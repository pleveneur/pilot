# Publication sans macOS — une annulation de machine Apple ne bloque plus la chaîne

> Décision appliquée du propriétaire (2026-11-15) : « **Contourne sans macOS.** »
> Une version peut donc être publiée SANS installateurs macOS — mais jamais en
> silence : l'absence est constatée, annoncée et autorisée explicitement.

## 1. Ce qui s'est passé (mesuré, pas supposé)

Trois publications d'affilée se sont arrêtées au même endroit. Le dépôt est
**public**, donc ce ne sont pas les minutes de CI : c'est GitHub qui n'a jamais
attribué de machine Apple.

| Version | Run de tests macOS | Durée | Étapes exécutées | Runner |
|---|---|---|---|---|
| 0.6.16 | 41857186819 | 15 min 02 s | **aucune** | jamais attribué |
| 0.6.17 | run de `063a53b` | 15 min 02 s | **aucune** | jamais attribué |
| 0.6.18 | 41874732425 | 15 min 02 s | **aucune** | jamais attribué |

Windows et Ubuntu réussissaient (16 étapes chacun). Le job macOS, lui, restait
`queued` puis était **annulé** par GitHub au bout de ~15 min.

### La cause exacte

`continue-on-error: ${{ matrix.os == 'macos-latest' }}` couvrait **un échec**,
pas une **annulation**. Or un job annulé met ses dépendants en `skipped` :

```
test (macOS annulé) → create-release : skipped → build : skipped → latest-json : skipped
```

Il n'y avait donc ni Release, ni installateur Windows, ni `latest.json` — alors
que tous les artefacts Windows avaient bien été fabriqués. Le `continue-on-error`
était le bon outil au mauvais endroit : il ne pouvait pas protéger la chaîne,
puisqu'il s'appliquait à un job dont **tout le reste dépendait**.

Trois runs avec un plafond d'attribution identique à la seconde près ne se
corrigent pas en réessayant : il fallait changer la topologie.

## 2. La correction

### a) Les tests macOS sortent de la chaîne critique (`release.yml`)

| Avant | Après |
|---|---|
| `test` : matrice `[ubuntu-22.04, windows-latest, macos-latest]` | `test` : matrice `[ubuntu-22.04, windows-latest]` — **chemin critique** |
| — | `test-macos` : nouveau job, même suite Rust + même suite front, `continue-on-error: true` |
| `create-release` dépendait de `test` (macOS inclus) | `create-release` dépend de `test` (sans machine Apple) |

Aucun job ne déclare `test-macos` dans ses `needs`. Conséquence : **une machine
Apple jamais attribuée n'annule plus rien**. Les tests macOS **continuent de
tourner** dès qu'une machine est obtenue — le contrôle n'est pas supprimé, il est
seulement rendu non bloquant (c'était déjà l'intention du `continue-on-error`
d'origine).

### b) La fabrication macOS est tolérée en échec **et** en annulation (`build`)

Le job `build` porte désormais
`continue-on-error: ${{ matrix.platform == 'macos-latest' }}` : une cible macOS
annulée ne met plus le job entier en `cancelled`, donc les artefacts Windows sont
publiés et les deux cibles macOS restent fabriquées quand une machine est
obtenue. `latest-json` garde `if: always()` et ne dépend que de `build`.

### c) L'absence est constatée, annoncée, et autorisée explicitement

Nouvelle étape dans `latest-json`, avant toute génération :

```yaml
- id: macos
  run: node scripts/detect-macos-gap.js "${GITHUB_REF_NAME}" "${GITHUB_REPOSITORY}"
- env:
    ALLOW_INCOMPLETE_RELEASE: ${{ steps.macos.outputs.allow_incomplete }}
  run: node scripts/gen-latest-json.js ...
```

`scripts/detect-macos-gap.js` lit les fichiers **réellement déposés** sur la
Release et applique une règle pure (`evaluateMacosGap`, dans
`scripts/release-gates.js`) :

- macOS présent → **aucune** autorisation (rien à autoriser) ;
- macOS absent **et** une autre plateforme livrée → autorisation accordée
  **pour cette release seulement**, tracée en `::warning::` dans le journal ;
- rien de livrable du tout → **aucune** autorisation : ce n'est pas « macOS
  absent », c'est une livraison cassée, et `gen-latest-json.js` refuse.

L'autorisation n'est jamais écrite en dur dans le workflow : elle vient d'une
sortie d'étape. Le refus par défaut est intact — sans `ALLOW_INCOMPLETE_RELEASE`,
une livraison incomplète échoue (code 2), exactement comme avant.

**Portée bornée** : `gen-latest-json.js` passe désormais
`allowIncompleteScope: MACOS_PLATFORMS`. « macOS absent » ne peut donc plus
couvrir un Windows manquant, **même drapeau posé** : la cible hors portée reste
bloquante et le refus nomme la cible fautive.

### d) `latest.json` : rien d'annoncé qui n'existe

`platforms` n'est rempli que par les fichiers trouvés et par une signature non
vide : une cible sans artefact n'y apparaît jamais (aucune clé macOS n'existe
dans le script). **Windows reste servi** (`windows-x86_64`, installateur NSIS),
et la seconde passe Linux (`latest-json-linux`) hérite de la même autorisation
au lieu de la réinventer.

