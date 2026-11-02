# Rapport de publication — Pilot 0.4.43 : **PUBLICATION BLOQUÉE**

> Rédigé par l'agent publieur, le 2026-10-23 (session de publication 0.4.42 → 0.4.43).
> **Verdict : aucun bump de version, aucun commit, aucune étiquette, aucune release.**
> Un contrôle obligatoire est ROUGE : la suite de tests frontend ne se charge plus
> (7 fichiers de test), à cause d'un commit **non publié** de la série 0.4.43.

---

## 1. Ce qui a été contrôlé, dans l'ordre

| Contrôle | Commande | Résultat exact |
|---|---|---|
| État du dépôt | `git status --porcelain` | **propre** avant toute intervention (aucune ligne) |
| Branche / HEAD | `git rev-parse` | `main` — HEAD `a365bff` (voir § 3) |
| Canal de publication | `git remote -v` / `.pilot/gds.json` | `origin = https://github.com/pleveneur/pilot.git` ✔ ; GDS **désactivé** (`"enabled": false`) ✔ → publication GitHub autorisée, mais voir § 5 |
| Tests frontend | `npm test` | **ÉCHEC — code de sortie 1** : `Test Files 7 failed | 149 passed (156)`, `Tests 2580 passed (2580)` |
| Tests Rust (espace complet) | `cargo test --workspace` | **OK — code de sortie 0** : 841 réussis / 0 échec / 1 ignoré (112 `gds-core` + 34 `gds-server` + 695 `pilot` + 3 harnais vides) |
| Fabrication frontend | `npm run build` | **OK — code de sortie 0** : `✓ built in 13.51s` (seul avertissement : taille de chunk > 500 kB, préexistant) |

Journaux bruts conservés (dossier ignoré par Git) :
`.pilot/tmp-pub/cargo-test.log`, `.pilot/tmp-pub/npm-build.log`,
et la sortie complète de `npm test` en `.pilot/tmp-pub/` (rejouable par `npm test`).

**Conclusion du § 1 : un contrôle est rouge → la publication s'arrête ici.**

---

## 2. Le contrôle rouge, en détail

`npm test` échoue **au chargement** de 7 fichiers de test (aucune assertion
fausse : 2580 tests passent, 0 échoue ; ce sont 7 fichiers entiers qui ne
peuvent plus être chargés, donc **7 fichiers de tests ne sont plus exécutés du
tout** — c'est le piège « test sauté silencieusement ») :

1. `src/js/read-aloud.test.js`
2. `src/js/super-agent-bubble-badges.test.js`
3. `src/js/super-agent-data-analysis.test.js`
4. `src/js/super-agent-disconnect.test.js`
5. `src/js/super-agent-events-overlay.test.js`
6. `src/js/super-agent-reflecting.test.js`
7. `src/js/super-agent-scroll.test.js`

Message identique pour les 7 :

```
TypeError: default(...).use is not a function
 ❯ src/js/preview.js:16:4
```

### 2.1 Cause exacte (prouvée)

- `src/js/preview.js:16` : `markdownit({…}).use(mkkatex, {…})` — cet appel exige
  un `.use()` sur l'instance.
- Les 7 fichiers de test neutralisent `markdown-it` par
  `vi.mock("markdown-it", () => ({ default: vi.fn(() => ({ render: () => "" })) }))`
  → l'instance simulée **n'a pas de `use`**.
- Jusqu'à la 0.4.42, ces 7 fichiers **ne chargeaient pas** `preview.js` :
  `src/js/super-agent.js` n'importait pas `updater.js`
  (`git show v0.4.42:src/js/super-agent.js | grep updater.js` → **aucun**), et
  `preview.js` n'est atteignable que par `updater.js:25`
  (`import { renderMarkdown } from "./preview.js"`), lui-même importé par
  `super-agent.js`.
- Le commit **non publié** `a61051a` (« fix(maj): une mise a jour en attente
  passe avant la relance automatique ») a ajouté
  `src/js/super-agent.js:80` :
  `import { isUpdateWaitingForGround, recheckPendingUpdateWindow } from "./updater.js";`
  → la chaîne `super-agent.js → updater.js → preview.js` s'exécute désormais
  dans ces 7 tests, et leur simulation de `markdown-it` devient insuffisante.

**C'est donc une régression réelle introduite par un commit de la série 0.4.43**,
et non un défaut d'environnement : les 7 fichiers de test concernés sont
**identiques** à ceux de l'étiquette `v0.4.42` (vérifié par
`git diff --quiet v0.4.42 HEAD -- <fichier>`), et le run CI de la v0.4.42
(run `39956634179`, conclusion `success`) était vert avec ces mêmes fichiers.

