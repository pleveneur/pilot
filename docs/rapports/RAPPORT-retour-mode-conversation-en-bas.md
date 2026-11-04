# Rapport — la conversation retrouve sa place au retour d'un plein écran

**Date** : 2026-11-16
**Symptôme rapporté par le propriétaire** : en passant du mode **Vocal** au mode
**Détaillé** (ou à « Assistant seul »), la conversation se réaffichait **tout en
haut** de la liste ; il fallait faire défiler jusqu'en bas pour retrouver où il
en était.

---

## 1. La cause réelle (lue dans le code, pas devinée)

Le plein écran **ne déplace pas** la conversation : `enterVocal()` / `exitVocal()`
ne touchent jamais au nœud `messagesEl`. En mode Vocal, `.agent-chat-messages`
est simplement rendu **invisible** (`visibility: hidden`, `src/css/style.css`),
ce qui **préserve ses mesures** — c'était même écrit noir sur blanc dans la
feuille de style (« aucun saut de l'historique à la sortie »).

Le défaut vient d'ailleurs, et de deux faits qui se combinent :

1. **Le bouton des modes est un cycle** : Détaillé → Assistant seul → Vocal →
   Détaillé. Pour atteindre le mode Vocal, on **traverse** donc « Assistant
   seul », dont la sortie exécute `exitImmersive()`.
2. **`exitImmersive()` déplace `messagesEl`** (`wrapper.insertBefore(messagesEl,
   toolbar)`). Or **déplacer un nœud défilable dans le DOM remet son `scrollTop`
   à 0** : la position de lecture est perdue à cet instant précis, pendant que
   l'écran Vocal est encore affiché (elle est donc invisible pour l'utilisateur).
   À la sortie du mode Vocal, `exitVocal()` ne restituait rien : la conversation
   réapparaissait avec `scrollTop = 0`, c'est-à-dire **tout en haut**.

L'entrée en « Assistant seul » était déjà corrigée à la main (issue #82 : on
force le bas à l'entrée), mais **aucune sortie** ne restituait quoi que ce soit —
et le mode Vocal, lui, n'avait aucune restitution du tout.

## 2. Le correctif, et pourquoi il est à cet endroit

La décision de mode et la restitution des nœuds existaient déjà : **aucun second
mécanisme de mode n'a été créé**. Le correctif s'ajoute exactement là où la
position se perd, et une seule fois :

