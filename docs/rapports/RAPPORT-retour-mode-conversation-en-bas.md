# Rapport — la conversation retrouve sa place au retour d'un plein écran

**Date** : 2026-11-16 (premier correctif) · **2026-11-17** (deuxième correctif)
**Symptôme rapporté par le propriétaire** : en passant du mode **Vocal** au mode
**Détaillé**, la conversation se réaffichait **tout en haut** de la liste ; il
fallait faire défiler jusqu'en bas pour retrouver les derniers échanges.
**Signalé une seconde fois après le premier correctif** — d'où ce rapport en deux
temps, qui dit aussi pourquoi le premier ne tenait pas dans l'application réelle.

---

## 1. Première cause (lue dans le code, pas devinée)

Le plein écran **ne déplace pas** la conversation : `enterVocal()` / `exitVocal()`
ne touchent jamais au nœud `messagesEl`. En mode Vocal, `.agent-chat-messages`
est simplement rendu **invisible** (`visibility: hidden`, `src/css/style.css`),
ce qui **préserve ses mesures**.

Le défaut venait d'ailleurs, de deux faits qui se combinent :

1. **Le bouton des modes est un cycle** : Détaillé → Assistant seul → Vocal →
   Détaillé. Pour atteindre le mode Vocal, on **traverse** « Assistant seul »,
   dont la sortie exécute `exitImmersive()`.
2. **`exitImmersive()` déplace `messagesEl`** (`wrapper.insertBefore(messagesEl,
   toolbar)`). Or **déplacer un nœud défilable dans le DOM remet son `scrollTop`
   à 0** : la position de lecture est perdue à cet instant précis, pendant que
   l'écran Vocal est encore affiché. À la sortie du mode Vocal, `exitVocal()` ne
   restituait rien : la conversation réapparaissait avec `scrollTop = 0`, c'est-à-dire
   **tout en haut**.

L'entrée en « Assistant seul » était déjà corrigée à la main (issue #82 : on
force le bas à l'entrée), mais **aucune sortie** ne restituait quoi que ce soit.

## 2. Premier correctif (toujours en place, il reste nécessaire)

| Endroit | Ce qui est fait |
|---|---|
| `exitImmersive()` | **photographie** de la position AVANT les déplacements de nœuds, **restitution** en dernière instruction (après le retrait de l'overlay) |
| `exitVocal()` | même chose, en dernière instruction (après le retrait du calque et de la classe de mode) |

- `memoizeSuperScroll(messagesEl)` — la photographie, prise **avant** que
  l'information n'existe plus (après le déplacement, `scrollTop` vaut 0) ;
- `restoreSuperScroll(messagesEl)` — la position rendue **une seule fois** (la
  photographie est consommée), et le suivi automatique du bas (`superAtBottom`)
  **ré-armé** avec la valeur réelle.

La décision (« quelle position rendre ») est **pure** et vit dans
`src/js/conversation-scroll.js` (aucun DOM, aucun import, aucun minuteur, aucun
stockage).

| Situation | Décision | Effet |
|---|---|---|
| il était **en bas** (seuil de 60 px) | on rend **le bas réel du contenu d'aujourd'hui** | il retrouve le fil, **même** si des messages sont arrivés pendant le plein écran |
| il avait **remonté** pour relire | on rend **sa position exacte**, bornée à ce qui est encore atteignable | ni saut en haut, ni saut en bas arbitraire |
| aucune photographie | `null` | on ne touche à rien : aucun saut inventé |

`CONVERSATION_SCROLL_BOTTOM_THRESHOLD` (60 px) est la **seule** valeur du seuil :
`SUPER_SCROLL_BOTTOM_THRESHOLD` la lit, et `shouldScrollSuperToBottom` délègue à
`conversationAtBottom`. La règle de l'issue #60 (« ne pas forcer le bas si
l'utilisateur a remonté ») est **inchangée**.

---

## 3. Deuxième cause — la mise en page n'est pas finie à l'instant de l'écriture

Le premier correctif décidait la position sur `clientHeight` / `scrollHeight` lus
**à l'instant même** de la sortie. Or cet instant **n'est pas** celui de la mise
en page **définitive** : dans le même tour, « Détaillé » remet en place la barre
de saisie (`wrapper.appendChild(inputBar)`), la rangée des questions
(`wrapper.appendChild(pendingBar)`), la conversation elle-même, le logo et
l'entrée « Travail » (sortis de l'overlay), puis retire l'overlay et la classe de
mode.

