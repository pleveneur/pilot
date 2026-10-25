# Rapport — le suivi par client rejoint le tableau de bord

Lot « suivi multi-projets ». Objectif : **une seule** vue de suivi, dans le
Tableau de bord, groupée par client et alimentée par **tous** les projets suivis
(y compris ceux qui ne sont pas ouverts) — l'onglet Assistant 🧭 perd son
panneau et son bouton.

## 1. Tableau de bord 📊 — carte « Suivi multi-projets » (première carte)

`src/js/dashboard.js`

- **Deux commandes croisées, aucune ligne perdue** : `get_super_agent_tracking`
  (tous les projets suivis, rangés par client) + `get_project_tracking` (projets
  ouverts : activité agent, dernière session). Le croisement est fait par
  `buildTrackingGroups(clients, openProjects)` (pure) ; le rapprochement se fait
  par le **chemin** via `trackingPathKey` (casse, `\`/`/` et séparateur final
  ignorés). Un projet ouvert inconnu du suivi tombe dans un groupe « Sans
  client » : **aucune ligne ne disparaît**. Aucune ligne vide (un client sans
  projet n'affiche pas d'en-tête).
- **En-tête de groupe par client** : `div.dash-tracking-client`, nom du client
  au-dessus de ses projets. Recette **reprise** des autres titres de rubrique du
  produit, pas réinventée.
- **Projets non ouverts** : ligne conservée, pastille `dash-chip` **« non
  ouvert »** (le composant des autres statuts), compteurs `en cours / en cours +
  terminées` issus du suivi, colonne Agent à `—` (aucune activité inventée).
- **Colonnes, tailles `dash-tracking-*`, tri, couleurs des lignes** : inchangés.
- **Temps estimé / passé** du projet : ligne discrète ⏱, affichée **seulement**
  si le réglage `super_agent_show_time` est actif, avec les helpers purs repris
  de l'ancien panneau (`projectTrackingTimeFragment` : présence lue sur `*_set`,
  aucun calcul côté interface). Ces helpers sont **désormais exportés par
  `dashboard.js`**, leur seule source.
- **Détails Décisions / Sessions** (projet et client) : repris à l'identique de
  l'onglet 🧭, tronqués à 140 caractères.
- **Insight** de synthèse : clients, projets suivis, **dont non ouverts**,
  tâches ouvertes, agents actifs.
- `load()` interroge maintenant 5 commandes (`Promise.all`) et `render()` reçoit
  `assistantTracking` ; le bouton **Actualiser** et le rafraîchissement
  automatique en profitent sans changement.
- **Backend Rust : aucune modification.** Les deux commandes existantes
  (`src-tauri/src/super_agent.rs`, `src-tauri/src/dashboard.rs`) suffisent.

## 2. Couleur et contraste mesurés (une seule source, aucun sous-thème)

`src/css/style.css` — `.dash-tracking-client` :

```css
padding: 8px 8px 2px;
font-size: var(--font-xs);          /* 11 px */
font-weight: var(--fw-semibold);    /* 600 */
letter-spacing: 0.04em;
text-transform: uppercase;
color: var(--accent-text);          /* une seule couleur, jeton de thème */
```

Contraste **mesuré** sur les fonds réels de la carte (`--accent-text` sur
`--surface-1`, et sur la ligne impaire `--surface-2` à 60 %) :

| Thème | `--accent-text` | Fond | Ratio |
|---|---|---|---|
| Sombre | `#7d97ff` | `--surface-1` `#16181d` | **6.55:1** |
| Sombre | `#7d97ff` | ligne impaire `#1b1d24` | **6.20:1** |
| Clair | `#3b57d6` | `--surface-1` `#ffffff` | **5.97:1** |
| Clair | `#3b57d6` | ligne impaire `#f6f7f8` | **5.56:1** |

Dans les deux thèmes le ratio dépasse **4.5:1** (AA texte normal), y compris
pour du texte de 11 px. **Aucune teinte en dur** (pas de `#…`, pas de
`rgb()`/`hsl()`, pas de repli `var(--accent, #…)`). Un test mesure ces deux
ratios à partir des jetons du fichier de styles : il rougira si le jeton ou la
surface change de valeur.

## 3. Onglet Assistant 🧭 — retrait du panneau et du bouton

`src/js/super-agent.js`, `src/js/tabs.js`, `src/css/style.css`

- Bouton `data-action="tracking"` retiré de la barre d'outils (**8 boutons**
  visibles ; « Vues », « Bilan de période », etc. intacts).
