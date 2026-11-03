# Rapport — « l'Assistant se croit occupé alors que rien ne travaille »

**Date** : 2026-11-16
**Symptôme rapporté** (propriétaire) : « On me dit que tu travailles alors que tu
n'apparais pas en train de travailler, et la demande que je viens d'écrire ne
part jamais. Je dois fermer puis rouvrir l'onglet 🧭 pour qu'elle reparte. »

**Verdict** : défaut réel, en **deux temps**, chacun suffisant à lui seul.

---

## 1. Cause 1 — deux observateurs pour un même fait

L'onglet 🧭 tenait **sa propre boucle** de 2 s (`superStatusPoll`, `setInterval`)
qui interrogeait la sonde **LOURDE** `get_agent_supervision` pour décider si
l'Assistant travaillait. Le cercle d'activité (en haut à droite) tenait la
sienne, sur le **magasin partagé** (`agent-activity.js`, sonde LÉGÈRE
`agent_activity_probe` + `agent-state-changed`).

Deux observateurs, deux vérités possibles :

- le cercle affichait l'Assistant **au repos** (vérité du magasin partagé) ;
- l'onglet, lui, gardait son drapeau `backendBusy` allumé — et **rien ne pouvait
  plus le faire tomber**, puisque la seule preuve acceptée était une lecture
  lourde qui pouvait échouer ou être décalée ;
- l'onglet ne lisait d'ailleurs jamais `isStreaming` en retour : l'état local
  « tour en cours » n'était effacé que par `agent_end` ou par la sonde.

La règle du projet est pourtant explicite (`spec_pilot.md` § 2, « Aucune attente
de `pi` sur le thread principal ») : la boucle n'a le droit qu'à la sonde
**légère**, la supervision complète n'est lue qu'au démarrage, au changement
d'ensemble des sessions et sur `agent-state-changed`. L'onglet violait cette
règle avec sa boucle lourde.

## 2. Cause 2 — la file ne partait que si l'on avait VU le moteur travailler

`flushDemandesEnAttente` n'était autorisé à vider la file qu'avec le drapeau
`tourEnCoursVu`, armé **uniquement** quand la sonde avait observé le moteur en
traitement **après** la mise en file. Or dans le cas rapporté, le moteur était
**déjà au repos** au moment de la mise en file : aucun `agent_end` ne viendrait
plus, la sonde ne verrait jamais de tour, le drapeau restait faux — **la demande
ne partait jamais**. Seule la réouverture de l'onglet (qui recréait l'état)
libérait la file : exactement le geste de contournement décrit par le
propriétaire.

---

## 3. Correction

### 3.1 Une seule vérité du travail (`src/js/agent-activity.js`)

- `flattenAgents` publie un champ **ADDITIF** `alive` (booléen), recopié de la
  supervision / de la sonde légère. Absent quand il n'est pas connu : **jamais
  inventé**. Aucune autre sémantique touchée, la règle de la sonde légère
  (`agent-activity-sonde-legere.test.js`) reste intacte.
- Nouvelle fonction **PURE** `assistantWorkState(list)` : c'est désormais le
  **seul** endroit qui décide de l'état de travail de l'Assistant. Elle
  reconnaît sa session par son **identité** (`kind === "superagent"`, jamais un
  libellé — un renommage ne peut plus casser la détection) et rend
  `{ known, working, starting, alive, auRepos }` avec
  `auRepos = !working && !starting`.

### 3.2 L'onglet lit le magasin partagé (`src/js/super-agent.js`)

- `superStatusPoll` (et son `clearInterval`) **supprimés** ; il ne reste **aucun**
  `get_agent_supervision` dans le fichier. L'onglet s'abonne une fois :
  `subscribeAgentActivity(...)`, désabonné à la fermeture (`unsubAssistantWork()`).
  Le magasin livre immédiatement l'état connu, puis à chaque changement
  (cadence 2 s inchangée).
- `appliquerObservationTravail(list)` remplace le corps de l'ancienne boucle, en
  **trois cas dans l'ordre** :
  1. **travaille** → `backendBusy = true`, « Réfléchit… », classe
     `agent-status-streaming`, `setReflecting(true)` (états d'erreur jamais
     écrasés) ;
  2. **en démarrage** (`starting`) → `backendBusy = true` seulement : c'est la
     **latence après un envoi**, pas le repos — aucune seconde demande ne peut
     partir par-dessus la première ;
  3. **au repos** → `backendBusy = false`, retour à « Prêt » / classe
     `agent-status-idle`, `setReflecting(false)`, **`isStreaming = false`** puis
     vidage de la file.
- `scheduleTransientDisconnect` (fenêtre de grâce de 500 ms → 30 s) ne sonde
  plus en boucle : il s'abonne au **même** magasin et garde **une** borne
  (`setTimeout`) qui déclenche l'alerte si la session reste morte. Le faux
  départ rattrapé et le vrai blocage se comportent exactement comme avant.