**Conséquence** : si la géométrie est encore **transitoire** — typiquement le
contenu mesuré comme **non débordant** (`scrollHeight <= clientHeight`, donc
`conversationScrollMax()` = 0) —, la décision rend **`0`** et la conversation est
écrite **tout en haut**. Une fois la mise en page stabilisée, **plus rien ne la
corrige** : elle reste en haut. C'est exactement le symptôme rapporté la seconde
fois.

C'est un défaut de **timing**, pas de décision : la décision est juste, elle est
calculée sur une géométrie qui ne sera pas celle qui sera peinte.

## 4. Deuxième correctif — la même décision, rejouée sur la géométrie réelle

Rien n'a été dupliqué : la **même** fonction pure tranche, à un second moment.

- **Nouvelle fonction pure** dans `src/js/conversation-scroll.js` :
  `conversationScrollReplayTarget(snapshot, applied, currentTop, clientHeight,
  scrollHeight)`. Trois règles, dans l'ordre :
  1. rien à restaurer / aucune position atteignable → `null` (aucune écriture
     inventée) ;
  2. la position déjà écrite est **déjà** celle que la mise en page demande →
     `null` (aucune écriture inutile, donc aucun clignotement) ;
  3. elle est fausse **et** l'utilisateur a déplacé la conversation depuis notre
     écriture alors qu'il ne cherchait pas le bas → `null` (sa main l'emporte).
     S'il cherchait le bas, le bas reste sa position.
