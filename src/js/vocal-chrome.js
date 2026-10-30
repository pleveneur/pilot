/**
 * vocal-chrome.js — LE BAS DE L'ECRAN VOCAL S'EFFACE AU REPOS.
 *
 * Source UNIQUE des decisions du masquage (CONCEPTION-ecran-vocal-cercle-et-bas.md
 * §2) : ce module est PUR (aucun DOM, aucune minuterie, aucun appel), il ne
 * decide que sur des faits qu'on lui donne. L'ecriture de la classe CSS, les
 * ecouteurs et l'unique minuteur vivent dans `super-agent.js`
 * (`vocalSyncChrome`), qui ne fait rien d'autre que d'appliquer ce que ce
 * module tranche.
 *
 * Les TROIS noeuds masques, et eux seuls : la ligne d'etat, la zone de saisie,
 * le bouton de depannage du micro. Le disque, le bouton de relance, le logo
 * (bouton des trois modes) et l'entree « Travail » ne sont JAMAIS masques : le
 * CSS ne les nomme pas, et un test le verifie. La rangee des questions en
 * attente n'est pas masquee non plus : elle vit DANS la zone de saisie, et la
 * regle 5 ci-dessous interdit de l'effacer tant qu'une question attend.
 */

/** Delai avant le REMASQUAGE, quand aucun geste ne vient : 2 500 ms. */
export const VOCAL_CHROME_IDLE_MS = 2500;

/**
 * Tolerance du pointeur : un deplacement cumule de 4 px depuis le dernier
 * reveil est un geste. Sous ce seuil, le tremblement d'une main posee ne
 * reveille rien.
 */
export const VOCAL_CHROME_MOVE_PX = 4;

/** La classe posee sur l'overlay quand le bas est efface (source unique). */
export const VOCAL_CHROME_HIDDEN_CLASS = "vocal-chrome-hidden";

/**
 * PEUT-ON effacer le bas ? PURE — l'ORDRE de ces cinq regles EST la spec.
 *
 * Rend `true` quand au moins une des cinq circonstances INTERDIT le
 * masquage — c'est-a-dire quand le bas doit rester a l'ecran :
 *
 *  1. **Le micro est ferme** (refus, absence, occupation, panne) : le bouton
 *     « Autoriser le micro » est le seul recours, il ne s'efface jamais.
 *  2. **Le champ de saisie est occupe** : il contient du texte (brouillon, ou
 *     dictee en cours de transcription) ou il a le focus.
 *  3. **Pilot ecoute ou parle** : pendant l'ecoute, la ligne d'etat est la seule
 *     chose qui dit que le micro est ouvert ; pendant la lecture, c'est elle qui
 *     dit que Pilot repond. Aucun des deux ne peut etre efface.
 *  4. **Le pointeur vise la zone du bas** — mais par le GESTE, jamais par la
 *     seule position : on ne cache pas ce que la souris vient de viser.
 *     C'est ce que dit le fait `pointeurGeste` (remarque du proprietaire du
 *     2026-10-03 : « la barre doit disparaitre quand on ne fait rien »). Une
 *     souris simplement POSEE sur la bande du bas — qui couvre toute la largeur
 *     de l'ecran — ne retenait le bas qu'aucun reglage ne pouvait plus effacer :
 *     il fallait en sortir pour que le decompte reprenne. Desormais
 *     `pointeurGeste === false` signifie « le decompte est alle au bout, il ne
 *     reste qu'une position », et le masquage est permis. Le fait absent
 *     (`undefined`) vaut geste recent : un appelant qui ne le fournit pas garde
 *     le comportement d'avant.
 *  5. **Une question de l'assistant attend une reponse** : la rangee de
 *     boutons vit au-dessus de la ligne de saisie, donc DANS le bas. L'effacer
 *     rendrait la question invisible et le travail resterait bloque sans que
 *     l'utilisateur puisse savoir pourquoi. Une question humaine ne s'efface
 *     jamais : ce n'est pas un decor, c'est ce qu'on attend de vous.
 *
 * Aucune autre circonstance ne retient le bas : au repos, champ vide, aucune
 * question en attente et pointeur ailleurs, le masquage est permis (et la
 * dictee armee mais encore muette n'y change rien — c'est le cas particulier
 * voulu : l'ecran reste nu).
 *
 * @param {{etat?: string, saisie?: boolean, micFerme?: string|boolean, pointeurActif?: boolean, pointeurGeste?: boolean, question?: boolean}} [faits]
 * @returns {boolean} true = le bas reste visible (masquage interdit)
 */
export function vocalChromeVisible(faits = {}) {
  const f = faits || {};
  // 1. Micro ferme : le bouton de depannage ne s'efface jamais.
  if (String(f.micFerme == null ? "" : f.micFerme).trim() !== "") return true;
  // 2. Champ occupe (texte present ou focus dedans).
  if (f.saisie === true) return true;
  // 3. Pilot ecoute ou parle.
  if (f.etat === "listening" || f.etat === "speaking") return true;
  // 4. Pointeur sur la zone du bas : un GESTE la retient, une simple position non
  // (`pointeurGeste === false` = le decompte est alle au bout).
  if (f.pointeurActif === true && f.pointeurGeste !== false) return true;
  // 5. Une question de l'assistant attend une reponse (regle ajoutee avec le
  // correctif « les questions ne sont pas visibles dans l'ecran Vocal ») : le
  // bas porte la rangee de boutons, il ne s'efface donc jamais tant qu'une
  // question est en file. Rien n'expire ici : c'est l'utilisateur qui repond.
  if (f.question === true) return true;
  // Rien ne retient le bas : le masquage est permis.
  return false;
}

