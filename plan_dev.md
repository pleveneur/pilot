# Plan de Développement — Pilot

## Statut global

**Phases 1 à 10 : ✅ Terminées.** Le projet est fonctionnel et complet.

## En cours

*Mode remote (accès web distant)* — socle v1+v2 livré (backend axum + auth argon2 + fan-out WS + UI web + panneau Paramètres desktop + reload à chaud + keep-alive tray + redémarrage pi au changement de projet web + resync visuel desktop + rate limiting login/prompt/WS + toast bind élargi + affichage des prompts distants sur le desktop + pagination des messages + audit log formel **persistant** (JSONL append-only, rechargé au démarrage, rotation 2 Mo) + `/api/file/meta` + création de projet web (modale select racine + nom) + édition web v2 `PUT /api/file` + création de nouveaux fichiers `POST /api/file` + **automatisation Tailscale Serve** (opt-in : proxy HTTPS 443 auto, resync au changement de port, URL + QR code dans les Paramètres). Mode remote complet. Voir [`spec_web_remote.md`](spec_web_remote.md) §14.

## Dernière fonctionnalité livrée

| Domaine | Fichier | Statut |
|---|---|---|
| Mode Orchestration V3 | [`spec_orchestration.md`](spec_orchestration.md) | ✅ Implémenté (2026-07-29) — Triptyque Réfléchir/Faire/Contrôler (SELF_FIX in-session), 3 tentatives, vérification finale par le codeur, contrôles utilisateur par tâche, batch désactivé par défaut, métriques temps réel |
| Automatisation Tailscale Serve | [`spec_web_remote.md`](spec_web_remote.md) §14 | ✅ Implémenté (2026-07-11) — proxy HTTPS 443 auto, resync port, URL + QR code (opt-in) |
| Aide intégrée (❓) | [`spec_help.md`](spec_help.md) | ✅ Implémenté (2026-07-11) — Niveau 1 Option A : chat LLM sur handbook généré depuis les specs (blocs HELP), process pi temporaire cadré, isolé de l'agent de coding |
| Quality-gate interne | [`spec_quality_gate.md`](spec_quality_gate.md) | ✅ Implémenté (2026-07-11) — bouton 🛡️ dans la toolbar agent, skill embarqué via `--skill`, persistance config, relance immédiate de l'agent |
| Observabilité orchestration | [`spec_orchestration_observability.md`](spec_orchestration_observability.md) | ✅ Implémenté (2026-07-13) — journal des tentatives du codeur par tâche (marqueur, raison, durée, bouclage), bloc repliable dans le panneau d'orchestration, synthèse dans les messages système |
| Context Engine (H1 V1) | [`spec_context_engine.md`](spec_context_engine.md) | ✅ Implémenté (2026-07-19) — injection auto-contexte projet avant le 1er prompt de chaque session agent (AGENTS.md, fichier actif, imports, manifestes, specs, recents), budget tokens configurable, bouton 📑, V1 heuristique |
| Diff Review agent (A4 V2) | [`spec_diff_review.md`](spec_diff_review.md) | ✅ Implémenté — porte pré-écriture : extension pi `pilot-edit-gate` bloque write/edit avant exécution, diff Accepter/Refuser (Refuser = fichier intact), paramètre `confirm_file_edits` (défaut off), auto-approve en orchestration |
| Mémoire de projet (H3 V1) | [`spec_project_memory.md`](spec_project_memory.md) | ✅ Implémenté — `PROJECT_MEMORY.md` tenu par l'agent (conventions, pièges, décisions), injecté avant chaque tâche (orchestration) et 1er prompt (chat), extraction auto opt-in après tâche d'orchestration, bouton 📝 |
| Git intégré (C1) | [`spec_review.md`](spec_review.md) | ✅ Implémenté (2026-07-29) — badges de statut Git dans l'explorateur (CLI `git status --porcelain`) + diff visuel read-only (`git_diff_file`, réutilise `diff-view.js`) |
| Health check pi (E4) | — | ✅ Implémenté (2026-07-29) — sonde `--version` au démarrage + gate gracieuse dans l'onglet agent (écran « π indisponible ») + toast |
| Revue de code assistée (H5) | [`spec_review.md`](spec_review.md) | ✅ Implémenté (2026-07-29) — onglet 🔍 Review : second reviewer sur `git diff` (working tree / dernier commit), pi temporaire cadré lecture seule, revue structurée + questions de suivi |

## Ce qui reste

Voir les fichiers dédiés :

| Domaine | Fichier |
|---|---|
| Agent Pi (RPC) | [`spec_rpc.md`](spec_rpc.md) — section « Reste à faire » |
| Évolutions futures | [`idees_evolutions.md`](idees_evolutions.md) |
| Conversion PDF → MD | [`spec_pdf2md.md`](spec_pdf2md.md) |

## Commandes

```bash
npm run tauri dev    # Développement
npm run tauri build  # Production
```

---

*Dernière mise à jour : 2026-07-29*
