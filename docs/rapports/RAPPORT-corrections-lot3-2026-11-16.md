# Corrections locales : lot 3

# Lot 3 : fiabilité RPC et conversion PDF

RPC-01 et RPC-02 sont confirmés et corrigés. Pour chaque défaut, j'ai observé un test ROUGE puis le même test VERT. Le dernier run de la lib Rust `pilot` donne 983 réussis, 0 échec, 3 ignorés. La suite JS donne 6000 réussis, 0 échec, 1 en attente, et le build passe. Rien n'est commité ni poussé.

## RPC-01 : caractères UTF-8 coupés entre deux blocs de lecture

**Confirmé.** Dans `read_jsonl_loop`, chaque bloc de 4096 octets était décodé seul. Un accent ou un emoji coupé entre deux blocs devenait `��`.

**Confirmé, et plus grave, dans `stream_pipe` (`web_server.rs`).** Tout bloc qu'on ne pouvait pas décoder seul était retiré du journal final `command_end.output`. Dans le test, ce journal sortait **vide**.

**Correction.** Un helper interne `decode_utf8_chunk` (`rpc_manager.rs`) garde de côté les premiers octets d'un caractère incomplet jusqu'au bloc suivant. Seule une séquence vraiment invalide devient `U+FFFD`. `stream_pipe` réutilise ce helper, et `flush_utf8_pending` marque en fin de flux un caractère resté tronqué au lieu de le perdre.

Ce qui ne change pas :
- l'ordre des événements, vers l'interface comme vers le WebSocket ;
- le découpage sur `\n` et la tolérance `\r` ;
- une dernière ligne sans `\n`, toujours ignorée ;
- la fermeture de flux (`involuntary`, `running`, la table des attentes vidée) ;
- les octets bruts `data` diffusés en direct.

## RPC-02 : le délai de 2 min n'interrompait pas un moteur muet

**Confirmé.** Le délai n'était vérifié qu'à l'arrivée d'une ligne. Avec un faux moteur muet et un délai de 400 ms, la fonction ne rendait la main qu'après 8,00 s, quand le faux moteur s'arrêtait de lui-même, avec le message « Aucune réponse reçue de l'IA ».

**Correction.** La lecture de stdout se fait dans un fil dédié, et l'attente est bornée par une échéance fixe (`recv_timeout`). L'échéance est aussi vérifiée en tête de boucle, ce qui arrête un moteur qui écrit sans fin sans jamais envoyer `agent_end`. À l'échéance, le processus est tué puis récolté. Sa sortie se ferme alors, et le fil de lecture se termine de lui-même.

- **Interface publique inchangée :** `convert_text_with_pi` garde sa signature et délègue à une fonction privée `run_pdf_conversion(cmd, …, timeout)`, ce qui rend la durée injectable pour le test.
- **Durée et message inchangés :** 120 s, et le texte « Timeout : la conversion a pris plus de 2 minutes ». Le test vérifie les deux.

## Tests et runs réels (Rust 1.99, via le helper)

| Filtre | Run | Résultat |
|---|---|---|
| `rpc_utf8_coupe` | 1 | **ROUGE** : `"Caf�� été"`, `"go ���� !"`, `"voil��"` |
| `rpc_utf8_coupe` | 2 | VERT 2/2 |
| `stream_pipe_utf8` | 1 | **ROUGE** 0/2 : journal `""` |
| `stream_pipe_utf8` | 2 | VERT 2/2 |
| `pdf2md_moteur` | 1 | Erreur de compilation dans mon test (chaîne brute mal fermée), **non comptée comme preuve** |
| `pdf2md_moteur` | 2 | **ROUGE** : moteur muet, 8,00 s et « Aucune réponse reçue de l'IA » ; le test de réponse normale passe |
| `pdf2md_moteur` | 3 | VERT 2/2 (assertion `< 4 s` et processus disparu de `/proc`) |
| `rpc_manager` | — | VERT 7/7 |
| `::` (toute la lib `pilot`, 0 filtré) | 3 runs | 983 réussis, 0 échec, 3 ignorés |
| `check.py` (JS + build) | 1 | **1 échec** : garde `fenetres-noires-lancements.test.js` |
| `check.py --test` (ce garde) | — | VERT 8/8 |
| `check.py` | 2 | 6000 réussis, 0 échec, 1 en attente, build OK |

