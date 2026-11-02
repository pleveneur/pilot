# Rapport — « au repos, ce n'est pas du travail »

Correctif : une session OUVERTE mais sans travail n'est plus présentée comme
« en cours » et ne s'anime plus. Un travail RÉEL reste « en cours », animé, et
reste listé (décision 447 intacte).

- Date : 2026-11-14
- Base : `56159ab fix(agents): aucun agent invisible, quel que soit le chemin de lancement`
- Verrou : `src/js/au-repos-ce-n-est-pas-du-travail.test.js` (5 cas) +
  `src-tauri/src/anomaly.rs` (`session_generating_needs_busy_without_a_finished_turn`)
  + `src-tauri/src/agent_service.rs` (`activity_probe_entry_publishes_the_working_decision`)

---

## 1. Ce qui est constaté (par le propriétaire)

1. La session de l'Assistante s'affiche **« en cours »** alors qu'elle ne fait
   rien. Une session **ouverte** n'est pas un **travail**.
2. Elle **« respire »** au repos : un indicateur d'activité (pastille qui pulse)
   continue de s'animer alors qu'aucun travail ne tourne.

Les deux points ont la **même cause** : l'écran lisait un état **périmé**.

---

## 2. Preuves sur le disque (avant correction)

### 2.1 Où le libellé « en cours » est décidé

| Endroit | Ligne (avant) | Rôle |
|---|---|---|
| `src/js/agent-activity.js` | `241` | `const busy = state === "running" \|\| state === "compacting"` — `flattenAgents` dérive `busy` de `state` |
| `src/js/agent-activity.js` | `381` | `isAgentWorking(a)` = `working \|\| busy \|\| toolInProgress` — **point central** déjà partagé (liste, fiche, `anyBusy`, `main.js`) |
| `src/js/agent-activity.js` | `877` | `buildRunningMissions` retient un agent **seulement** si `isAgentWorking(a)` |
| `src/js/agent-activity.js` | `996` | `mode === "running" ? "en cours" : …` — **la chaîne exacte** du libellé |
| `src/js/agent-activity.js` | `1400` | `renderDropdown` pose `breathing` si `isAgentWorking(a)` |

Conclusion : **tout** descend de `state`, et `state` ne vient que d'un seul
endroit — la vue LOURDE `get_agent_supervision`.

### 2.2 Pourquoi `state` restait « running » à l'écran

Deux conditions doivent être réunies pour que la vue lourde soit relue :

- `planActivityRefresh` (`agent-activity.js:1087-1109`) ne la relit que si la
  **signature** change — `probeSessionsSignature` (`:1062`) = `projet + agent +
  vivacité` par session. Or **ni le début ni la fin d'un tour ne changent cette
  signature** : mêmes sessions, mêmes agents, même vivacité.
- ou sur le push `agent-state-changed` (`agent_service.rs:1353`
  `emit_state_changed`), appelé **uniquement** par `set_visible` et `set_state`.
  `set_state` n'est appelé qu'au **démarrage**, à la **mise en pause** et à
  l'**arrêt** d'une session (`agent_service.rs:1520, 1554, 1725, 1806, 3045,
  3061`) : **jamais à `agent_end` / `agent_settled`**.

Conséquence mécanique : une session photographiée `running` pendant qu'elle
travaillait **reste `running` à l'écran indéfiniment** après la fin de son tour.
Et l'Assistante est le cas le plus visible : sa session est **toujours ouverte**,
donc présente en permanence dans la photo lourde.

Le moteur, lui, publiait déjà la vérité **toutes les 2 s** dans la sonde légère
(`agent_service.rs:4068`, `activity_probe_entry` → `busy`, `toolInProgress`,
`lastActivity`)… et le frontend **ignorait** `busy` : `mergeProbeActivity`
(`agent-activity.js:1122`) ne recopiait que `alive`, `toolInProgress` et
`lastActivity`, **jamais `state`**.

