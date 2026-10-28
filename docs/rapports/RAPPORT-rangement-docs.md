# Rapport — rangement des rapports et des conceptions

Mission : sortir de la racine les rapports de mission (`RAPPORT-*.md`) et les
documents de conception (`CONCEPTION-*.md`), sans rien perdre, sans rien
renommer, sans rien supprimer, et en gardant l'historique Git de chaque fichier.

Date : 2026-10-28. État de départ : `main` à `6883eab`, arbre de travail propre
(seuls des fichiers non suivis étaient présents).

---

## 1. Recomptage fait sur le disque (pas recopié de la demande)

Comptage avant déplacement, racine du dépôt :

| Famille | Suivis par Git | Non suivis | Total |
|---|---|---|---|
| `RAPPORT-*.md` | 108 | 57 | **165** |
| `CONCEPTION-*.md` | 1 | 2 | **3** |
| **Total** | **109** | **59** | **168** |

Après déplacement, recomptage :

- `docs/rapports/*.md` : **165**
- `docs/conceptions/*.md` : **3**
- racine : **0** fichier `RAPPORT-*.md` ou `CONCEPTION-*.md`

Le total est identique avant et après (168) : **aucun fichier perdu**.

## 2. Répartition et méthode

| Destination | Contenu | Déplacés par `git mv` | Déplacés par `mv` |
|---|---|---|---|
| `docs/rapports/` | 165 `RAPPORT-*.md` | 108 | 57 |
| `docs/conceptions/` | 3 `CONCEPTION-*.md` | 1 | 2 |

- Les fichiers **suivis** sont passés par `git mv` : `git status` affiche
  **109 renommages** (`R...`) et **aucune** suppression ni ajout.
- Les fichiers **non suivis** ont été déplacés par un `mv` simple (ils restent
  non suivis : voir § 6).
- **Aucun renommage** : chaque fichier garde exactement son nom d'origine, donc
  toutes les citations par nom restent valables.
- Deux dossiers **plats**, sans sous-dossier par date ni par thème.

## 3. Références trouvées dans le dépôt

Recherche : `git grep` sur les fichiers **suivis** hors des dossiers déplacés,
extensions `.md`, `.js`, `.ts`, `.rs`, `.json`, motif
`(RAPPORT|CONCEPTION)-[A-Za-z0-9._-]+\.md`.

Résultat : **72 mentions** dans **39 fichiers**. Elles sont de deux natures :

1. **Citations par NOM seul** (ex. `RAPPORT-badge-distant-bas.md`,
   `CONCEPTION-cercle-equaliseur.md`), dans `spec_cinq_regles_chaine_agents.md`,
   `spec_super_agent.md`, `spec_pilot.md`, `spec_web_remote.md`,
   `spec_read_aloud.md`, `spec_anomaly.md`, `PLAN-mode-reseau-multipostes.md`,
   `src/js/*.js`, `src/js/*.test.js`, `src-tauri/src/*.rs`,
   `VERIF-380.md`, `rapport-380bis-verif.md`.
   → **Aucune modification nécessaire** : les fichiers gardent leur nom, et ces
   citations ne désignent pas un chemin. C'est exactement pourquoi la consigne
   interdisait de renommer.

2. **Une seule mention désignant un emplacement exact** :
   `spec_modes_ecran_vocal.md` § en-tête disait que les raisons de conception
   « restent dans `RAPPORT-trois-modes-ecran-vocal.md`, **à la racine** » — devenu
   faux.

| Fichier | Avant | Après |
|---|---|---|
| `spec_modes_ecran_vocal.md` (en-tête) | `` `RAPPORT-trois-modes-ecran-vocal.md`, à la racine`` | `` `docs/rapports/RAPPORT-trois-modes-ecran-vocal.md` `` |

Aucune autre référence de type chemin (`./`, `../`, `docs/`, lien Markdown vers
un de ces fichiers) n'existe dans les fichiers suivis. Vérifié par une seconde
recherche ciblée sur les préfixes de chemin : **zéro** autre résultat.

Non modifié, volontairement : les fichiers déplacés eux-mêmes (consigne : ne pas
toucher leur contenu), les documents de conception historiques
(`docs/proposition-*.md`, `plan_*.md`) et les fichiers non suivis (`.pilot/`,
`VERIF-380.md`, `rapport-380bis-verif.md`) : leurs mentions sont des noms seuls,
toujours vrais.

## 4. Convention documentée

`AGENTS.md` — section « Documentation à jour » → « Règles de maintenance de la
documentation », nouvelle règle **7** (deux lignes, dans le style du fichier) :

