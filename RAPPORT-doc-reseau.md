# Rapport — documentation du mode réseau multi-postes

> Mission : écrire la documentation du **mode réseau multi-postes** (portage d'un
> projet) d'après le **code réellement écrit**, corriger les contradictions du
> §9 de `PLAN-mode-reseau-multipostes.md`, et mettre à jour les fichiers de
> référence. **Aucun fichier de code n'a été modifié** (`.rs`, `.js`, `.css`,
> `index.html`).

---

## 1. Méthode

Tout ce qui suit a été **lu avant d'être écrit** : plan (§1 à §11), migrations
`gds-core/migrations/`, `gds-core/src/handover.rs`, `gds-core/src/http.rs`,
`gds-core/src/db.rs`, `src-tauri/src/gds_handover.rs`,
`src-tauri/src/gds_write_guard.rs`, `src-tauri/src/gds_sync.rs`,
`src-tauri/src/gds.rs`, `src/js/gds.js`, `gds-status.js`, `gds-admin.js`, plus
les documents à corriger. Les chiffres du §6 ont été **recomptés sur le disque**
le 2026-10-25, pas recopiés du plan.

---

## 2. Contradictions du §9 du plan — une par une

| # | Cible indiquée par le plan | Ce que disait le texte | Ce qui a été écrit | Sort |
|---|---|---|---|---|
| 1 | `spec_gds.md:13-14`, `851-859`, `908`, `919` | « verrou supprimé », « dernier écrit gagne » présentés comme **le** mécanisme de cohérence | En-tête : le verrou global est « **supprimé** et **remplacé** par une **prise en main par projet** » (`0008_project_handover.sql`) ; §5.1 renommé « Synchronisation poste **et portage** » et réécrit : l'exclusivité vient du portage, « le plus récent gagne » ne sert plus qu'au **pont du suivi** ; §5.3 et la ligne de décision 6 renvoient à la **libération par un administrateur** ; le tableau des modules reçoit `gds_handover.rs` et `gds_write_guard.rs` | **corrigé** — `spec_gds.md:9`, `:15`, `:858`, `:860`, `:905`, `:1036`, `:1333` |
| 2 | `spec_gds.md:254`, `286`, `891` | mode urgent retiré, aucune route de verrou | Conservé (c'est exact : ni commande ni route `/api/gds/lock/*`), **complété** : le mode urgent n'est pas remplacé par un contournement mais par la **libération forcée** réservée à l'administrateur, motif obligatoire, trace d'audit | **conservé + complété** — `spec_gds.md:260`, `:905`, `:1333` |
| 3 | `plan_gds.md:169-172`, `258-272`, `412-419`, `443` | « décision 3 : plus de verrou projet » lu comme « concurrence libre assumée » | Réécrit : la décision 3 est **remplacée** par « un seul porteur par projet », **pas** par un verrou global ; §3.5 renommé « Synchronisation poste **& portage** », critère de fin réécrit (deux postes ne doivent **jamais** écrire en même temps), §7 « Concurrence (écriture exclusive par projet) », L6 et la ligne de décision complétées | **corrigé** — `plan_gds.md:171-174`, `:264`, `:279`, `:428-433`, `:457`, `:604`, `:626-627` |
| 4 | `README.md:283-285` | « Synchronisation sans verrou : plusieurs postes peuvent travailler en même temps sur un projet ; l'écriture la plus récente fait foi » | Remplacé par deux puces orientées **utilisateur** : « **Un seul poste travaille sur un projet à la fois** » (bandeau, prise, restitution, 15 min, libération par un administrateur, travail local jamais supprimé) et « **Conflits** » (le filet du pont) | **corrigé** — `README.md:289-301` (l'ancre du plan, `283-285`, tombe en réalité sur le paragraphe des trois rôles : le décalage des numéros était déjà relevé dans `RAPPORT-relecture-plan-reseau.md:19`) |
| 5 | `AGENTS.md:226` | « Migrations SQL GDS partagées (`0001_init` → `0007_drop_project_locks`) » | « (`0001_init` → **`0008_project_handover`**) » ; l'entrée de navigation GDS renvoie à `spec_reseau.md` ; l'arbre reçoit `gds_handover.rs` et `gds_write_guard.rs` (ils n'y figuraient pas) | **corrigé** — `AGENTS.md:84`, `:226`, `:298-299`. ⚠️ Le plan demandait « jusqu'à `0009` » : `0009_project_info.sql` **n'existe pas** (voir §5.b), le chiffre réel est **0008** |
| 6 | `plan_gds.md:318`, `345` | temps réel WebSocket des tickets du widget web | **non touché** : hors sujet ici (phase D, `spec_web_component.md`) | **laissé tel quel**, comme demandé |

### Contradictions trouvées **hors** du §9 (grep exhaustif « dernier qui écrit » / « sans verrou »)

Le plan ne les listait pas ; elles contredisaient l'exclusivité de la même façon,
elles ont été corrigées :

| Fichier | Avant | Après |
|---|---|---|
| `help/overview.md` (bloc `HELP:gds`, puis `help/handbook.md` généré) | « Synchronisation — sans verrou … deux postes peuvent travailler en même temps » | « **Un seul poste travaille sur un projet à la fois** » + prise/restitution/15 min/libération administrateur + « Envoi au fil de l'eau » + « Conflits » |
| `spec_assistant_sync.md` (en-tête, tableau 1.1/1.2, cycle de vie, concurrence) | « verrous supprimés … risque accepté, dernier qui écrit gagne » | en-tête remplacé (exclusivité par projet) ; statut **🟡 aucune implémentation** rendu explicite et distingué du portage, lui implémenté ; « historique de sessions » retiré des données synchronisées (le **résumé** part, jamais les transcriptions) ; §4 : le poste **prend le projet en main** au lieu de « aucun verrou » |
| `spec_pilot.md:63` | « sans verrou (« dernier qui écrit gagne », conflits journalisés) » | « **mode réseau multi-postes** … le pont du suivi garde « le plus récent gagne » comme filet » + lien vers `spec_reseau.md` |
| `plan_gds.md` (l. 7, 106, 624) | phases et modules « sans verrou » | « verrou global retiré » + « prise en main par projet » |
| `docs/gds-guide-mise-en-place.md` (2.10, 3.3, 3.6, tableau de dépannage) | « personne n'est bloqué (il n'y a plus de verrou)… le dernier qui écrit gagne » | 2.10 renommé et réécrit (filet du pont + renvoi) ; 3.3 nuancé ; **nouvelle 3.4 « Deux postes, un seul écrit sur le projet »** (marche à suivre + 4 cas « si ce n'est pas ça ») avec renumérotation 3.4→3.5 et 3.5→3.6 (aucun renvoi externe à ces numéros : vérifié) ; ligne de dépannage corrigée |

Restent **volontairement** en « dernier écrit gagne » les passages qui parlent du
**pont du suivi** (`gds_sync::resolve_conflict`, conflits journalisés
`tracking.conflict`) : c'est exact et c'est la nuance qui empêche de jeter la
règle de fusion avec l'exclusivité. Chacun est désormais présenté comme un
**filet**, jamais comme le mécanisme de cohérence.

---

## 3. Fichiers écrits ou mis à jour

| Fichier | Nature |
|---|---|
| `spec_reseau.md` | **créé** — spec dédiée : principe, gestes de l'utilisateur, partagé vs privé, règles du serveur, ce que fait le poste, modes de panne, **ce que le mode ne fait pas**, preuves |
| `spec_gds.md` | en-tête, §5 (titre, 5.1, 5.3), tableau des modules, §7 concurrence, ligne de décision 6, phase B |
| `plan_gds.md` | en-tête, §2.2, §3.5, phase B (L6), §7 risques, décision 1 |
| `spec_assistant_sync.md` | en-tête + statut, tableaux 1.1/1.2, cycle de vie, concurrence |
| `spec_pilot.md` | ligne GDS + lien vers `spec_reseau.md` |
| `README.md` | section GDS : deux puces réécrites (orientées utilisateur) |
| `AGENTS.md` | navigation (ligne GDS), série de migrations, arbre (`gds_handover.rs`, `gds_write_guard.rs`) |
| `help/overview.md` | bloc `HELP:gds` (texte utilisateur) |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (jamais édité à la main) |

Vérifications du handbook : `45 blocs`, 0 bloc **vide**, 0 **doublon** de bloc,
le topic `gds` présent, le texte est bien celui de `help/overview.md`.

---

## 4. Le contenu de la nouvelle spec, en clair

`spec_reseau.md` répond aux cinq questions de la mission :

1. **Ce que ça fait** : un projet est tenu par un seul poste — §1.
2. **Comment on s'en sert** : tableau des gestes (ouvrir, prendre, travailler,
   rendre, libérer) + la précision que **la prise n'est pas automatique** — §2.
