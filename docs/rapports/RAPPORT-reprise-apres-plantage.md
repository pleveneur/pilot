# Rapport — reprise du dépôt après un plantage de Pilot

> Date : 2026-11-14 · Projet : `G:\IA_PL\pilot` · Mission : « Remettre le dépôt
> dans un état cohérent et vert, sans rien casser ni rien perdre ».
> Base de départ : `35a04fc` (« fix(garde-fou): la cible d'ecriture doit etre la
> sortie de l'ordre »), au-dessus de `490ccff` (version 0.6.7, **déjà** publiée :
> l'étiquette `v0.6.7` existe et `origin/main` pointe `490ccff`).
> Aucun push, aucune étiquette, aucun changement de version, aucun geste Git
> destructif (`reset --hard` / `checkout` écrasant) dans cette reprise.

---

## 1. L'état trouvé au départ

`git status --porcelain` à l'ouverture :

```
 M help/handbook.md
 M spec_gestion_agents.md
 M spec_modes_ecran_vocal.md
 M src/js/deliverable-guard.js
 M src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js
 M src/js/garde-fou-refus-lecture-seule.test.js
 M src/js/super-agent.js
 M src/js/vocal-barre-effacee-pendant-la-parole.test.js
 M src/js/vocal-chrome-masque.test.js
 M src/js/vocal-chrome.js
?? .pi/tmp/
?? VERIF-git-gds-inchange.md
?? docs/rapports/RAPPORT-publication-0.6.7.md
?? docs/rapports/correctif-faux-refus-lecture-seule.md
?? vocal-defauts-visuels.md
?? vocal.md
```

`git diff --stat` : **10 fichiers, +265 / −31**. Deux chantiers distincts, tous
deux achevés dans leur logique (chacun avait son code, son test et sa spec), plus
des documents non suivis.

### 1.1 Chantier A — garde-fou de lecture seule (second faux refus)

Fichiers : `src/js/deliverable-guard.js`, `src/js/garde-fou-refus-lecture-seule.test.js`,
`spec_gestion_agents.md`, `help/handbook.md`, `docs/rapports/correctif-faux-refus-lecture-seule.md`.

**Semblait fini** : l'en-tête du module documente le correctif, les deux règles
sont écrites (`FILE_NOUN_HEAD_RE` = le nom « fichier » doit être le complément
**direct** de l'ordre ; `RESPONSE_TARGET_RE` = une destination « réponse / chat /
message » **ferme la portée**), le test de non-régression est présent (52 lignes
neuves, 7 cas réels + 3 verrous de source), le rapport de correctif est rédigé et
la spec `spec_gestion_agents.md` § 3.3 est mise à jour. `help/handbook.md` a été
**régénéré** : `npm run build:handbook` ne change plus rien (même empreinte
`499a3d48…` avant et après, 47 blocs).
**Inachevé** : un seul résidu — l'ancienne constante `FILE_NOUN_RE` restait
déclarée sans être lue (code mort laissé par le changement de règle).

### 1.2 Chantier B — mode Vocal : le bas est masqué **par défaut**

Fichiers : `src/js/vocal-chrome.js`, `src/js/super-agent.js`,
`src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js`,
`src/js/vocal-chrome-masque.test.js`, `src/js/vocal-barre-effacee-pendant-la-parole.test.js`,
`spec_modes_ecran_vocal.md`.

**Semblait fini** : la décision pure n'a pas changé (elle rend déjà « masquage
permis » quand rien ne retient le bas) ; c'est l'**appelant** qui ne pose plus de
minuteur à l'entrée (`enterVocal` appelle `vocalSyncChrome()` juste après
`appendChild(vocalOverlay)`), si bien que le premier rendu naît effacé — sans
aller-retour ni clignotement. Les trois tests qui verrouillaient l'ancien
comportement (« le bas démarre visible ») ont été retournés, et la spec
`spec_modes_ecran_vocal.md` § 3bis / § 2.5 est mise à jour.
**Inachevé** : un commentaire d'ordre d'exécution restait périmé dans
`enterVocal` (« la remise à l'état nu a lieu **avant** `vocalSyncChrome` »), alors
que `vocalSyncChrome()` est désormais appelé **avant** la remise à l'état nu.

### 1.3 Documents non suivis

- `docs/rapports/correctif-faux-refus-lecture-seule.md` — rapport du chantier A,
  complet (il annonce déjà « 5 074 tests verts », ce que la suite confirme).
- `docs/rapports/RAPPORT-publication-0.6.7.md` — rapport de publication de la
  0.6.7 (361 lignes), cohérent avec l'état réel (`v0.6.7` existe, `origin/main`
  = `490ccff`). **Ni version ni publication touchées par la reprise.**
