# Plan de Développement — Pilot

> Résumé concis (≤ 30 lignes) : **état global + liens vers les specs détaillées**.
> Pas d'historique des étapes terminées — il vit dans les specs par domaine et `git log`.

## 🟠 Super-agent 🧭 — reste à traiter
Signaux utilisateur depuis la TÂCHE 2 : `open_project` / `delegate_to_coder` (**non
reproduits** : chemins relus, corrects ; les défauts voisins déjà corrigés depuis
`8ae8551`), erreurs console de l'onglet (**aucune reproduite**).
✅ Corrigés (2026-10-11) : **association projet → client** (`0b0df74`, source de vérité
unique : la base de suivi) et **nom de l'assistant** (`ff7b43f`, plus de « Magnus » codé
en dur ; `f15a25c` : la sonde de reconnexion compare elle aussi le nom réglé). Voir
[`spec_super_agent.md`](spec_super_agent.md) § Gérer les clients / Paramètres.

## Statut global
- Phases 1 à 10 : ✅ terminées. Prochaine étape hors GDS : **H4 (Plan Editor)**.
- ✅ **Refonte serveur GDS** (2026-08) — conteneur tout-en-un `gds-server/`, socle partagé
  `gds-core/`, rôles admin/dev/standard, **suppression des verrous de projet** (sync
  « dernier qui écrit gagne », conflits journalisés), deux écrans transverses
  (« 🖥️ GDS Serveur — administration » · « ⚙️ GDS — paramétrage »). Voir [`spec_gds.md`](spec_gds.md).
- Reportés : H6 (routing multi-modèle) · H10 (MCP extensible).

## Ce qui reste (specs détaillées)
| Domaine | Fichier |
|---|---|
| GDS (gestionnaire de sources) | [`spec_gds.md`](spec_gds.md) |
| Sous-projets liés (ouverture groupée) | [`spec_subprojects.md`](spec_subprojects.md) |
| Composant web (issue #56) | [`spec_web_component.md`](spec_web_component.md) |
| Agent Pi (RPC) | [`spec_rpc.md`](spec_rpc.md) — « Reste à faire » |
| Conversion PDF → MD | [`spec_pdf2md.md`](spec_pdf2md.md) |
| Idées complètes (avec verdicts) | [`idees_evolutions.md`](idees_evolutions.md) |