### 2.3 D'où venait l'animation

`breathing` **est** l'animation : `src/css/style.css:2483`
`.agent-activity-item-dot.breathing { animation: agent-pulse 1.5s ease-in-out infinite; }`
(même chose `:2320` pour `#agent-activity-dot.breathing`, `:11358` pour
`.sa-immersive-dot.breathing`). La classe n'était posée que sur
`isAgentWorking(a)` — donc sur le **même état périmé**. Il n'y avait pas
d'animation « en trop » : il y avait une animation **correctement pilotée par un
état faux**.

### 2.4 Ce qui n'était PAS la cause (vérifié, écarté)

- **Le battement lui-même** : il sert aussi à repérer une session morte. Il est
  conservé tel quel ; seul son **affichage au repos** était en cause.
- **La respiration de la barre de saisie** (`superagent-input-reflecting`) : elle
  est pilotée par les évènements RPC réels de la session
  (`agent_start` → vrai, `agent_end` → faux, `super-agent.js:8444` / `:4451`),
  pas par la photo lourde. Elle n'était pas en cause ; le mouvement réduit la
  couvre désormais aussi.
- **`prefers-reduced-motion`** : une seule occurrence dans le CSS, et c'était un
  **commentaire** (`style.css:13183`) — le drapeau réel est la classe
  `.vocal-reduced` posée par `super-agent.js`. Il n'existait donc **aucune**
  règle de mouvement réduit pour les animations d'activité : c'est ajouté ici.

---

## 3. Cause tranchée

> L'écran décidait « travaille / au repos » sur un état que le moteur ne
> rafraîchissait qu'à la (re)création d'une session, alors qu'il publiait la
> vérité toutes les 2 s dans une sonde que le frontend ignorait.

Le défaut n'est donc **pas** un cas particulier de l'Assistante : il frappe
**toute** session (assistant, agent de projet, agent sans onglet) dont le tour se
termine sans que l'ensemble des sessions change. L'Assistante est simplement la
plus exposée, parce que sa session ne se ferme jamais.

---

## 4. Correction — au point le plus central

### 4.1 Une seule règle côté moteur (Rust)

`anomaly::session_generating(entry)` (`src-tauri/src/anomaly.rs`) : **« cette
session génère-t-elle, à cet instant ? »** = `busy` **et** dernier évènement ni
`agent_settled` ni `agent_end`. Elle remplace la règle qui était **recopiée à
deux endroits** dans `dashboard.rs:1360` et `:1375`, et elle est **publiée** par
la sonde légère (`activity_probe_entry` → champ `working`, `agent_service.rs`).

### 4.2 Une seule règle côté affichage (JS)

`stateFromProbeActivity(state, probe)` (`src/js/agent-activity.js`, PURE) :
processus mort → `stopped` s'il était annoncé `running` / `compacting` (un état
déjà au repos est conservé : il n'affirme aucun travail) ; le moteur dit qu'elle produit → `running` ; il dit
qu'elle ne produit pas → `idle` **seulement** si l'état connu affirmait le
contraire (`running` / `compacting`) ; `paused` est conservé ; **aucune preuve →
l'état connu est conservé** (rien n'est inventé). `mergeProbeActivity` l'appelle
et pose `state`.

Résultat : le même état que celui qui pilote déjà le libellé, la pastille, la
fiche et le volet des missions devient **vrai à chaque sonde (2 s)**, pour
**toutes** les sessions, sans nouvelle source de vérité et sans un cas par écran.

### 4.3 Effet de bord — souhaitable et vérifié

La fenêtre de **mise à jour** attend que plus aucune session ne travaille
(`setUpdateWorkProbe`, `main.js:441`, qui filtre sur `isAgentWorking`). Un
assistant figé « en cours » la retenait donc indéfiniment (« en cours depuis 2 h
13 min »). Avec l'état réel, elle se libère dès la fin du tour : c'est le même
correctif, pris au même point central, sans code supplémentaire.

