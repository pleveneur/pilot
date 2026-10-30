# RAPPORT — Le mode Vocal répond toujours, même pendant une tâche longue

**Symptôme rapporté par le propriétaire** : « Quand l'assistante travaille, le mode vocal ne
fonctionne plus. J'ai dû relancer mon onglet. »

**Verdict** : ce n'était ni un gel du moteur, ni un problème de micro, ni un défaut du
WebView. C'était **trois refus muets empilés dans `super-agent.js`**, qui se déclenchaient
tous les trois pendant qu'un tour est en cours. Chacun, pris seul, « protégeait » quelque
chose ; ensemble, ils rendaient l'écran Vocal **totalement muet** pendant un travail long,
sans jamais le dire, et sans que rien ne reparte ensuite. La demande de l'utilisateur
n'était pas perdue par un bug exotique : elle était **refusée**, proprement, à trois endroits.

Le correctif ne touche **aucune décision ferme de l'écran vocal** (le bouton des modes est
toujours le logo, la barre du bas s'efface toujours, les trois sorties sont inchangées, la
zone image reste en haut à droite). Il ne masque rien par un délai : il **remplace un refus
par un accusé immédiat + une file vidée à la fin réelle du tour**.

> **Note sur `vocal.md`** : ce document de travail porte sur la **coupure de parole
> intermittente** (mesure du résidu d'écho, garde armée/désarmée par lecture). Il ne
> documente pas et ne contredit pas le défaut traité ici : il a été relu avant de toucher au
> comportement vocal, et **rien** de ce qu'il décrit (mesure du résidu, seuil
> `max(0,05 ; résidu × 1,8)`, `stepSpeechGate`, `bargeInArmed`) n'a été modifié.
> Les deux sujets se touchent par un seul point, respecté ici : le chemin d'arrêt du barge-in
> reste **le seul** (`stopSuperAgentTurn` → un unique `invoke("abort_super_agent")`), et une
> demande mise en file **n'interrompt jamais** le tour en cours.

---

## 1. Cause tranchée, avec preuves `fichier:ligne`

### Refus n° 1 — le micro est refusé pendant un tour

`src/js/super-agent.js` (avant correctif, `toggleVoiceInput`) :

```js
if (isStreaming) { appendSystemMessage(messagesEl, "⏳ L'assistant est en cours, patiente la fin pour dicter."); return; }
```

Le bouton 🎙️ — et donc le rond « Réveiller » de l'écran Vocal, qui passe par la même
fonction — **refuse d'ouvrir une dictée** tant que `isStreaming` est vrai. Et ce message
part dans `messagesEl`, **la conversation**… qui n'est **pas affichée** dans l'écran Vocal.
Résultat visible pour l'utilisateur : il appuie, **rien ne se passe**, aucun message.

### Refus n° 2 — une dictée ouverte pendant un tour se referme « pour rien », et sa demande ne part jamais

`src/js/vocal-conversation.js` (avant correctif) :

- `decideVocalDictation`, règle 4 : `reflechit || occupe` ⇒ **DISARM**, raison `"tour-en-cours"` ;
- `decideVocalSilenceSend`, règle 3 : `reflechit || occupe` ⇒ **CANCEL**, raison
  `"tour-en-cours"` — c'est-à-dire : le texte **est** transcrit, la phrase **est** finie,
  l'échéance de silence (2 s) **est** atteinte… et la demande est **annulée**.

C'est le pire des trois : l'utilisateur **voit** son texte apparaître dans la zone de
saisie, puis la dictée se referme et **il ne part rien**. Aucun message. La demande est
transcrite puis jetée.

### Refus n° 3 — le chemin d'envoi refuse la demande, et l'explique là où personne ne regarde

`src/js/super-agent.js` (`send`) :

```js
if (isStreaming || backendBusy) {
  if (!busyNotified) { busyNotified = true; statusEl.textContent = "⏳ Occupé…"; setBusyHint(true); }
  return;
}
```

Le texte reste dans le champ, et l'explication part sur `statusEl` — ligne **de l'onglet
normal**, absente de l'écran Vocal (« l'écran n'a qu'une seule ligne d'état », § 4ter de
`spec_modes_ecran_vocal.md`). Et **rien ne rejoue la demande à la fin du tour** : elle attend
un nouvel appui.

### Le blocage **définitif** (« j'ai dû relancer mon onglet »)

`isStreaming` n'est remis à `false` qu'à deux endroits : `agent_end` (`super-agent.js`) et
l'échec d'envoi. Si un `agent_end` **manque** — arrêt pendant un outil, tour interrompu —,
`isStreaming` **reste collé à `true` pour toujours** :

- `send` refuse **définitivement** (refus n° 3),
- `toggleVoiceInput` refuse **définitivement** (refus n° 1),

donc plus aucune demande ne part et plus aucun micro ne s'ouvre **jusqu'au rechargement de
l'onglet**. C'est exactement le geste que l'utilisateur a décrit. La sonde de supervision
(`get_agent_supervision`, toutes les 2 s) **connaissait déjà** la vérité (`processing =
alive && (running || compacting)`) et désarmait `backendBusy`, mais **pas** `isStreaming` :
la seule source qui fait foi n'était pas celle qui débloque.

