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
- Effet visible **immédiat : aucun**, et c'était la limite de ce lot. L'assistant de ce poste
  porte le nom « Nova » dans ses réglages ; son texte d'instructions, écrit **avant** ce
  correctif, n'était **pas** réécrit (Pilot ne réécrit jamais un prompt qu'il n'a pas écrit) et
  continuait donc à nommer un personnage et à imposer un genre. Ce lot ne changeait que les
  textes livrés et la règle d'injection : il rendait le défaut **réparable** (le texte peut
  désormais dire `{nom}`, et aucune version ancienne ne revient en silence), il ne le réparait
  pas. La suite est traitée au § 8.

## 8. Tâche 416 — la suite : le texte DÉJÀ en vigueur (2026-11-16)

Le lot précédent protégeait les textes **livrés**. Il laissait intact le texte **durable déjà
réglé** par le propriétaire, qui nommait encore « Sylvie » alors qu'aucun personnage n'était
actif, imposait « au FÉMININ », une « voix féminine » et un « Ton chaleureux ». Rien, à l'écran,
ne le disait : le défaut était invisible et sans geste de réparation.

| Point | Ce qui est fait |
|---|---|
| **Voir** | Module **pur** `src/js/personnage-fige-dans-le-texte.js` : `findFrozenPersonaSigns` nomme les passages qui figent un personnage (prénom en dur ou entre guillemets, genre imposé, voix imposée, ton de personnage imposé), en français simple (`frozenPersonaNotice`). Aucune décision dans l'interface. |
| **Réparer** | `cleanFrozenPersonaText` rend un texte **nettoyé** : le prénom en tête devient `{nom}`, l'occurrence entre guillemets part, les phrases de genre / voix / ton tombent. Le retrait est **ciblé** : les règles de travail, la lecture seule, le cadre et le style général sont conservés **au mot près**, la typographie française (espace avant `:` `;` `»`) n'est pas retouchée, et un texte déjà sain est rendu **à l'identique**. |
| **Le geste** | Encart sous le champ « Prompt système » (Options → Assistant) avec la liste des passages et **un** bouton « Nettoyer ce texte ». Rien n'est appliqué sans le clic, rien n'est enregistré sans « Enregistrer » — et l'enregistrement passe par `set_super_agent_prompt`, donc l'ancienne version reste dans `prompt-history.md`. |
| **Le texte du poste** | Nettoyé sur le disque (14 630 → 14 290 caractères, **une seule** clé modifiée : `super_agent_prompt` ; `super_agent_name` = « Nova » et `assistant_gender` = "" inchangés ; copie de sécurité `config.json.bak-tache416-personnage`). L'ancienne version y était **déjà** dans `prompt-history.md` : rien n'a été ajouté à la main dans cet historique (il n'a qu'un écrivain, côté Rust). |
| **Le verrou** | `src/js/personnage-fige-dans-le-texte.test.js` (19 tests) : détection des quatre familles, **aucun** faux signalement d'un mot produit entre guillemets (« Pilot », « Présences »), conservation **au mot près** de neuf consignes de travail, typographie française intacte, idempotence, et **interdiction du nettoyage automatique** (un seul appel de `cleanFrozenPersonaText`, dans le gestionnaire du clic). |

### Preuves par mutation (tâche 416)

| Mutation | Verrou qui a échoué |
|---|---|
| exclusion des mots produits retirée dans `markersOf` + dans `leadingNameOf` | « ne signale pas un mot produit entre guillemets (**aucun** faux signalement) » |
| `GENDER` retiré des phrases qui tombent en entier | « retire le genre, la voix et le ton imposés » |
| `cleanFrozenPersonaText` appelé dans le rafraîchissement de l'affichage (nettoyage **automatique**) | « le nettoyage n'est JAMAIS automatique : un seul appel, dans le clic » |
| `id="assistant-prompt-frozen"` renommé dans `index.html` | « l'encart et son bouton existent là où le prompt se règle » |

Après restauration : verrou vert (19), `git diff` sans reste.

### Limite assumée

L'instance de Pilot **déjà lancée** garde en mémoire le texte d'avant : un enregistrement des
Options depuis cette instance pourrait le réécrire sur le disque. Le nettoyage prend effet au
**redémarrage** — et, si le texte revenait, l'encart du § 416 le dirait de nouveau, avec le même
bouton. Aucun nettoyage n'est fait dans le dos de l'utilisateur.

## 6. Tests à lancer

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:handbook
```
