# Rapport — préchauffage de la voix imitée AU DÉMARRAGE

**Date** : 2026-11-14
**Mission** : supprimer l'attente de la PREMIÈRE phrase lue après le lancement
de Pilot, quand la voix mémorisée est la **voix imitée** (service local
VoiceStudio). Rien d'autre ne devait bouger.

**Livré** : une décision PURE (`shouldPrewarmVoiceStudio`), un déclenchement
unique et silencieux **après** l'affichage de la fenêtre, au plus **une** seconde
tentative discrète, une garde en mémoire contre le double préchauffage, un test
de branchement, une section de spec et une note d'aide.

---

## 1. Le constat (prouvé, fichier:ligne)

| # | Fait | Preuve |
|---|---|---|
| 1 | Le préchauffage **existait déjà**, mais seulement **sur geste** dans les Paramètres : ouvrir l'onglet Assistant et changer de voix lançait `warmupVoiceStudio`. | `src/js/settings.js:766` (`warmupVoiceStudio({ voice: voiceStudioProfileIdFor(wanted) })`), sous la garde `options.gesture` |
| 2 | Au **démarrage**, personne ne préchauffait : la première lecture après lancement payait le démarrage à froid du service (≈ 6 s mesurées par le propriétaire). | aucun appelant de `warmupVoiceStudio` hors `settings.js` avant ce lot (`rg` sur `src/js`) |
| 3 | Le préchauffage était déjà **muet** et déjà **délégué à la machine** (commande asynchrone hors thread de la fenêtre). | `src/js/voicestudio-voice.js:449` → `src-tauri/src/tts_voicestudio.rs` commande `tts_voicestudio_warmup` (`pub async fn` + `spawn_blocking`) |
| 4 | Le démarrage a un point d'affichage **tardif** et identifié : le masquage de l'écran de chargement. Tout ce qui est posé après lui ne retarde pas l'affichage. | `src/js/main.js:1474` (`bootOverlay.classList.add("hidden")`), puis `void initOnboarding(...)` (motif déjà en place pour du travail non attendu) |
| 5 | La valeur mémorisée de la voix est **une seule chaîne** (`read_aloud_voice`), et son type n'est reconnu qu'à **un seul endroit** (`voiceStudioProfileIdFor`). | `src/js/voicestudio-voice.js:91` (`VOICESTUDIO_VOICE_PREFIX`) |

**Conclusion du constat** : il n'y avait rien à réparer côté machine ni côté
lecture. Il manquait **un déclencheur**, et il manquait une **décision pure** qui
l'autorise — les deux sont l'objet de ce lot.

---

## 2. La décision

**Préchauffer une fois au démarrage, si et seulement si la voix mémorisée est une
voix IMITÉE valide (identifiant de profil présent). Sinon, ne rien faire du tout.**

- `shouldPrewarmVoiceStudio(value)` — `src/js/voicestudio-voice.js:123` — PURE :
  `voiceStudioProfileIdFor(value) !== ""`. Elle ne recopie **pas** la grammaire
  des valeurs (aucun préfixe réécrit) : la reconnaissance du type de voix reste
  dans le module de la voix imitée, à un seul endroit.
- **Non** pour : voix du système (`Microsoft Hortense`), voix locale
  (`local:piper`, `local:piper:<modèle>`), valeur vide, valeur inconnue,
  `local:voicestudio` sans profil.
- **Oui** pour : `local:voicestudio:<profil>` (espaces autour tolérés).

Le préchauffage lui-même ne change pas de nature : il ne lit rien, ne joue rien,
ne vole aucune parole. Il demande à la machine de charger le modèle.

---

## 3. Le déclenchement (et pourquoi là)

`src/js/main.js:1490` — **après** `bootOverlay.classList.add("hidden")`
(`main.js:1474`), dans la portion de démarrage, sous la forme :

```js
try {
  void prewarmVoiceStudioAtStartup();
} catch (_) {
  // Silence total : un préchauffage impossible ne concerne pas l'utilisateur.
}
```

Quatre raisons à cet emplacement :

1. **Après l'affichage** : le masquage du chargement est le dernier acte visible
   du démarrage ; rien de ce qui suit ne retarde la fenêtre.
2. **`void`, jamais `await`** : l'appel rend la main immédiatement. Le travail
   réel (lire la configuration, parler à la machine) part en tâche de fond.
3. **Le motif est déjà celui du projet** : `void initOnboarding(...)` juste après
   (`main.js:1502`) — même règle, aucune invention.
4. **Le `try` est une ceinture** : la fonction ne lève jamais, mais le chemin de
   démarrage ne doit dépendre d'aucune promesse tenue par un module de voix.

La fonction elle-même (`src/js/voicestudio-voice.js:567`) :

- garde en mémoire `prewarmStartupStarted` (`:527`) : **un seul** préchauffage par
  démarrage, réarmable seulement par `resetPrewarmStartupGuard()` (tests) ;
- lit la voix mémorisée (`get_config` → `read_aloud_voice`), et **sort sans rien
  faire** si la décision est « non » ;
- **une** tentative ; si elle échoue pour une raison **passagère**
  (`isTransientWarmupFailure`, `:510` : service injoignable, connexion refusée,
  délai dépassé), **une** seconde tentative après
  `VOICESTUDIO_PREWARM_RETRY_MS` = 5 000 ms (`:496`) ; un échec **définitif** (voix
  inconnue, refus) n'est **jamais** repris ;
- **aucune boucle**, **aucune** nouvelle tentative à chaque lecture : au pire deux
  appels par lancement de Pilot ;
