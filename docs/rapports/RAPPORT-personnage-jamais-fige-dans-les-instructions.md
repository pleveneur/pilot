# Rapport — Un personnage ne se fige plus dans les instructions de l'Assistant

Date : 2026-11-15 · Projet : Pilot · Domaine : Assistant 🧭 (prompt durable, personnage actif, règle de réveil)

## 1. Le défaut signalé

Un personnage activé dans Présences n'est que **quatre fichiers** (nom, image, genre, modèle).
Rien de plus. Or, après désactivation, l'Assistant continuait de :

- se **nommer** par le personnage (« Sylvie », « Nova ») ;
- se dire **au féminin** alors qu'aucun réglage de genre n'était plus actif ;
- garder le **modèle** du personnage dans une conversation déjà en cours.

Diagnostic (déjà fait, non refait ici) : ces phrases ne vivent **pas** dans le code livré, mais
dans le **texte d'instructions durable** stocké en configuration (`super_agent_prompt`),
réinjecté à chaque message. Trois causes distinctes ont été confirmées :

1. **Le nom injecté par le moteur ne venait pas du personnage.** `do_send_super_agent_prompt`
   composait le rôle avec `cfg.super_agent_name` (réglage de Pilot) **seulement**. La fenêtre,
   elle, appliquait déjà la bonne règle (personnage → nom réglé → défaut) : deux règles de nom,
   donc deux vérités. Un personnage actif n'était même pas nommé correctement côté moteur.
2. **Un texte d'instructions ne pouvait que RECOPIER le nom**, jamais le référencer. Le nom
   figé dans le texte survivait donc au personnage.
3. **Une version antérieure du prompt revenait en silence.** `save_config` réécrit **toute** la
   configuration depuis la copie de la fenêtre. Or le prompt a son propre écrivain, avec
   historique (`set_super_agent_prompt` → `prompt-history.md`), utilisé par l'outil
   `update_my_prompt` de l'assistant. Un enregistrement des Réglages réécrivait donc la copie
   périmée de la fenêtre **par-dessus une version plus récente**, sans passer par l'historique.

## 2. Décisions

| # | Décision | Où |
|---|---|---|
| 1 | **Une seule règle de nom côté moteur** : `assistant_display_name` (personnage actif → nom réglé → « Assistant »), miroir exact de `personaDisplayName` côté fenêtre. | `assistant_identity.rs` |
| 2 | **Les instructions RÉFÉRENCENT le nom** : jeton `{nom}`, résolu **à chaque injection** par la règle 1 (`resolve_instruction_name`). Le jeton n'est **jamais** injecté brut. | `assistant_identity.rs` + `super_agent.rs` |
| 3 | **Textes livrés neutres** : aucun nom de personnage, aucun genre imposé, aucune appellation propre à un personnage. Le genre ne vient que du réglage `assistant_gender` (vide = rien) et de la fiche (`genre.txt`). | constantes de `super_agent.rs` (déjà neutres, désormais **verrouillées**) |
| 4 | **Un seul écrivain du prompt** : toute écriture passe par `record_prompt_version` (config + `prompt-history.md`). `save_config` **préserve** le prompt en vigueur, comme il préserve déjà le miroir des clients. Les Réglages enregistrent une modification du prompt par le **chemin dédié**. | `super_agent.rs` + `lib.rs` + `settings.js` |
| 5 | **Rien du personnage ne survit** : nom et genre sont relus à **chaque** message (aucune mémoïsation) ; le **modèle** est réappliqué à la session vivante au changement de personnage (`refresh_assistant_identity`), sans jamais être persisté. | `super_agent.rs` + `super-agent.js` |

## 3. Ce qui change (fichiers)

- `src-tauri/src/assistant_identity.rs` — `ASSISTANT_DEFAULT_NAME`, `INSTRUCTION_NAME_TOKEN`,
  `assistant_display_name`, `resolve_instruction_name`, `should_reapply_session_model` (+ tests).
- `src-tauri/src/super_agent.rs` — injection du **nom dynamique** et résolution de `{nom}` dans les
  **deux** chemins (`do_send_super_agent_prompt`, `ask_super_agent`) ; point unique
  `record_prompt_version` ; commande `refresh_assistant_identity` (+ tests).
- `src-tauri/src/lib.rs` — `save_config` préserve `super_agent_prompt` (la config vivante est la
  seule vérité).