3. **Ce qui est partagé / privé** : un tableau information par information
   (code, suivi, portage, mémoire, conversations, réglages/secrets) — §3 ; c'est
   désormais la **source unique** de cette frontière, `spec_assistant_sync.md` y
   renvoie.
4. **Ce qui arrive en cas de panne** : tableau de 6 situations (poste fermé,
   poste mort, serveur muet, publication en échec, mort entre publication et
   restitution, projet bloqué) — §6.
5. **Ce qu'il ne fait pas** : 10 limites explicites — §7.

---

## 5. Écarts entre le code et le plan (constatés, **non corrigés** — documentation seule)

| # | Écart | Preuve |
|---|---|---|
| a | **La prise en main automatique à l'ouverture du projet n'existe pas.** Le plan la prévoyait ; le code ne prend le projet que par le bouton `gds_handover_take`, ou silencieusement par la **publication du suivi** (`gds_force_push_suivi` → `ensure_write_allowed` → `write_gate`, `claim = true`). Écrit tel quel dans `spec_reseau.md` §2. | `src-tauri/src/gds_handover.rs` `write_gate` / `peek_write_gate` ; `src-tauri/src/gds_sync.rs:1120` |
| b | **L'état d'avancement partagé (`project_info`) n'existe pas** : la série de migrations s'arrête à `0008_project_handover.sql`, `0009` est absente. Les étapes 6 et 7 du plan sont donc non faites et documentées comme telles. | `gds-core/migrations/` (8 fichiers) |
| c | **La garde laisse écrire dans un projet libre sans le prendre** : `peek_write_gate` est en lecture seule, et `decide` autorise « libre / tenu par moi / tenu par un autre expiré ». Tant que personne n'a pris le projet, deux postes peuvent donc encore éditer chacun de leur côté. Documenté comme limite (§7). | `src-tauri/src/gds_write_guard.rs` `decide` et `probe` |
| d | **L'écran d'administration ne montre pas qui tient le projet** : la ligne d'un projet n'affiche que son nom et le chemin du dépôt, avec « Libérer » (rôle `admin`). Un administrateur doit donc savoir *quel* projet est bloqué pour le libérer. Documenté comme limite (§7). | `src/js/gds-admin.js` `renderProjects` (`release` seulement, aucun porteur) |
| e | **`write_context_handoff` n'est pas gardé** (écriture du fichier interne `.pilot/context-inject.md`). Documenté comme limite (§7). | `src-tauri/src/files.rs:116` (aucun appel à la garde) |
| f | **Le terminal intégré et les commandes git ne sont pas gardés** : la garde couvre 6 commandes d'écriture de fichiers, `copy_image_to_project`, 2 lancements d'agents et la publication du suivi. Documenté (§5 et §7). | `grep ensure_path_writable\|ensure_project_writable` = 9 sites + `ensure_write_allowed` |
| g | **`AGENTS.md` ne décrivait ni `gds_handover.rs` ni `gds_write_guard.rs`** (et sa série de migrations était en retard d'une version). Corrigé **côté documentation** uniquement. | `AGENTS.md:226`, `:298-299` |
| h | **Les tests de base des étapes 2-3 exigent `PILOT_GDS_TEST_URL`** (PostgreSQL) : ils ne tournent pas dans une CI sans base. Dit tel quel dans la spec (§8). | tests `handover` de `gds-core` |

---

## 6. Recomptes faits sur le disque (2026-10-25)

| Élément | Compte vérifié | Remarque |
|---|---|---|
| Migrations GDS | **8** : `0001_init` → `0008_project_handover.sql` | `0009` **annoncée par le plan, absente** |
| Specs `spec_*.md` à la racine | **39** (dont la nouvelle `spec_reseau.md`) | — |
| Blocs du handbook généré | **45** blocs / topics, dont `gds` | 0 vide, 0 doublon |
| TTL du portage | **15 min** (`HANDOVER_TTL_MINUTES`) | expiration **paresseuse**, aucun job planifié |
| Présence | **1 appel / 3 min** (`HEARTBEAT_INTERVAL_SECS = 180`) | jamais pour un projet non tenu |
| Pont du suivi | contrôle **toutes les 30 s** | distinct de la présence (corrigé dans la doc : l'avancement ne part **pas** avec la présence) |
| Garde d'écriture | `GUARD_TIMEOUT` **3 s**, `GUARD_TTL` **5 s**, cache **32** projets | fail-open |
| Sites gardés | **9** appels + la publication du suivi | 6 fichiers, 1 image, 2 agents |

---

## 7. Tests

- **Avant** : `npx vitest run` → **181 fichiers / 3153 tests, tous verts**,
  `EXIT=0` (`/tmp/vitest-before.log`).
- **Après** : `npx vitest run` → **3153 tests passés, 0 échec**, `EXIT=0`
  (`/tmp/vitest-after.log`).
- Aucun test cassé, aucun test supprimé, aucun test ajouté (mission de
  documentation : les seuls fichiers touchés hors documentation sont
  `help/handbook.md`, qui est **généré**).
- Documentation seule : `cargo test` n'est pas concerné par ces changements.

---

## 8. Ce qui n'a **pas** été fait, volontairement

- Aucune modification de code Rust, JavaScript, CSS ou HTML.
- Aucun `sed` global, aucun remplacement de masse : chaque passage a été réécrit
  à la main, avec sa nuance (filet du pont vs exclusivité du projet).
- `help/handbook.md` n'a **jamais** été édité directement (régénéré).
- Aucune publication, aucun tag, aucune version touchée.
- Les écarts du §5 ne sont **pas** corrigés dans le code : ils sont écrits noir
  sur blanc ici et dans `spec_reseau.md` §7, à charge de l'étape suivante.

---

VERDICT : les 6 contradictions du §9 sont traitées (5 corrigées, 1 laissée
volontairement : le widget web), les occurrences hors §9 trouvées dans 5 autres
fichiers sont corrigées, la spec dédiée `spec_reseau.md` (181 lignes, 8 sections)
est écrite d'après le code, 8 documents de référence sont à jour, le handbook
régénéré est cohérent (45 blocs, aucun vide ni doublon), les tests sont identiques
avant et après (181 fichiers / 3153 tests verts) — et 8 écarts code ↔ plan, dont
l'absence de prise automatique et de `project_info`, sont signalés sans avoir été
maquillés.