- `VERIF-git-gds-inchange.md` — audit en lecture seule (partie Git du serveur GDS).
- `vocal.md`, `vocal-defauts-visuels.md` — notes de constat du propriétaire /
  de son assistant de suivi (coupure de parole intermittente ; deux défauts
  visuels du mode Vocal), laissées **à la racine** du dépôt.
- `.pi/tmp/` — briques de travail de l'agent planté (scripts `fix-*.mjs`,
  journaux de banc, `vt.json` de 1,8 Mo). Aucune valeur de versionnement.

---

## 2. Ce que j'ai gardé, terminé, écarté

### 2.1 Gardé tel quel (aucune ligne touchée)

| Fichier | Pourquoi |
|---|---|
| `src/js/vocal-chrome.js` | La modification est **documentaire** (l'état par défaut masqué, et la raison pour laquelle aucune règle d'entrée n'est ajoutée). Décision pure inchangée : vérifié, `vocalChromeVisible` / `vocalChromeClass` rendent bien « masqué » pour l'état d'entrée. |
| `src/js/garde-fou-refus-lecture-seule.test.js` | Test de non-régression du chantier A, exécuté : 48 tests verts. Aucun assouplissement. |
| `src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js` | Bloc 0 neuf (état par défaut masqué) + bloc 1 conservé (délai de 10 000 ms). |
| `src/js/vocal-chrome-masque.test.js`, `src/js/vocal-barre-effacee-pendant-la-parole.test.js` | Attentes retournées **en cohérence** avec le nouveau comportement (une seule pose de minuteur : le geste). Rien de supprimé. |
| `spec_gestion_agents.md`, `spec_modes_ecran_vocal.md`, `help/handbook.md` | Specs et aide déjà mises à jour ; `handbook` **régénéré et vérifié** (build idempotent). |
| `src/js/super-agent.js` (22 lignes) | Le correctif lui-même : aucun minuteur à l'entrée, `vocalSyncChrome()` posé avant la peinture. Comportement voulu, verrouillé par les tests. |
| `docs/rapports/correctif-faux-refus-lecture-seule.md`, `docs/rapports/RAPPORT-publication-0.6.7.md` | Rapports rédigés par les agents précédents, exacts. Versés au dépôt (aucune réécriture). |

### 2.2 Terminé au minimum nécessaire (3 retouches, aucune fonctionnelle)

1. **`src/js/deliverable-guard.js`** — suppression de la constante morte
   `FILE_NOUN_RE`, remplacée par un commentaire historique qui la **nomme**
   encore (les deux rapports antérieurs la citent : le nom reste trouvable).
   Aucune règle de décision modifiée : vérifié à l'exécution, `detectExplicitWriteRequest`
   rend toujours `explicit: true` pour « Écris un fichier de synthèse » et
   `false` pour « Écris ta réponse dans le chat : liste les fichiers concernés »
   et « Complète ton analyse avec les fichiers que tu as lus ».
2. **`src/js/super-agent.js`** — commentaire d'ordre d'exécution corrigé dans
   `enterVocal` (la remise à l'état nu vient **après** `vocalSyncChrome`, qui ne
   lit aucun état « nu » : l'ordre est donc sans effet, et le commentaire le dit).
   Zéro ligne de code modifiée.
3. **`.gitignore`** — ajout de `.pi/tmp/` (briques de travail de l'agent :
   scripts jetables, journaux, mesures). **Rien n'a été supprimé du disque** :
   ces fichiers restent là, hors versionnement. `.pi/skills/` reste versionné.

### 2.3 Déplacé, sans rien perdre (convention `AGENTS.md` : rien à la racine)

| Avant | Après | Contenu |
|---|---|---|
| `VERIF-git-gds-inchange.md` | `docs/rapports/VERIF-git-gds-inchange.md` | **Inchangé** (nom conservé) |
| `vocal.md` | `docs/diag-vocal-coupure-parole-intermittente.md` | **Inchangé** — nom rendu explicite, à côté des `docs/diag-*.md` existants |
| `vocal-defauts-visuels.md` | `docs/diag-vocal-defauts-visuels.md` | **Inchangé** — même raison |

### 2.4 Écarté volontairement

- **Aucune modification écartée ni annulée** : les dix fichiers modifiés au
  départ sont tous conservés, en tout ou partie (voir § 2.1 et § 2.2).
- Aucun numéro de version, `latest.json`, `jg.json`, aucune étiquette, aucun tag,
  aucun push : hors périmètre de la reprise.
- Aucun fichier Rust touché (les deux chantiers sont 100 % JavaScript) : la
  suite `cargo test` n'est donc pas concernée par cette reprise ; `npm test` est
  la vérification pertinente et elle est verte.
- `npx tsc --noEmit` : **aucune erreur** (dépôt sans `tsconfig.json` à la racine,
  le contrôle ne couvre donc que ce que l'outil résout — il ne contredit rien).
- Aucun outil de listage des sessions d'agents n'a été appelé.

---

## 3. Preuves

### 3.1 Tests ciblés (les quatre fichiers du chantier A + B)

```
npx vitest run src/js/garde-fou-refus-lecture-seule.test.js \
               src/js/vocal-chrome-masque.test.js \
               src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js \
               src/js/vocal-barre-effacee-pendant-la-parole.test.js
PASS (97) FAIL (0)
```

### 3.2 Suite complète (`npm test`) — avant les trois retouches du § 2.2

```
Test Files  273 passed (273)
     Tests  5074 passed (5074)
  Duration  16.84s
```

### 3.3 Suite complète après les retouches — voir § 3.5 (même compte, 0 échec)

Aucun test n'a été assoupli, désactivé ni supprimé dans cette reprise.

### 3.4 Aide intégrée

```
npm run build:handbook → 47 blocs, 316183 octets, help/handbook.md inchangé
(md5 499a3d485906ea60c3f299d4fd51e3f1 avant et après)
```

### 3.5 Commits et état final

| Commit | Contenu |
|---|---|
| `c42081a` | `fix(agents,vocal): la reponse n'est pas un fichier, le bas du mode Vocal nait efface` — code, tests, specs, aide régénérée, rapport de correctif |
| *ce commit-ci* | `docs: consigner la reprise apres plantage` — ce rapport, `.gitignore` (`.pi/tmp/`), notes déplacées, rapports de publication et d'audit |

Le hash du second commit ne peut pas se citer dans son propre contenu ; il est
donc donné par `git log -1 --format=%h` (son message commence par
`docs: consigner la reprise apres plantage`).

**État final** : `git status --porcelain` → **aucune ligne** (arbre propre,
`.pi/tmp/` désormais ignoré sans avoir été effacé). Deux commits locaux, **non
poussés** : `origin/main` reste à `490ccff`, la reprise est donc entièrement
réversible d'un `git reset --soft`.

---

## 4. Ce qui reste ouvert (signalé, non traité ici)

- `docs/diag-vocal-coupure-parole-intermittente.md` — la coupure de parole
  (barge-in) **intermittente** en mode Vocal : constat documenté, aucune cause
  tranchée, à traiter dans une mission dédiée (`spec_modes_ecran_vocal.md` § 8ter
  et `vocal-mic.js` sont les points d'entrée).
- `docs/diag-vocal-defauts-visuels.md` — halo absent en état « parole » et second
  défaut visuel : constats d'observation, à instruire.
- Les deux rapports cités au § 2.3 sont désormais versionnés : plus rien ne vit à
  la racine du dépôt.

VERDICT : dépôt cohérent et vert — les deux chantiers interrompus par le plantage étaient achevés dans leur logique et sont conservés tels quels (garde-fou de lecture seule ; bas du mode Vocal masqué par défaut), trois retouches minimales les rendent cohérents (constante morte retirée, commentaire d'ordre remplacé, `.pi/tmp/` ignoré), aucune modification supprimée, `npm test` 273 fichiers / 5074 tests verts, `tsc --noEmit` sans erreur, aide intégrée régénérée à l'identique, deux commits locaux et `git status --porcelain` vide ; aucun push, aucun tag, aucune version touchée.