> **Rapports et conceptions** : les rapports de mission (`RAPPORT-*.md`) vont
> dans `docs/rapports/` et les documents de conception (`CONCEPTION-*.md`) dans
> `docs/conceptions/` — deux dossiers versionnés, plats, sans renommage des
> fichiers. Rien de tout cela à la racine.

## 5. Tests adaptés

**Aucun test n'a eu besoin d'être adapté, et aucun n'a été modifié.**

Pourquoi, et comment c'est vérifié :

- aucun test ne lit un de ces documents : recherche de `readFileSync` /
  `readdirSync` dans `src/js/*.test.js` ne montre que des lectures de fichiers
  `src/js/*.js` (tests d'ancres de source) et de fixtures temporaires ;
- aucun test n'énumère la racine du dépôt (`readdirSync` sur la racine : zéro
  occurrence) ;
- les mentions dans les tests (`badge-distant-bas.test.js`,
  `repli-menus-bas.test.js`, `logo-bouton-trois-modes.test.js`,
  `ecran-vocal-lot2/3/4a.test.js`, `trois-modes-ecran.test.js`,
  `vocal-equalizer.test.js`, `compteur-taches-travail.test.js`,
  `relances-relecture.test.js`, `retrait-ecran-aide.test.js`,
  `lot2-colonne-haut.test.js`, `lot3-colonne-bas.test.js`,
  `agents-bus.test.js`, `updater-attente-qui-bloque.test.js`,
  `super-agent-receipt.test.js`, `voix-locales-chargement-automatique.test.js`)
  sont des **commentaires** citant un rapport par son nom : rien à changer.

## 6. Ce qui n'a PAS été touché

- **Aucune suppression**, aucun archivage, aucune corbeille, aucun `rm`.
- **Aucun renommage**, même de fichier « à uniformiser ».
- Rien d'autre n'a bougé à la racine : `spec_*.md`, `plan_*.md`, `PLAN-*.md`,
  `README.md`, `AGENTS.md`, `vocal.md`, `VERIF-380.md`,
  `rapport-380bis-verif.md`, `analyse_doublons_contexte.md` restent où ils sont.
- Les dossiers `src/`, `src-tauri/`, `web/`, `gds-core/`, `gds-server/`,
  `docs/` existant (fichiers `proposition-*.md`, `rapport-*.md`,
  `*-setup.md`, `guide-*.md`) : intacts.
- Le **contenu** des rapports et des conceptions : intacts (déplacement seul).
- **Les 59 fichiers non suivis restent non suivis** après leur déplacement :
  ils n'étaient pas versionnés avant, ils ne le sont pas davantage après (dont
  `RAPPORT-publication-0.4.43-BLOQUEE.md`, que plusieurs rapports citent comme
  « non suivi, laissé tel quel »). Le commit ne contient donc que les 109
  renommages, la règle `AGENTS.md`, la référence corrigée et ce rapport.

## 7. Commandes lancées et résultats exacts

Ordre respecté : ce rapport a été **écrit avant** le lancement des batteries
complètes ; seule cette section a été complétée après coup, avec les sorties
réelles.

| Commande | Résultat exact | Verdict |
|---|---|---|
| `git ls-files -z 'RAPPORT-*.md' 'CONCEPTION-*.md'` puis `git mv` fichier par fichier | 109 renommages | ✅ |
| `mv` des 59 fichiers non suivis | 0 échec | ✅ |
| `git status --short` (après les deux déplacements) | **109 lignes `R`** (renommages) ; **aucune** ligne `D` ni `A` hors `??` | ✅ pas de suppression + ajout |
| `npx vitest run` | `PASS (3895) FAIL (0)` — code de sortie **0** | ✅ |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | `792 passed, 1 ignored` (1 suite, 10.84 s) — code de sortie **0** | ✅ |
| `npm run build:handbook` | 46 blocs, 289 381 octets ; `git diff --stat help/handbook.md` → **vide** | ✅ aucun bloc d'aide touché |

Aucun test n'a rougi, donc aucune correction de chemin dans un test n'a été
nécessaire (§ 5).

### Vérifications finales

- racine : `0` fichier `RAPPORT-*.md` / `CONCEPTION-*.md` ;
- `docs/rapports/` : 166 fichiers — les **165** rapports déplacés **plus ce
  rapport-ci** ; `docs/conceptions/` : 3 fichiers ;
- aucun `rm`, aucune suppression, aucun renommage ;
- un seul commit pour toute l'opération.