Le patch du corps de la release a été **déplacé après** le verdict de livraison :
une publication refusée ne laisse plus la Release à moitié réécrite.

### e) L'absence est visible pour l'utilisateur

Une phrase simple, en français, une seule source
(`macosMissingNotice`), écrite à la fois dans le **corps de la Release** et dans
les **notes de `latest.json`** (donc dans la modale de mise à jour) :

> ⚠️ **macOS n'est pas servi cette fois.** Aucun paquet d'installation macOS
> (Mac Apple Silicon et Mac Intel) n'accompagne cette version : les postes macOS
> ne recevront pas cette mise à jour et resteront sur leur version actuelle. Les
> fichiers publiés ci-dessous restent, eux, téléchargeables et fonctionnels.

Elle n'existe que si macOS manque réellement : macOS servi → aucune phrase,
aucune plateforme annoncée à tort.

## 3. Ce qui ne change pas (garde-fous conservés)

- Refus par défaut d'une livraison incomplète (`ALLOW_INCOMPLETE_RELEASE` reste
  la seule sortie de secours).
- Release créée seulement après un verdict de tests favorable (`create-release`
  → `needs: [test]`), et `build` après `create-release`.
- Refus net de republier un tag existant ; changelog utilisateur obligatoire.
- Linux reste hors chemin critique (job séparé, 90 min, `continue-on-error`).
- Aucun test supprimé, aucun numéro de version, tag ou release touché.

## 4. Ce que ça change pour l'utilisateur

- Une version **sort** même quand Apple ne fournit pas de machine : les postes
  Windows (et Linux quand il est là) reçoivent la mise à jour au lieu d'attendre
  indéfiniment une publication qui n'arrivait jamais.
- Les postes macOS **ne reçoivent rien cette fois** et restent sur leur version —
  c'est écrit noir sur blanc dans la Release et dans la modale de mise à jour.
- Rien d'autre ne change : les numéros de version restent la décision du
  propriétaire, et les publications 0.6.16 / 0.6.17 / 0.6.18 déjà perdues **ne
  sont pas rejouées** par cette correction (republier un tag est refusé).

## 5. Verrous (deux tests qui échouent si la panne revient)

`scripts/publication-sans-macos.test.js` — 15 tests, trois familles :

1. **Annulation macOS non bloquante** : le job `test` ne contient plus aucune
   machine Apple, `test-macos` existe et exécute bien les deux suites,
   `continue-on-error: true`, aucun job ne dépend de `test-macos`, les deux cibles
   macOS de `build` restent tolérées, `latest-json` garde `if: always()`.
2. **Livraison incomplète impossible sans autorisation** : refus par défaut,
   portée bornée à macOS, autorisation jamais en dur dans le workflow, refus
   toujours placé avant l'écriture de `latest.json` et avant le patch du corps.
3. **Absence annoncée, jamais inventée** : phrase nulle quand macOS est servi,
   phrase écrite dans le corps **et** dans les notes, aucune cible macOS
   synthétique dans `latest.json`.

**Preuves par mutation** (vérifiées puis restaurées, code identique après
restauration) :

| Mutation | Résultat attendu | Constaté |
|---|---|---|
| remettre `macos-latest` dans la matrice de `test` | verrou 1 échoue | 1 test en échec (14 passés) |
| poser `ALLOW_INCOMPLETE_RELEASE: "1"` en dur dans le workflow | verrou 2 échoue | 1 test en échec (14 passés) |
| retirer `allowIncompleteScope: MACOS_PLATFORMS` de `gen-latest-json.js` | verrou 2 échoue | 1 test en échec (14 passés) |

Et l'étape réelle, exercée sur trois jeux de fichiers simulés (Windows seul /
macOS présent / rien d'utilisable) : `allow_incomplete=1` **seulement** dans le
premier cas, avec la phrase d'annonce dans le journal ; rien dans les deux autres.

## 6. Commandes et résultats réels

```bash
npx vitest run scripts/publication-sans-macos.test.js   # 15 tests
npx vitest run                 # suite front complète
cargo test --workspace         # suite Rust complète
```

| Suite | Résultat |
|---|---|
| `scripts/publication-sans-macos.test.js` | **15 tests**, 0 échec |
| `scripts/` (verrous de publication) | **128 tests**, 0 échec |
| Front complet (`npx vitest run`) | **301 fichiers**, **5609 tests**, 0 échec |
| Rust complet (`cargo test --workspace`) | **1075 tests**, 0 échec, 14 ignorés (139 + 34 + 902) |
