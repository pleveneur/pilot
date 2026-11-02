# Rapport — La voix du SYSTÈME qui a disparu n'est plus remplacée en silence

> Micro-tâche : suite directe de « annoncer le repli de voix là où l'on écoute »
> (commit `4dffca3`, `RAPPORT-repli-voix-muet.md` § 5.1), qui signalait ce trou
> restant. Décision du propriétaire (384) : quand la voix choisie est absente ou
> hors service, on **prévient visiblement** — jamais de remplacement silencieux.
> Aucune voix téléchargée, aucun modèle supprimé, aucun réglage ajouté, aucun
> autre écran touché, `src-tauri/src/agents.rs` non modifié, rien de poussé, pas
> de tag, pas de version changée.

## 1. Constat (avant)

**Comment une voix du système disparaît.** Le réglage unique
(`read_aloud_voice`, champ des Options → onglet « Assistant ») mémorise
l'**identité stable** d'une voix du système (`voiceKey` = `voiceURI`, à défaut le
nom). Cette identité est propre à un **ordinateur** et à un **système** : elle
cesse d'exister si la voix est **désinstallée** (paquet de langue retiré, voix
SAPI/OneCore supprimée), si la configuration est **recopiée sur un autre poste**,
ou si le système change de version de moteur vocal. La liste réelle
(`speechSynthesis.getVoices()`) ne contient alors plus cette voix.

**Quel code s'en apercevait.** Un seul endroit, et il se taisait :
`resolveVoiceForChoice(voices, lang, choice)` (`src/js/read-aloud.js`) faisait
`findVoiceForChoice(...) || pickVoiceForLang(...)` — donc un repli **propre** sur
la voix de la langue de l'interface, mais **muet**. Le constat existait bien
ailleurs (`voiceChoiceStatus` → `kind: "missing"`), mais **uniquement** dans la
section des Options, fenêtre **fermée** pendant qu'on écoute une réponse.

**Pourquoi c'était muet pendant l'écoute.** L'état transmis au bouton ne
connaissait que deux replis : `local-fallback` (voix locale) et… rien pour la
voix du système. `speak()` émettait au mieux `speaking` → le bouton affichait
« Arrêter », et l'utilisateur entendait **une autre voix que celle qu'il avait
choisie sans aucune explication à l'écran**. Symptôme identique à celui corrigé
en `4dffca3`, sur l'autre moteur.

## 2. Geste fait (minimal, un seul mécanisme réutilisé)

Tout est dans `src/js/read-aloud.js`, sur le chemin **déjà** utilisé par le
repli de la voix locale :

| Élément | Rôle |
|---|---|
| `systemVoiceMissingCause(voices, choice)` | **pure** : compare la valeur mémorisée à la liste **réelle** des voix (`findVoiceForChoice` : identité stable puis nom). Renvoie `"voix introuvable"` quand le repli a lieu, `""` dans **tous** les autres cas |
| `readAloudSystemFallbackNotice(cause)` | **pure** : la phrase, une ligne — « Voix du système choisie indisponible (voix introuvable) : lecture avec la voix de la langue de l'interface. » |
| `speak()` (après `resolveVoiceForChoice`) | émet `notify("system-fallback", cause)` — même canal `onstate(state, cause)` que `local-fallback` |
| `createReadAloudButton()` | une branche `else if (state === "system-fallback")` : `setState("speaking")` + `showNotice(readAloudSystemFallbackNotice(cause))` — **le même** `span.agent-read-notice`, dans **la même** rangée, avec le style `.agent-read-notice` déjà livré |
| `readAloudStateLabel("system-fallback")` | la ligne d'état des Options dit la même chose (aucun écran nouveau) |

Rien d'autre n'a bougé : ni `index.html`, ni `settings.js`, ni `style.css`, ni le
Rust. **Aucun second mécanisme** : la mention vit et meurt exactement comme celle
du repli local (retirée au démarrage de la lecture suivante, absente du document
en dehors du repli, `role="status"`).

**Le réglage n'est pas réécrit** : `getPreferredVoiceName()` garde la valeur
mémorisée (vérifié par test). La remise sur « Automatique » reste un geste de la
section des Options (§ 3 de `spec_read_aloud.md`), pas un effet de la lecture.

## 3. Cas couverts

| Cas | Comportement |
|---|---|
| **Voix du système mémorisée absente** (désinstallée, autre poste, autre système) | Lecture avec la voix de la langue de l'interface **et** mention d'une ligne à côté du bouton « 🔊 Écouter » |
| **Voix du système présente et réellement utilisée** | **Aucune** mention, aucun état de repli émis (le cas normal reste muet) |
| **« Automatique »** (`read_aloud_voice: ""`) | Aucune mention : la voix de la langue de l'interface **est** le choix |
| **Voix locale choisie** | Inchangé : son repli a sa propre phrase (`local-fallback`), `systemVoiceMissingCause` renvoie `""` (aucune double mention) |
| **Aucune voix installée du tout** | Inchangé : l'état `no-voice` parle (bouton inactif + infobulle), pas un repli |
| **Voix revenue entre deux lectures** | La mention du repli précédent disparaît au démarrage de la lecture suivante |
| **Options ouvertes pendant la lecture** | La ligne d'état de la section affiche `readAloudStateLabel("system-fallback")` |

