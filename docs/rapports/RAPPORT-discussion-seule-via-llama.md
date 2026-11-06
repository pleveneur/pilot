# Rapport — « Discussion seulement via llama »

Conception appliquée, mot pour mot : `docs/conceptions/CONCEPTION-personnage-discussion-seule-via-llama.md`.
Lot unique (§ 6.1) : case, mémorisation, moteur du personnage, refus net, identité lue
dans la fiche, écriture de la fiche avec historique et retour en arrière, phrases orales.

Résultat des tests à la fin du lot : **`npm test` → PASS (5752) FAIL (0)** et
**`cargo test --manifest-path src-tauri/Cargo.toml --lib` → 964 passed, 3 ignored**.

---

## 1. Ce que voit l'utilisateur

| Élément | Où | Condition d'apparition |
|---|---|---|
| Case **« Discussion seulement via llama »** | Options ⚙️ → Assistant, **sous le modèle du personnage** | un personnage est actif (sinon la ligne entière est masquée, l'écran est celui d'avant) |
| Ligne discrète « Fiche absente/vide — le personnage parle sans consigne. » | sous la case | fiche absente, vide ou illisible |
| Lien **« Revenir à la version précédente de la fiche »** | sous la case | une version précédente existe |
| Pastille **« Discussion seule »** | en-tête de l'onglet 🧭, à côté du nom | case cochée du personnage actif |

La coche est écrite **à l'instant** par le socle (aucun bouton « Enregistrer ») et
**survit au redémarrage**. Décocher **retire l'entrée** de la configuration au lieu
d'écrire `false` : la configuration revient à son état d'avant, à l'octet.

## 2. Le moteur, et l'absence totale de repli

Case cochée + personnage actif ⇒ la session de l'Assistant est lancée **avec le seul
modèle de la fiche du personnage**, et **une seule extension** (`pilot-persona-fiche.ts`) :
ni MCP, ni contexte projet, ni compétences, ni porte d'écriture, ni outils d'action. Le
modèle n'est pas « demandé » : si la décision de modèle ne vient pas de la **fiche**
(`AssistantModelSource::Persona`), la session **n'est pas démarrée** et la phrase du § 3
s'affiche. C'est ce qui rend la bascule silencieuse **impossible par construction**.

## 3. Le refus net (§ 2)

Trois façons d'échouer, une seule phrase chacune, toutes écrites dans
`src-tauri/src/discussion_seule.rs` (jamais recopiées dans la fenêtre) :

| Situation | Ce que fait Pilot |
|---|---|
| Aucun modèle local réglé pour le personnage | session non démarrée, phrase `NO_LOCAL_MODEL_SENTENCE`, message gardé |
| Le local ne répond pas (refus du moteur) | `REFUSAL_TEXT` (écrit) / `REFUSAL_VOCAL` (oral), message **remis dans la barre**, **aucune bulle** créée |
| Le local ne répond pas au bout de **60 s** | même refus, le tour est arrêté, message gardé |
| Le local se coupe **en pleine réponse** | la réponse **déjà reçue est gardée telle quelle**, seulement la ligne grise `PARTIAL_STOP_LINE` |
| Attente > **3 s** | ligne d'état `WAITING_LINE` (rien d'autre ne bouge) |

Aucun réessai automatique, **jamais** de second envoi à la place de l'utilisateur.

## 4. Identité : la fiche seule (§ 3)

`discussion_seule::build_message` compose **uniquement** : le bloc de la fiche (les cinq
champs de contenu qui existent), le cadre du § 4 (ce qu'il peut écrire, et rien d'autre),
puis la demande de l'utilisateur **mot pour mot**. Aucun rôle de Pilot, aucun contexte
projet, aucune mémoire de session, aucun prompt personnalisé, aucun genre réglé : en
discussion seule, le personnage **n'est pas** l'assistant au travail. Le palier de
relation et la description visuelle ne sont pas joints (le bloc construit ne les lit même
pas).

Fiche **absente**, **vide** ou **illisible** ⇒ le personnage parle avec son nom seul et
une ligne grise, **une fois par session**. Fiche **incomplète** ⇒ **aucun message** (état
normal, conforme au § 3.3).

## 5. Écriture de sa propre fiche (§ 4)

- Outil **`ecrire_ma_fiche`**, seul outil du mode, déclaré dans
  `src-tauri/extensions/pilot-persona-fiche.ts` ; son appel passe par la sentinelle
  `PILOT_PERSONA_FICHE::`. Les deux valeurs sont écrites **une seule fois** (constantes
  Rust) et servies à la fenêtre et à l'extension par `discussion_seule_state`.
