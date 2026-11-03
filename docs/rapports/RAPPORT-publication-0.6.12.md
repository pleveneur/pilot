# Rapport — publication de Pilot v0.6.12

**Date** : 2026-11-03 (horloge du poste)
**Ordre du propriétaire** : publier la 0.6.12 avec autonomie complète — accord
explicite donné pour **cette** version avant le début des opérations.

## VERDICT : **NON PUBLIÉ — ARRÊT SUR UN CONTRÔLE ROUGE**

Les deux suites de tests et la fabrication sont **vertes**. La chaîne de
publication **a refusé** de créer la Release, et je ne publie pas. Le refus ne
vient pas du travail livré : il vient d'un **défaut du nouveau verrou de
publication du lot B**, qui cherche le changelog sous un nom qui n'existe dans
aucune version du dépôt. Le tag `v0.6.12` est poussé (il ne se répare pas) et
**aucune Release n'existe** : rien n'a été distribué, les utilisateurs installés
restent en 0.6.11.

---

## 1. Version, commit, étiquette

| Élément | Valeur |
|---|---|
| Version précédente | `0.6.11` (tag `v0.6.11`) |
| Version visée et poussée | **`0.6.12`** (règle du projet : correctifs = dernier chiffre, aucun retour en arrière) |
| Commit de contenu | **`f230b02`** — `fix(assistant): une seule vérité du travail, et une livraison réellement vérifiée` |
| Commit de version | **`7278795`** — `chore: bump version to 0.6.12` |
| Étiquette | **`v0.6.12`** — annotée, objet `00406dc`, cible `7278795`, **poussée** (`refs/tags/v0.6.12` sur `origin`) |
| Branche | `main` poussée : `origin/main` = `7278795` |
| GDS | `.pilot/gds.json` → `"enabled": false` ⇒ pas de bascule GDS, publication GitHub autorisée |
| Version 0.6.12 déjà prise ? | **Non** au moment du tag (aucune étiquette `v0.6.12` locale ni distante) |

Bump des quatre fichiers (`git diff` = **1 insertion / 1 suppression** par
fichier) :

- `src-tauri/tauri.conf.json` : `0.6.11` → `0.6.12`
- `package.json` : `0.6.11` → `0.6.12`
- `src-tauri/Cargo.toml` : `0.6.11` → `0.6.12`
- `Cargo.lock` (racine) : **paquet `pilot` uniquement** (motif `name = "pilot"`
  + `version` juste dessous). Piège v0.2.30 vérifié : le fichier contient une
  **seconde** occurrence de `0.6.12`, celle de la dépendance
  `postgres-protocol` — **non touchée**. Le diff du verrou est bien d'une seule
  ligne.

## 2. Contrôles exécutés — résultats exacts

### 2.1 En local, avant le bump

| Contrôle | Commande | Résultat |
|---|---|---|
| Aide intégrée | `npm run build:handbook` | ✅ 47 blocs, 328 491 octets (aucun bloc manquant) |
| Tests front | `npx vitest run` | ✅ **`PASS (5336) FAIL (0)`** |
| Tests Rust bureau | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **837 passés, 1 ignoré, 0 échec** |
| Tests socle + serveur | `cargo test -p gds-core -p gds-server` | ✅ **173 passés, 11 ignorés, 0 échec** |

### 2.2 Après le bump (contrôles d'arrivée)

| Contrôle | Résultat |
|---|---|
| `npx vitest run` | ✅ **`PASS (5336) FAIL (0)`** |
| `cargo test --lib` (paquet `pilot` compilé en `0.6.12`) | ✅ **837 passés, 1 ignoré** |
| `npm run build` (front) | ✅ `dist/` produit, 13 Mo, `index.html` 146,8 Ko |
| `npx tauri build --no-bundle` | ✅ `target/release/pilot.exe` (45,0 Mo), `Pilot_0.6.12_x64_en-US.msi` (84,2 Mo), `Pilot_0.6.12_x64-setup.exe` (64,5 Mo) |

Point d'honnêteté, identique à la 0.6.11 : la fabrication se termine par
`A public key has been found, but no private key`. C'est la **signature de
l'updater**, qui exige `TAURI_SIGNING_PRIVATE_KEY` — clé qui n'existe **que**
dans les secrets GitHub. Son absence en local est attendue et n'empêche pas la
fabrication : binaire et deux installateurs sont bien sur le disque.

### 2.3 Dans la chaîne GitHub (le premier vrai test des verrous du lot B)

| Job (run `41633049260`, étiquette `v0.6.12`) | Résultat |
|---|---|
| `test (ubuntu-22.04)` | ✅ success |
| `test (windows-latest)` | ✅ success |
| `test (macos-latest)` | ✅ success |
| `create-release` | ❌ **failure** (étape « Create GitHub Release (idempotent) ») |
| `build` | ⏭️ **skipped** (dépend de `create-release`) |
| `build-linux` | ⏭️ **skipped** |
| `latest-json` | ❌ failure (même porte) |
| `latest-json-linux` | ❌ failure (même porte) |
| `quality-gate` (poussée sur `main`) | lancé, sans aucun droit d'écriture |

**La garde du lot B a fonctionné** : `create-release` a démarré à
`12:14:32Z`, **après** la fin des trois jobs `test`, et il n'a jamais tourné
avant eux. Aucune release n'a été créée « en avance » — c'est exactement ce que
le trou C7.1 demandait de fermer. **Preuve côté GitHub** : aucune Release
`v0.6.12` (`GET /releases/tags/v0.6.12` → **HTTP 404**) ; la dernière release
publiée reste **`v0.6.11`** (`draft: false`, 11 fichiers). `latest.json` n'a donc
pas été réécrit : les postes installés ne voient toujours que 0.6.11.