**Branchements vérifiés** (quality-gate § 3.2/3.3) : les 2 nouvelles fonctions
sont exportées et importées là où elles servent (aucun import mort), la nouvelle
branche du gestionnaire d'état est **avant** le `else` final (qui remet le bouton
au repos), l'évènement public `pilot-read-aloud-state` garde la même forme
(`{ state }`), et les appelants existants (`previewVoice` / `settings.js`) ne
tombent que dans leur branche par défaut (aucun changement d'écran).

## 4. Tests — `src/js/repli-voix-muet.test.js` renforcé (pas de second fichier)

15 contrôles (7 nouveaux), dont :

- `systemVoiceMissingCause` : repli **seulement** si la voix manque réellement —
  présente par nom **et** par identité stable → `""` ; disparue →
  `"voix introuvable"` (aucun identifiant technique dans la cause) ;
  « Automatique », voix locale, liste vide → `""` ;
- la phrase : courte (< 120 caractères), une seule ligne, dit ce qui se passe
  (« voix du système », « indisponible ») **et ce qui est utilisé à la place**
  (« voix de la langue de l'interface »), sans mot alarmant, sans parenthèse
  quand la cause est inconnue ;
- `readAloudStateLabel("system-fallback")` nomme le repli ;
- le lecteur transmet bien `system-fallback` + sa cause ;
- **CAS 4** (le cas du défaut) : la voix de la langue de l'interface parle
  réellement (Hortense), la mention apparaît **dans la rangée du bouton**
  (`role="status"`, **un seul** `span.agent-read-notice`) et le réglage mémorisé
  reste **intact** ;
- **CAS 5** : voix présente et utilisée → **aucune** mention, réglage intact ;
- la mention disparaît à la lecture suivante quand la voix est revenue.

**Les nouveaux cas mordent** (vérifié en cassant exprès, puis restauré — fichier
comparé à l'identique, `diff` vide) :

| Sabotage | Résultat |
|---|---|
| retirer `notify("system-fallback", …)` dans `speak()` | **3 tests rouges** |
| forcer `systemVoiceMissingCause` à renvoyer toujours `"voix introuvable"` | **3 tests rouges** |
| retirer la branche d'affichage `system-fallback` du bouton | **2 tests rouges** |

Suite complète : `npm test` → **195 fichiers, 3450 tests, 0 échec**.
`npm run build` → **`✓ built in 12.81s`** (aucune erreur).
`npm run build:handbook` → handbook régénéré (45 blocs), **seul** le bloc
`HELP:lire-reponses` change.

## 5. Documentation

- `spec_read_aloud.md` : § 3 (voix mémorisée disparue = annoncée là où l'on
  écoute, réglage non réécrit), **nouveau § 4 ter** (repli de la voix du
  système : un seul endroit pour le constater, un seul mécanisme, une ligne, cas
  normal muet, réglage intact, état lisible dans les Options), § 6 (couverture
  et neutralisations) ;
- `help/overview.md`, bloc `HELP:lire-reponses` : la puce « La voix choisie a
  disparu de l'ordinateur » dit désormais que Pilot **le dit aussi à côté du
  bouton « 🔊 Écouter »**, que le choix enregistré n'est pas modifié et qu'aucune
  ligne n'apparaît quand la voix est présente ;
- `help/handbook.md` régénéré (jamais édité à la main).

## 6. Ce qui reste non vérifiable ici

1. **Une voix réellement désinstallée sur ce poste.** Les tests utilisent une
   voix factice absente de la liste : le comportement est prouvé au niveau du
   code et de l'écran, pas contre un pilote SAPI/OneCore réellement retiré (ou un
   `voiceURI` effectivement absent d'un autre système d'exploitation). La preuve
   de bout en bout demanderait de désinstaller un paquet de langue Windows puis
   de relancer Pilot — hors périmètre de cette micro-tâche, et non fait ici.
2. **Le rendu visuel de la ligne** (taille, italique, couleur secondaire) n'est
   pas vérifié à l'écran : il réutilise exactement le style `.agent-read-notice`
   déjà livré et déjà vu en `4dffca3` ; aucun style nouveau n'a été ajouté.
3. **Le cas d'une voix présente qui échoue à parler** (voix listée mais
   `utterance.onerror`) n'est pas traité : il n'y a alors **aucun** repli (la
   lecture s'arrête), donc aucune mention de repli à afficher. Point signalé,
   non modifié.