- **Seuls les cinq champs de contenu** peuvent être écrits : `nom`, `ce_qu_il_est`,
  `ton_et_parler`, `appel_du_proprietaire`, `ce_qu_il_fait`… et `ce_qu_il_ne_fait_jamais`.
  Le reste du fichier (`palier_relation`, `description_visuelle`, `portrait`, identifiant)
  est **préservé à l'identique**.
- **Passage du propriétaire jamais écrasé** : le socle retient, par personnage et par
  champ, la dernière valeur **écrite par le personnage** (`character_fiche_authors`). Une
  valeur qui n'est pas la sienne appartient au propriétaire ⇒ **modification abandonnée**
  (en discussion écrite : une question, une seule fois, et `force: true` seulement si le
  propriétaire répond oui) ; en mode Vocal : `force` est **ignoré**, aucune question n'est
  posée. Fail-closed : dans le doute, on protège.
- **Version précédente toujours gardée** : copie datée dans `historique/` à côté de la
  fiche, **20 versions** au plus par personnage, seule la plus ancienne est retirée — la
  fiche en vigueur n'est jamais tronquée. Retour en arrière depuis les Options (le geste
  est réversible par le même lien, sans fenêtre de confirmation).
- **Aucune création de fiche** : sans fiche, rien n'est inventé dans le dossier de
  Présences.
- **Réflexion jamais écrite** : la charge utile est **filtrée sur les cinq champs** ; tout
  ce que le modèle aurait mis ailleurs (raisonnement, brouillon, commentaire) est ignoré
  avant la moindre écriture.

## 6. Mode Vocal (§ 4.5)

Aucune question, jamais : `force` est refusé, le personnage écrit et **annonce en une
phrase**, avec ses mots, le fait que le socle lui rend (`report_text`, variantes `vocal`) :
écriture faite (« l'ancienne version est gardée »), passage du propriétaire laissé tel
quel, écriture impossible. Une phrase par modification, jamais deux annonces groupées.

## 7. Les lignes grises : trois, chacune une seule fois par session

| Ligne | Quand | Texte porté par |
|---|---|---|
| « Ce personnage n'a pas encore de fiche (remplie) : il te parle sans consigne… » | mode actif, fiche absente/vide/illisible | `persona_fiche::FicheEtat::notice` |
| « Personnage actif : <Nom>. » | le personnage change **en cours** de session | `discussion_seule::persona_switch_line` |
| « Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel. » | le personnage disparaît pendant la discussion | `discussion_seule::PERSONA_DISABLED_LINE` |

Aucun de ces textes n'est composé dans la fenêtre : `src/js/discussion-seule.js` décide
**laquelle est encore due** (`sessionNotice`), jamais son contenu. Des tests vérifient que
la fenêtre ne contient ni « Personnage actif : » ni la phrase de désactivation. La ligne
« personnage actif » n'est **pas** dite à l'ouverture de l'onglet (le personnage n'a pas
changé, il était déjà là) ; une conversation neuve remet les trois à zéro.

## 8. Décisions prises pendant le lot (à lire)

1. **`NO_LOCAL_MODEL_SENTENCE` est la SEULE addition textuelle du lot** (aucune phrase de
   ce genre dans la conception). Justification : la conception interdit la bascule
   silencieuse, or la chaîne de modèles de Pilot retombe sur le modèle de l'assistant puis
   sur le défaut global quand la fiche n'en porte pas. Sans cette phrase, la case cochée
   aurait parlé avec le moteur habituel **sans le dire** — exactement ce que le § 2
   interdit. La phrase dit le geste à faire et termine par « Rien n'est parti vers un autre
   moteur. »
2. **Le refus à 60 s passe par le geste d'arrêt EXISTANT** (`stopSuperAgentTurn()`), qui
   devient son **troisième appelant** (bouton Stop, prise de parole vocale, refus de
   délai) : aucun `invoke("abort_super_agent")` n'a été ajouté. Le verrou
   `src/js/vocal-couper-la-reflexion.test.js` comptait deux appelants ; il en compte trois
   désormais, avec la raison écrite dans le test. Ce qui reste interdit et toujours
   vérifié : un arrêt **écrit ailleurs** (aucun quatrième site d'IPC).
3. **Changer la case en cours de session relance la session de l'Assistant** (et seulement
   si le mode a changé). Raison : les extensions d'une session sont fixées à son
   lancement — sans relance, cocher la case laisserait les outils de travail disponibles
   dans une session déjà vivante, ce qui violerait la règle absolue « aucun outil de
   travail ». Le fil **affiché** est conservé (les bulles ne sont pas effacées), la ligne
   grise du § 3.4 le dit ; en revanche la **mémoire interne du processus** repart, comme
   pour tout changement de session. C'est la seule conséquence de ce choix, et elle est
   assumée : l'alternative (garder une session avec outils) est interdite par le document.
   Décision PURE et testée : `agent_service::superagent_mode_mismatch`.