**En résumé** : le mode Vocal n'était pas figé. Il **refusait**, à trois niveaux, en silence,
et l'un de ces trois refus pouvait devenir permanent.

---

## 2. Correctif

### 2.1 Une seule règle nouvelle, dans un module pur et testé

`src/js/demande-pendant-le-tour.js` (nouveau) — **source unique** de ce que devient une
demande arrivée pendant un tour :

| Situation | Décision |
|---|---|
| texte vide | `refuser` (`sans-texte`) — rien à envoyer, rien à accuser |
| moteur libre | `envoyer` (`moteur-libre`) — le chemin d'envoi **existant**, inchangé |
| moteur occupé, file < 5 | **`enfiler`** (`tour-en-cours`) — accusé immédiat, rang dans la file |
| moteur occupé, file pleine | `refuser` (`file-pleine`) — **message explicite**, texte conservé |

`prendreDemandeEnAttente` est le **seul** endroit qui décide de l'ordre de sortie (premier
arrivé, premier servi). Le module est pur : aucun DOM, aucune horloge, aucun `invoke`,
aucun envoi (verrouillé par test).

### 2.2 Les trois refus supprimés

- **Refus n° 1** : `toggleVoiceInput` (`super-agent.js:4195`) n'inspecte plus `isStreaming`.
  Le bouton 🎙️ et le rond « Réveiller » ouvrent la dictée pendant un tour.
- **Refus n° 2** : `decideVocalDictation` **n'a plus** de règle « Pilot travaille ⇒
  désarmer ». Le tour en cours ne fait que choisir la **raison** (`"tour-en-cours"`) et la
  **marge d'armement** (celle du repos). Même chose pour `decideVocalSilenceSend` : un tour
  en cours ne change **plus rien** à la décision (propriété testée : la décision est
  **identique** avec et sans `reflechit`/`occupe`).
- **Refus n° 3** : `send` (`super-agent.js:6411`) ne refuse plus : il **enfile** et
  **accuse**.

### 2.3 L'accusé, aux deux endroits qui existent déjà

`enfilerDemande` (`super-agent.js:6309`) écrit **une** phrase dans la conversation et
rafraîchit l'écran Vocal ; `vocalStatusLine` (`super-agent.js:5018`) affiche
`VOCAL_MESSAGE_DEMANDE_ACCUSEE` **avant** les quatre phrases d'état. En mode Vocal la
conversation n'est pas affichée : sans cette ligne, l'accusé serait invisible — c'était le
symptôme exact. **Aucun nouveau nœud d'interface, aucune nouvelle ligne.**

### 2.4 La file repart sur la fin de tour **réelle**, et dénoue le blocage définitif

`flushDemandesEnAttente` (`super-agent.js:6337`) vide **une** demande, dans l'ordre, par le
**seul chemin d'envoi existant** (`send`) : le texte est remis dans la zone de saisie
(`inputEl.value = texte`), donc `send` le lit comme n'importe quelle demande tapée. Le
brouillon éventuel de l'utilisateur est restitué aussitôt.

Elle est appelée à **deux** moments, tous deux réels — **aucun délai, aucun `setTimeout`** :

1. la **fin de tour** (`agent_end`, `super-agent.js:4419`) — le moteur a rendu la main ;
2. la **supervision** (`super-agent.js:6701`), quand elle affirme qu'**aucune session n'est
   en traitement** alors qu'un tour local est encore marqué « en cours » : là seulement, la
   fin de tour n'arrivera jamais, et l'état du **moteur fait foi** (`flushDemandesEnAttente(true)`).
   Une garde `tourEnCoursVu` exige que la sonde ait **vu** le moteur réellement en traitement
   depuis la mise en file : une simple latence juste après un envoi ne peut pas faire partir
   une seconde demande par-dessus la première.

Quand une demande part à la fin d'un tour, la **lecture à voix haute** de la réponse
précédente est sautée (`if (!demandePartie) autoReadVocalReply()`) : deux voix ne se
chevauchent pas. La réponse reste dans la conversation, avec son bouton d'écoute.

### 2.5 Ce qui n'a **pas** bougé

- Le **barge-in** (§ 6bis) : `vocalInterruptTarget`, le seuil, la garde `if (voiceActive)
  return;`, le chemin d'arrêt **partagé** `stopSuperAgentTurn` → `abort_super_agent` (un seul
  IPC). Aucun test de coupure n'a été touché.
- **Mais un effet de bord est assumé, et consigné dans la spec** : pendant un travail, la
  dictée étant désormais **ouverte**, la garde « une dictée ouverte ne coupe rien »
  s'applique — parler pendant que Pilot **travaille** ne l'**interrompt** plus, cela devient
  une **demande mise en file** (c'est précisément le but : accusé immédiat, travail ni
  interrompu ni perdu). La coupure n'est pas perdue pour autant : quand Pilot **lit**, la
  dictée est désarmée, donc parler **coupe la lecture** comme avant ; si la dictée n'est pas
  ouverte (permission refusée, geste, plafond des sessions vides), la coupure de la
  **réflexion** passe par le **même** chemin d'arrêt ; et le bouton **Stop** reste le geste
  explicite. Aucun seuil, aucune garde, aucun IPC n'a été modifié.