### 2.2 Preuves reproductibles (hors dépôt de code)

Deux tests de démonstration écrits dans un dossier ignoré par Git
(`.pilot/tmp-pub/`, config dédiée `vitest.preuve.config.js`) :

| Preuve | Fichier | Résultat observé |
|---|---|---|
| Le mock **sans** `use` bloque `preview.js` | `.pilot/tmp-pub/preuve-sans-use.test.js` | ✅ passe : `import("../../src/js/preview.js")` rejette avec `use is not a function` |
| Le **même** mock **avec** `use` charge `preview.js` | `.pilot/tmp-pub/preuve-avec-use.test.js` | dépasse `preview.js:16` et n'échoue plus que sur `window` (fourni par les 7 fichiers de test, qui embarquent un DOM minimal) |

### 2.3 Correctif minimal (NON appliqué — hors de mon périmètre)

Une seule ligne par fichier de test, dans chacun des 7 fichiers :

```js
vi.mock("markdown-it", () => ({
  default: vi.fn(() => ({ use() { return this; }, render: () => "" })),
}));
```

(ou, variante équivalente : simuler aussi `./preview.js` dans ces 7 fichiers).
C'est un correctif de **test**, pas de code applicatif : la fonctionnalité
« une mise à jour en attente passe avant la relance automatique » n'est pas en
cause dans son comportement.

---

## 3. Note sur le commit de documentation apparu pendant la session

Le dépôt a reçu, **avant mon intervention**, le commit de documentation annoncé
comme possible par la demande :

- `a365bff` — `docs: signal de travail de la zone de saisie pendant une delegation`

Il est **laissé tel quel** (aucune modification, aucun retrait). HEAD est donc
`a365bff` et non `0c1fba4`. La série non publiée depuis `v0.4.42` compte
**7 commits** :

```
a365bff docs: signal de travail de la zone de saisie pendant une delegation
0c1fba4 docs: référer la décision 5 de la spec dictée pour le correctif micro
4a50814 docs: conception de la conversation vocale interruptible
a61051a fix(maj): une mise a jour en attente passe avant la relance automatique   ← régression des 7 tests
9b8ef07 docs: proposition de navigation évidente (inventaire, gênes, cible, plan)
e60aeab feat(voix): voix française locale hors ligne pour la lecture à voix haute
9d4ee92 fix(assistant): la zone de saisie respire aussi quand un agent delegue travaille
```

---

## 4. Ce qui n'a **pas** été fait (preuves)

| Action | État | Preuve |
|---|---|---|
| Bump de version | **NON fait** | `package.json` = `0.4.42`, `src-tauri/tauri.conf.json` = `0.4.42`, `src-tauri/Cargo.toml` = `0.4.42`, `Cargo.lock` (`name = "pilot"`) = `0.4.42` |
| Notes de version `release-notes/v0.4.43.md` | **NON créées** (brouillon prêt au § 6) | fichier absent |
| Commit de version | **NON fait** | `git status --porcelain` ne contient que ce rapport (non suivi) |
| Étiquette `v0.4.43` | **NON posée** | `git tag -l "v0.4.43"` → 0 ligne |
| Release GitHub `v0.4.43` | **NON créée** | API GitHub `releases/tags/v0.4.43` → `Not Found` |
| Poussée vers GitHub | **AUCUNE** | dépôt local uniquement |
| Force-push / réécriture / suppression de tag ou de release | **AUCUN** | — |

Il n'existe donc **aucune** étiquette ni release à réparer : rien n'a été
irréversible.

### Pourquoi il ne faut surtout pas pousser l'étiquette en l'état

Dans `.github/workflows/release.yml`, le job `test` exécute `npm test` et le job
`build` déclare `needs: [create-release, test]`. Le job `create-release` est
indépendant du job `test` : pousser `v0.4.43` maintenant créerait **une release
vide** (créée par `create-release`) avec un build bloqué par le test rouge —
exactement le type d'incident déjà vécu (v0.4.26 publiée sans installateur).

---

## 5. Canal de publication vérifié (conforme)

- `origin` = `https://github.com/pleveneur/pilot.git` — **même canal que la
  0.4.42** ; publication GitHub donc autorisée côté canal.
- `.pilot/gds.json` : `"enabled": false`, `server_url` vide → le projet **n'est
  pas** basculé sur le GDS. Aucune publication GDS n'a été tentée.
- Point à connaître (sans effet, non modifié) : `.git/config` contient un
  second remote `gds` pointant vers un chemin local inexistant
  (`G:\IA_PL\pilot\src-tauri\laya.__probe2__\pilot-gds-absent-10988`) — vestige
  d'une sonde de test locale (`laya`), pas un canal de publication. Il n'a pas
  été utilisé.

---

