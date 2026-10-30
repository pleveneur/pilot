# Rapport — LOT 3 : la colonne de gauche de l'écran Vocal

Date : 2026-10-30 · Projet : `G:\IA_PL\pilot` · Version : **0.6.4** (aucun bump)
Demande du propriétaire : la colonne de gauche de l'écran Vocal doit montrer **ce qui
vient d'être dit** — titre « DISCUSSION », aperçu de la discussion collé **au bas**,
questions et réponses distinguées, dégradé **en haut** — puis la documentation doit
décrire ce qui existe.

Travail **local seulement** : aucun envoi GitHub, aucun tag, aucune publication,
aucune suppression de fichier, aucune commande de nettoyage Git.

---

## 1. Ce qui est livré, en trois phrases

À gauche du disque, une colonne symétrique de celle des tâches (même hauteur, même
largeur) porte le titre **« DISCUSSION »** et, **collés à son bas**, les derniers
échanges du chat : **questions** en 13 px gris sur deux lignes au plus, **réponses** en
15 px, huit lignes au plus, du plus ancien au plus récent. Le texte s'**efface par le
haut**, vers le titre, et la phrase « … et N échange(s) plus haut » dit ce qui n'a pas
trouvé place. Rien n'est **déplacé ni copié** : la conversation reste dans son onglet,
l'écran n'en lit que le texte et le recopie ; aucun nœud n'entre dans l'overlay, aucun
clic n'est ajouté.

## 2. Ce qui a changé, et où

| Fichier | Nature | Lignes |
|---|---|---|
| `src/js/vocal-sides.js` | **décision PURE** de l'aperçu (aucun DOM, aucune minuterie) | +213 |
| `src/js/super-agent.js` | **un seul point de peinture** : `collectVocalDiscussion`, `buildVocalDiscussionHtml`, `vocalRenderDiscussion` | +114 |
| `src/css/style.css` | mesures, gris `--vocal-ink-soft`, masque du haut, titre commun aux deux colonnes | +86 / −4 |
| `src/js/vocal-colonne-discussion.test.js` | **nouveau** fichier de tests (36 groupes, 34 `it`) | +434 |
| `spec_modes_ecran_vocal.md` | § 3 et § 3ter décrits au réel, § 4ter passé en ✅, bloc HELP refait | +134 / −41 |
| `help/overview.md` | bloc `modes-ecran` : aperçu + **phrase manquante du bouton de masquage** | +19 |
| `help/handbook.md` | **régénéré** (`npm run build:handbook`) — 47 blocs, 306 854 octets | +34 / −6 |

### 2.1 La décision, dans `vocal-sides.js` (pure)

Constantes exposées : `VOCAL_DISCUSSION_MAX_MESSAGES = 6`, `VOCAL_DISCUSSION_LINE_H = 23`,
`VOCAL_DISCUSSION_GAP = 14`, `VOCAL_DISCUSSION_HEAD_PX = 14`,
`VOCAL_DISCUSSION_QUESTION_LINES = 2`, `VOCAL_DISCUSSION_ANSWER_LINES = 8`,
`VOCAL_DISCUSSION_CHAR_PX = 7.6`, `VOCAL_DISCUSSION_MORE_PX = 29`,
`VOCAL_DISCUSSION_TITLE = "DISCUSSION"`.

Fonctions : `vocalCharsPerLine(track)`, `vocalSideClipped(texte, lignes, chars)`,
`vocalExcerpt(texte, lignes, chars)` (coupe **sur une frontière de mot**, ellipse
`…`, et **le préfixe exact** conservé), `planVocalDiscussion(hauteur, largeur)`,
`vocalDiscussionView(messages, { columnHeight, track, total })` et
`vocalDiscussionMoreText(n)`. Aucune de ces fonctions ne touche au DOM : c'est la même
règle que les lots 1 et 2 — **aucune valeur n'est choisie dans la feuille de style**,
tout vient du document de conception (§ 1.3, § 4.2, § 4.3).