4. **« Personnage désactivé pendant l'écriture » est distingué de « fiche absente »** : la
   fenêtre transmet le personnage qui a demandé l'écriture, le socle le compare à celui
   d'aujourd'hui (`persona_gone_since_request`). Personnage disparu ⇒ **rien n'est écrit**
   et la phrase est celle du § 4.6 (« Je n'ai plus de fiche à moi, je n'ai rien changé. »).
5. **La réflexion du modèle local n'apparaît jamais** (exigence du propriétaire) : elle
   n'est peinte ni en flux ni à la fin, **même** quand l'option « afficher la réflexion »
   est active — le flux de pensée alimente seulement la détection de boucle, qui reste
   inchangée.

## 9. Fichiers

Créés :

- `src-tauri/src/discussion_seule.rs` — décisions et phrases du mode (PUR, source unique).
- `src-tauri/src/persona_fiche.rs` — lecture de `fiche.json`, écriture protégée,
  historique, retour en arrière, commandes `discussion_seule_state`,
  `set_discussion_seule`, `persona_fiche_write`, `persona_fiche_rollback`.
- `src-tauri/extensions/pilot-persona-fiche.ts` — l'outil `ecrire_ma_fiche`, seul outil du
  mode (délai d'attente `PILOT_UI_OPTS = { timeout: 120_000 }`, comme les autres
  extensions d'interface).
- `src/js/discussion-seule.js` + `src/js/discussion-seule.test.js` — ce que l'écran doit
  montrer, et rien de plus (aucune phrase du socle n'y est recopiée).

Modifiés : `src-tauri/src/lib.rs` (deux champs de configuration additifs, quatre
commandes), `src-tauri/src/agent_service.rs` (mode de session, relance au changement de
mode), `src-tauri/src/super_agent.rs` (deux compositions, un seul envoi),
`src/js/super-agent.js` (pastille, attente, refus, lignes grises, interception de la
sentinelle), `src/js/settings.js` + `index.html` (la case, la note, le lien de retour).

## 10. Ce qui n'a pas été fait (hors périmètre, § 5)

Aucun second moteur ni endpoint, aucun second écran, aucune mémoire nouvelle, aucun
changement dans Présences, aucun réglage global. Le prompt de l'assistant, la
documentation d'usage et la version du produit n'ont pas été touchés.

## 11. Les quatorze vérifications du propriétaire (§ 6.2)

1. Sans personnage : la case n'est pas là. — Rien d'autre n'a bougé.
2. Avec un personnage : la case apparaît sous le modèle du personnage.
3. Case décochée : comportement identique à avant, écrit et oral.
4. Case cochée, écrit : le personnage répond avec son modèle ; lui demander une tâche ⇒
   refus poli ; pastille « Discussion seule » visible.
5. Case cochée, oral : il répond et refuse le travail avec sa voix.
6. Modifier une phrase de la fiche dans Présences ⇒ au message suivant, la nouvelle
   version est utilisée (aucun redémarrage).
7. Fiche vide ⇒ une ligne grise, une fois ; il continue de parler ; aucun rouge.
8. llama arrêté ⇒ message gardé dans la barre, phrase de refus (dite à l'oral), aucune
   réponse d'un autre moteur ; rallumer puis réessayer fonctionne.
9. « Appelle-moi patron » ⇒ la fiche change (ou une question, si le passage est au
   propriétaire) ; en Vocal, elle change sans question et **une** phrase le dit.
10. Une phrase écrite par le propriétaire n'est jamais touchée en Vocal, et il le dit.
11. Options → Assistant : le lien de retour en arrière apparaît, un clic rend la version
    d'avant, un second revient en avant.
12. Redémarrer Pilot : la case est toujours cochée pour ce personnage.
13. Désactiver le personnage en pleine discussion : le message suivant repart en
    comportement habituel, le fil est conservé, la ligne grise le dit une fois.
14. Deux personnages : chacun garde son réglage.
