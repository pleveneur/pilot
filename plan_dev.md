# Plan de Développement — Pilot

## Statut global

**Phases 1 à 10 : ✅ Terminées.** Le projet est fonctionnel et complet.

## En cours

*Mode remote (accès web distant)* — socle v1+v2 livré (backend axum + auth argon2 + fan-out WS + UI web + panneau Paramètres desktop + reload à chaud + keep-alive tray + redémarrage pi au changement de projet web + resync visuel desktop + rate limiting login/prompt/WS + toast bind élargi + affichage des prompts distants sur le desktop + pagination des messages + audit log formel **persistant** (JSONL append-only, rechargé au démarrage, rotation 2 Mo) + `/api/file/meta` + création de projet web (modale select racine + nom) + édition web v2 `PUT /api/file` + création de nouveaux fichiers `POST /api/file` + **automatisation Tailscale Serve** (opt-in : proxy HTTPS 443 auto, resync au changement de port, URL + QR code dans les Paramètres). Mode remote complet. Voir [`spec_web_remote.md`](spec_web_remote.md) §14.

## Dernière fonctionnalité livrée

| Domaine | Fichier | Statut |
|---|---|---|
| Mode Orchestration V3 | [`spec_orchestration.md`](spec_orchestration.md) | ✅ Implémenté (2026-06-29) — Triptyque Réfléchir/Faire/Contrôler (SELF_FIX in-session), 3 tentatives, vérification finale par le codeur, contrôles utilisateur par tâche, batch désactivé par défaut, métriques temps réel |
| Automatisation Tailscale Serve | [`spec_web_remote.md`](spec_web_remote.md) §14 | ✅ Implémenté (2026-07-11) — proxy HTTPS 443 auto, resync port, URL + QR code (opt-in) |
| Aide intégrée (❓) | [`spec_help.md`](spec_help.md) | ✅ Implémenté (2026-07-11) — Niveau 1 Option A : chat LLM sur handbook généré depuis les specs (blocs HELP), process pi temporaire cadré, isolé de l'agent de coding |

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

*Dernière mise à jour : 2026-07-03*