## 3. Ce qui a échoué, exactement — et pourquoi je m'arrête

`scripts/release-gates.js`, fonction `notesPathForTag` :

```js
export function notesPathForTag(tag) {
  return `release-notes/${String(tag || "").replace(/^v/, "")}.md`;
}
```

Le `v` initial est retiré : pour l'étiquette `v0.6.12`, la porte exige
**`release-notes/0.6.12.md`**. Or la convention réelle du dépôt — écrite dans
`AGENTS.md` (« Rédiger le changelog utilisateur `release-notes/vX.Y.Z.md` ») et
suivie par **tous** les fichiers présents — porte le `v` :

```
release-notes/ : v0.6.1.md v0.6.10.md v0.6.11.md v0.6.12.md …
```

Reproduction locale, sans réseau (le refus tombe **avant** tout appel à l'API) :

```
chemin attendu par la garde : release-notes/0.6.12.md
existe ? false
décision : {"ok":false,"accepted":false,
  "reason":"Aucun changelog lisible pour v0.6.12 :
   release-notes/0.6.12.md est OBLIGATOIRE …"}
```

Conséquences à dire franchement :

- **Le changelog existe** (`release-notes/v0.6.12.md`, 66 lignes, trois
  catégories, committé avec le bump) : ce n'est pas un oubli de ma part.
- **La garde refuserait TOUTE publication future** portant une étiquette `v…`,
  c'est-à-dire toutes : `create-release.js` et `gen-latest-json.js` lisent le
  chemin par cette seule fonction (son second candidat,
  `notesPathForTag(VERSION)`, donne `release-notes/0.6.12.md` : même impasse).
- **Le défaut est figé par un test** : `scripts/release-gates.test.js` affirme
  `expect(notesPathForTag("v1.2.3")).toBe("release-notes/1.2.3.md")`. Corriger la
  fonction impose donc de changer **ce test**, ce que ma mission m'interdit
  (« aucun test ne se supprime ni ne s'assouplisse », et je ne touche pas au
  travail livré).

**Je m'arrête ici, en application de la consigne : un contrôle échoue ⇒ rapport,
arrêt, main rendue au propriétaire.** Aucun contournement n'a été employé : pas
de `ALLOW_MISSING_RELEASE_NOTES=1`, pas de test modifié, pas d'étiquette déplacée
ni supprimée, aucun nouveau tag.

## 4. Changelog rédigé (prêt, committé)

`release-notes/v0.6.12.md` — français, accents, orienté utilisateur, sans nom de
fichier ni de fonction :

- **Nouvelles fonctionnalités** (2) : une demande écrite n'est plus perdue lors
  d'un travail en cours ; les fichiers attendus d'un agent sont désormais
  annoncés, avec refus net au lancement s'ils manquent.
- **Corrections** (6) : l'Assistante ne se croit plus occupée à tort ; une tâche
  « terminée » est réellement vérifiée (existe, non vide, modifié) ; un agent
  n'est plus crédité d'un travail qu'il n'a pas fait ; une question d'agent ne
  s'affiche plus en double ni nulle part ; une checklist vide ne clôture plus
  une tâche ; l'Assistant ne contourne plus son propre suivi.
- **Améliorations** (5) : mise à jour jamais annoncée avant vérification ;
  publication incomplète = échec ; changelog obligatoire ; version déjà publiée
  non republiable ; chaque proposition de modification contrôlée
  automatiquement.

## 5. Documentation vérifiée avant le bump

`spec_pilot.md` (la règle de la sonde légère vaut pour tous les écrans, onglet 🧭
compris), `spec_super_agent.md` (une seule vérité du travail ; livrable déclaré,
non vide et modifié ; tables de suivi hors de portée du SQL de l'Assistant ;
checklist vide non conforme), `AGENTS.md` et `help/handbook.md`
**régénéré** (`npm run build:handbook`, 47 blocs) : à jour, committés avec le
contenu.

`docs/architecture-conversation-vocale-interruptible.md` (612 lignes de
révision) est également dans le commit de contenu.

## 6. Ce que le propriétaire doit décider (deux gestes, d'une ligne chacun)

1. **Corriger le chemin du changelog** (décision de publication, pas de code
   métier) : faire reconnaître par `notesPathForTag` le nom réellement employé
   partout, `release-notes/vX.Y.Z.md` — et **retourner** l'assertion de
   `scripts/release-gates.test.js` qui fige aujourd'hui le nom sans `v`
   (l'intention du test garde tout son sens : le changelog doit être trouvé,
   pas un chemin particulier). Sans accord explicite sur ce point, la chaîne de
   publication restera bloquée pour toutes les versions suivantes.
2. **Publier sous un nouveau numéro** : `v0.6.12` est **consommé** (étiquette
   poussée, aucune Release). Conformément à la consigne (« ne force rien : prends
   la version suivante »), la publication se fera en **`0.6.13`** une fois la
   correction en place : bump des quatre fichiers, `release-notes/v0.6.13.md`,
   commit, poussée de `main`, nouvelle étiquette, poussée. Le présent rapport dit
   la vérité sur 0.6.12 : **tag présent, release absente**, donc rien de distribué.

## 7. Ce qui n'a pas été fait (volontairement)

- Aucun test supprimé ni assoupli, aucun code du travail livré modifié.
- Aucune variable d'échappement de publication utilisée.
- Aucune étiquette supprimée, déplacée, ni republiée ; aucun force push ; aucun
  `reset` ni `checkout` écrasant ; aucune donnée ni sauvegarde supprimée.
- Aucune image ni conteneur GDS reconstruit, aucun autre dépôt touché.
- Aucun outil de liste de sessions d'agents appelé.