### 4.4 Mouvement réduit

Nouveau bloc **en fin** de `src/css/style.css` :
`@media (prefers-reduced-motion: reduce)` → `animation: none` sur les six
indicateurs d'activité (pastille de session, point du suivi, statut « en train de
répondre », point de mission en cours, outil en cours, compteur du tableau de
bord, respiration de la saisie).

**Aucune information ne dépend de l'animation** : la pastille garde sa **couleur
pleine** (`animation: none` ne touche pas `background`/`opacity`), le nom de
l'agent qui travaille reste en **gras**, la fiche écrit **« Travail » /
« Repos »**, la mission porte le texte **« en cours »** et sa durée.

La règle de fond reste celle posée ici : **au repos, il n'y a rien à animer** —
le mouvement réduit n'est qu'une seconde ceinture.

---

## 5. Ce que chaque test empêche

`src/js/au-repos-ce-n-est-pas-du-travail.test.js` — les trois cas passent par la
**chaîne réelle** `mergeProbeActivity → flattenAgents → buildRunningMissions →
rendus` (aucune logique recopiée).

| Cas | Ce qu'il empêche |
|---|---|
| **(a)** « une session ouverte sans travail n'est pas présentée comme en cours » | le retour du libellé « en cours », de la mission comptée dans « Travail » et de la fiche « Travail » pour une session au repos — **alors même qu'un prompt est mémorisé** ; et vérifie que la session reste **LISTÉE** (décision 447) |
| **(b)** « aucune animation d'activité sur une session au repos » | le retour du `breathing` (donc de `agent-pulse`) sur la liste ou la fiche, et du point animé dans le volet des missions |
| **(c)** « un travail réel est présenté comme en cours et animé » | le retour de l'autre erreur : une session qui **travaille** ne doit jamais être refroidie par ce correctif (état `running`, libellé « en cours », point animé, `breathing`) |
| repli `busy` / `paused` / `alive=false` | qu'on invente un état : sans `working` publié, `busy` tranche ; une session **parquée** reste `paused` ; un processus mort est `stopped` |
| mouvement réduit | qu'on supprime le bloc CSS ou qu'on le déplace avant les règles `.breathing` (il perdrait la cascade) |

**Preuve d'échec sans le correctif** : en retirant les deux lignes de
`mergeProbeActivity` (`const state = stateFromProbeActivity(...)`), les cas
**(a)**, **(b)** et **(c)** échouent —
`expected 'running' to be 'idle'`, `… not to contain 'breathing'`,
`expected 'idle' to be 'running'` — puis repassent au vert après restauration.

Côté Rust :

- `session_generating_needs_busy_without_a_finished_turn` : `busy` vrai après
  `agent_end` / `agent_settled` **ne vaut pas** travail ; « aucune entrée » non
  plus.
- `activity_probe_entry_publishes_the_working_decision` : la sonde **publie** la
  décision (`working`), y compris `false` quand `busy` est resté vrai ; `working`
  **absent** quand aucune activité n'est connue.

---

## 6. Ce qui n'est PAS touché

- **Décision 447** : `isAgentListedInWorkList` est inchangée ; l'Assistante reste
  **toujours listée** (règle 2). Rien n'est masqué, rien n'est retiré.
- **Le battement** comme signal de session morte : conservé.
- **Le travail réel** : mêmes libellés, même animation, même volet « Travail ».
- Aucun test existant assoupli, aucun test supprimé.

---

## VERDICT

Corrigé au point central, pour toutes les sessions : l'état affiché suit
désormais la sonde de 2 s (`stateFromProbeActivity`, alimentée par
`anomaly::session_generating`), donc une session ouverte au repos n'est plus
« en cours » ni animée, et un travail réel reste reconnu et animé. Le mouvement
réduit coupe les animations d'activité sans retirer une seule information.
Verrouillé par 3 cas JS qui échouent si le correctif est retiré (+ 2 tests Rust).
