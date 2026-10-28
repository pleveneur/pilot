# RAPPORT — Écran Vocal : les deux dernières gardes (attente bornée, plafond atteignable)

Micro-tâche de fermeture de **deux défauts non bloquants** signalés par une revue
indépendante (verdict FEU VERT). Tous deux reproduisaient le profil du défaut
d'origine de cet écran : **un écran muet qui n'explique rien**. Aucune
fonctionnalité nouvelle, aucun réglage, aucun bouton, aucune apparence touchée.

---

## 1. Défaut n° 1 — l'attente du statut du projet n'était pas bornée

### Ce qui se passait
À l'entrée du mode, `refreshVocalSensitivity()` demandait au moteur
(`invoke("is_project_sensitive")`) si le projet ouvert est marqué 🔒. La promesse
n'avait **aucune borne**. Tant qu'elle n'avait pas répondu :

- la décision pure refusait l'armement (`sensibilite-inconnue`) — c'est voulu :
  on ne parie pas « projet libre » pour une dictée qui passe par le réseau ;
- mais **aucune phrase n'était affichée** (cette raison n'était traduite nulle
  part dans `vocalStatusLine`) ;
- et le **geste 🎙️ rendait la main en silence** : `toggleVoiceInput` sortait sur
  `if (!vocalSensibiliteConnue) return;`, sans message.

Un moteur lent (ou bloqué) laissait donc l'écran muet et le bouton sans effet —
exactement le défaut que la revue reprochait au reste de l'écran.

### Ce qui a été fait (chemins fermés)
| Fichier | Ligne | Changement |
|---|---|---|
| `src/js/super-agent.js` | 4369 | `const VOCAL_SENSITIVITY_TIMEOUT_MS = 800;` — délai court, **même ordre que `BADGE_PROJECTS_COLLECT_TIMEOUT_MS`** (800 ms, la seule autre attente bornée du fichier) |
| `src/js/super-agent.js` | 4402-4410 | l'appel passe par **`withTimeout(...)`** (ligne 2408), la garde **déjà écrite pour cette doctrine** — aucune seconde mécanique d'attente bornée, aucun `Promise.race` écrit à la main ici |
| `src/js/super-agent.js` | 4411-4422 | **délai dépassé** (`null`, le repli de `withTimeout`) ⇒ `vocalSensibiliteConnue = false`, `vocalSensibiliteIndisponible = true`. **Aucune écriture de `vocalProjectSensible`** dans cette branche : le projet reste **non vérifié**, jamais supposé libre |
| `src/js/super-agent.js` | 3378 | nouveau drapeau `vocalSensibiliteIndisponible`, remis à zéro à chaque relecture (4394/4399), à la sortie du mode (4684) et à l'entrée sans projet (4394) |
| `src/js/super-agent.js` | 4433 | le drapeau entre dans l'état par le champ que la décision pure lit : `sensibiliteIndisponible: ...` |
| `src/js/vocal-conversation.js` | 230-237 | nouvelle règle **`7b`** (`sensibilite-indisponible`) : **désarmée**, placée **après** la règle 5 (« déjà ouverte ») et **avant** l'ancienne 7b (devenue `7c`) — une dictée ouverte **par un geste** n'est donc jamais refermée par cette raison |
| `src/js/super-agent.js` | 4211-4214 | `vocalStatusLine` traduit la raison ⇒ **une phrase** (voir §3) |
| `src/js/super-agent.js` | 3625 | `toggleVoiceInput` : `if (!vocalSensibiliteConnue && !vocalSensibiliteIndisponible) return;` ⇒ **pendant** l'attente, le geste n'ouvre toujours pas au hasard ; **après** une attente bornée sans réponse, **le geste fonctionne** — l'utilisateur décide, une fois averti |
| `src/js/voice-auto-send.js` | — | inchangé par ce défaut |