### 3.3 Le repos observé vide la file (`viderFileAuReposObserve`)

```js
function viderFileAuReposObserve() {
  isStreaming = false;                               // ← la cause du « occupé » fantôme
  if (demandesEnAttente.length === 0) return false;
  return flushDemandesEnAttente(true);                // ← le SEUL chemin d'envoi
}
```

- `isStreaming` n'était **jamais** effacé par une observation : c'est le
  « occupé » fantôme lui-même. Il tombe maintenant sur un **fait observé**.
- L'envoi reste `send()`, **une seule demande à la fois, dans l'ordre** d'arrivée
  (`prendreDemandeEnAttente`) — aucun second chemin d'envoi.
- Le drapeau `tourEnCoursVu` est **supprimé** (identifiant absent du fichier, y
  compris des commentaires) : son rôle d'anti-double-envoi est repris par la
  famille `starting`, **sans aucun minuteur** — la règle « jamais par un délai »
  est tenue.
- Ne changent pas : les phrases d'accusé (mot pour mot), la file pleine, l'écran
  Vocal, les réglages, les boutons, les lignes d'état.

---

## 4. Verrous (tests)

| Fichier | Ce qu'il tient |
|---|---|
| `src/js/assistant-une-seule-verite-du-travail.test.js` (**nouveau**, 13 tests) | Aucun `setInterval` n'appelle `get_agent_supervision` ; abonnement unique au magasin + désabonnement ; `tourEnCoursVu` absent ; détection par `kind === "superagent"` ; le repos efface `isStreaming` **et** vide la file ; `starting` / `working` ne libèrent rien ; jamais de session morte « au repos » ; `alive` additif et jamais inventé |
| `src/js/demande-pendant-le-tour.test.js` (mis à jour, 20 tests) | La file part par le **seul** chemin `send()`, premier arrivé premier servi, brouillon préservé, **aucun** `setTimeout`/`setInterval` dans le vidage ; le fait qui dénoue est le **repos observé** (les deux anciennes assertions sur `tourEnCoursVu` décrivaient la mécanique remplacée) |
| `src/js/agent-activity-sonde-legere.test.js` (inchangé) | La boucle de 2 s reste sur la sonde **légère** |
| `src/js/au-repos-ce-n-est-pas-du-travail.test.js`, `src/js/super-agent-disconnect.test.js` (inchangés) | Une session ouverte au repos n'est pas du travail ; la fenêtre de grâce et le message « Connexion perdue » |

**Preuve que le verrou mord** : lancé sur le code **non modifié**, le nouveau
fichier échoue (3 tests) —
`AssertionError: expected '// super-agent.js — Assistant de suiv…' to contain
'const unsubAssistantWork = subscribeA…'`. Après correction : vert.

## 5. Vérifications

| Moment | Commande | Résultat |
|---|---|---|
| Avant | `npx vitest run` sur les 4 fichiers concernés | `PASS (49) FAIL (0)` |
| Après | `npx vitest run` (suite complète) | **`PASS (5250) FAIL (0)`** |
| Après | `npm run build` (front) | OK |
| Docs | `npm run build:handbook` | `help/handbook.md` régénéré (bloc `assistant-une-seule-verite-du-travail`) |

Rust non touché : aucune commande, aucune structure de données modifiée
(`alive` était déjà publié par `get_agent_supervision` et par
`agent_activity_probe`).

## 6. Documentation mise à jour

- `spec_super_agent.md` — nouvelle section (bloc HELP)
  « L'Assistant n'est jamais « occupé » à tort (une seule vérité du travail) ».
- `spec_pilot.md` § 2 — la règle de la sonde légère vaut désormais pour **tous
  les écrans**, onglet 🧭 compris, avec la garde associée.
- `AGENTS.md` — la ligne de `demande-pendant-le-tour.js` dit maintenant que la
  file est vidée sur le **repos observé** du magasin partagé (et non plus sur
  une relecture de `get_agent_supervision`).
- `help/handbook.md` régénéré.

## 7. Ce qui n'a pas changé (vérifié)

- Un **seul** chemin d'envoi (`send`), un **seul** propriétaire de la file.
- Accusés de mise en file et messages de file pleine : **mot pour mot**.
- Écran Vocal (aucune ligne touchée), aucun nouveau réglage, aucun nouveau
  bouton, aucune nouvelle ligne d'état.
- La sonde **légère** reste la seule autorisée dans une boucle ; la supervision
  complète reste lue au démarrage, au changement d'ensemble et sur
  `agent-state-changed`.
- Aucun minuteur ajouté pour « laisser le temps » : les seuls minuteurs touchés
  ont été **retirés** (la boucle lourde de l'onglet et la boucle 500 ms de la
  fenêtre de grâce).
