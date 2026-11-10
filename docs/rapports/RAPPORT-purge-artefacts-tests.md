# Purge des artefacts de tests régénérables de `docs/rapports/`

Date : 2026-11-17 · Tête git au moment de l'inventaire : `b956128`

## 1. Objet

Le dossier `docs/rapports/` contenait **361 fichiers** et **9 549 663 octets**
(≈ 9,1 Mio). La demande : faire de la place **sans jamais perdre un rapport, une
fiche ou une spec**. Tracabilité prioritaire : une suppression abusive est un
échec grave. La règle appliquée est donc **conservatrice** (voir § 5).

## 2. Règle appliquée

Trois catégories, et une seule est supprimable :

| Catégorie | Définition | Sort |
|---|---|---|
| **(a) Rapport, fiche, spec, note** | tout `.md` (RAPPORT-*, rapport-*, VERIF-*, FICHE-*, PLAN-*, CONCEPTION-*, JOURNAL-*, DIAG-*, CONSTAT-*, REMARQUES-*, notes de travail) | **conservé sans exception** |
| **(b) Artefact de test régénérable** | sortie brute d'un outil de test, **reproductible par une commande**, **déjà déclarée « jamais versionnée » par le dépôt**, **non lue par aucun code** | supprimable |
| **(c) Incertain** | tout le reste | **conservé** |

Le critère (b) n'a **pas** été inventé ici : il vient de `.gitignore` § 65-70,
décision du propriétaire documentée dans `docs/rapports/RAPPORT-mise-au-propre-depot.md`
§ 7, qui dit :
« Un rapport peut citer la sortie comme preuve, mais l'artefact lui-même reste
local (volumineux, reproductible). » Les trois fichiers supprimés sont
**exactement** ceux que ce fichier d'exclusion désigne :

```
docs/rapports/vitest-*.json
docs/rapports/sorties/*.json
```

Vérifications faites avant de supprimer, pour chacun des trois :

1. **Régénérable** : ce sont des rapports `--reporter=json` de Vitest
   (`{"numTotalTestSuites":…,"numTotalTests":…}`), reproduits par
   `npx vitest run --reporter=json --outputFile=<chemin>`.
2. **Non suivi par git** : `git check-ignore -v` les attribue tous les trois à
   `.gitignore:69` / `.gitignore:70`. Aucun fichier suivi n'a donc été touché,
   et **aucun objet d'historique git n'est supprimé** (les anciens commits qui
   ont pu les contenir restent intacts).
3. **Aucun code ne les lit** : recherche sur les trois noms dans tout le dépôt
   (`*.js`, `*.ts`, `*.rs`, `*.json`, `*.md`, `*.yml`, `*.html`) → **uniquement
   des phrases de rapport** qui les citent comme preuve produite à l'époque
   (`RAPPORT-arret-ecoute-vocale.md`, `RAPPORT-bouton-ok-nova.md`,
   `RAPPORT-bouton-reveiller.md`, `RAPPORT-mise-au-propre-depot.md`). Aucun
   script, aucun test, aucun module ne les ouvre. Ces citations restent exactes
   dans leur sens (« une sortie brute a été produite ce jour-là »), et le mode
   d'emploi de reproduction est donné en § 6.

## 3. Décompte avant / après

| | Fichiers | Octets | Mio |
|---|---|---|---|
| **Avant** | 361 | 9 549 663 | 9,11 |
| **Après** | 358 | 4 249 232 | 4,05 |
| **Écart** | **−3** | **−5 300 431** | **−5,06 Mio** |

Aucun `.md` n'a été touché : **350 `.md` avant, 350 `.md` après** (351 avec le
présent rapport, écrit après la mesure).
Le dossier est passé de 10 M à 4,9 M sur le disque (`du -sh`), 5,3 M des 5,96 M
récupérables par cette règle étant les trois sorties JSON.

## 4. Fichiers supprimés (liste complète, un par un)