/**
 * L'ETAT QUI RETIENT LE BAS (§2.6, regle 3 de `vocal-chrome.js`) — et pourquoi ce
 * n'est PAS l'etat de l'ecran tel quel.
 *
 * LE DEFAUT CORRIGE (remarque du proprietaire du 2026-11-03 : « la barre ne
 * s'efface plus du tout »). Le mecanisme d'effacement n'etait pas casse : la
 * regle 3 interdit le masquage des que l'etat vaut « ecoute » ou « parole ».
 * Mais depuis que l'etat « ecoute » se calcule sur une MESURE de niveau (lot 3,
 * `9a8c2cf`), ce fait n'est plus un fait d'usage : la mesure du micro est
 * ouverte A L'ENTREE du mode et jamais refermee (`requestVocalMeasure(
 * "entree")`), la descente de l'hysteresis (`VOCAL_VOICE_OFF = 0,03`) est SOUS le
 * plancher de voix du projet (`BARGE_IN_MIN_LEVEL = 0,05`, vocal-mic.js), et le
 * micro demande `autoGainControl` : le plancher de bruit d'une piece silencieuse
 * passe donc au-dessus du seuil de sortie, l'etat ne revient jamais au repos, et
 * la regle 3 retient le bas pendant toute la session. Le decompte de 2 500 ms
 * sonnait, `vocalSyncChrome` recalculait, et repondait encore « visible ».
 *
 * LE FAIT RETENU EST DONC UN FAIT D'USAGE, JAMAIS UNE MESURE :
 *  - « parole » retient toujours (Pilot lit une reponse, on doit pouvoir couper) ;
 *  - « ecoute » ne retient que si la dictee ouverte a REELLEMENT transcrit un mot
 *    (`vocalMotRecu`) : c'est la seule preuve que l'utilisateur se sert du bas ;
 *  - tout le reste vaut repos.
 * Une piece silencieuse, un souffle, un gain automatique : plus rien de cela ne
 * peut retenir le bas. Aucun second mecanisme n'est ajoute, aucune duree ne
 * change, aucune autre regle n'est touchee.
 *
 * @param {{etat?: string, dicteeOuverte?: boolean, motRecu?: boolean}} [faits]
 * @returns {"idle"|"listening"|"speaking"} l'etat que la regle 3 a le droit de voir
 */
export function vocalEtatQuiRetientLeBas(faits = {}) {
  const f = faits || {};
  if (f.etat === "speaking") return "speaking";
  if (f.etat === "listening" && f.dicteeOuverte === true && f.motRecu === true) {
    return "listening";
  }
  return "idle";
}

/**
 * La classe CSS a poser sur l'overlay. PURE.
 * `vocalChromeVisible` rend « le bas reste visible » : c'est son INVERSE qui
 * pose la classe — une seule correspondance, jamais deux.
 * @param {boolean} visible
 * @returns {string} `"vocal-chrome-hidden"` ou `""`
 */
export function vocalChromeClass(visible) {
  return visible === false ? VOCAL_CHROME_HIDDEN_CLASS : "";
}

/**
 * Cette touche reveille-t-elle le bas ? PURE.
 * Toute frappe reveille le bas, SAUF Echap : c'est la touche de sortie du mode
 * (§8), elle ne doit pas rallumer l'ecran au moment ou on le quitte.
 * @param {string} touche valeur de `KeyboardEvent.key`
 * @returns {boolean}
 */
export function vocalChromeWakeKey(touche) {
  const k = String(touche == null ? "" : touche);
  return !(k === "Escape" || k === "Esc");
}

/**
 * Le pointeur a-t-il bouge assez pour valoir un geste ? PURE.
 *
 * Distance entre la position courante et le REPERE (la derniere position qui a
 * reveille le bas, ou la position d'entree) : au-dela de `seuil`, c'est un geste.
 * Sans repere connu (premier mouvement apres l'entree du mode), on reveille —
 * l'ecran vient de s'ouvrir, son bas est visible de toute facon.
 *
 * @param {{x?: number, y?: number}} [courant]
 * @param {{x?: number, y?: number}|null} [repere]
 * @param {number} [seuil]
 * @returns {boolean}
 */
export function vocalChromeMoved(courant, repere, seuil = VOCAL_CHROME_MOVE_PX) {
  const c = courant || {};
  const x = Number(c.x);
  const y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const r = repere || null;
  const rx = r ? Number(r.x) : NaN;
  const ry = r ? Number(r.y) : NaN;
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return true;
  const s = Number.isFinite(seuil) && seuil > 0 ? seuil : VOCAL_CHROME_MOVE_PX;
  return Math.hypot(x - rx, y - ry) >= s;
}
