# Couper la réflexion en mode Vocal — quand le propriétaire prend la parole

> Micro-tâche de développement (rôle : codeur). Objet : en mode **Vocal**, si
> l'utilisateur parle **pendant que Pilot réfléchit**, l'agent en cours doit
> s'**arrêter** et la parole être prise en compte tout de suite — en réutilisant
> **exactement** le chemin d'arrêt existant (celui du bouton Stop de la
> conversation). Aucun mécanisme d'arrêt parallèle.

---

## 1. Audit écrit — quel est LE chemin d'arrêt existant

Avant toute modification, le chemin d'arrêt de la conversation a été identifié et
lu de bout en bout.

| Endroit | Ce qu'il fait |
|---|---|
| `src/js/super-agent.js` — bouton Stop de la barre d'outils (`data-action="abort"`) | appelle **`invoke("abort_super_agent")`**, précédé de `resetDeferredSound()` |
| `src-tauri/src/super_agent.rs:1812` — `abort_super_agent` | refuse proprement si `!superagent_alive()` (retourne une erreur, **ne relance jamais**), sinon envoie `{"type":"abort"}` au moteur RPC |
| `src/js/super-agent.js` — fin de tour | l'arrêt se termine par l'événement **`agent_end`** existant : `isStreaming`, `backendBusy`, `busyNotified` retombent, `setReflecting(false)`, le texte déjà produit est rendu |
| arrêts **automatiques** (boucle détectée) | deux sites distincts, **tracés** dans `.pilot/agent-stops.log` (règle 3 du projet) |

Conclusion de l'audit : **il n'existe qu'un seul arrêt de conversation**, l'IPC
`abort_super_agent`. C'est donc lui, et rien d'autre, qui doit être emprunté par
la voix. Aucun état à réinventer : tout ce qui suit l'arrêt (texte déjà écrit,
file de missions, journal, état « Prêt ») passe déjà par ce chemin.

## 2. Branchement — ce qui a été fait, et où

### 2.1 Le chemin d'arrêt est devenu une fonction partagée (`src/js/super-agent.js`)

- Le corps du handler `abort` a été **extrait** tel quel dans
  `stopSuperAgentTurn()` (`super-agent.js:4379`), marqueur
  `R3-EXCEPTION-MANUEL` conservé et élargi à la voix. Le bouton Stop l'appelle
  (`super-agent.js:4400`) et la prise de parole l'appelle aussi
  (`super-agent.js:4124`, en `void` : la mesure micro ne doit pas attendre).
  **Un seul `invoke("abort_super_agent")` dans cette fonction**, aucun IPC écrit
  dans la fonction de coupure vocale → cardinalité des sites d'arrêt
  **inchangée** (3 sites : 2 automatiques tracés + 1 manuel partagé).

### 2.2 La décision « quoi interrompre » est une fonction pure

`vocalInterruptTarget({ speaking, reflecting })` (`super-agent.js:496`) →
`"lecture" | "reflexion" | ""`. Elle suit **la priorité des états déjà
affichée** (`vocalScreenState`) : parole > réflexion > repos. `vocalBargeIn`
(`super-agent.js:4099`) ne fait plus que l'appliquer : `stopReading()` pour la
lecture (lot 4a, inchangé) ou `stopSuperAgentTurn()` pour la réflexion, puis
l'état de l'écran et le curseur dans la zone de saisie (inchangés).

### 2.3 La garde du micro (aucune seconde garde)

`src/js/vocal-mic.js` — **même** fonction `stepSpeechGate`, **même** signal
`onSpeechStart`, **même** moteur. On y a ajouté une **phase** :

- `setThinking(actif)` : état reposé par l'appelant, jamais deviné. À la fin de la
  réflexion, la mesure de continuité repart de zéro, mais un verrou de coupure
  **déjà posé** le reste jusqu'à ce que la voix retombe.
- branche réflexion : **aucun calibrage** (Pilot est muet, il n'y a pas d'écho à
  mesurer), **aucune** condition d'annulation d'écho, uniquement les **deux
  règles existantes** — plancher de bruit `BARGE_IN_MIN_LEVEL` (0,05) et voix
  **continue** `BARGE_IN_MIN_MS` (200 ms).
- **réarmement** : quand la voix retombe sous le seuil, le verrou s'ouvre → une
  coupure **par prise de parole**, jamais deux pour la même phrase.
- `bargeInReport()` gagne un champ `pendant` (`"lecture" | "reflexion" | ""`) pour
  que la vérification au vrai micro distingue les deux cas ; les champs existants
  sont conservés.

Côté écran : `vocalSyncMicThinking()` (`super-agent.js:4072`) pousse
`reflectingActive` — **le même signal que l'écran** (`agent_start` / `agent_end`)
— dans le moteur, depuis `superSetReflecting` et depuis l'entrée du mode.
`createVocalMic(` reste à **une seule occurrence**.

## 3. Garde-fous tenus

