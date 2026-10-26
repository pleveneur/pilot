# Plan de Développement — Pilot

> Résumé concis (≤ 30 lignes) : **état global + liens vers les specs détaillées**.
> Pas d'historique des étapes terminées — il vit dans les specs par domaine et `git log`.

## Statut global
- Phases 1 à 10 : ✅ terminées. Prochaine étape hors GDS : **H4 (Plan Editor)**.
- ✅ **Mode réseau multi-postes : le portage est implémenté** — étapes 1 à 5
  (règle pure `gds-core/src/handover.rs`, table `0008_project_handover`, routes,
  présence, garde d'écriture, bandeau et boutons). Restent les étapes 6 et 7
  (avancement partagé, migration `0009`) et l'étape 9 (test entre deux postes).
  Voir [`spec_reseau.md`](spec_reseau.md) ; plan : [`PLAN-mode-reseau-multipostes.md`](PLAN-mode-reseau-multipostes.md).
- ✅ **Refonte serveur GDS** (2026-08) — `gds-server/` tout-en-un, socle `gds-core/`, rôles
  admin/dev/standard, **verrous supprimés**, écrans 🖥️ Serveur · ⚙️ GDS — [`spec_gds.md`](spec_gds.md).
- Reportés : H6 (routing multi-modèle) · H10 (MCP extensible).

## 🟠 Assistant 🧭 — reste à traiter
Deux signaux utilisateur **non reproduits** (`open_project`, `delegate_to_coder`) et la
console de l'onglet — détail : [`spec_super_agent.md`](spec_super_agent.md).

## Ce qui reste (specs détaillées)
| Domaine | Fichier |
|---|---|
| Mode réseau multi-postes (portage fait ; restent étapes 6, 7 et 9) | [`spec_reseau.md`](spec_reseau.md) |
| GDS (gestionnaire de sources) | [`spec_gds.md`](spec_gds.md) |
| Sous-projets liés (ouverture groupée) | [`spec_subprojects.md`](spec_subprojects.md) |
| Composant web (issue #56) | [`spec_web_component.md`](spec_web_component.md) |
| Agent Pi (RPC) | [`spec_rpc.md`](spec_rpc.md) — « Reste à faire » |
| Conversion PDF → MD | [`spec_pdf2md.md`](spec_pdf2md.md) |
| Idées complètes (avec verdicts) | [`idees_evolutions.md`](idees_evolutions.md) |