Sur l'échec JS : en déplaçant le code, j'avais éloigné `hide_console` de la fonction qui crée la commande. Je l'ai remis dans `convert_text_with_pi`, sans toucher au garde.

Les nouveaux tests :
- **RPC-01, `rpc_manager.rs` :** `rpc_utf8_coupe_entre_blocs_reste_intact` coupe é, 🚀 et à, y compris sur le dernier bloc avant la fin du flux. `rpc_utf8_coupe_fin_de_flux_sans_saut_de_ligne` vérifie qu'une dernière ligne tronquée reste ignorée.
- **RPC-01, `web_server.rs` :** `stream_pipe_utf8_coupe_entre_blocs_journal_complet` et `stream_pipe_utf8_invalide_et_fin_tronquee_sans_perte`.
- **RPC-02, `rpc_manager.rs` :** `pdf2md_moteur_muet_interrompu_a_l_echeance` et `pdf2md_moteur_qui_repond_rend_le_texte_avant_l_echeance`. Le faux moteur est `/bin/sh` puis `exec sleep`, dans un dossier temporaire supprimé à la fin. Ils ne tournent que sous Linux.

## Fichiers modifiés

Uniquement les quatre autorisés, qui n'étaient pas modifiés au départ : `src-tauri/src/rpc_manager.rs`, `src-tauri/src/web_server.rs`, `spec_rpc.md` (ligne ajoutée au tableau des garde-fous) et `spec_pdf2md.md` (échéance réelle et tests). Je n'ai touché à aucun fichier des lots 1 et 2.

## Reportés et limites

- **Fermeture de stdin de pi après le `prompt` : non testée, comportement inchangé.** Rien ne confirme ni n'infirme son effet sur le vrai pi.
- **Fil de lecture PDF :** il se termine bien après l'arrêt du processus, mais je n'ai pas de test dédié qui le prouve. Si pi lançait lui-même des processus qui gardent sa sortie ouverte, ce fil pourrait rester bloqué en arrière-plan, sans bloquer l'appelant.
- **Hors périmètre, non corrigés :**
  - `read_stderr_loop` (`rpc_manager.rs`) a le même défaut de décodage par bloc sur les `process_error`. Pas de test possible sans `AppHandle`.
  - `help.rs` a le même délai vérifié seulement à l'arrivée d'une ligne (« …aide a pris plus de 2 minutes »). Fichier non autorisé.
  - Dans `web/js/app.js`, l'affichage en direct de `command_output` décode chaque bloc à part, ce qui peut montrer des `��` passagers. Le journal final `command_end.output`, désormais intact, remplace ensuite cet affichage. Fichier non autorisé.
  - Dans `run_pdf_conversion`, si une écriture sur stdin échoue, la fonction s'arrête sans tuer le processus. Défaut antérieur.
- **Non validés :** Windows, macOS, PostgreSQL et l'interface graphique.
- **Écarts de procédure :**
  - Une commande du helper a été passée par erreur dans `| tail`.
  - Je n'ai pas pu lire le journal détaillé des runs, situé hors du dossier autorisé. La durée de la correction RPC-02 repose donc sur l'assertion du test (moins de 4 s), pas sur une mesure lue.
  - `git -C` m'a été refusé ; j'ai relu le diff avec `git diff` simple.
- Le décompte de 983 couvre seulement la lib `pilot`. Il n'est pas comparable aux 1150 de la baseline, qui couvrait aussi d'autres paquets.

Ce lot ne termine pas l'audit global.