## 6. Brouillon des notes de version 0.4.43 (prêt, non publié)

À reprendre tel quel dans `release-notes/v0.4.43.md` **après** réparation du
test rouge et accord explicite du propriétaire.

```markdown
# Pilot v0.4.43

Cette version ajoute une **vraie voix française qui fonctionne hors ligne**,
fait **respirer la zone de saisie** de l'Assistant pendant qu'un agent délégué
travaille, et donne la **priorité à une mise à jour en attente** pour qu'elle
ne reste plus indéfiniment annoncée. Elle regroupe tout le travail fait depuis
la version que vous avez installée (0.4.42) : rien n'en a été publié entre-temps.

## ✨ Nouvelles fonctionnalités

- **Une voix française locale, qui marche sans Internet.** La lecture à voix
  haute peut maintenant utiliser une voix française installée sur votre
  machine : aucun compte, aucune clé, aucune connexion pendant la lecture, et
  pas besoin d'une carte graphique puissante. Le réglage reste **unique** :
  ⚙️ → Assistant → « Lecture des réponses », où la voix locale apparaît dans la
  liste à côté des voix de votre système. Une note vous dit si le moteur est
  prêt et **où déposer les fichiers** (Pilot ne télécharge rien lui-même).
- **Si la voix locale n'est pas disponible, vous êtes prévenu et la lecture
  continue.** Moteur absent, lecture impossible, son refusé, délai dépassé :
  la voix du système prend le relais, l'écran l'annonce clairement et une ligne
  datée est notée dans un journal. Rien ne se bloque. Le bouton « Arrêter »
  coupe aussi le son de la voix locale.

## 🐛 Corrections

- **La zone de saisie de l'Assistant montre que le travail continue.** Quand
  vous écriviez un message pendant qu'un agent délégué travaillait, la zone de
  saisie retombait au repos alors que le travail continuait : la barre
  **respire** désormais, comme le point de la liste des agents, et s'arrête
  pendant qu'une question vous attend.
- **Une mise à jour annoncée s'installe enfin, même quand la file de travail ne
  désemplit pas.** La mise à jour était bien détectée, mais la chaîne d'agents
  reprenait immédiatement la main et l'écran de mise à jour n'obtenait jamais
  son moment de calme : il restait annoncé « à la fin du travail en cours »
  indéfiniment. Une mise à jour en attente passe maintenant **avant** la
  relance automatique suivante — sans jamais interrompre un travail déjà lancé,
  sans perdre ni doubler une demande, et « Plus tard » rend la place tout de
  suite. Vos commandes manuelles ne sont jamais bloquées.

## 📄 Documents ajoutés (pas des fonctionnalités)

- **Conception de la conversation vocale interruptible** (« couper Pilot en
  pleine phrase ») : document de travail à trancher, sans effet sur l'usage
  actuel.
- **Proposition de navigation évidente** : inventaire, gênes constatées, cible
  et plan — une proposition, rien n'est encore appliqué.

## ℹ️ Limites connues

- La voix française locale suppose un dépôt de fichiers fait **une fois** à la
  main (Pilot ne télécharge ni le moteur ni le modèle).
- Sans ce dépôt, la lecture à voix haute utilise la voix du système, comme
  avant.
```

---

## 7. Ce que le propriétaire doit vérifier à la main

1. **Réparer le test rouge** (une ligne par fichier, § 2.3) — décision et
   exécution par le codeur, pas par le publieur.
2. Relancer `npm test` et vérifier **les deux lignes** :
   `Test Files` doit afficher **0 failed (156)**, et `Tests` doit dépasser
   **2580** (les 7 fichiers récupérés ajoutent leurs propres cas).
3. Vérifier ensuite `cargo test --workspace` (841 attendus) et `npm run build`.
4. Redemander explicitement la publication : elle sera alors reprise à l'étape
   « bump 0.4.42 → 0.4.43 » avec le brouillon de notes du § 6.
5. À la publication, contrôler dans le réel : release `v0.4.43` **non brouillon**,
   installateurs Windows + macOS, fichiers de signature (`.sig`) et
   `latest.json` indiquant `0.4.43`, et la conclusion du run GitHub Actions.
6. Décider du sort du commit `a61051a` : il porte la fonctionnalité utile **et**
   la régression de tests ; le correctif de test suffit à conserver les deux.

---

## 8. État final du dépôt

- Branche `main`, HEAD `a365bff`, worktree **propre** hormis ce rapport
  (fichier **non suivi**, volontairement non commité : la publication est
  bloquée, le propriétaire décide).
- Aucune version modifiée, aucun commit, aucune étiquette, aucune release,
  aucune poussée. Le dépôt est exactement dans l'état où je l'ai trouvé.