- Les **décisions fermes** de l'écran : bouton des modes = le logo, barre du bas qui s'efface
  au repos, trois sorties, zone image en haut à droite, « tout masquable sauf le portrait ».
- Le **silence qui n'est pas une panne**, le **plafond des sessions vides**, les **refus
  définitifs** (projet sensible, arrêt 🎙️, hors du mode, erreur, dictée indisponible).
- La **discussion normale** : un envoi au repos part exactement comme avant
  (`moteur-libre` ⇒ `envoyer`).

---

## 3. Tests

### Exécutés

```bash
npx vitest run                     # 4610 tests — PASS (0 échec)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # aucun code Rust modifié
```

### Ajoutés

`src/js/demande-pendant-le-tour.test.js` (20 tests) : la décision pure (4 branches, ordre des
règles, entrées invalides, file bornée), l'accusé (deux phrases distinctes, **aucun délai
annoncé**, priorité sur la ligne d'état, écriture dans la conversation **et** rafraîchissement
de l'écran Vocal), la file (FIFO, jamais perdue, pureté du module), le **branchement réel**
sur le source (`send` n'a plus de refus muet, la fin de tour vide la file, un seul `send()`,
aucun `invoke(`, le brouillon restitué, `toggleVoiceInput` sans refus, blocage définitif
dénoué par l'état du moteur — et **pas** par un minuteur), et la disparition de la règle
« le tour en cours prime ».

### Adaptés — et **pourquoi** (aucun test n'a été assoupli ni supprimé)

Trois tests verrouillaient explicitement l'**ancienne** règle (« le tour en cours prime »),
c'est-à-dire le comportement qui **produisait** le défaut. La décision du propriétaire
(2026-11) la **remplace** ; ces tests ont donc été réécrits pour verrouiller la **nouvelle**
règle, avec des assertions **plus** fortes, pas moins :

| Test | Avant | Après |
|---|---|---|
| `vocal-parler-declenche-une-demande.test.js` | « pendant que Pilot travaille, la dictée est DÉSARMÉE » | « la dictée reste **ARMÉE** » + délai, raison, et existence de l'accusé |
| `vocal-repondre-deux-secondes.test.js` | « Pilot travaille : rien ne part » ; « rien ne part pendant que Pilot réfléchit » | « la demande **PART** quand même » — la décision est **identique** avec et sans `reflechit`/`occupe` (propriété d'invariance), et l'échéance **referme** réellement la dictée |
| `vocal-reprise-ecoute-auto.test.js` | 4 refus passagers dont `"tour-en-cours"` ; « un tour en cours est un refus passager, jamais une ouverture » | 3 refus passagers ; `"tour-en-cours"` **n'est plus** un refus (`vocalResumeRetry` = 0) et un tour en cours **ouvre** l'écoute |

Aucune assertion n'a été retirée des garanties existantes (un seul `new SR()`, idempotence,
une seule minuterie, bornage des reprises, un seul `applyVoiceEnd`, un seul envoi).

---

## 4. Vérification demandée : une tâche longue ne bloque plus l'écran Vocal

| Geste pendant une tâche longue | Avant | Après |
|---|---|---|
| Je parle (dictée déjà armée) | la dictée se **referme**, la demande est **annulée** en silence | la dictée reste ouverte ; la demande est **accusée** puis **mise en file**, et part à la fin du tour |
| J'appuie sur 🎙️ / « Réveiller » | **refusé** (« patiente la fin », message invisible ici) | la dictée s'ouvre |
| Je tape une demande puis Entrée | refusée ; texte conservé ; explication sur une ligne invisible en mode Vocal | **accusée** et mise en file |
| L'écran affiche | « Je réfléchis… » puis **plus rien jamais** | « C'est noté, je m'en occupe dès que j'ai terminé. » |
| Je parle pour **couper** Pilot | coupait la réflexion | pendant le travail : devient une **demande mise en file** (le travail n'est plus interrompu) ; pendant la **lecture** : coupe toujours ; bouton **Stop** inchangé |
| Le tour se termine | rien ne repart, il faut réappuyer | la file part **toute seule**, dans l'ordre |
| `agent_end` manqué | `isStreaming` **collé** ⇒ envoi et micro refusés **pour toujours** (relance de l'onglet) | la supervision (état du **moteur**) vide la file et rouvre la main |
| La réponse précédente est-elle lue deux fois ? | — | non : la lecture est sautée si une demande vient de partir |

---

## 5. État du dépôt

- Fichiers modifiés : `src/js/super-agent.js`, `src/js/vocal-conversation.js`,
  `spec_modes_ecran_vocal.md` (décision 2026-11 consignée en § 6bis), et les trois tests
  listés ci-dessus.
- Fichier ajouté : `src/js/demande-pendant-le-tour.js` + son test.
- Aucun code Rust touché. Aucune donnée personnelle, aucun registre d'agents, aucun réglage.
