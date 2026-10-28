# Rapport — écran Vocal nu (aucun échange affiché)

Décision du propriétaire du **2026-10-28** : l'écran **Vocal** ne montre **plus
aucun échange** de la conversation. On n'y voit que l'objet lumineux, le trait de
niveau, l'unique ligne d'état et la barre de saisie. La lecture à voix haute
devient le seul moyen d'entendre la réponse — elle continue de fonctionner.

Commit local unique (aucun push, aucun tag, aucune publication, aucune version
bumpée) : `feat(vocal): bare Vocal screen — no conversation shown, read-aloud stays fed`.

## 1. Ce qui a été retiré — après localisation, pas avant

**Audit mené d'abord** (règle : localiser ce qui joue le rôle d'« échanges »
avant de couper). Résultat de l'audit dans `src/js/super-agent.js` :

- `buildVocalOverlay()` construit l'écran et **rien d'autre** : `.vocal-top`,
  `.vocal-stage` (`.vocal-orb`, `.vocal-level` + `.vocal-level-bar`,
  `.vocal-status`, `.vocal-mic-fix` caché), `.vocal-input`. Aucun conteneur de
  messages, aucune bulle, aucune zone d'historique.
- `enterVocal()` ne déplace que **deux** nœuds existants : la barre de saisie
  (`inputBar`) et le bouton unique des modes (`#screen-mode-button`). Le reste de
  l'onglet (conversation, barre d'outils, bandeaux d'attente) **reste dans
  l'onglet**.
- `applyVocalState()` n'écrit dans la ligne d'état que les trois phrases de
  l'écran (`vocalStatusText(state)`), ou le message clair du micro fermé. Jamais
  un message de la conversation.

Il n'existait donc **aucun affichage d'échange propre à cet écran** : la
conversation était seulement **laissée en place derrière** l'overlay, rendue
invisible par son seul fond opaque. C'était une promesse tenue par **une couleur**
— un thème, une règle CSS translucide ou un futur déplacement de nœud suffisait à
faire réapparaître les messages.

**Ce qui a donc été retiré, concrètement** : la conversation n'est plus
seulement *cachée par le fond*, elle est **explicitement retirée de la peinture**
pendant le mode. `src/css/style.css` (section de l'écran Vocal, juste après
`.pilot-vocal-active`) :

```css
body.pilot-vocal-active .agent-chat-messages {
  visibility: hidden;
}
```

Choix techniques motivés (un `display: none` aurait été plus « propre » à lire,
mais faux ici) :

| Choix | Pourquoi |
|---|---|
| `visibility: hidden` | Les **mesures de défilement** de la conversation restent intactes : en quittant le mode, l'historique n'est pas remis en haut et aucune reprise de position n'est nécessaire. |
| Pas de `display: none` | Même raison, plus le risque de voir `scrollHeight = 0` et de casser les `scrollSuperToBottom()` qui arrivent pendant le mode. |
| Aucun nœud déplacé / détruit | Rien n'est à restaurer, donc rien ne peut être mal restauré ; les écouteurs (scroll, lecture, relais) ne sont pas déplacés. |
| Aucun réglage, aucun bouton, aucun écran | La règle est inconditionnelle : on ne peut pas « réactiver » l'affichage des échanges. |

## 2. Comment la lecture à voix haute reste alimentée

Vérifié, pas supposé. En mode Vocal, `autoReadVocalReply()` (appelée à la fin
d'une réponse) actionne **le bouton « 🔊 Écouter » déjà posé sous la dernière
réponse** — le même bouton, le même module `read-aloud.js`, le même nettoyage de
texte (`speech-text.js`), les mêmes voix, une seule lecture à la fois :

```js
messagesEl.querySelectorAll(".agent-message-assistant .agent-read-btn")  // 1) le bouton
bouton.click()                                                          // 2) on l'actionne
```

- La source du texte est **la conversation de l'onglet**, pas un élément de
  l'écran : l'écran peut donc être nu sans que la lecture devienne muette.
- `autoReadVocalReply()` ne contient **aucun** `speechSynthesis`, aucun
  `SpeechSynthesisUtterance`, aucun `.speak(` : pas de second lecteur.
- Elle ne cherche **aucun** élément de l'écran (`.vocal-orb`, `.vocal-status`,
  `.vocal-stage`, `.vocal-input`, `vocalOverlay.querySelector`) : elle ne dépend
  de rien de ce qui est affiché.