Le budget est calculé, pas deviné : `lignes = floor((H − 14) / 37)` (23 px de ligne +
14 px d'écart) et `charsPerLine = max(1, floor(track / 7,6))`. La phrase du surplus voit
sa place **réservée d'avance** (29 px) : quand elle apparaît, elle ne pousse aucun
message hors de la colonne.

### 2.2 La peinture, dans `super-agent.js` (un seul point)

- `collectVocalDiscussion()` **lit** `superMessagesEl.querySelectorAll(".agent-message-user,
  .agent-message-assistant")`, borne la lecture aux 6 derniers et rend `{ messages, total }`.
  Il lit le `.agent-bubble` et **jamais** la rangée `.agent-message-actions` : le libellé du
  bouton « 🔊 Écouter » ne fait pas partie de ce qui a été dit.
- `buildVocalDiscussionHtml(vue)` compose le HTML (surplus d'abord, puis les messages).
- `vocalRenderDiscussion(plan)` est appelée par `vocalSyncSides()`, **juste après**
  `vocalRenderColumn(plan)` : **aucun second tic, aucune seconde mesure**. Le titre
  (`.vocal-discussion-title`) et le corps (`.vocal-side-body`) sont **créés à la peinture**
  par `vocalColumnNode()`, comme ceux de la colonne de droite : le balisage statique de
  `buildVocalOverlay()` ne gagne **aucun nœud**, et la liste ordonnée des classes — que
  deux tests existants lisent — ne bouge pas d'un élément. `data-vocal-more` est posé à
  `"1"` seulement s'il y a effectivement plus haut. Une écriture n'a lieu **que si le texte
  change** (cache `data-vocal-discussion`) : le tic de 900 ms repasse sans faire clignoter
  la colonne.

### 2.3 Les mesures, dans `style.css`

`.vocal-side-discussion > .vocal-side-body` : `flex: 0 1 auto`, colonne, `justify-content:
flex-end`, `overflow: hidden` — c'est `space-between` sur la colonne qui colle l'aperçu au
bas, jamais une marge automatique. Le masque `linear-gradient(to bottom, transparent 0,
black 28px)` est posé **sur le corps** et armé par `data-vocal-more="1"` : le titre garde sa
pleine lisibilité. Le gris des questions est un **jeton**, `--vocal-ink-soft:
color-mix(in srgb, var(--text-primary) 85%, var(--bg-app))` : aucune couleur en dur, et il
suit les dix palettes. Les 23 px de hauteur de ligne sont ceux du budget ;
`-webkit-line-clamp` n'est que le **filet** de la feuille de style — la coupe réelle est
faite en JavaScript, sur une frontière de mot, parce qu'une découpe CSS ne sait pas dire de
quel mot il s'agit. `.vocal-discussion-title` et `.vocal-tasks-title` partagent **un seul
bloc** : les deux titres ne peuvent pas dériver l'un de l'autre.

## 3. Ce que je n'ai pas fait (et pourquoi)

- **Aucun septième hôte cliquable.** Le verrou de l'issue #381
  (`vocal-aucun-calque-ne-capte-les-clics.test.js`) compte exactement six sélecteurs
  `.pilot-vocal <hôte>` avec `pointer-events: auto`. La colonne de gauche n'ajoute **aucun**
  `pointer-events`, **aucun** nœud focusable, aucun survol : `user-select: none` reste la
  règle du décor. Elle se lit, elle ne se manipule pas — pour relire, on retourne à
  l'onglet.
- **Aucun nœud de conversation déplacé, cloné ou vidé.** `collectVocalDiscussion()` ne fait
  que `querySelectorAll` / `textContent` ; il n'y a ni `appendChild` de nœud existant, ni
  `cloneNode`, ni `removeChild`. La règle
  `body.pilot-vocal-active .agent-chat-messages { visibility: hidden }` n'a **pas** été
  touchée et `enterVocal()` ne contient toujours ni `innerHTML`, ni `textContent`, ni
  `messagesEl` (`ecran-vocal-nu.test.js` reste vert **sans être modifié**).
- **Aucun test existant assoupli, supprimé ni désactivé.** Deux phrases sont verrouillées
  par des tests que je ne pouvais pas réécrire : `Rien de la conversation n'est affiché`
  dans la spec (`ecran-vocal-nu.test.js` l. 245) et `Rien de la conversation n'y est
  affiché` + `écran nu` dans le bloc HELP `modes-ecran` (l. 250-251). Stratégie appliquée :
  **ajouter, jamais supprimer** — la spec garde la phrase, mais la **situe** (« Dans l'état
  nu, §4ter ») et ajoute l'aperçu de la colonne de gauche à côté ; le bloc HELP garde ses
  deux formulations et gagne l'aperçu, puis la phrase du bouton de masquage.
- **Aucun réglage, aucune persistance.** L'aperçu est recalculé à chaque entrée dans le mode
  et à chaque tic de 900 ms ; rien n'est mémorisé, rien ne se configure.
- **Le disque, le halo, les quatre états, le bouton des trois modes et l'effacement du bas
  ne sont pas touchés** : le lot n'écrit aucune ligne de ces blocs, et leurs tests restent
  verts.
- **Les fichiers non liés au lot, déjà non suivis dans l'arbre, n'ont pas été touchés ni
  committés** (rapports antérieurs, conceptions, `vocal.md`, etc.).

## 4. Documentation

La conception devient description du réel, sans changer l'esprit du § 4.1 :

1. **`spec_modes_ecran_vocal.md` § 3** — « la conversation n'est **jamais déplacée** … la
   seule chose qui en vient est un **aperçu recopié**, du texte, jamais un nœud, dans la
   colonne de gauche et **seulement là** ». La phrase verrouillée est conservée et
   **située** (état nu).
2. **`spec_modes_ecran_vocal.md` § 3ter** — le titre passe de « 🟡 lots 1 et 2 livrés, lot 3
   à venir » à « ✅ **lots 1, 2 et 3 livrés** », l'encadré d'état réel décrit les deux
   colonnes remplies, et une section nouvelle **« La colonne de gauche : l'aperçu de la
   discussion (lot 3, livré) »** donne les mesures (titre 11 px / `0.08em` / 14 px, question
   13 px gris 2 lignes + 12 px, réponse 15 px 8 lignes, 23 px de ligne, 14 px d'écart),
   le budget (42 caractères à 320 px, 52 à 400 ; 13 lignes à 512 px, 9 à 383, 8 à 331, 7 à
   287, 5 à 231), le dégradé **en haut** et la règle de lecture seule.
3. **`spec_modes_ecran_vocal.md` § 4ter** — l'état nu passe de « 🟡 conception écrite, **non
   livrée** » à « ✅ **livré** » : le bouton-œil, la classe `vocal-bare` et ses tests
   existent depuis le commit `a086c7e`, la spec disait le contraire.
4. **`help/overview.md`, bloc `HELP:modes-ecran`** — la **phrase d'aide manquante** du bouton
   de masquage y est écrite, avec les libellés **exacts** du module `src/js/vocal-bare.js` :
   « **tout est visible — cliquer pour ne garder que le portrait** », puis « **tout est
   masqué — cliquer pour tout réafficher** ». Le paragraphe dit ce qui est masqué (cercle et
   sa lumière, ligne d'état, barre de saisie, les deux colonnes), que **rien ne bouge**,
   que le bouton reste le seul moyen de revenir, que le logo / `Échap` / la fermeture de
   l'onglet continuent de marcher, et qu'il n'y a **aucune mémoire**.
5. **`help/overview.md`, bloc `HELP:vocal-colonnes-portrait`** — « la discussion est **vide
   pour l'instant** » disparaît au profit de la colonne de gauche livrée, et une ligne
   renvoie au bouton-œil pour ne pas répéter deux fois les libellés dans l'aide.
6. **`help/handbook.md` régénéré** par `npm run build:handbook` (jamais édité à la main) :
   47 blocs, 306 854 octets. Le diff ne contient que l'entête de génération et les trois
   paragraphes ci-dessus.

## 5. Tests

`src/js/vocal-colonne-discussion.test.js` (nouveau, **34 tests**, aucun test existant
modifié) :

- **T1** questions : `--font-base`, `--vocal-ink-soft`, `-webkit-line-clamp: 2`,
  `padding-inline-start: 12px`, aucune couleur hexadécimale ;
- **T2** réponses : `--font-zone`, `--text-primary`, `8` lignes, 23 px de ligne, 14 px
  d'écart ;
- **T3** ordre chronologique et **collé au bas** (`space-between` sur la colonne,
  `flex-end` sur le corps) ;
- **T4** coupe **sur une frontière de mot** : le préfixe exact est conservé, l'ellipse est
  là, les sauts de ligne et espaces multiples sont normalisés ;
- **T5** **lecture seule** : `.agent-bubble` seul, jamais `appendChild` / `remove` /
  `innerHTML` **dans la lecture** ; `visibility: hidden` inchangé ; ni `.agent-thinking`,
  ni `tool-inline`, ni `message-system` ;
- **T6** masque `linear-gradient(to bottom, …)` et `data-vocal-more = vue.hidden > 0 ? "1" :
  "0"` ;
- **T7** six messages lus au plus, `total − VOCAL_DISCUSSION_MAX_MESSAGES`,
  `vocalDiscussionMoreText`, `MORE_PX = 29`, contiguïté des messages retenus ;
- **T8** une seule source, **un seul** `collectVocalDiscussion`, **un seul**
  `vocalRenderDiscussion`, **un seul** `buildVocalDiscussionHtml`, et `vocal-sides.js`
  **pur** (`document.` / `window.` / `invoke(` / `localStorage` / `setTimeout` absents) ;
- cohérence : les deux titres partagent **une** règle (`11px`, `0.08em`, capitales, 14 px),
  le **tableau du § 4.2 rejoué** (512→13, 511→13, 479→12, 383→9, 331→8, 287→7, 231→5 ;
  `charsPerLine` 42 à 320 px, 37 à 282, 52 à 400, jamais 0), **aucun** `pointer-events`
  ajouté par le lot, aucun hôte focusable, aucun réglage.

**Morsures rencontrées pendant l'écriture des tests, et corrigées dans le code** (elles
disent que les tests mordent) :

1. `#000` dans le dégradé déclenchait le contrôle « aucune couleur hexadécimale » →
   remplacé par le mot-clé **`black`**, de valeur identique.
2. Un texte de 42 caractères ne se déclarait pas `clipped` → le cas de test est passé à
   `LONG.repeat(2)`, ce qui teste vraiment la coupe.
3. Une regex cherchait `buildVocalDiscussionHtml(vue)` et ne voyait pas l'affectation
   intermédiaire → l'ancre est devenue `/html = buildVocalDiscussionHtml\(/` (le code est
   resté tel quel : c'est la vérification qui était trop étroite).
4. Le contrôle de pureté `document\.` matchait un **commentaire** de `vocal-sides.js` →
   commentaire reformulé : un module pur ne parle pas du document, même en prose.

## 6. Résultats des vérifications

| Vérification | Résultat |
|---|---|
| `node --check` sur `vocal-sides.js`, `super-agent.js`, `vocal-colonne-discussion.test.js` | OK |
| `npx vitest run src/js/vocal-colonne-discussion.test.js` | **34 PASS / 0 FAIL** |
| `npx vitest run` (suite complète) | **4710 PASS / 0 FAIL** (base **4676**, **+34**, FAIL **0**) |
| `npx vitest run` sur `ecran-vocal-nu`, `vocal-taches-en-haut-portrait-en-bas`, `help-delai-inactivite`, `libelle-options-ecran` | **105 PASS / 0 FAIL** |
| `npm run build` (Vite) | OK (avertissements préexistants : import dynamique de `search-panel.js`, taille de chunk) |
| `npm run build:handbook` | OK — 47 blocs, 306 854 octets |
| Aucun test existant modifié, assoupli, supprimé ni désactivé | vérifié (`git diff` ne touche aucun `*.test.js` existant) |

## 7. Commit

Un **seul** commit local, en français :

```
feat(vocal): la colonne de gauche montre l'aperçu de la discussion (lot 3)
```

Contenu : les sept fichiers du tableau du § 2 (dont ce rapport). **Aucun** push, aucun tag,
aucun bump de version.