Fail-open **inchangé** : une **erreur d'IPC** vaut toujours « réponse connue à
`false` » (`.catch(() => ({ sensible: false }))`, comportement d'avant).

### Ce qui n'a pas été touché
Les seuils de coupure (`vocal-mic.js`), l'apparence et les jetons `--vocal-*`,
les phrases existantes **déjà vraies**, les trois sorties du mode, l'ordre
`requestVocalMeasure("entree")` → `refreshVocalSensitivity()` →
`applyVocalState()`.

---

## 2. Défaut n° 2 — le plafond des sessions vides était inatteignable

### Ce qui se passait
Le plafond (3 fins vides en 30 s ⇒ plus d'armement automatique) ne comptait que
la fin **normale et vide** : `if (!fin || fin.reason !== VOICE_END_EMPTY) return;`.

Or un moteur de reconnaissance qui rend la main **sans rien transcrire et sans
erreur affichée** (`no-speech`, `aborted` sans geste) ferme la session avant
`onend` : la fin arrivait en `VOICE_END_NO_SESSION`, **jamais comptée**. Le micro
pouvait donc se rouvrir **sans limite**, sans un mot à l'écran — un écran muet
qui tourne en boucle.

### Ce qui a été fait (chemins fermés)
| Fichier | Ligne | Changement |
|---|---|---|
| `src/js/voice-auto-send.js` | 96-133 | nouvelle fonction **PURE** `isSilentEmptyVoiceEnd(fin, contexte)` : compte la fin **normale et vide** ET la fin **silencieuse du moteur** ; ne compte **pas** une erreur affichée, un arrêt demandé, ni une reprise en main. Elle vit **à côté de `normalizedVoiceText`** : le vide d'une dictée se constate **à un seul endroit** |
| `src/js/super-agent.js` | 47 | `import { applyVoiceEnd, isSilentEmptyVoiceEnd }` — **la détection existante est réutilisée**, aucune seconde détection du vide (`dictatedText`/`trim()` n'apparaissent pas dans le compteur) |
| `src/js/super-agent.js` | 3591 | `voiceStopVoulu = true` dans `stopVoiceInput()` (bouton 🎙️, envoi, sortie du mode) : un arrêt **demandé** ne compte pas |
| `src/js/super-agent.js` | 3662-3663 | remise à zéro **par session** : `voiceStopVoulu = false;` et `let erreurAffichee = false;` (aucun drapeau qui survit d'une dictée à l'autre) |
| `src/js/super-agent.js` | 3703 | `erreurAffichee = vocalDictationMessage(ev.error) !== "";` — une erreur **affichée** (elle a déjà sa phrase) n'est pas une fin silencieuse |
| `src/js/super-agent.js` | 3720 | `const arretDemande = voiceStopVoulu;` lu **avant** `applyVoiceEnd` |
| `src/js/super-agent.js` | 3739 | `vocalNoteEmptySession(fin, { erreurAffichee, arretDemande });` |
| `src/js/super-agent.js` | 4321 | le compteur délègue la nature de la fin : `if (!isSilentEmptyVoiceEnd(fin, contexte)) return;` — `noteEmptyVocalSession` (seuil 3 / 30 s) **inchangé** |

Le plafond reste **posé par la fin d'écoute et par rien d'autre**, ne se lève
**pas avec le temps**, et se lève par **un geste** (🎙️ ou nouvelle entrée dans le
mode) : comportement d'avant, simplement désormais **atteignable**.

---

## 3. Les phrases ajoutées (une seule, et elle sert les deux gardes)

| Constante | Texte | Où |
|---|---|---|
| `VOCAL_MESSAGE_SENSIBILITE_INCONNUE` | « État du projet non vérifié : appuyez sur le micro pour dicter, ou écrivez votre demande. » | `vocal-conversation.js` (source unique), affichée par `vocalStatusLine` sur l'**unique** ligne d'état |

Aucune autre phrase créée. Les phrases du repos, de l'écoute, de la réflexion, de
la parole, du micro et du plafond (`VOCAL_MESSAGE_DICTEE_ECHEC`) sont
**inchangées**. Aucun bouton, aucun réglage, aucune zone de débogage : la phrase
ne pose pas `vocalMicFerme`, donc elle n'ajoute **pas** de bouton « Autoriser le
micro ».

---

## 4. Tests

### Nouveau verrou : `src/js/vocal-deux-gardes-finales.test.js` (16 tests)
Décisions **pures** testées pour elles-mêmes + **branchements** lus dans les
sources (fins de ligne normalisées, commentaires retirés ; découpage vérifié par
`sliceSource`, jamais un `indexOf` nu).

- **Plafond** : fin normale et vide compte ; fin **silencieuse du moteur**
  compte (défaut corrigé) ; erreur affichée / arrêt demandé / reprise en main /
  texte transcrit ne comptent pas ; entrées invalides sans exception ; **3 fins
  vides en 30 s ⇒ `suspendu` puis plus d'armement** (`sessions-vides`) ; une
  seule fin ne suffit pas ; le vide est constaté **une seule fois**
  (`normalizedVoiceText`, aucun `.trim()` ailleurs).
- **Branchement du plafond** : `erreurAffichee`, `voiceStopVoulu` (posé **une**
  fois, remis à zéro **une** fois par session), `arretDemande` lu avant,
  `applyVoiceEnd` appelé **une** fois.
- **Attente bornée** : `withTimeout` utilisé, **un seul** appel de ce type pour
  `is_project_sensitive`, délai entre 200 et 1500 ms, aucun `Promise.race` ni
  `new Promise` écrit ici (pas de second mécanisme).
- **Délai dépassé** : sentinelle `null`, `sensibiliteIndisponible = true`,
  **aucune** écriture de `vocalProjectSensible` dans la branche, fail-open IPC
  conservé, drapeau remis à zéro (≥ 4 sites).
- **« Délai dépassé ⇒ phrase affichée et geste qui marche »** : la raison
  `sensibilite-indisponible` est **traduite** par l'écran (phrase non vide, une
  ligne, < 120 caractères, distincte de celle du plafond) ; le geste ne sort
  plus sur `!vocalSensibiliteConnue` seul ; le refus « projet sensible **connu** »
  reste **prioritaire** ; le geste lève toujours le plafond.
- **Non-régression de la règle 5** : une dictée ouverte **par un geste** reste
  `deja-ouverte` (jamais refermée par la nouvelle raison) ; pendant l'attente
  non dépassée, la raison reste `sensibilite-inconnue`.

### Tests existants modifiés (2) — motif écrit
| Fichier | Pourquoi |
|---|---|
| `src/js/vocal-correctifs-revue.test.js` | ses deux ancres pointaient le **défaut corrigé** (`fin.reason !== VOICE_END_EMPTY`, `vocalNoteEmptySession(fin)`) : elles sont remplacées par la forme corrigée (`isSilentEmptyVoiceEnd(fin, contexte)`, `vocalNoteEmptySession(fin, { erreurAffichee, arretDemande })`), avec le même objet de vérification (compter les fins **vides** seulement, dans l'écran seulement, sans seconde détection du vide) |
| `src/js/vocal-mesure-en-premier.test.js` | son ancre exigeait `if (!vocalSensibiliteConnue) return;` — **c'est le bouton sans effet** que la mission corrige ; remplacée par la garde à deux drapeaux, l'intention (« pas d'ouverture au hasard pendant l'attente ») étant conservée et renforcée |

**Aucun test supprimé.**

### Contre-épreuve (défauts réintroduits à la main, puis restaurés)
1. `isSilentEmptyVoiceEnd` remis à `fin.reason === VOICE_END_EMPTY` seul ⇒
   **2 échecs** (« la fin silencieuse du moteur compte », « le plafond s'atteint »).
2. `withTimeout` retiré **et** garde du geste remise à `!vocalSensibiliteConnue`
   ⇒ **3 échecs** sur les deux fichiers concernés. Restauration vérifiée
   (`PASS (54)`).

### Résultats
- `npm test` : **207 fichiers, 3762 tests, 0 échec**.
- `npm run build` : `✓ built in 12.46s`.
- `npm run build:handbook` : régénéré (46 blocs).

---

## 5. Documentation

| Fichier | Mise à jour |
|---|---|
| `spec_modes_ecran_vocal.md` | §6bis : plafond = fins **vides** (normale **et** silencieuse), jamais une erreur **affichée** / un arrêt **demandé** / une reprise en main ; **attente bornée** du statut du projet (800 ms, `withTimeout`, non vérifié ⇒ pas d'armement mais phrase + geste) ; §10 : ligne `voice-auto-send.js` (seule détection du vide, `isSilentEmptyVoiceEnd`), ligne `vocal-conversation.js` complétée, verrou `vocal-deux-gardes-finales.test.js` cité |
| `help/overview.md` (bloc `<!-- HELP:modes-ecran -->`) | version utilisateur : la question du projet 🔒 est posée avec une **attente courte et bornée**, l'écran le dit et **le bouton 🎙️ marche** (jamais un bouton sans effet, jamais un armement deviné) ; le plafond compte les fins **vides**, « y compris celles où le moteur s'arrête sans rien dire » |
| `help/handbook.md` | **régénéré** (`npm run build:handbook`), jamais édité à la main |

---

## 6. Doutes restants (dits, non masqués)

1. **Réponse tardive ignorée** : `withTimeout` ne l'annule pas ; si la réponse
   « projet sensible » arrive **après** les 800 ms, elle n'est plus appliquée
   (la course est déjà résolue). Comme la dictée ne s'est pas armée toute seule,
   le seul cas est celui d'un **geste 🎙️ explicite** postérieur à l'avertissement :
   la responsabilité est alors à l'utilisateur, averti. Une seconde lecture
   tardive aurait demandé un second mécanisme — refusé par la mission.
2. **Fins « silencieuses » dépendantes du moteur** : `no-speech` / `aborted`
   sont des codes standard, mais un moteur qui rendrait la main **sans aucun
   évènement** ne produirait pas de fin du tout (aucun code n'est alors compté).
   Ce cas n'est pas couvert ici et n'était pas dans le périmètre.
3. **`erreurAffichee` évalué par `vocalDictationMessage(ev.error)`** : c'est la
   **même** source que la phrase réellement affichée (aucune table en double),
   mais l'appel est écrit deux fois (une pour le drapeau, une pour le message).
   Fonction pure, coût nul ; une variable intermédiaire aurait changé une ancre
   de test existante (préféré : garder l'ancre).

Aucun de ces points ne bloque, aucun ne modifie le comportement promis.

---

## 7. Fichiers touchés

- `src/js/super-agent.js` (attente bornée, drapeau, garde du geste, phrase,
  contexte de fin d'écoute) ;
- `src/js/vocal-conversation.js` (règle 7b, phrase, en-tête de vocabulaire) ;
- `src/js/voice-auto-send.js` (`isSilentEmptyVoiceEnd`, seule détection du vide) ;
- `src/js/vocal-deux-gardes-finales.test.js` (**nouveau**, 16 tests) ;
- `src/js/vocal-correctifs-revue.test.js` et `src/js/vocal-mesure-en-premier.test.js`
  (2 ancres du défaut corrigé, motif ci-dessus) ;
- `spec_modes_ecran_vocal.md`, `help/overview.md`, `help/handbook.md` (régénéré) ;
- ce rapport.

Ni `vocal-mic.js` (seuils, garde anti-auto-coupure), ni `screen-mode.js`, ni
`index.html`, ni `src/css/style.css` n'ont été modifiés.

**VERDICT : les deux gardes sont fermées** — l'attente du statut du projet est
bornée par la garde existante (800 ms), le projet non vérifié n'est jamais
supposé libre, l'écran le dit en une phrase et le bouton 🎙️ fonctionne ; le
plafond des sessions vides compte désormais les fins silencieuses du moteur (3 en
30 s ⇒ plus d'armement automatique), avec une seule détection du vide, réutilisée.
Aucun réglage, aucun bouton, aucun affichage de débogage, aucune apparence
touchée. Reproduction verrouillée par 16 tests, contre-épreuve prouvée par
réintroduction des deux défauts (2 puis 3 échecs).