- Branche de bascule `action === "tracking"` retirée ; la branche « Bilan de
  période » ne masque plus un panneau qui n'existe plus.
- Panneau `#super-tracking` (`trackingEl`), `loadSuperTracking()`, la variable
  `superShowTime`, les helpers de temps dupliqués et l'export
  `superTrackingRefresh` retirés.
- `tabs.js` : plus de `tab.superTrackingRefresh` ni de crochet au changement
  d'onglet.
- CSS : les règles propres à l'ancien panneau (`.super-tracking-client`,
  `-projects`, `-project`, `-project-name`, `-section`) supprimées ; la base
  `.super-tracking` **reste** car le **bilan de période** s'en sert
  (`super-tracking super-period-report`).
- **Chemin préservé** : `loadDelegationContext` (contexte des tâches déléguées)
  interroge toujours `get_super_agent_tracking`, en fail-open — verrouillé par un
  test.

## 4. Tests

- **Avant** : `npx vitest run` → **PASS 2935 / FAIL 0**.
- **Après** : `npx vitest run` → **PASS 2956 / FAIL 0** (+21, dont le nouveau
  fichier ci-dessous ; `npm run build` passe, seuls les avertissements
  préexistants subsistent).
- **Nouveau** `src/js/suivi-multi-projets-dashboard.test.js` (21 tests) :
  en-tête de groupe avant les lignes et sa recette CSS, **aucune teinte en dur**,
  **contraste ≥ 4.5:1 mesuré dans les deux thèmes**, croisement des deux
  commandes (tous les projets suivis, non ouverts compris, « Sans client »,
  normalisation de chemins, aucun groupe vide, données absentes), pastille
  « non ouvert » + `dash-chip`, absence d'activité inventée, retrait côté 🧭
  (8 boutons, pas de `#super-tracking`, pas de `loadSuperTracking`, pas de
  crochet `tabs.js`, CSS de l'ancien panneau disparu) et **contexte des tâches
  déléguées intact**.
- **Mis à jour (jamais supprimés)** : `super-agent-tracking-time.test.js`
  (helpers lus dans `dashboard.js`, branchement verrouillé sur la carte du
  tableau de bord), `super-agent-time-tranche6.test.js` (réglage éteint = rien
  ne s'affiche, désormais côté tableau de bord), `settings-show-time.test.js`
  (la vue d'ensemble qui consulte le réglage est la carte du tableau de bord).

## 5. Documentation

- `spec_dashboard.md` : bloc d'aide utilisateur `<!-- HELP:dashboard -->` réécrit
  (première carte, en-têtes par client, projets non ouverts, ligne ⏱) et section
  d'évolution complétée (les deux commandes, `buildTrackingGroups`,
  `trackingPathKey`, `.dash-tracking-client`, l'unique maison du suivi, tests).
- `spec_super_agent.md` : la vue liste n'est plus dans l'onglet 🧭 (8 boutons,
  panneau et crochet retirés ; seul le bilan de période reste).
- `help/handbook.md` régénéré (`npm run build:handbook`, 45 blocs).

## 6. Ce qui n'a pas été touché

Backend Rust (aucune ligne), colonnes et tri de la table, tailles
`dash-tracking-*`, palette et thèmes (aucune couleur nouvelle), barre du bas,
onglet « Aide », bande haute 32 px, libellé « Réglages ». Aucun outil listant les
sessions d'agents n'est appelé.

VERDICT : conforme — suivi par client en tête du Tableau de bord, tous les
projets suivis (pastille « non ouvert »), couleur unique `--accent-text`
(6.55:1 sombre / 5.97:1 clair), onglet Assistant allégé (8 boutons), contexte des
tâches déléguées intact, `vitest` 2956 PASS / 0 FAIL, un seul commit local.