| Endroit | Ce qui est fait |
|---|---|
| `exitImmersive()` | **photographie** de la position AVANT les déplacements de nœuds, **restitution** en dernière écriture (après le retrait de l'overlay) |
| `exitVocal()` | même chose, en dernière écriture (après le retrait du calque et la classe de mode) |

Deux fonctions seulement dans `super-agent.js` :

- `memoizeSuperScroll(messagesEl)` — prend la photographie **avant** que
  l'information n'existe plus (après le déplacement, `scrollTop` vaut 0) ;
- `restoreSuperScroll(messagesEl)` — rend la position **une seule fois** (la
  photographie est consommée, aucune restauration tardive), et **ré-arme le
  suivi automatique du bas** (`superAtBottom`) avec la valeur réelle : si
  l'utilisateur était en bas, les messages suivants continuent de le suivre ;
  s'il relisait un passage, rien ne le pousse.

**La décision elle-même est pure et vit dans un module dédié** :
`src/js/conversation-scroll.js` (aucun DOM, aucun import, aucun minuteur,
aucun stockage). C'est le seul endroit où l'on décide *quelle* position rendre.

## 3. Les deux règles de l'utilisateur (décisions pures)

| Situation | Décision | Effet |
|---|---|---|
| il était **en bas** (dans le seuil de 60 px) | on rend **le bas réel du contenu d'aujourd'hui** | il retrouve le fil, **même** si des messages sont arrivés pendant le plein écran |
| il avait **remonté** pour relire | on rend **sa position exacte**, bornée à ce qui est encore atteignable | ni saut en haut, ni saut en bas arbitraire |
| aucune photographie | `null` | on ne touche à rien : aucun saut inventé |

`CONVERSATION_SCROLL_BOTTOM_THRESHOLD` (60 px) est désormais la **seule** valeur
du seuil : `SUPER_SCROLL_BOTTOM_THRESHOLD` (super-agent.js) la lit, et
`shouldScrollSuperToBottom` délègue à `conversationAtBottom` du module pur. La
règle historique (« ne pas forcer le bas si l'utilisateur a remonté », issue #60)
est **inchangée**, à l'identique — ses tests passent sans modification.

Aucun défilement animé (`scrollTo`, `behavior: smooth`), aucun minuteur, aucun
`requestAnimationFrame` : la position est **posée** en une écriture, avant la
peinture — donc sans clignotement ni saut visible.

## 4. Ce qui n'a pas changé

- L'apparence, la disposition, la barre de saisie, les boutons, les trois sorties
  du mode Vocal (§8), l'état nu (§4ter), le bas qui s'efface (§4bis) : **rien**.
- L'entrée en « Assistant seul » continue de forcer le bas (issue #82) : c'était
  une décision explicite, elle est conservée.
- Aucun réglage, aucune clé de stockage, aucun nouveau bouton.
- Le défilement en mode Vocal pendant qu'il est affiché (`.pilot-vocal-active {
  overflow: hidden }`) : inchangé.

## 5. Le verrou (il échoue sans le correctif, c'est vérifié)

`src/js/conversation-scroll.test.js` — 12 tests :

1. **La décision pure** : seuil unique (60) et une seule valeur dans le dépôt ;
   « en bas » à l'identique (dont le contenu qui ne déborde pas) ; « était en
   bas » rend le bas **d'un contenu qui a grandi** ; « avait remonté » rend sa
   position exacte (0 assumé) ; position devenue hors d'atteinte bornée ; aucune
   photographie ⇒ `null` ; valeurs absentes/`NaN` sans exception.
2. **Le branchement réel** (lecture du source de `super-agent.js`) : la
   photographie est prise **avant** `wrapper.insertBefore(messagesEl, toolbar)`
   dans `exitImmersive` ; la restitution est **après** `immersiveOverlay.remove()`
   et n'est suivie d'aucun déplacement ; `exitVocal` fait la même chose, avec la
   photographie avant la restitution des nœuds et le rendu après le retrait du
   calque et de `VOCAL_ACTIVE_CLASS` ; le geste appelle bien le module pur (pas
   de recalcul local), ré-arme `superAtBottom` depuis la photographie, et
   n'introduit ni `scrollTo`, ni `smooth`, ni `setTimeout`, ni
   `requestAnimationFrame` ; enfin, **aucun déplacement supplémentaire** de la
   conversation n'a été ajouté (toujours exactement les trois existants :
   montage, entrée, sortie).

**Preuve que le verrou est réel** : avec les deux appels `restoreSuperScroll`
neutralisés, le fichier de test **échoue sur 2 tests** (`la sortie de « Assistant
seul » rend la position APRÈS avoir retiré l'overlay`, idem pour l'écran Vocal) ;
avec le correctif, il passe. Les 4 tests de `super-agent-scroll.test.js`
(issue #60, #82, suivi automatique) passent **sans aucune modification**.

## 6. Documentation

- `spec_modes_ecran_vocal.md` : nouvelle section **§8ter** (« La conversation
  retrouve sa place au retour »), une ligne dans le tableau du §10 et le verrou
  nommé dans la liste des tests ;
- bloc d'aide intégrée **`<!-- HELP:vocal-colonnes-portrait -->`** : une phrase
  ajoutée côté utilisateur (« en quittant le mode, la conversation se retrouve là
  où vous l'aviez laissée »), puis `npm run build:handbook` ;
- `README.md` : une puce dans « Trois modes d'écran ».

## 7. Vérifications lancées

```
npx vitest run src/js/conversation-scroll.test.js   # 12/12
npm test                                            # suite complète, verte
```

Aucun numéro de version, aucun tag, aucun commit de release n'a été touché.
