# Rapport — Retrait de l'écran « Aide » (bouton + onglet)

> Lot unique : retirer de l'écran tout ce qui ouvre l'ancien onglet Aide.
> L'outil documentaire de l'Assistant (lot précédent, commit `6b6346f`) couvre
> désormais le besoin : l'outil d'abord, le retrait ensuite.

## 0. Vérification de la tâche reçue

La demande porte bien sur **le bouton « Aide » du haut de la colonne de gauche**
et sur **l'onglet Aide** (ouverture, contenu, fermeture, restauration,
raccourcis). Elle ne parle ni de bande haute, ni du coin haut droit, ni des voix
locales, ni de la barre du bas, ni des sous-thèmes, ni du bouton « Options », ni
du suivi multi-projets, ni de la prise en main. Rien de tout cela n'a été touché.

## 1. Ce qui a été retiré

| Élément | Emplacement | Détail |
|---|---|---|
| Bouton d'ouverture | `index.html` | Le `<button id="btn-help">` (icône + libellé « Aide ») est supprimé du groupe `#global-actions`. |
| Écouteur du bouton | `src/js/main.js` | Le bloc `getElementById("btn-help")…` est supprimé ; un commentaire renvoie à `spec_help.md §4.5`. |
| Mode d'onglet `help` | `src/js/tabs.js` | Branche `mode === "help"` de `openFile`, méthode `_openHelp`, entrées `"help"` dans la liste `special` et dans l'exclusion de renommage `["review","terminal","prompt-builder"]`. |
| Restauration / fermeture | `src/js/tabs.js` | Les deux blocs `tab.mode === "help" && tab.unlistenHelp` (fermeture et changement de projet) sont supprimés : plus aucun onglet de ce mode ne peut exister. |
| Écran lui-même | `src/js/help.js` | Fichier supprimé (`git rm`). Aucun appelant ne subsiste (vérifié : plus aucune occurrence de `"help"` comme mode dans `src/js` et `web/js` hors tests). |

Aucun écran, onglet ou bouton de remplacement n'a été créé.

## 2. Ce qui est gardé, et pourquoi

| Élément gardé | Pourquoi |
|---|---|
| Réglage `help_model` (config, `set_help_model`, `set_help_model` enregistré) | C'est le **repli de la Revue de code** et un étage de la résolution du modèle du socle (`resolve_help_doc_model` → `resolve_super_agent_model`). Le supprimer casserait la Revue. Il n'est simplement plus édité par un écran. |
| Styles `.help-*` (`style.css`) | **Partagés** : `review.js` (`help-chat review-chat`, `help-title-row`) et `session-history.js` (`help-chat history-chat`) les réutilisent. Bloc conservé avec un commentaire « ne pas supprimer ». |
| Commande socle `ask_help_doc` + outil `answer_from_documentation` + plafond d'appels | C'est le **remplaçant fonctionnel** : l'Assistant répond sur la documentation. Vérifié toujours branché (déclaration, écriture disque des DEUX listes d'extensions, relais du sentinel, plafond). |
| `answer_from_handbook`, `build_help_prompt`, `run_help_prompt` | Socle de la réponse documentaire (utilisé par `ask_help_doc`). |
| `ask_help`, `get_handbook` | **Conservés mais sans appelant côté écran** — signalés ici, non supprimés, comme demandé. Retrait possible dans un lot dédié après décision (ils ne coûtent rien et restent testés). |
| `src/js/help-delai-inactivite.test.js` | **Ne concerne pas** l'écran Aide : il vérifie que le *handbook* (documentation embarquée) annonce le bon délai d'inactivité. Il reste valable, nom inchangé. |

## 3. Ce qui reste dans le haut de la colonne

Deux portes nommées seulement, dans `#global-actions` : **« Brouillon »**
(`#btn-scratchpad`) et **« Réglages »** (`#btn-settings`). La rangée est en
`flex-wrap` avec `gap: 6px` : elle se resserre, **aucune place n'est réservée**
à l'ancien bouton, il n'y a ni trou, ni espacement cassé, ni bouton fantôme.
Le badge « Distant » (`#remote-badge`, masqué par défaut) reste inchangé à côté.

## 4. Documentation mise à jour

`spec_help.md` (titre, statut, §2 Architecture, §4.2 `help_model`, §4.3
historique, §5 UX, §8 Fichiers, nouvelle §9 « Retrait de l'écran Aide »),
`spec_pilot.md` (ligne « Réponse sur la documentation »), `README.md`
(« Réponses sur la documentation » + arborescence `help/`), `help/overview.md`
(bloc `HELP:aide` réécrit), `spec_feedback.md`, `spec_gds.md`,
`spec_telegram.md` (§7 renommée « Documentation embarquée »),
`docs/gds-guide-mise-en-place.md`, `AGENTS.md` (5 blocs), plus les commentaires
de `src-tauri/src/help.rs`, `src-tauri/src/lib.rs` et `src/js/review.js`.
Messages d'erreur de `help.rs` réalignés : ils renvoient désormais à
⚙️ → Assistant au lieu d'une « liste déroulante de l'onglet Aide » disparue.

`npm run build:handbook` relancé après modification d'un bloc `HELP:` :
**45 blocs, 261 496 octets**. Les documents de *proposition* antérieurs
(`docs/proposition-navigation.md`, `docs/proposition-presentation-ui.md`)
mentionnent encore `btn-help` : ce sont des instantanés de propositions passées,
volontairement laissés tels quels.

## 5. Tests

| Suite | Avant | Après |
|---|---|---|
| `npx vitest run` | **PASS 2972 / FAIL 0** | **PASS 2985 / FAIL 0** (+13) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **754 passed, 1 ignored** | **754 passed, 1 ignored** |

Aucun test supprimé. Modifiés : `src/js/lot2-colonne-haut.test.js` (compte les
portes nommées : **deux**, et non plus trois) et `src/js/assistant-outil-doc.test.js`
(commentaire au présent). Créé : `src/js/retrait-ecran-aide.test.js`, le verrou
permanent du lot — il **échoue** :

- si `btn-help` (ou un libellé « Aide ») réapparaît dans `#global-actions` →
  le compte des portes nommées passe à 3 et l'assertion « la porte Aide ne
  revient pas » tombe ;
- si le mode `"help"` revient dans `tabs.js` (branche `openFile`, `special`,
  exclusion de renommage, `unlistenHelp`) ;
- si `src/js/help.js` réapparaît sur le disque ;
- si un style **partagé** `.help-*` (utilisé par la Revue ou l'Historique) ou
  une pièce du socle (`ask_help_doc`, `answer_from_documentation`,
  `pilot-assistant-doc.ts` dans les deux listes d'extensions) est supprimé.

## 6. Reste à faire

1. Décider du sort de `ask_help` et `get_handbook` (sans appelant côté écran) —
   lot dédié, avec suppression de leurs tests associés le cas échéant.
2. Réaligner, si on le souhaite, les deux documents de *proposition* qui citent
   encore `btn-help` (instantanés historiques, hors périmètre de ce lot).
3. Publication : **hors périmètre** — ce lot reste un commit local, sans tag ni
   version.

VERDICT : le bouton et l'onglet Aide ont quitté l'écran, sans place vide ni
bouton de remplacement ; la réponse sur la documentation passe par l'Assistant,
les styles partagés et le repli `help_model` sont intacts, et un test permanent
empêche le retour de l'ancien écran.