| # | Chemin | Taille (octets) |
|---|---|---|
| 1 | `docs/rapports/vitest-arret-ecoute-vocale.json` | 2 163 361 |
| 2 | `docs/rapports/vitest-bouton-ok-nova.json` | 1 567 721 |
| 3 | `docs/rapports/sorties/vitest-bouton-reveiller-20261029-0854.json` | 1 569 349 |
| | **Total** | **5 300 431** |

Rien d'autre n'a été supprimé. Aucun `git rm`, aucun `git reset`, aucun
nettoyage en masse, aucun `git gc`, aucune réécriture d'historique.

## 5. Fichiers conservés par prudence (catégorie c)

Huit fichiers non-`.md`, tous **suivis par git** et **cités comme preuve** dans
un rapport. Ils sont petits (5 964 octets au total) : les supprimer ne
libérerait rien de mesurable et casserait des renvois de rapport. **Conservés.**

| Chemin | Taille | Pourquoi conservé |
|---|---|---|
| `docs/rapports/RESULTATS-assistant-nom-du-personnage.txt` | 2 343 | cité par `RAPPORT-assistant-nom-du-personnage.md` (chiffres non recopiés à la main, réexécution complète) |
| `docs/rapports/sorties/rust-mcp-activation-assistant-20261029.txt` | 1 053 | cité par `RAPPORT-mcp-activation-par-l-assistant.md` |
| `docs/rapports/sorties/rust-verif-mcp-activation-20261029.txt` | 799 | cité par `RAPPORT-mcp-activation-par-l-assistant.md` |
| `docs/rapports/sorties/vitest-halo-enveloppe-20261028-final.txt` | 221 | cité deux fois par `RAPPORT-halo-suivant-le-son.md` |
| `docs/rapports/sorties/vitest-mcp-activation-assistant-20261029.txt` | 221 | cité par `RAPPORT-mcp-activation-par-l-assistant.md` |
| `docs/rapports/sorties/vitest-verif-complet-20261029.txt` | 627 | cité par `RAPPORT-mcp-activation-par-l-assistant.md` |
| `docs/rapports/sorties/vitest-verif-mcp-toggle-20261029.txt` | 228 | cité par `RAPPORT-mcp-activation-par-l-assistant.md` |
| `docs/rapports/sorties/geo-bouton-reveiller.mjs` | 1 472 | **script de mesure** cité par `RAPPORT-bouton-reveiller.md` (extrait de code probant, pas une sortie) |

Ce sont bien, techniquement, des sorties de test ; mais elles portent la
**preuve datée** (tête git, commande, verdict) que les rapports invoquent, elles
sont versionnées, et leur poids est négligeable. Le doute a profité à la
conservation.

## 6. Comment reproduire un artefact supprimé, si le besoin revient

```bash
npx vitest run --reporter=json --outputFile=docs/rapports/vitest-<sujet>.json
```

Le fichier produit retombe sous `.gitignore:69` : il reste **local**, comme
avant la purge. Un rapport qui veut citer une sortie brute la **régénère** puis
en cite le chemin et la date, exactement comme les quatre rapports cités au § 2.

## 7. Ce qui n'a pas été touché

- **Aucun fichier hors de `docs/rapports/`** n'a été modifié, déplacé ou
  supprimé (le `.gitignore` et `RAPPORT-mise-au-propre-depot.md` ont seulement
  été **lus** : ils fournissent la règle).
- **Aucun code source, aucun test, aucun script** modifié.
- Les rapports non suivis déjà présents dans le dossier (préfixe `rapport-*`,
  sortie `git status` en `??`) n'ont pas été touchés ni ajoutés au commit.

## 8. Conclusion

Trois fichiers supprimés sur 361, **5,06 Mio récupérés**, **350 rapports / fiches
/ specs intacts**, huit pièces probantes douteuses conservées. La place
récupérable restante dans ce dossier est essentiellement du **contenu de
rapport**, qui n'est pas supprimable par cette règle.