- `.click()` sur un nœud en `visibility: hidden` **fonctionne** (l'évènement est
  bien distribué ; `read-aloud.js` ne fait aucune mesure de visibilité — ni
  `IntersectionObserver`, ni `offsetParent`, ni `getBoundingClientRect`) : la
  règle CSS ne peut pas rendre la lecture muette.
- L'état « Pilot parle » de l'écran reste celui de `READ_ALOUD_STATE_EVENT`
  (seule source), donc la couleur de l'objet, la ligne d'état et la garde
  anti-auto-coupure du micro ne changent pas.

## 3. Tests adaptés (aucun supprimé)

**Aucun test n'a été supprimé** : aucun test n'affirmait la *présence*
d'échanges sur cet écran. Au contraire, `ecran-vocal-lot2.test.js` §6
(« l'écran ne montre RIEN de la conversation ») interdisait déjà `/message/i`
dans `buildVocalOverlay()` — il est conservé tel quel et reste vert.

Ajouté : **`src/js/ecran-vocal-nu.test.js`** (15 assertions, 7 groupes), qui
interdit le **retour** des échanges et verrouille ce qui doit rester :

1. le balisage de l'écran contient l'objet, le trait, la ligne d'état, le bouton
   de dépannage du micro et la saisie — et **aucun** `agent-message`,
   `agent-chat-messages`, `agent-tool-call`, `messagesEl`, `markdown` ;
2. `enterVocal()` ne déplace que `inputBar` et le bouton des modes ; aucun
   `messagesEl` / `toolbar` / `pendingBar` / `busyHint` / `statusEl` / `wrapper`,
   aucun `innerHTML`, aucun `textContent` (rien de la conversation n'« entre »
   dans l'écran) ;
3. la ligne d'état ne reçoit que `vocalStatusText(state)` ou le message du micro
   fermé, jamais un texte de message ;
4. la lecture à voix haute garde la même source (le bouton de la dernière
   réponse), n'a aucun second lecteur et ne cherche aucun élément de l'écran ;
5. la conversation est invisible pendant le mode (`visibility: hidden`, et
   **pas** `display: none`) et l'overlay reste opaque et plein écran ;
6. ce que l'écran nu doit **garder** : objet 168 px, trait 200 px, saisie
   `min(720px…)`, les trois sorties (bouton des modes, Échap, fermeture de
   l'onglet) et le mouvement réduit — pour qu'un futur nettoyage ne les emporte
   pas avec la conversation ;
7. la règle est écrite noir sur blanc dans la spec et dans l'aide intégrée.

Le fichier utilise `sliceSource` (jamais un `.slice(indexOf…)` non protégé) et
normalise les fins de ligne en LF (piège CI Windows, quality-gate §3.4).

## 4. Documentation

- `spec_modes_ecran_vocal.md` § 3 : intitulé devenu « L'écran Vocal, de haut en
  bas — **un écran nu** », deux paragraphes ajoutés (la règle ferme du
  2026-10-28 + où retrouver la conversation ; la lecture à voix haute comme seule
  porte de la réponse et les trois verrous qui tiennent la règle). La phrase de
  clôture interdit maintenant aussi « un résumé des derniers échanges ».
- `help/overview.md`, bloc `<!-- HELP:modes-ecran -->` : le mode **Vocal** est
  présenté comme un **écran nu**, et la section rappelle que la réponse s'entend
  par la lecture à voix haute.
- `help/handbook.md` **régénéré** : `npm run build:handbook` → 46 blocs,
  283 237 octets.

## 5. Vérifications

```
npm test                            → 201 fichiers, 3630 tests, 0 échec (dont les 15 nouveaux)
npm run build:handbook              → handbook régénéré (46 blocs)
npm run build                       → ✓ built in 12,16 s (avertissements de découpage
                                      de chunks préexistants, sans rapport)
```

## 6. Non touché (périmètre respecté)

Objet lumineux et ses quatre états, trait de niveau, ligne d'état, barre de
saisie, les trois sorties du mode, mouvement réduit, détection de la parole
(`vocalCapte` / `vocalVoiceStep` / `vocal-mic.js`), état de l'écran, réglages
existants, mode « Assistant seul », colonne de gauche, menu du bas. Aucun écran,
bouton ou réglage créé. Aucun push, aucune publication, aucune version bumpée.

## 7. Fichiers modifiés

- `src/css/style.css` (une règle + son commentaire de décision)
- `src/js/ecran-vocal-nu.test.js` (nouveau)
- `spec_modes_ecran_vocal.md` § 3
- `help/overview.md` (bloc HELP `modes-ecran`) et `help/handbook.md` (généré)
- `RAPPORT-ecran-vocal-nu.md` (ce rapport)