- toute panne (configuration illisible, exception du service, exception du
  rapporteur) → `false`, **sans exception**, **sans message**, **sans ligne de
  journal** : le repli existant (voix locale puis voix du système) reste seul en
  jeu, inchangé.

Interdits respectés : **aucun** réglage ajouté, **aucune** case à cocher, **aucun**
changement du repli ni des réglages de voix, **aucune** modification de Piper ni
du moteur local, **aucune** installation/lancement/téléchargement de VoiceStudio
par Pilot, **aucune** attente sur le chemin de démarrage, **aucun** son produit.

---

## 4. Ce que chaque test empêche

Fichier : `src/js/prechauffage-voix-imitee-demarrage.test.js` (18 contrôles).

| § | Contrôle | Ce qu'il empêche |
|---|---|---|
| 1 | décision pure : oui pour une voix imitée valide ; non pour système, Piper, vide, inconnue, `local:voicestudio` sans profil ; le corps de la décision passe par `voiceStudioProfileIdFor` | qu'une voix du système ou une voix locale réveille le logiciel pour rien ; qu'une seconde grammaire de valeurs apparaisse |
| 2 | aucune commande de préchauffage pour système / Piper / vide / inconnu (seule la **lecture** de la configuration part) ; pour la voix imitée : **un** appel `tts_voicestudio_warmup` avec l'identifiant du profil, rien d'autre (ni état, ni synthèse, ni journal) | le déclenchement pour la mauvaise voix, et l'appel en double ou accompagné d'effets |
| 3 | service injoignable → `false`, **aucune** exception, **aucune** sortie console, aucune ligne de journal ; configuration illisible → silence, aucun préchauffage ; échec définitif → pas de seconde tentative | qu'une panne du logiciel casse le démarrage ou parle à l'utilisateur ; qu'un refus définitif soit réessayé |
| 4 | l'appel rend la main avant la fin ; dans `main.js` : un seul import, appel en `void`, **jamais** `await`, posé **après** le masquage du chargement | un `await` ajouté un jour sur le chemin de démarrage, ou un appel déplacé avant l'affichage |
| 5 | échec passager → exactement **deux** tentatives espacées de `VOICESTUDIO_PREWARM_RETRY_MS` ; deux échecs passagers → la seconde est la dernière ; exception « injoignable » traitée comme passagère ; `isTransientWarmupFailure` distingue passager/définitif | une boucle de relance, une relance à chaque lecture, ou une relance sur un refus définitif |
| 6 | second appel = aucun nouveau préchauffage (garde en mémoire) ; le préchauffage n'est pas une lecture (ni `new Audio`, ni lecteur, ni synthèse) et le module ne joint jamais le service lui-même (`fetch(` absent) | le double préchauffage, et un préchauffage qui produirait du son ou ouvrirait une seconde porte réseau |

**Preuves par neutralisation (mesurées, puis code restauré)** :

| Neutralisation | Résultat observé |
|---|---|
| (b) garde de décision retirée (`if (!shouldPrewarmVoiceStudio(choice)) return false;` supprimée) | **3 échecs** au § 2 (système, Piper, valeur vide/inconnue) |
| (c) silence de la lecture de configuration retiré (`try/catch` de `loadChoice`) | **1 échec** au § 3 (« configuration illisible ») |
| (c bis) les **deux** silences du préchauffage retirés (celui de `warmupVoiceStudio` et celui de `attempt`) | **2 échecs** au § 3 (« service injoignable ») et au § 5 (exception passagère) |
| garde de double préchauffage retirée | **1 échec** au § 6 |
| appel `void prewarmVoiceStudioAtStartup();` retiré de `main.js` | **1 échec** au § 4 |

Après restauration : **18/18 verts**.

---

## 5. Documentation

- `spec_read_aloud.md` § 4 quater : la règle est écrite (déclencheur, décision,
  emplacement, silence, relance unique, ce qui reste interdit).
- `help/overview.md` (bloc `HELP:lire-reponses`) : une phrase d'utilisateur, sans
  jargon — « la voix de Pilot est prête dès le lancement » n'ajoute aucun réglage.
- `help/handbook.md` **régénéré** par `npm run build:handbook` (jamais édité à la
  main).

---

## 6. Vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/prechauffage-voix-imitee-demarrage.test.js` | 18 / 18 |
| `npx vitest run src/js/voix-imitee-voicestudio.test.js` | inchangé, vert |
| `npm test` (suite complète) | **284 fichiers / 5 237 tests réussis**, 0 échec |
| Rust | **non touché** : aucune commande, aucun module Rust modifié (`tts_voicestudio_warmup` existait déjà) — donc pas de `cargo test` nécessaire |

Preuves par neutralisation : voir le tableau du § 4 (décision retirée → 3 échecs ;
silences retirés → 3 échecs ; garde de double préchauffage retirée → 1 échec ;
appel retiré de `main.js` → 1 échec), puis restauration du code et **18/18 verts**.

`npm run build:handbook` exécuté après la mise à jour du bloc `HELP:lire-reponses`
(47 blocs, aucun fichier généré édité à la main).

---

## VERDICT

**Fait et vérifié.** La voix imitée est désormais préchauffée **une fois**, **en
tâche de fond**, **après l'affichage** — et **seulement** si c'est elle qui est
mémorisée. Une voix du système, une voix locale ou une valeur inconnue ne
déclenche **rien**. Une panne du logiciel de voix imitée ne casse rien, ne
s'affiche pas, ne journalise pas ; le repli (voix locale puis voix du système)
reste intact. Une seule seconde tentative, uniquement si l'échec peut être
passager. Aucun réglage ajouté, aucun son produit, aucun `await` sur le chemin de
démarrage.
