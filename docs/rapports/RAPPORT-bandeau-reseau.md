# Rapport — Interface du portage réseau (plan multi-postes, §7 étape 5)

Branche de travail : `main` local. **Interface seulement** : aucun fichier Rust,
aucune migration, aucune route. Un seul commit local, pas de push, pas de tag.

---

## 1. La tâche reçue, citée mot pour mot

Ligne 5 du tableau de la §7 de `PLAN-mode-reseau-multipostes.md` :

> | 5 | Interface : bandeau « tenu par X, jusqu'à HH:MM », **lecture seule (aucune
> modification de fichier, aucun agent du projet lancé)**, **travail local non
> publiable signalé** avec l'action « prendre le projet pour publier » (§1),
> bouton de restitution, bouton admin « Libérer » tracé | codeur front |
> `src/js/gds.js`, `src/js/gds-status.js`, `src/js/gds-admin.js` |
> `npx vitest run src/js/gds-handover.test.js` |

Précision utile : le test qui prouve cette étape est **un fichier nommé par le
plan**, `src/js/gds-handover.test.js`, qui **n'existait pas**. Il a donc été
**créé** (aucun test existant n'a été supprimé ni affaibli) ; le reste de la
suite est inchangé.

---

## 2. Ce qui est livré, exigence par exigence

| Exigence de la ligne 5 | Où | Ce que voit l'utilisateur |
|---|---|---|
| **Bandeau « tenu par X, jusqu'à HH:MM »** | `src/js/gds-status.js` (`handoverBanner`, `formatHandoverUntil`), rendu dans `#gds-handover` de l'en-tête GDS (`src/js/gds.js`) | « Ce projet est tenu par un autre développeur, **jusqu'à 14:35**. Ce poste ne peut rien publier tant qu'il ne tient pas le projet : la lecture, la navigation et la consultation restent possibles, la publication du code et de l'avancement est refusée. » L'heure est celle du fuseau du poste ; `JJ/MM a HH:MM` un autre jour, `JJ/MM/AAAA a HH:MM` une autre année ; **échéance illisible = aucune heure inventée**. |
| **Lecture seule, dite au clic** | `handoverWriteAllowed`, `handoverWriteRefusal` + `guardWrite()` dans `gds.js` | Les **cinq** gestes qui écrivent (« Activer GDS sur ce projet », « Ajouter ce projet au GDS », « Synchroniser ce projet », « Publier ce projet sur le GDS », « Retirer du GDS ») **ne partent pas** et affichent le motif (qui tient le projet, jusqu'à quand, quoi faire). Jamais un refus muet, jamais un bouton mort. |
| **Travail local non publiable signalé + « prendre le projet pour publier »** | `handoverLocalWorkNotice`, `handoverHasTake` | « Votre travail local (3 fichiers modifiés) ne peut pas être publié : le projet est tenu par un autre développeur jusqu'à 14:35. Il est conservé sur ce poste, rien n'est supprimé : prenez le projet en main pour publier. » + bouton **« Prendre le projet pour publier »** (`gds_handover_take`, refus du serveur relayé). |
| **Bouton de restitution** | `handoverHasGiveBack` + `giveBackProject()` | Bouton **« Rendre le projet »** visible **seulement** quand ce poste tient le projet → `gds_handover_return` (code publié → avancement poussé → projet libéré). Échec : le poste **reste porteur**, le message du poste s'affiche, **rejouable**. |
| **Bouton admin « Libérer » tracé** | `src/js/gds-admin.js` (`canReleaseProject`, `handoverReleaseReasonError`, `handoverReleaseTraceLine`, `renderProjectReleaseConfirmHtml`) | Dans « 🖥️ GDS Serveur — administration » → **Dépôts / projets**, bouton **« Libérer »** rendu **uniquement** pour le rôle `admin` (même règle que les actions de service). Motif **obligatoire** (vide ou < 5 caractères refusé avec un message). Le geste produit une trace **nommée** : projet + compte + motif. **Limite assumée** (voir §5) : la commande de libération n'existe pas côté poste, donc l'écran **dit qu'il n'a rien libéré** au lieu de faire semblant. |
| **Projet libre ou tenu par soi : aucun changement** | `renderHandover()` + `.gds-handover:empty` | La zone est **vide** : aucune bordure, aucune place occupée, aucun bandeau parasite. Le seul ajout quand on tient le projet est le bouton de restitution (demandé par le plan). |

Contraintes de forme tenues :

- **Emplacement naturel** : le bloc vit dans l'**en-tête de l'écran GDS**, donc
  **dans le corps de l'onglet** — il ne décale ni la rangée d'onglets, ni la
  colonne de gauche, ni le bloc du bas.
- **Pas de fenêtre ni d'alerte bloquante** : un bandeau d'avertissement (fond
  `var(--warning)`, texte `var(--text-secondary)`) et des boutons ordinaires.
- **Aucune couleur en dur, aucun nouveau jeton** : uniquement `--warning` et
  `--text-secondary`, définis dans les thèmes clairs **et** sombres (le test
  refuse tout `#rrggbb` dans ce bloc de CSS).
- **Source unique** : toute la lecture des réponses de portage et **tous** les
  textes sont des fonctions **pures** dans `gds-status.js` ; `gds.js` ne fait
  que rendre et déclencher ; `gds-admin.js` porte la libération.

---

## 3. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/gds-status.js` | **+** section « PORTAGE » : constantes d'état, `mapHandoverState`, `formatHandoverUntil`, `handoverBanner`, `handoverLocalWorkNotice`, `handoverWriteAllowed`, `handoverWriteRefusal`, `handoverHasTake`, `handoverHasGiveBack`, `countLocalChanges` |
| `src/js/gds.js` | **+** zone `#gds-handover` dans l'en-tête, `renderHandover`, `guardWrite` (posé sur les 5 gestes), `loadHandover`, `loadLocalChanges`, `takeProject`, `giveBackProject` ; intégration dans `refresh()` |
| `src/js/gds-admin.js` | **+** `canReleaseProject`, `PROJECT_RELEASE_DESC`, `handoverReleaseReasonError`, `handoverReleaseTraceLine`, `renderProjectReleaseConfirmHtml` ; bouton « Libérer » dans le tableau des projets ; actions `release` / `release-cancel` / `release-confirm` ; motif relu avant redessin ; rôle transmis à la section |
| `src/js/gds-handover.test.js` | **nouveau** — 53 tests (preuve nommée par le plan) |
| `src/css/style.css` | **+** `.gds-handover`, `.gds-handover:empty`, `.gds-handover-line`, `.gds-handover-msg`, `.gds-handover-actions` (jetons uniquement) |
| `spec_gds.md` | **+** §5.4 « Portage d'un projet entre postes — interface » |
| `help/overview.md` | **+** trois puces utilisateur dans le bloc `HELP:gds` (bandeau / travail local / rendre + libérer) |
| `help/handbook.md` | régénéré par `npm run build:handbook` (jamais édité à la main) |

---

## 4. Preuves

### 4.1 Suite de tests

| Moment | Résultat |
|---|---|
| Avant toute modification (relevé en début de séance) | **3060 PASS / 0 FAIL** |
| Après (suite complète, `npx vitest run`) | **3113 PASS / 0 FAIL** (+53, aucun test cassé) |
| Le fichier de preuve seul | `npx vitest run src/js/gds-handover.test.js` → **53 PASS / 0 FAIL** |

### 4.2 Morsure prouvée (trois mutations réelles, puis restauration)

| Mutation appliquée au code | Résultat obtenu |
|---|---|
| Lecture seule supprimée (`handoverWriteAllowed` → `return true`) | **1 échec** : « MORSURE : autre poste → écriture refusée » |
| Bandeau privé de l'heure de fin (`const until = ""` dans `handoverBanner`) | **1 échec** : « projet tenu par un autre poste : alerte + HEURE DE FIN lisible » |
| Porte d'écriture retirée d'un seul geste (`guardWrite("Synchroniser ce projet")` supprimé) | **1 échec** : « MORSURE : les cinq gestes qui écrivent sont gardés, avec leur libellé » |

Chaque mutation a été annulée immédiatement (fichiers restaurés depuis une copie)
et la suite est revenue à **3113 PASS / 0 FAIL**.

### 4.3 Ce que couvrent les 53 tests

- **Lecture des réponses** : prise par ce poste → « tenu par moi » ; porteur
  autre → « tenu par un autre » (porteur + échéance) ; prise expirée de ce poste
  → « libre » ; `claim_required` → « libre » ; panne / réponse vide → « invérifiable »
  (jamais une supposition) ; comparaison des identifiants insensible à la casse.
- **Heure de fin** : jour même `14:35`, autre jour `03/12 a 08:05`, autre année
  `15/01/2027 a 18:45`, horodatage SQL accepté, illisible → chaîne vide.
- **Bandeau** : contient l'heure ; sans échéance il ne l'invente pas ; état
  invérifiable → alerte avec le motif ; libre ou tenu par soi → **aucun** bandeau.
- **Lecture seule** : refus + motif nommant l'action et l'heure ; état
  invérifiable → ne bloque pas (le serveur reste seul juge) et le bandeau le dit.
- **Travail local** : singulier/pluriel, mention « conservé », « rien n'est
  supprimé », invitation à prendre le projet ; 0 modification → rien à dire.
- **Restitution** : bouton seulement si ce poste tient le projet ; le message
  « Projet rendu » n'apparaît **qu'après** l'appel réussi.
- **Libération** : `admin` seul (casse et espaces tolérés), motif obligatoire,
  trace nommant projet + compte + motif, panneau et bouton **absents** pour un
  développeur ou un rôle inconnu, motif relu avant redessin.
- **Style** : les 4 classes existent, `:empty` neutralise le bloc, aucun `#hex`
  dans le bloc.

---

## 5. Trous et limites — dits franchement, rien inventé

1. **La libération forcée n'est pas exécutable depuis un poste.**
   `src-tauri/src/gds_handover.rs:378` définit bien `force(project, reason)`
   (`pub(crate)`) et le serveur expose `POST /api/gds/handover/force`
   (`src-tauri/src/gds_handover.rs:43`), mais **aucune commande Tauri
   `gds_handover_force` n'est enregistrée** : `src-tauri/src/lib.rs:3989-3995`
   ne contient que `take`, `state`, `return`, `can_write`, `presence_now`.
   Le lot étant **front-only**, je n'ai créé ni commande ni route. Le bouton
   existe donc, exige le motif et **trace** le geste, mais **annonce qu'il n'a
   rien libéré**. Pour le rendre effectif, il faut une commande Rust
   (`gds_handover_force`) — lot suivant.

2. **La lecture seule stricte (enregistrement de fichier local + lancement d'un
   agent du projet) n'est pas encore appliquée par le poste.**
   Le seul refus côté serveur aujourd'hui porte sur la **publication du suivi** :
   `ensure_write_allowed` est appelé dans `gds_force_push_suivi`
   (`src-tauri/src/gds_sync.rs:1120`, commande enregistrée
   `src-tauri/src/lib.rs:4001`). Aucune garde de portage n'existe dans
   `src-tauri/src/files.rs:76` (`write_file_content`), `agent_service.rs` ou
   `rpc.rs` (vérifié par recherche : aucune occurrence de `handover` dans ces
   fichiers). Bloquer l'écriture locale et le lancement d'agents **exige du
   Rust** : c'est hors de ce lot, et le faire côté JavaScript serait un
   contournement fragile (les outils d'écriture des agents ne passent pas par le
   front). **Conséquence assumée** : les textes de l'interface ne promettent que
   ce qui est réellement tenu — « rien ne peut être **publié** » — et non « vous
   ne pouvez pas modifier un fichier ». À livrer : garde dans le chemin
   d'écriture de fichier et refus de démarrage d'un agent du projet quand un
   autre poste tient le projet.

3. **Le bandeau se met à jour au rafraîchissement de l'écran, pas à la seconde.**
   Aucune minuterie n'a été ajoutée : l'état et l'heure sont relus à chaque
   `refresh()` de l'écran GDS (ouverture, bascule de projet, après un geste).
   Le plan ne demande pas de compte à rebours ; ajouter un minuteur aurait été
   un mécanisme de plus.

4. **Choix tranché pendant le lot** : un état **invérifiable** (serveur
   injoignable, réponse vide) **ne bloque pas** les gestes qui publient, il les
   **signale** (bandeau) et laisse le serveur trancher. Motif : bloquer sur un
   état invérifiable empêcherait de réparer une liaison cassée (« Ajouter ce
   projet au GDS »), alors que le serveur refuse de toute façon une écriture
   faite sans tenir le projet. Ce choix est écrit dans le code et couvert par un
   test.

---

## 6. Commandes à taper

```bash
# Preuve de l'étape 5 (fichier nommé par le plan)
npx vitest run src/js/gds-handover.test.js

# Suite complète (attendu : 3113 PASS / 0 FAIL)
npx vitest run

# Aide intégrée (déjà lancée ; à relancer après toute retouche d'un bloc HELP)
npm run build:handbook
```

---

## 7. Verdict

**VERDICT : bandeau, lecture seule dite au clic, travail local non publiable avec « prendre le projet pour publier », bouton de restitution et bouton administrateur « Libérer » tracé sont livrés et prouvés (3113 PASS / 0 FAIL, morsure démontrée) ; aucun bandeau parasite pour un projet libre ou tenu par soi ; deux manques sont déclarés et non maquillés — la libération forcée n'a pas encore de commande côté poste (Rust à ajouter) et le blocage strict de l'écriture locale / du lancement d'agent reste à faire côté Rust.**