- `src/js/assistant-instructions.js` — **nouveau**, pur : le jeton `{nom}` (même valeur que Rust,
  comparée par le verrou), `promptNeedsDedicatedSave` (une modification du champ part par le
  chemin dédié, un enregistrement sans changement n'écrit rien) et `instructionNameTokenCount`.
- `src/js/settings.js` — enregistre le prompt par `set_super_agent_prompt` quand il a changé ;
  mention de `{nom}` sous le champ.
- `src/js/super-agent.js` — le détecteur de changement de personnage redemande l'identité vivante
  (`refresh_assistant_identity`).
- `index.html` — une ligne d'explication sous le champ « Prompt système ».

## 4. Ce qui ne change PAS (exigences)

- La **chaîne de repli** du nom (personnage → nom réglé → défaut) : elle est seulement écrite
  **une** fois de plus, à l'identique, côté moteur.
- Les **règles de travail** de l'Assistant (lecture seule, sécurité, coordination) : intactes.
- Le **projet Présences** et les **fichiers de l'utilisateur** : jamais écrits (le personnage reste
  en lecture seule ; seul `modele.txt` garde son écriture encadrée, inchangée).
- Aucune **suppression** (voix, fiche, carnet) ; aucun **second** système d'historique — c'est
  `prompt-history.md` qui est réutilisé.
- Aucun numéro de version, aucun workflow de publication touché.

## 5. Le verrou (et sa preuve par mutation)

`src/js/personnage-jamais-fige-dans-les-instructions.test.js` ÉCHOUE si :

1. un **nom de personnage** réapparaît en dur dans les textes d'instructions livrés
   (`super_agent.rs` hors tests, `index.html`, textes par défaut) ;
2. un **genre est imposé** par défaut dans ces mêmes textes (« au féminin », « au masculin ») ;
3. le nom utilisé par la **règle de réveil** n'est plus le nom dynamique
   (`vocalNameSentence(superAgentDisplayLabel())`) ;
4. l'injection cesse d'utiliser `assistant_display_name` / `resolve_instruction_name` ;
5. `save_config` réécrit de nouveau `super_agent_prompt` depuis la copie de la fenêtre ;
6. le jeton `{nom}` diverge entre Rust et la fenêtre.

Preuve par **mutation** : `"Sylvie"` inséré dans `SUPER_AGENT_ROLE_TEMPLATE` → le test échoue ;
retour au fichier d'origine → le test repasse ; `git diff` ne montre **aucun** reste.

### Les trois mutations réellement essayées (2026-11-15)

| Mutation | Verrou qui a échoué | Message |
|---|---|---|
| `« Sylvie »` à la place du trou dans `SUPER_AGENT_ROLE_TEMPLATE` | « le rôle de l'assistant reste un GABARIT » | *expected 'Tu es « Sylvie », …' to contain '{}'* |
| `« Sylvie, au féminin. »` en tête de `SUPER_AGENT_TOOLS_PROMPT` | « aucun nom de personnage n'est recopié dans un texte figé » | *SUPER_AGENT_TOOLS_PROMPT nomme un personnage (Sylvie)* |
| retour à `let name = configured_name.clone();` dans `do_send_super_agent_prompt` (l'ancienne règle locale) | « l'injection du prompt utilise la règle unique du nom » | *do_send_super_agent_prompt doit nommer l'assistant par la règle unique : expected false to be true* |

Après restauration : verrou vert, `grep` de contrôle (3 appels à `assistant_display_name`, aucune
occurrence de `configured_name.clone()`), aucune différence avec la copie de sécurité.

### Les deux limites assumées, écrites dans le verrou

1. `findAssistantSessionAgent` (`super-agent.js`) garde le **libellé de session** d'un noyau plus
   ancien comme repli de compatibilité : c'est un nom de session, jamais injecté dans un prompt.
   Le verrou le **retire** du périmètre (le bloc est découpé par ancre), et exige zéro nom partout
   ailleurs dans le fichier.
2. Les fichiers de **rapport** historiques (`docs/rapports/RAPPORT-mots-de-reveil.md`,
   `RAPPORT-reglages-assistant.md`) citent l'exemple d'alors : ce sont des comptes rendus datés,
   pas des textes livrés — ils ne sont pas réécrits.

## 7. Résultats mesurés (recalculés, aucun chiffre figé)

- **Front** (`npx vitest run`) : tout vert, **5704** tests passés, 0 échec (le verrou en apporte **13**).
- **Rust** (`cargo test --manifest-path src-tauri/Cargo.toml --lib`) : **925** passés, 3 ignorés.
- Aide intégrée régénérée : `npm run build:handbook` → 49 blocs, `help/handbook.md`.
- Le plafond anti-bloat du prompt système est **inchangé** : aucun texte livré n'a été modifié
  (seuls des commentaires, des exemples d'aide et le branchement ont bougé).
- Effet visible immédiat : l'assistant de ce poste porte le nom **« Nova »** dans ses réglages ;
  son texte d'instructions, écrit avant ce correctif, reste celui de l'utilisateur (Pilot ne
  réécrit jamais un prompt qu'il n'a pas écrit). Ce qui change pour lui : ce texte peut désormais
  dire `{nom}` pour suivre le personnage, et **aucune** version ancienne ne reviendra en silence.

## 6. Tests à lancer

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:handbook
```