| Exigence | Comment elle est tenue |
|---|---|
| Une seule coupure par prise de parole | verrou `declenche` + réarmement à la retombée (testé) |
| Jamais sur un bruit court | voix **continue** 200 ms (testé : 1 image, éclats séparés) |
| Jamais sur silence / souffle | plancher 0,05 (testé : 10 s de silence, 10 s de souffle) |
| Jamais sur la voix de Pilot | la lecture garde le calibrage, le seuil au-dessus du résidu et le désarmement si l'écho n'est pas prouvé (testé : lecture + réflexion simultanées) |
| Aucun nouveau seuil / réglage | test de source : la branche réflexion ne contient **aucun** littéral décimal, aucune constante de calibrage, aucun stockage/config |
| Aucun second mécanisme d'arrêt | un seul `invoke("abort_super_agent")` partagé, un seul `stopReading()` |
| Aucun agent fantôme, file tenue | l'arrêt emprunte le chemin existant : `agent_end`, `keepQueuedRunAgentsMissions`, journal des arrêts — rien de court-circuité |
| Texte déjà produit restitué | idem : la restitution est celle du tour arrêté, pas une nouvelle |
| Hors mode Vocal, rien ne change | `if (!vocalOverlay) return;` en tête de `vocalBargeIn` (testé) |
| Écran Vocal inchangé | test de source : aucun `data-action` ajouté, phrases d'état et priorité identiques |
| Un seul micro | `createVocalMic(` = 1 (test existant, toujours vert) |

## 4. Tests

Nouveau fichier : **`src/js/vocal-couper-la-reflexion.test.js`** (21 tests,
découpage de source via `sliceSource` uniquement — les tests du projet interdisent
un découpage calculé à la main).

1. **Chemin réutilisé** : un seul IPC d'arrêt dans la fonction partagée, un seul
   `resetDeferredSound()`, marqueur d'arrêt manuel présent, clic Stop et voix sur
   la **même** fonction, cardinalité des sites d'arrêt inchangée (3), aucun IPC
   dans la coupure vocale, aucun `setTimeout` (pas de second essai).
2. **Décision** : parole > réflexion > rien (valeurs approchées → rien).
3. **Garde** : silence 10 s = 0 coupure ; souffle 10 s = 0 ; une image de bruit =
   0 ; éclats séparés = 0 ; voix continue = **1** coupure (entre 200 et 240 ms) ;
   continuer de parler = 0 de plus ; retombée puis nouvelle phrase = 1 de plus ;
   **aucun calibrage** (coupure avant 600 ms) ; lecture + réflexion simultanées =
   règles de lecture (aucune coupure pendant le calibrage, désarmement si l'écho
   n'est pas maîtrisé).
4. **Moteur** (faux micro complet : flux, analyseur piloté, horloge virtuelle) :
   pendant la réflexion, une voix continue → **un seul** signal ; hors réflexion
   → **aucun**.
5. **Branchement** : `reflectingActive` est la seule source, un seul appel de
   `setThinking`, état reposé à l'entrée du mode, micro unique, `onSpeechStart`
   inchangé.
6. **Non-régression** : écran inchangé (aucun bouton, phrases et priorité
   identiques), aucun réglage ni stockage, la coupure de lecture reste un arrêt
   d'écoute.

Deux tests **existants** ont été ajustés, avec justification écrite en tête de
fichier / en commentaire (aucune assertion supprimée sans raison) :

- `ecran-vocal-lot2.test.js` : la garde « Pilot ne parle pas → on ne coupe pas »
  est désormais portée par la décision unique `vocalInterruptTarget` (même
  exigence, un seul endroit à lire, deux états servis).
- `ecran-vocal-lot4a.test.js` : l'assertion interdisant tout mot « abort » dans la
  coupure vocale devient « aucun IPC/arrêt d'agent écrit **ici** » (l'arrêt de
  travail passe par la fonction partagée, jamais par un IPC local).

## 5. Résultats

```
npx vitest run          → PASS (3651) FAIL (0)
npm run build:handbook  → ✅ 46 blocs, handbook régénéré
```

Aucune modification Rust : le chemin d'arrêt côté serveur (`abort_super_agent`)
est utilisé tel quel, donc `cargo test` n'est pas concerné par cette micro-tâche.

## 6. Documentation

- `spec_modes_ecran_vocal.md` : statut (lot 4b), §4 (la priorité décide aussi de
  ce qui est interrompu), **§6 réécrit** en 6.1 lecture / 6.2 réflexion / 6.3
  commun, §7 (les protections d'écho ne concernent que la lecture, l'exigence de
  voix continue vaut pour les deux), §9 (la réorientation n'est toujours pas
  faite, mais le travail en cours est bien arrêté), §10 (fichiers et verrous),
  §11 (ce qui est prouvé).
- `help/overview.md`, bloc `<!-- HELP:modes-ecran -->` : une puce utilisateur
  (« Parler pendant qu'il travaille l'arrête aussi »), puis
  `npm run build:handbook`.

## 7. Ce qui n'a pas été touché

Apparence de l'écran Vocal, ligne d'état, détection de parole, lecture à voix
haute, mode « Assistant seul », colonne de gauche, menu du bas, logo. Aucun
bouton, aucun réglage, aucune option, aucun message d'interface ajouté. Aucun
arrêt forcé hors du cas visé. Rien de publié, aucune version changée, rien de
poussé.
