# Rapport — mise au propre du dépôt Pilot

> **Date** : 2026-11-16
> **Point de départ** : `HEAD = 41510a8`, `origin/main...HEAD = 0 4`, arbre de
> travail avec `help/handbook.md` modifié et trois rapports non suivis.
> **Objet** : huit points de rangement, dans l'ordre demandé, sans réécriture
> d'historique, sans publication, sans tag, sans changement de version, sans
> toucher à `src-tauri/laya/` ni à `src-tauri/assets/`, sans supprimer ni
> déplacer un fichier de code de production.
> **Commits produits** : `fe6edc3`, `660afb2`, `85928ef`, `218c93f`, plus le
> commit de ce rapport. `main` est ensuite poussé (point 1 : c'est du travail
> déjà fait, pas une publication — aucun tag, aucune release, aucune version).

Tout ce qui suit a été fait sur le disque réel, et chaque affirmation est
accompagnée de la commande qui la prouve.

---

## 1. Le travail local est poussé — ✅

**Constat de départ** : `git rev-list --left-right --count origin/main...HEAD`
répondait `0 4` : quatre commits locaux en avance, rien en retard.

**Fait** : `git push origin main`. Puis vérification :

```
$ git rev-list --left-right --count origin/main...HEAD
0	0
```

Aucun tag créé, aucun fichier de version touché (`tauri.conf.json`,
`Cargo.toml`, `package.json`, `Cargo.lock` : inchangés, vérifié par
`git status`).

---

## 2. Les trois rapports non suivis sont entrés dans git — ✅

Trois documents de diagnostic vivaient hors de git :

| Fichier | Contenu |
|---|---|
| `docs/rapports/RAPPORT-diagnostic-gemma4-e4b-llama-cpp.md` | diagnostic du modèle local |
| `docs/rapports/RAPPORT-diagnostic-mot-de-reveil.md` | diagnostic des mots de réveil |
| `docs/rapports/RAPPORT-publication-v0.6.21.md` | compte rendu de la publication 0.6.21 |

**Fait** : commit `fe6edc3` — *« trois rapports de diagnostic et de publication
entrent dans git »*, 3 fichiers, 739 insertions.

---

## 3. L'aide générée ne salit plus le dépôt — ✅

**Défaut constaté** : l'en-tête de `help/handbook.md` portait la date du jour.

```
<!-- PILOT-HELP generated=2026-11-06 topics=overview,… -->
```

Chaque `npm run build:handbook` réécrivait donc un fichier **suivi** alors que
le contenu des sources était identique : l'arbre de travail était sale en
permanence, et les revues de diff montraient une modification fantôme à chaque
construction.

**Correction** (`scripts/build-handbook.js`, réécrit, même liste de 25 sources,
même sortie) :

1. **La composition est pure** — fonction exportée `composeHandbook()` : aucune
   date, aucun horodatage, aucun appel à l'horloge. L'en-tête devient
   `<!-- PILOT-HELP topics=… -->`. À sources égales, deux générations produisent
   le **même texte**, quel que soit le jour.
2. **L'écriture est conditionnelle** — `writeIfChanged()` compare le contenu
   produit à celui du disque (fins de ligne normalisées) et **n'écrit rien** si
   les deux coïncident : ni le contenu, ni la date de modification du fichier ne
   changent.
3. **`main()` ne s'exécute que si le script est lancé directement** — importer
   le module depuis un test n'écrit donc jamais dans le dépôt.

**Preuve** (trois générations consécutives) :

```
$ node scripts/build-handbook.js
[build-handbook] … help/handbook.md déjà à jour (50 blocs, 351174 octets) — fichier non touché
$ node scripts/build-handbook.js
[build-handbook] … déjà à jour … — fichier non touché
$ git status --short help/handbook.md      # (aucune ligne)
```

**Le verrou** : `scripts/build-handbook.test.js` (6 tests, tous verts) :

- deux compositions à **horloges différentes** donnent un texte strictement
  identique (ce test échoue si une date revient dans l'en-tête) ;
- l'en-tête ne contient ni date, ni heure, ni `generated=` ;
- l'ordre des sources est conservé ;
- `writeIfChanged` n'écrit pas quand le contenu est identique (date de
  modification inchangée) et écrit quand il change vraiment ;
- un fichier en CRLF équivalent n'est pas réécrit (piège CI Windows,
  `.pi/skills/quality-gate/SKILL.md` § 3.4).

**Documentation** : `spec_help.md` §3.3 ne décrit plus `generated=<date>` mais
l'en-tête sans date, la composition pure, l'écriture paresseuse et le verrou.

