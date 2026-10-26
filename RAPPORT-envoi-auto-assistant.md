# RAPPORT — Envoi automatique en fin de dictée dans l'Assistant 🧭

> Suite du premier pas livré dans l'onglet agent π (commit `108038e`, module
> `src/js/voice-auto-send.js`, rapport `RAPPORT-envoi-auto-fin-dictee.md`).
> Objectif : **le même comportement** dans la barre de saisie de l'Assistant 🧭,
> en **réutilisant** le module déjà livré — aucun second mécanisme, aucune copie
> de logique.
> Rapport écrit **avant** les tests longs ; les résultats figurent au §6.

---

## 1. Constat — la barre de l'Assistant, avant modification

Fichier lu en entier : `src/js/super-agent.js`. Lignes réelles au moment du constat
(commit de départ `eb67977`) :

```
2920  <button class="agent-btn agent-mic-btn" data-action="voice" title="Dictée vocale (transcription cloud)" …>
3293  // ── Dictée vocale (Web Speech API) — comme l'agent standard ──
3300  let voiceActive = false;
3303  function stopVoiceInput() {
3305    voiceActive = false;
3315  function toggleVoiceInput() {
3318    if (voiceActive) { stopVoiceInput(); return; }
3351    inputEl.value = preText + sep + transcript;            // rec.onresult
3355    voiceActive = false; voiceRec = null;                  // rec.onerror
3364    const wasActive = voiceActive;                          // rec.onend
3365    voiceActive = false; voiceRec = null;
3369    inputEl.value = preText + sep + finalText;              // et RIEN d'autre
3682  async function send() { … }                               // chemin d'envoi existant
3719    if (voiceActive) stopVoiceInput();                      // garde interne de send()
3786  inputEl.addEventListener("keydown", …)  → send()  (Entrée)
3792  inputBar.querySelector('[data-action="send"]') → send()  (bouton ▶️)
3799  inputEl.addEventListener("input", …)                     // auto-resize seulement
```

Traduction : la barre de l'Assistant **dicte bien** (même moteur, même langue, même
`continuous = true`), mais à la fin d'une dictée elle **réécrit seulement la zone**
(`inputEl.value = preText + sep + finalText`) : **aucun envoi**. L'utilisateur doit
appuyer sur Entrée. Exactement le défaut corrigé dans l'onglet π en `108038e`.

Deux écarts supplémentaires entre les deux barres, lus dans le source :

| Point | Agent π (`agent-pi.js`) | Assistant 🧭 (`super-agent.js`) |
|---|---|---|
| Décision d'envoi | délègue à `applyVoiceEnd` (`voice-auto-send.js`) | **absente** |
| Reprise en main pendant l'écoute (`voiceUserTookOver`) | détectée (`input` pendant l'écoute) et **respectée** | **absente** : le moteur réécrit la zone à chaque résultat |
| Libellé du bouton micro rétabli en fin d'écoute (`MIC_TITLE_IDLE`) | oui (onerror / onend / stop) | non : il reste « Arrêter la dictée » après la fin |

## 2. Geste fait (minimal, un seul endroit décide)

