# Plan de Développement — Pilot

> Résumé concis (≤ 30 lignes) : **état global + liens vers les specs détaillées**.
> Pas d'historique des étapes terminées — il vit dans les specs par domaine et `git log`.

## Statut global
- Phases 1 à 10 : ✅ terminées. Prochaine étape hors GDS : **H4 (Plan Editor)**.
- 🟠 **Mode réseau multi-postes : plan figé (v4 + 7 arbitrages), réalisation à démarrer** — rien d'implémenté : [`PLAN-mode-reseau-multipostes.md`](PLAN-mode-reseau-multipostes.md).
- ✅ **Refonte serveur GDS** (2026-08) — `gds-server/` tout-en-un, socle `gds-core/`, rôles
  admin/dev/standard, **verrous de projet supprimés**, deux écrans transverses (🖥️ Serveur · ⚙️ GDS).
  Voir [`spec_gds.md`](spec_gds.md).
- Reportés : H6 (routing multi-modèle) · H10 (MCP extensible).

## 🟠 Super-agent 🧭 — reste à traiter
Signaux utilisateur depuis la TÂCHE 2 : `open_project` / `delegate_to_coder` (**non
reproduits** ; défauts voisins corrigés depuis `8ae8551`), console de l'onglet (**aucune
erreur reproduite**). ✅ Corrigés : **projet → client** (`0b0df74`, base de suivi = source de
vérité) et **nom de l'assistant** (`ff7b43f`, plus de « Magnus » en dur ; `f15a25c`).
Voir [`spec_super_agent.md`](spec_super_agent.md).

## Ce qui reste (specs détaillées)
| Domaine | Fichier |
|---|---|
| Mode réseau multi-postes (plan figé v4, rien d'implémenté) | [`PLAN-mode-reseau-multipostes.md`](PLAN-mode-reseau-multipostes.md) |
| GDS (gestionnaire de sources) | [`spec_gds.md`](spec_gds.md) |
| Sous-projets liés (ouverture groupée) | [`spec_subprojects.md`](spec_subprojects.md) |
| Composant web (issue #56) | [`spec_web_component.md`](spec_web_component.md) |
| Agent Pi (RPC) | [`spec_rpc.md`](spec_rpc.md) — « Reste à faire » |
| Conversion PDF → MD | [`spec_pdf2md.md`](spec_pdf2md.md) |
| Idées complètes (avec verdicts) | [`idees_evolutions.md`](idees_evolutions.md) |
