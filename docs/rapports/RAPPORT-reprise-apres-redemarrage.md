# Rapport — reprise après redémarrage de Pilot (chantier vocal interrompu)

Date : 2026-10-29 · Projet : `G:\IA_PL\pilot` · Version installée : 0.6.4
(commit `160611f`) · Aucune version bumpée, aucun tag, aucune publication.

Suite de l'arrêt brutal d'une ou plusieurs missions du mode Vocal. Ce rapport
dit ce qui était réellement en cours, ce qui a été fait, la preuve, et ce qui
reste.

---

## 1. État constaté au redémarrage

`git status` sur `160611f` :

| Élément | Nature |
|---|---|
| `src/js/vocal-conversation.js` (+68) | 4 ajouts **purs** de la reprise d'écoute |
| `src/js/super-agent.js` (+26/−1) | import + corps de la **seule** minuterie d'armement |
| `src/js/vocal-reprise-ecoute-auto.test.js` | **nouveau** verrou (17 tests) |
| `src/js/vocal-parler-declenche-une-demande.test.js` (+2/−1) et `src/js/vocal-mesure-en-premier.test.js` (+10/−5) | ancres de source réécrites (elles figeaient la ligne de l'abandon) |
| `spec_modes_ecran_vocal.md` (§6bis, §10), `spec_voice_input.md` (bloc `HELP:dictee-vocale`), `help/handbook.md` | documentation du comportement |
| `docs/RAPPORT-REPRISE-ECOUTE-AUTO.md` | rapport de la mission interrompue |

Rien d'autre n'appartenait à ce chantier : les ~70 autres fichiers non suivis
(rapports, conceptions, `vocal.md`, `vocal-defauts-visuels.md`, propositions)
étaient **déjà** là avant la mission et n'ont **pas** été touchés.

## 2. À quel chantier cela correspond, et dans quel état

**Chantier : « l'écoute repart toute seule après chaque réponse »** en mode
Vocal — ni la coupure de la parole (barge-in, sujet de `vocal.md`), ni le
cercle/relance, ni le masquage du bas.

État : **cohérent et TERMINÉ**. Preuves, fichier:ligne sur l'arbre committé :

| Exigence | Preuve |
|---|---|
| une **règle pure** de reprise, pas une décision d'écran | `src/js/vocal-conversation.js:117` `VOCAL_RESUME_RETRY_MS = 400`, `:128` `VOCAL_RESUME_MAX_RETRIES = 8`, `:138` `VOCAL_RESUME_TRANSIENT_REASONS` (4 raisons passagères gelées), `:160` `vocalResumeRetry(raison, tentatives)` |
| le module reste **pur** | aucun `setTimeout` / `Date.now` / `requestAnimationFrame` dans `vocal-conversation.js` (vérifié par `vocal-reprise-ecoute-auto.test.js`, section 1) |
| **un seul** branchement, dans la minuterie existante | `src/js/super-agent.js:5172-5204` : `tentatives` lu du plan (`:5179`), décision **réévaluée** (`:5182`), `vocalResumeRetry` (`:5193`), reprogrammation par **la même** fonction (`:5195-5201`, `tentatives: tentatives + 1`) |
| jamais d'ouverture dans la branche de refus | `armVoiceInput()` n'apparaît que dans le chemin « décision = ARM » (`super-agent.js:5202`) |
| **une seule** minuterie | une seule affectation `vocalArmTimer = setTimeout(` (`super-agent.js:5180`) ; garde `if (!plan.delai || vocalArmTimer) return;` (`:5176`) |
| refus **définitifs** jamais repris | les 4 raisons passagères correspondent exactement à des raisons **produites** par `decideVocalDictation` (`vocal-conversation.js:347`, `:351`, `:375`/`:391`/`:399` pour `mesure-fermee`, `:399` pour `sensibilite-inconnue`) ; `arret-manuel` (`:359`), `sessions-vides` (`:367`), `erreur` (`:371`), `projet-sensible` (`:339`) restent hors liste |
| aucune apparence touchée | `git diff` ne contient **aucune** ligne CSS ; halo, objet lumineux, trait, ligne d'état, rond « Réveiller » inchangés |
| documentation à jour | `spec_modes_ecran_vocal.md` §6bis (règle + refus définitifs + ronde = secours) et §10 (rôle du module + verrou listé) ; `spec_voice_input.md` (phrase utilisateur, bloc `HELP:dictee-vocale`) ; `help/handbook.md` régénéré |

Le seul manque constaté était **documentaire**, pas fonctionnel : le module
n'était pas décrit dans l'arborescence de `AGENTS.md`, et le rapport de mission
était resté à la racine de `docs/` alors que la règle 7 impose `docs/rapports/`.

## 3. Ce qui a été réellement fait lors de cette reprise

1. **Vérification de cohérence** du diff complet (7 fichiers modifiés + 1
   nouveau test) et de `decideVocalDictation` / `planVocalConversation`, pour
   s'assurer que les quatre raisons reprises sont bien celles qui sont
   **émises**, et qu'aucune décision n'a quitté le module pur.
2. **`npm run build:handbook`** : le handbook de l'arbre de travail est
   exactement celui que produit la génération (46 blocs, 299 691 octets) —
   le `diff` de `help/handbook.md` reste `+5/−1`, uniquement la phrase
   utilisateur sur la reprise d'écoute.
3. **Suite front complète** `npx vitest run` : **PASS (4296) FAIL (0)**.
   Le nouveau verrou seul : **PASS (17) FAIL (0)**.
4. **Rust (corpus embarqué)** `cargo test --manifest-path src-tauri/Cargo.toml
   --lib help::` : **4 passed, 0 failed, 1 ignored**.
5. **Deux corrections documentaires ciblées** :
   - `AGENTS.md` : `vocal-conversation.js` décrit désormais la reprise bornée
     (constantes, raisons passagères, « un refus définitif n'est jamais
     repris ») et cite `vocal-reprise-ecoute-auto.test.js` comme couverture ;
   - le rapport de mission est **déplacé** vers
     `docs/rapports/RAPPORT-reprise-ecoute-auto.md` (règle 7, deux références
     mises à jour : `spec_modes_ecran_vocal.md:539` et l'en-tête du nouveau
     test) ; son chiffre de suite complète, qui annonçait 4 266 tests, est
     porté au chiffre **mesuré** ici (4 296) avec renvoi à ce rapport.
6. **Commit unique** du chantier (comportement + tests + documentation).

Aucun test existant n'a été supprimé, désactivé ou assoupli ; les deux ancres
réécrites vérifiaient l'**ancienne** ligne d'abandon (elles figeaient le défaut)
et vérifient maintenant la **propriété** : la décision est réévaluée à
l'échéance, et la branche de refus n'ouvre jamais la dictée.

## 4. Preuve

- Commit : **`ff12937`** — `fix(vocal): l'ecoute repart toute seule apres
  chaque reponse`, sur la base `160611f` (11 fichiers, +756/−12).
- Front : **4 296 tests verts, 0 échec** (`npx vitest run`).
- Rust : **4 passed, 0 failed, 1 ignored** (`--lib help::`), handbook
  régénéré avant la compilation.
- Handbook : régénéré, identique à l'arbre committé.

## 5. Ce qui reste

- **Rien pour ce chantier.** Le comportement livré est borné par construction
  (8 reprises × 400 ms) et aucun seuil de décision n'a bougé.
- **Hors périmètre, non touché** : la coupure de la parole (barge-in) décrite
  dans `vocal.md` (écart entre garde armée et désarmée) reste un sujet ouvert,
  distinct de la reprise d'écoute ; les propositions et conceptions non suivies
  (`docs/proposition-*.md`, `docs/conceptions/CONCEPTION-*.md`,
  `vocal-defauts-visuels.md`) attendent leur propre décision.
- Le fichier `.pi/vitest-report.json` (artefact de mesure locale) reste **non
  suivi** et volontairement non committé.