| Endroit | Ce qui change |
|---|---|
| `src/js/super-agent.js` (imports) | `import { applyVoiceEnd } from "./voice-auto-send.js";` — le module **déjà livré**, aucune copie |
| `super-agent.js` (`rec.onend`) | lit `wasActive` **avant** toute fermeture, puis délègue l'ordre et la décision à `applyVoiceEnd({ sessionActive, preText, dictatedText, userEdited, closeSession, write, send })`, où `send` est `() => { send(); }` : le **chemin d'envoi existant** (Entrée / bouton ▶️). La réécriture de la zone passe par `write` (qui inclut l'auto-resize). |
| `super-agent.js` (`rec.onresult`) | garde `if (voiceUserTookOver) return;` **avant** l'écriture : même règle de reprise en main que l'onglet π (les écritures du moteur sont programmatiques et n'émettent aucun `input`, donc tout `input` reçu pendant l'écoute vient de l'utilisateur) |
| `super-agent.js` (état de dictée) | `voiceUserTookOver` (détecté par un listener `input`), remis à `false` au début de **chaque** dictée ; `MIC_TITLE_IDLE` rétabli en fin d'écoute (onerror / onend / stop) |
| `voice-auto-send.js` | **aucune modification** : le module servait déjà les deux appelants tels quels (il ne connaît ni le DOM ni l'envoi, seulement l'ordre et la décision) |

Aucun réglage, aucun bouton, aucun libellé d'action ajouté. `src-tauri/src/agents.rs`
non touché. `web/js/app.js` **non touché** (voir §5).

## 3. Ce qui est commun avec le chat de l'agent, et ce qui diffère

**Commun (par construction, même code) :** la décision (`decideVoiceAutoSend`) et
l'ordre (`applyVoiceEnd` : refermer la session → écrire la zone → envoyer), donc les
règles de sûreté sont **les mêmes** : jamais de texte vide/blanc, jamais après une
erreur / un refus / un arrêt manuel, jamais deux fois, jamais par-dessus une saisie
reprise à la main. Le `send` reste le chemin d'envoi existant du fichier.

**Différent (et c'est pour ça que seule la décision est partagée) :**

| Point | Agent π | Assistant 🧭 |
|---|---|---|
| Chemin d'envoi | `sendPrompt()` | `send()` — **asynchrone**, avec ses gardes propres : question en attente (`hasPendingQuestion` → `validatePendingQuestion`), règle de démarrage (`canAssistantReflect`), occupation (`isStreaming`/`backendBusy`) |
| Effet d'un refus d'envoi | `sendPrompt` renvoie tôt | `send()` **conserve** la saisie dans le champ et l'explique (message système) — comportement inchangé, l'envoi auto ne le contourne pas |
| Zone | `autoResizeTextarea()` | `resizeInput()` |
| Sensible / local-first | dictée bloquée si projet sensible | pas de blocage (l'Assistant n'est pas rattaché à un projet ouvert) |

Conséquence assumée : `applyVoiceEnd` rend `sent: true` quand il **appelle** le
chemin d'envoi. Si `send()` refuse ensuite (Assistant déjà occupé par un tour venu
d'ailleurs), rien ne part mais **le texte dicté reste dans la zone** — c'est le
comportement voulu de `send()`, pas une perte.

## 4. Tests — renforcement du fichier existant

`src/js/envoi-auto-fin-dictee.test.js` (aucun second fichier de test créé ; il est
passé de 22 à **37 cas**) reçoit :

1. un harnais `createAssistantWindow` qui reproduit la barre de l'Assistant (dont
   les gardes réelles de `send()` : texte trimé vide ⇒ rien, occupation ⇒ rien) ;
2. les cas de bout en bout : fin normale ⇒ **un seul** envoi par le chemin
   existant ; fin signalée deux fois ⇒ un seul envoi ; erreur / refus / arrêt
   manuel ⇒ aucun envoi et texte conservé ; texte vide/blanc ⇒ rien ; reprise en
   main ⇒ saisie intacte, rien ne part ;
3. les verrous de **câblage** lus dans `super-agent.js` : import du module, ancre
   `const wasActive = voiceActive;` avant `closeSession`, `send: () => { send(); }`
   (une seule occurrence), aucune décision recopiée (`decideVoiceAutoSend` absent),
   `voiceUserTookOver` détecté + garde avant l'écriture + transmis en `userEdited` ;
4. une assertion croisée : **les deux** appelants importent le **même** module et
   aucun des deux ne contient `decideVoiceAutoSend`.

Sabotages réels appliqués puis retirés (preuve que les nouveaux cas mordent) : voir
§6.

## 5. Ce qui reste à faire (dit franchement)

- **Version web distante** (`web/js/app.js`, lignes ~1780/1862) : sa dictée garde le
  comportement d'avant (texte dans la zone, envoi manuel). **Non touchée**, comme
  demandé — reste à faire dans une tâche dédiée.
- `web/js/app.js` a sa propre copie de la logique d'écoute : la brancher sur le
  module partagé suppose de vérifier son contexte (navigateur mobile, HTTPS), donc
  ce n'est pas un simple import.
- Rien n'a été poussé, aucun tag, aucune version changée.
- Commit de cette tâche : uniquement mes fichiers (`super-agent.js`, le fichier de
tests, `spec_voice_input.md`, `AGENTS.md`, `RAPPORT-envoi-auto-assistant.md`) et le
`help/handbook.md` **régénéré** — ce dernier reflète aussi une modification de spec
déjà présente dans le worktree (`spec_read_aloud.md`, tâche d'un autre agent, non
committée par moi). Les autres fichiers modifiés du worktree (`agents.rs`,
`read-aloud.js`, `repli-voix-muet.test.js`, `spec_read_aloud.md`, `help/overview.md`)
ne sont **pas** de moi et n'ont pas été touchés.

## 6. Vérifications

| Vérification | Résultat |
|---|---|
| `npx vitest run src/js/envoi-auto-fin-dictee.test.js` | **37 tests, 0 échec** (22 précédents + 15 nouveaux) |
| `npm test` (suite complète) | **195 fichiers, 3465 tests, 0 échec** (`PASS (3465) FAIL (0)`) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passés, 1 ignoré, 0 échec** |
| `npm run build` (vite) | **OK** (`✓ built in 13.03s`, seuls des avertissements de chunks préexistants) |
| `npm run build:handbook` | **OK** (45 blocs) |
| `node --check src/js/super-agent.js` | OK |
| `node --check src/js/voice-auto-send.js` | OK (module inchangé) |

Sabotages réels (code cassé exprès, tests relancés, code restauré depuis une copie
vérifiée par `diff`, puis suite re-verte) :

| Sabotage | Tests tombés |
|---|---|
| `super-agent.js` : `rec.onend` réécrit la zone comme avant, sans appeler `applyVoiceEnd` | 3 |
| `super-agent.js` : ligne `send: () => { send(); }` retirée (envoi auto supprimé) | 1 |
| `super-agent.js` : `sessionActive: wasActive` remplacé par `sessionActive: true` (envoi possible après une erreur) | 1 |
| `super-agent.js` : `userEdited: voiceUserTookOver` retiré (reprise en main ignorée) | 1 |
| `super-agent.js` : garde `if (voiceUserTookOver) return;` retirée de `rec.onresult` | 1 |
| `voice-auto-send.js` : `decideVoiceAutoSend` renvoie toujours `autoSend: false` | 10 |

Lecture des sabotages : les cas **de bout en bout** (harnais des deux barres) tiennent
la **règle** (le module) — 10 tests tombent dès que le module cesse d'envoyer. Les
cas de **câblage** tiennent le **branchement du fichier** — chacun des sabotages de
`super-agent.js` fait tomber au moins un test, aucun ne passe inaperçu.

**Non vérifiable ici** : la dictée **avec un micro réel** dans la fenêtre de Pilot
(aucun son, aucune application lancée dans cet environnement). Le comportement est
prouvé par la décision pure, l'ordre testé et le câblage lu dans le source — jamais
par une parole réelle.

## 7. Documentation mise à jour

- `spec_voice_input.md` §5bis : portée étendue aux **deux** barres desktop, chemin
d'envoi dit par barre, règles 5 à 7 ajoutées, preuve chiffrée (37 cas, sabotages),
« reste à faire » réduit au **web distant**.
- Bloc `<!-- HELP:dictee-vocale -->` (visible par l'utilisateur) : « Dans l'onglet
agent Pi **ET dans l'Assistant 🧭**… », + une ligne disant que **sur le web distant**
l'envoi reste manuel. `npm run build:handbook` relancé (45 blocs ; `help/handbook.md`
est généré, jamais édité à la main).
- `AGENTS.md` (arborescence, source unique) : la description de `voice-auto-send.js`
dit maintenant les **deux** appelants (`sendPrompt` / `send()`).

## 8. Conclusion

La barre de saisie de l'Assistant 🧭 se comporte maintenant comme celle de l'onglet
agent π : à la fin normale d'une dictée, le texte reconnu part **une seule fois**,
par le chemin d'envoi de toujours ; si le texte est vide, si la dictée échoue, est
refusée ou est interrompue, ou si l'utilisateur a repris la main, **rien ne part** et
la zone garde ce qu'il voit. La décision reste dans **un seul** fichier
(`voice-auto-send.js`), inchangé.