- **Nouveau geste** dans `super-agent.js` : `replaySuperScrollAfterLayout(...)`,
  appelé en fin de `restoreSuperScroll`, sur le **signal de rendu**
  `requestAnimationFrame` (exécuté **juste avant la peinture** — ce n'est ni une
  temporisation arbitraire, ni un second avis, et un signal existait : c'est
  celui qu'utilise déjà le rendu du flux de texte, `text_delta`).
  - **une seule** demande de rendu : aucune boucle, aucun `setTimeout`, aucun
    `setInterval` ;
  - **aucun défilement animé** (`scrollTo`, `behavior: smooth`) : la position est
    posée, la correction est donc **invisible** (elle n'est jamais peinte) ;
  - **annulée** si l'onglet a été démonté entre-temps (`isConnected`) ou si
    l'environnement n'a pas de rendu ;
  - `restoreSuperScroll` reste la **dernière instruction** de `exitImmersive()`
    **et** de `exitVocal()` : les **trois** voies de sortie du mode Vocal (le
    logo, `Échap`, la fermeture de l'onglet 🧭) passent toutes par `exitVocal()`
    et ont donc **exactement** le même comportement.

## 5. Ce qui n'a pas changé

- L'apparence, la disposition, le portrait, les colonnes, la barre de saisie, les
  boutons, l'état nu, le bas qui s'efface : **rien**.
- L'entrée en « Assistant seul » continue de forcer le bas (issue #82).
- Aucun réglage, aucune clé de stockage, aucun nouveau bouton, aucune version
  touchée (ni `package.json`, ni `Cargo.toml`, ni `tauri.conf.json`, ni `Cargo.lock`).
- Le réglage des mots de réveil et la garde du nom : **non touchés**.
- Le défilement manuel de l'utilisateur : **jamais** écrasé (règle 3 ci-dessus,
  et le verrou le vérifie).

## 6. Les verrous (ils échouent sans le correctif, c'est vérifié)

| Fichier | Ce qu'il tient |
|---|---|
| `src/js/conversation-scroll.test.js` (12 tests, inchangé) | la décision pure et le branchement photographie/restitution des deux sorties, seuil unique, aucun déplacement ajouté |
| `src/js/retour-mode-conversation-en-bas.test.js` (14 tests, **nouveau**) | le cas **géométrie transitoire** (la décision rend 0 → le rendu rend le bas), le contenu qui a grandi, la mise en page déjà juste (aucune réécriture), l'absence de photographie, la **relecture jamais écrasée**, le seuil unique conservé, le **branchement réel**, le **signal de rendu au lieu d'un minuteur**, l'annulation si l'onglet est démonté, et les trois voies de sortie |

**Preuve que le verrou est réel** (mutation faite puis annulée) : en retirant
l'appel `replaySuperScrollAfterLayout(messagesEl, memo, cible);` de
`restoreSuperScroll`, le nouveau fichier **échoue** sur
« la restitution appelle la vérification de rendu » ; avec l'appel, il passe.
De même, neutraliser les `restoreSuperScroll` fait échouer deux tests de
`conversation-scroll.test.js`.

## 7. Éprouver à la main (le geste exact)

1. `npm run tauri dev`, ouvrir l'onglet 🧭, avoir une conversation **assez longue
   pour défiler** (au moins deux écrans).
2. **Voie du logo** : descendre jusqu'aux derniers échanges → cliquer le logo
   (→ « Assistant seul ») → cliquer (→ « Vocal ») → cliquer (→ « Détaillé »).
   La conversation doit être **sur les derniers échanges**, posée sans saut et
   sans clignotement.
3. **Voie `Échap`** : entrer en « Vocal », appuyer sur `Échap` → même résultat.
4. **Voie « fermer l'onglet »** : entrer en « Vocal », fermer l'onglet 🧭, le
   rouvrir → même résultat.
5. **Contre-épreuve — il relisait** : remonter dans la conversation, changer de
   mode, revenir : on retrouve **le passage**, ni en haut ni en bas.
6. **Contre-épreuve — il lit, il ne change pas de mode** : remonter, laisser
   arriver des messages (l'agent travaille) : rien ne doit bouger (issue #60).
7. **Contre-épreuve — le contenu grandit** : entrer en « Vocal » pendant que
   l'assistant écrit, attendre la fin de la réponse, sortir : on arrive **sur le
   bas**, dernière réponse comprise.

## 8. Vérifications lancées (cette session)

```
npx vitest run src/js/retour-mode-conversation-en-bas.test.js   # 14/14
npx vitest run src/js/conversation-scroll.test.js \
              src/js/super-agent-scroll.test.js                 # vert
npm test                                                        # 298 fichiers, 5531 tests, tous verts
cargo test --manifest-path src-tauri/Cargo.toml --lib             # 900 passés, 3 ignorés
npm run build:handbook                                          # 48 blocs, handbook régénéré
```

## 9. Documentation mise à jour

- `spec_modes_ecran_vocal.md` §8ter : nouvelle sous-section « Le deuxième temps :
  la mise en page n'est pas toujours finie (défaut revenu) » (cause, règles,
  garde-fous) ; ligne du module dans le tableau du §10 ; verrou nommé dans la
  liste des tests ;
- bloc d'aide intégrée **`<!-- HELP:modes-ecran -->`** (`help/overview.md`) : le
  paragraphe utilisateur « Au retour à l'écran habituel, la conversation est là
  où vous l'aviez laissée… », suivi de `npm run build:handbook` (le
  `help/handbook.md` généré est committé avec le reste).

Aucun numéro de version, aucun tag, aucune publication n'a été touché.

---

# Troisième temps — la conversation ne repart ni en haut, ni de force en bas

**Date** : 2026-11-17 (troisième passage) · **Signalé une TROISIÈME fois**.
La demande du propriétaire tient en quatre points : nommer la cause, corriger,
le faire pour les **trois** sorties (logo, `Échap`, fermeture de l'onglet), et
**ne pas forcer à redescendre** celui qui avait volontairement remonté.

## 10. La cause restante (lue dans le code)

Les deux premiers correctifs (§2 et §4) sont bien en place et tiennent le cas
« il était en bas ». Il en restait un, plus discret, de **mauvais instant de
photographie** :

1. Pour passer en mode Vocal, le cycle du logo **traverse** « Assistant seul »,
   dont l'entrée force le bas (`enterImmersive` : `superAtBottom = true;`
   puis `scrollSuperToBottom(messagesEl)`, correctif de l'issue #82 — décision
   conservée, on n'y touche pas).
2. Ce bas est écrit **avant** la moindre photographie : les deux photographies
   existantes sont prises à la **sortie** des pleins écrans (`exitImmersive`,
   `exitVocal`).
3. Donc, pour l'utilisateur qui **relisait un passage**, la photographie de
   sortie dit « il était en bas » — c'est exact à cet instant, mais c'est nous
   qui l'y avons mis. Il est donc ramené **en bas**, contre son gré : il doit
   remonter à nouveau pour retrouver son passage.

Autrement dit : la position de « Détaillé » était **perdue au moment même où on
quittait « Détaillé »**, et rien ne la conservait. Le défaut ne se voyait pas,
parce que dans le cas « il était en bas » la conclusion (aller en bas) est la
bonne par hasard.

## 11. La correction (une décision pure, une photographie, un fait observé)

| Élément | Ce qui est fait |
|---|---|
| `src/js/conversation-scroll.js` | **nouvelle décision pure** `conversationScrollReturnSnapshot(detaille, pleinEcran, geste)` : 1) une seule photographie disponible → c'est elle (rien d'inventé) ; 2) l'utilisateur a **repris la main pendant le plein écran** → sa position du moment l'emporte ; 3) sinon → la position qu'il avait **en quittant « Détaillé »**. Aucun DOM, aucun minuteur. |
| `super-agent.js` → `memoizeSuperDetailScroll` | **photographie la position de « Détaillé » au moment où on le quitte**, avant tout déplacement de nœud et avant le bas forcé. Appelée depuis `enterImmersive`, **seul** écran qui force le bas (`enterVocal` ne déplace pas la conversation : il n'y a rien à y photographier, et le cycle du logo l'atteint toujours après « Assistant seul », dont la sortie vient de rendre la bonne position). |
| `super-agent.js` → `restoreSuperScroll` | la restitution ne lit plus une seule photographie : elle **confronte les deux** par la décision pure, puis consomme les deux et le drapeau de geste. Reste la **dernière instruction** de `exitImmersive()` **et** de `exitVocal()` : les **trois** voies de sortie (logo, `Échap`, fermeture de l'onglet) ont donc exactement le même comportement. |
| `super-agent.js` → écouteur `scroll` | **un seul fait nouveau**, déjà observé : le passage de `superAtBottom` de **vrai à faux pendant un plein écran**. Les écritures de l'application posent cette valeur **avant** d'écrire et ne la font jamais passer de vrai à faux : cette transition ne peut venir que d'un **geste réel**. C'est le seul cas où la position du plein écran l'emporte. |

Ce qui **n'est pas** fait : aucun nouveau défilement, aucun `scrollTo`, aucun
`smooth`, aucune minuterie, aucun écouteur supplémentaire dans le DOM, aucune
clé de stockage, aucun réglage. La disposition des trois écrans est intacte et
l'entrée en « Assistant seul » continue de forcer le bas (issue #82).

## 12. Ce que le propriétaire verra

| Il était… | Il revient à « Détaillé » sur… |
|---|---|
| en **bas** | **les derniers échanges** — et sur la fin de la réponse si elle a continué pendant le plein écran |
| en train de **relire** un passage | **son passage**, sans avoir à le rechercher : il n'est plus ramené en bas de force |
| en train de **relire** dans un plein écran (il a remonté la conversation là aussi) | **sa position du plein écran** : sa main l'emporte toujours |
| dans un plein écran sans toucher à rien | la position qu'il avait **en quittant « Détaillé »** |

Le même comportement pour les **trois** sorties : le **logo** (le bouton des
modes), **`Échap`**, et la **fermeture de l'onglet 🧭**.

## 13. Le verrou

`src/js/retour-mode-conversation-en-bas.test.js`, section « 4 » (**nouvelle**) :

- `conversationScrollReturnSnapshot` : la photographie de « Détaillé » gagne sur
  une photographie tardive de bas **quand l'utilisateur n'a pas touché au plein
  écran** — puis `conversationScrollTarget` rend **son passage** et **pas** le
  bas (c'est le test qui échoue si le retour le ramène en bas) ;
- un **geste** dans le plein écran fait gagner la photographie du moment ;
- une seule photographie disponible → c'est elle (aucune position inventée) ;
- le **branchement réel** : `memoizeSuperDetailScroll` est appelée dans
  `enterImmersive` **avant** le bas forcé de l'issue #82 et avant le déplacement
  de `messagesEl`, `enterVocal` n'en prend pas (il ne déplace pas la
  conversation) mais ouvre l'observation du geste, et `restoreSuperScroll`
  confronte bien les deux photographies par la fonction pure.

Il échoue si la photographie de « Détaillé » disparaît, si elle est prise trop
tard (après le bas forcé), ou si la restitution revient à une photographie
unique.