Seul changement visible du fichier suivi : `help/handbook.md` — **1 insertion,
1 suppression** (l'en-tête). Le contenu embarqué est identique.

---

## 4. Les trois specs invisibles sont citées — ✅

Trois specs existaient à la racine sans être citées dans `AGENTS.md`. Elles sont
entrées dans la table « Navigation rapide », décrites **d'après leur propre
contenu** (aucune invention) :

| Spec | Ce qu'elle dit d'elle-même |
|---|---|
| `spec_orchestration_multiagents.md` | Orchestration multi-agents : Phase 0 implémentée (T1 à T6), réservations de fichiers, agents jetables, bus d'agents (`agents-bus.js`), `AgentService` côté Rust |
| `spec_agents_md.md` | Bouton de la barre d'outils pour créer / mettre à jour `AGENTS.md` par un modèle IA (issue #5) |
| `spec_assistant_sync.md` | 🟡 **rien d'implémenté** : le contexte projet voyage via GDS §6/C1 ; le portage est réalisé dans `spec_reseau.md`, le partage du contexte de l'assistant reste à faire |

Les trois lignes disent donc aussi, quand c'est le cas, que la spec **n'est pas
implémentée** — pour qu'aucun lecteur ne la prenne pour une fonctionnalité
livrée.

---

## 5. `AGENTS.md` dit maintenant qu'il est partiel — ✅

**Mesure exacte** (production, hors `*.test.js`) :

```
161 fichiers dans src/js/*.js  →  87 cités dans AGENTS.md, 74 jamais cités
```

Le fichier fait 90 Ko : le réécrire était hors de question. Une phrase explicite
ouvre désormais la section « Structure du projet » :

> **Cette arborescence est PARTIELLE — le disque fait foi.** Elle nomme les
> fichiers qui portent une **décision structurante** (87 des 161 fichiers
> JavaScript de production ; 74 n'y sont pas) … Un fichier absent d'ici n'est
> **pas** un fichier mort, un fichier déplacé n'est pas un fichier supprimé.
> Pour la vérité du disque : `git ls-files 'src/js/*.js'`, `git ls-files
> 'src-tauri/src/*.rs'`, `ls docs/rapports` ; pour savoir qui appelle quoi, le
> wiki du Code Graph ou `rg`.

**Mentions devenues fausses — constatées et corrigées** (un seul cas) :

`web_auth.rs`, `web_rate.rs`, `web_audit.rs` étaient encore listés comme
fichiers de `src-tauri/src/`. Ils **n'existent plus** : depuis L1.7 ils vivent
dans le socle `gds-core/src/` (`auth.rs`, `rate.rs`, `audit.rs`) et sont aliasés
dans `src-tauri/src/lib.rs` (`use gds_core::auth as web_auth;` …). L'arborescence
le dit maintenant, à la place des trois lignes fantômes.

**Vérification systématique** : tous les chemins cités dans `AGENTS.md` (106
jetons en `backticks`, 201 noms du bloc d'arborescence) ont été confrontés au
disque. Résultat : **aucun autre fichier cité ne manque**. Les seuls noms
introuvables sont légitimes : `prompt-history.md` (créé à l'exécution dans
l'espace de l'assistant), `release-notes/vX.Y.Z.md` (motif de nom), `latest.json`
(artefact généré), `xterm.js` (paquet npm). Aucun fichier n'a donc été
« corrigé » par supposition.

---

## 6. La racine est rangée : 32 documents de travail → `docs/rapports/` — ✅

Déplacés avec `git mv` (**aucun renommage**, contenu intact, historique suivi) :

- les **22** `rapport-*.md` (`rapport-380bis-verif`, `-381-agent-demande`,
  `-384-remise-en-etat`, `-385-file-attente`, `-386-publication-0.4.32`,
  `-delai-inactivite`, `-doc-delai-inactivite`, `-doc-finale`,
  `-fiche-agent-2-colonnes`, `-file-attente-pertes-doublons`,
  `-maj-non-detectee`, `-p1-ordre-arrivee`, `-p2-file-conservee`,
  `-p3-cle-projet`, `-p4-maj-detectee`, `-p5-fenetre-maj`,
  `-publication-0.4.36`, `-publication-0.4.37`, `-relecture-file`,
  `-relecture-finale`, `-relecture-maj`, `-resume-tache-fourni`) ;
- `VERIF-380.md`, `PLAN-mode-reseau-multipostes.md`,
  `plan-organisation-par-defaut.md`, `plan_gestion_agents.md`,
  `plan_graphique.md`, `plan_reconciliation_phase2.md`, `refonte_graphique.md`,
  `orchestration_V3.md`, `fiche-reference-pilot.md`,
  `analyse_doublons_contexte.md`.

**Références de chemin corrigées** (elles pointaient la racine) :

| Fichier | Avant | Après |
|---|---|---|
| `plan_dev.md` | lien `PLAN-mode-reseau-multipostes.md` | lien `docs/rapports/PLAN-mode-reseau-multipostes.md` |
| `spec_reseau.md` § en-tête | `PLAN-mode-reseau-multipostes.md` | `docs/rapports/…` |
| `spec_gds.md` (2 endroits) | idem | `docs/rapports/…` |
| `spec_gestion_agents.md` | `plan_gestion_agents.md` | `docs/rapports/plan_gestion_agents.md` |
| `spec_orchestration.md` (2 endroits) | `orchestration_V3.md` | `docs/rapports/orchestration_V3.md` |
| `gds-core/src/db.rs`, `handover.rs`, `http.rs` | commentaires citant le plan | `docs/rapports/PLAN-mode-reseau-multipostes.md` |
| `src/js/help-delai-inactivite.test.js` | « `rapport-delai-inactivite.md`, racine du projet » | « `docs/rapports/rapport-delai-inactivite.md` » |

Recherche de contrôle après coup — aucune référence de chemin ne pointe encore
un ancien emplacement :

```
$ grep -rn "](…rapport-\|](…VERIF-380\|](…PLAN-mode\|](…plan_\|](…refonte_graphique\|](…orchestration_V3" --include=*.md .
(zéro résultat)
```

**Ce qui a été délibérément laissé à la racine** :

- `plan_dev.md` et `plan_gds.md` : ce sont des **documents de référence
  permanents**, cités comme tels par `AGENTS.md` (« Roadmap restante ») et par la
  règle 2 de maintenance (un résumé concis + liens). Les enterrer dans les
  rapports contredirait la documentation qui les désigne à la racine.
- `idees_evolutions.md`, `spec_*.md`, `README.md`, `AGENTS.md`,
  `PROJECT_MEMORY.md` : ce ne sont pas des documents de travail mais les
  sources de vérité du projet.
- `Bugs et Evolutions.md` : **hors de la liste demandée**, et aucune règle ne
  l'impose (ce n'est ni un `rapport-*`, ni un `plan_*`, ni un `CONCEPTION-*`).
  Il n'a pas été touché — le déplacer aurait été une initiative non demandée.
- Les trois `RAPPORT-*` du point 2 étaient déjà au bon endroit.

---

## 7. Les sorties brutes ne sont plus versionnées — ✅

| Fichier | Taille | Nature |
|---|---|---|
| `docs/rapports/sorties/vitest-bouton-reveiller-20261029-0854.json` | 1 569 349 o | sortie Vitest brute |
| `docs/rapports/vitest-bouton-ok-nova.json` | 1 567 721 o | sortie Vitest brute |
| `models_tmp.json` | 582 o | temporaire |
| `diff-css.txt` | 1,7 Ko | mesure jetable |

Total retiré de l'index : **3 139 405 octets** (≈ 3,0 Mo).

**Fait** : `git rm --cached` sur les quatre (jamais de `git filter-branch`, de
`git gc` agressif ni aucune réécriture d'historique : les objets restent dans les
commits passés, on cesse seulement de les suivre).

**`.gitignore` complété**, avec la raison écrite sur place :

```
# Sorties BRUTES de tests et fichiers temporaires de mesure : jamais versionnées.
docs/rapports/vitest-*.json
docs/rapports/sorties/*.json
models_tmp.json
diff-css.txt
```

Les fichiers restent **sur le poste** (rien n'est supprimé) ; ils ne sont plus
suivis et plus proposés à l'index (`git status --short` ne les montre plus).

**Vérification « aucun code ne lit ces chemins »** :

```
$ grep -rn "models_tmp\|diff-css\|vitest-bouton-ok-nova\|vitest-bouton-reveiller-20261029" \
    --include=*.js --include=*.rs --include=*.json --include=*.md --include=*.yml --include=*.html .
```

Deux résultats, tous deux des **phrases de rapport**, aucune lecture :

- `docs/rapports/RAPPORT-bouton-ok-nova.md:188` cite le JSON comme **preuve
  produite** à l'époque ;
- `docs/rapports/RAPPORT-bouton-reveiller.md:84` idem.

Aucun script, aucun test, aucun module ne les ouvre. Ces deux citations restent
exactes (le fichier existe toujours localement) ; elles désignent simplement un
artefact qui n'est plus versionné — c'est précisément la décision du point 7.

---

## 8. Les branches mortes sont supprimées — ✅

Douze branches locales, **toutes à 0 commit d'avance** sur `main` (vérifié :

```
$ for b in …; do echo "$b -> $(git rev-list --left-right --count main...$b)"; done
correctifs-lot1 -> 902 0     feat/laya-marche2 -> 609 0
feat/telegram-etape2-et-son-affichage -> 811 0   fix-dispo-assistant -> 899 0
fix-onglet-avatar -> 901 0   fix/defaut-b-purge-busy -> 828 0
gds-refonte-l1 -> 792 0      gds-refonte-l2 -> 651 0
gds-refonte-l6 -> 806 0      gds-serveur-distant -> 914 0
plface-autostart -> 903 0    verrou-par-projet -> 566 0
```
)

Supprimées avec **`git branch -d` uniquement** (jamais `-D`) : les douze ont été
acceptées (c'est la preuve qu'elles étaient bien fusionnées).

```
$ git branch
* main
```

Aucun refus, donc aucune branche laissée de côté.

---

## 9. Vérifications finales

| Contrôle | Résultat |
|---|---|
| `npx vitest run` | **PASS (5807) FAIL (0)** — 312 fichiers de test (301 `src/js/*.test.js` + 11 `scripts/*.test.js`) : les 311 d'avant + `scripts/build-handbook.test.js` |
| `cargo test -p gds-core` | **139 passed, 11 ignored** (0 échec) |
| `cargo test -p gds-server` | **34 passed** (0 échec) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **964 passed, 3 ignored** (0 échec) |
| `git status --short` | propre après le commit de ce rapport |
| `git rev-list --left-right --count origin/main...HEAD` | `0 0` après le push de `main` |
| `git branch` | `* main` |

Aucun test assoupli, aucun test supprimé, aucun `skip` ajouté. Le seul test
nouveau **durcit** le dépôt (il échoue si une date revient dans l'en-tête de
l'aide ou si une génération identique réécrit le fichier).

### Note d'honnêteté sur l'ordre des commits

Les déplacements (`git mv`) et les retraits d'index (`git rm --cached`) étaient
déjà **indexés** quand le premier commit a été créé : il a donc emporté les
points 3, 6 et 7 sous un message qui ne parlait que de l'aide générée. Ce commit
n'était **pas encore poussé** : il a été défait (`git reset --soft HEAD~1` puis
`git reset`), puis refait proprement en trois commits distincts (point 3 → point
5 → points 6/7/8). **Aucun historique publié n'a été réécrit** ; aucun commit
distant n'a été touché.

---

## 10. Ce qui reste volontairement de côté

1. **Le contenu de l'arborescence d'`AGENTS.md`** n'a pas été complété : le
   point 5 demandait une phrase, pas une réécriture de 90 Ko. Les 74 fichiers JS
   non cités restent non cités, mais le fichier **le dit** désormais, et renvoie
   aux commandes qui donnent la vérité du disque.
2. **`Bugs et Evolutions.md`** reste à la racine : hors de la liste fournie, et
   aucune règle du dépôt ne l'oblige à partir. Le déplacer sans consigne aurait
   été un choix non demandé.
3. **`plan_dev.md` / `plan_gds.md`** restent à la racine (documents de référence
   permanents, cités par `AGENTS.md`).
4. **Les trois `.md` de `docs/rapports/sorties/`** (petits `.txt`/`.mjs` de
   moins de 1,5 Ko) restent versionnés : ils sont lisibles, utiles comme preuve
   et ne pèsent rien. Seuls les JSON volumineux sont partis.
5. **Aucune suppression disque** : tout ce qui a quitté l'index est toujours sur
   le poste (`models_tmp.json`, `diff-css.txt`, les deux JSON).
6. **Aucun fichier de code de production** n'a été déplacé ni supprimé. Les
   seules écritures dans du code sont : trois **commentaires** de `gds-core`
   (chemin du plan), un **commentaire** de test (`help-delai-inactivite.test.js`),
   et le script d'aide généré.

---

DONE: dépôt mis au propre — 8/8 points traités, 5 commits, `main` poussé (`0 0`), arbre propre, 12 branches mortes supprimées avec `-d`, 32 documents de travail rangés dans `docs/rapports/`, 3,0 Mo de sorties brutes déversionnées, aide générée idempotente et verrouillée par un test ; vitest 5807/0 échec, gds-core 139, gds-server 34, desktop 964 — aucun test assoupli.
