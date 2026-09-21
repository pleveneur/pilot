# Plan de Développement — Pilot

> Résumé concis (≤ 30 lignes) : **état global + liens vers les specs détaillées**.
> Pas d'historique des étapes terminées — il vit dans les specs par domaine et `git log`.

## 🔴 Priorité n°1 — Super-agent 🧭 : bugs + erreurs console (À TRAITER EN PREMIER)
Signaux utilisateur persistants depuis la TÂCHE 2 (open_project / delegate_to_coder,
association projet→client, nom de l'assistant injecté). Pistes : `pilot-assistant-actions.ts`,
`super_agent.rs` (extension + prompt système), `super-agent.js` (sentinel
`PILOT_ASSISTANT_ACTION::`, panneau Projets & clients, `pilot-config-changed`),
`tabs.js` (`updateSuperAgentLabel`), `list_super_agent_projects`. Reproduire en console,
corriger, vérifier qu'`ask_pi_caged_timed` (help/review/agents_md) n'est pas cassé.

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
