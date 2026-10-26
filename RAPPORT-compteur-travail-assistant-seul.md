# Rapport — le compteur « Travail » du mode « Assistant seul »

Date : 2026-09-01 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest)
Demande du proprietaire : en mode « Assistant seul » (overlay immersif), le
compteur de travail doit montrer **exactement le meme ecran et les memes
informations** qu'en mode normal : nombre de taches **en cours** et nombre
**total**.

---

## 1. Constat : la difference exacte, avec preuve

### 1.1 Mode normal — d'ou vient le compteur

| Element | Fichier | Role |
|---|---|---|
| Bouton `#agent-activity-entry` | `index.html:277` | conteneur « Travail » (point + mot + compteur), place dans la rangee d'onglets `#tab-row` |
| `#agent-activity-count` | `index.html:277` | le compteur lui-meme (« 2/5 »), `hidden` quand il n'y a rien |
| `splitMissions()` | `src/js/agent-activity.js:655` | decoupe les missions en **en cours** / **en attente** |
| `agentTaskCounterText(running, waiting)` | `src/js/agent-activity.js:1204` | compose le texte « en cours / total » (vide si rien, plafond `99+`) |
| `agentTaskCounterLabel(running, waiting)` | `src/js/agent-activity.js:1219` | infobulle + `aria-label` (nombres reels) |
| `paintAgentPanelTaskCount()` | `src/js/agent-activity.js:1248` | **seul** peintre : ecrit dans `#agent-activity-count` et l'infobulle |
| `setAgentPanelTaskCount(running, waiting)` | `src/js/agent-activity.js:1275` | point d'entree public du peintre |
| `publishSuperMissionsCount()` | `src/js/super-agent.js:2598` | **seul** producteur du compte : `getAgentActivitySnapshot().list` + `collectQueuedMissions()` → `buildRunningMissions` → `splitMissions` → `setAgentPanelTaskCount(running.length, waiting.length)` |

Sens du compteur (decision du proprietaire, deja en place) : **total = en cours
+ en attente**, tous projets confondus ; ni pastille, ni repere d'onglet.

### 1.2 Mode « Assistant seul » — ce qui se passait

Preuves relevees sur le disque **avant** correction :

1. `src/js/super-agent.js`, `buildImmersiveOverlay()` (~3408) : la barre du mode
   (`.sa-immersive-top`) contient le bouton retour, le titre « Pilot », le resume
   des agents (`.sa-immersive-agents`) et le bouton ⚙. **Aucun compteur de
   travail n'y est construit** : ni texte, ni nombre, ni bouton « Travail ».
2. `src/css/style.css:11197` (avant) :

   ```css
   .superagent-immersive-active #agent-activity {
     display: none;
   }
   ```

   L'entree « Travail » **existait toujours dans la page** mais etait **masquee**
   pendant tout le mode immersif.
3. `src/js/super-agent.js`, `enterImmersive()` (avant) portait le commentaire
   « Ajustement A19 : le suivi du travail … reste un controleur du mode standard
   — il n'est plus deplace dans l'overlay (recouvert par celui-ci, masque via
   `.superagent-immersive-active`) ».

### 1.3 Les trois cas tranches

| Cas envisage | Verdict |
|---|---|
| Deux bouts de code differents | **NON** — il n'existe qu'un seul calcul et un seul peintre, et le mode immersif ne les appelle pas |
| Le second reutilise le premier | **NON** — il ne reutilisait rien du tout |
| **Le compteur manque purement et simplement** | **OUI** — le noeud est masque (`display: none`), donc absent de l'ecran du mode |

## 2. Ce qui manquait / differait

- **Absence totale** : ni « en cours », ni « total », ni libelle « Travail ».
- L'information restait neanmoins a jour en arriere-plan (le mode normal
  continuait de la peindre) : le mode ne montrait simplement rien.
- Aucune difference de libelle, d'apparence ou de calcul a corriger : **tout
  existait deja**, il fallait le **montrer au meme endroit dans ce mode**.

## 3. Correction retenue : deplacer, jamais recopier

Regle absolue respectee : **une seule source de verite**.

- `src/js/super-agent.js` — `enterImmersive()` : le noeud `#agent-activity`
  **existant** est pris par `document.getElementById("agent-activity")` et
  **deplace** (`insertBefore`) dans la barre du mode, juste a gauche du resume
  des agents. Sa place d'origine (parent + voisin suivant) est memorisee dans
  `immersiveActivityHome`.
- `src/js/super-agent.js` — `exitImmersive()` : le **meme** noeud est restitue a
  sa place exacte, **avant** le retrait de l'overlay (sinon il serait detruit
  avec lui et le mode normal perdrait son compteur). Garde : si le voisin
  memorise n'appartient plus au parent, on ajoute en fin de parent.
- `src/css/style.css` : `.superagent-immersive-active #agent-activity` ne masque
  plus rien (`display: flex`, `align-self: center`, `margin: 0`) : le bouton
  prend sa place dans la barre de 58 px, centre verticalement (la rangee
  d'onglets, elle, l'etirait). `position: relative` est conservee → le panneau a
  trois onglets (`#agent-activity-dropdown`, `z-index: 10001`, deja existant)
  reste ancre sous le bouton et s'ouvre dans l'overlay.

Consequences directes : **aucun second calcul**, **aucun second noeud**,
**aucun nouveau reglage**, **aucun bouton ajoute**. Le texte, l'infobulle,
l'`aria-label`, le plafond `99+`, le panneau « Agents / Taches / Evenements » et
le sens « total = en cours + en attente » sont ceux du mode normal, a
l'identique, puisqu'il s'agit du **meme element du document**.

## 4. Preuve d'egalite (tests)

Ajout d'un bloc `(g)` dans `src/js/compteur-taches-travail.test.js` (le verrou
historique du compteur) — 6 tests, aucun nombre fige :

1. **un SEUL noeud de compteur dans tout le document** : `index.html` contient
   exactement un `id="agent-activity"` et un `id="agent-activity-count"` ;
   `super-agent.js` et `style.css` ne contiennent aucun `sa-immersive-count`
   (aucun compteur parallele pour le mode).
2. **le mode DEPLACE le noeud du mode normal, puis le restitue** : le corps
   verifie de `enterImmersive()` contient `getElementById("agent-activity")` et
   `insertBefore(activity, agentsHost)`, et **ne contient ni**
   `agentTaskCounterText`, **ni** `agent-activity-count`, **ni**
   `setAgentPanelTaskCount` (aucune peinture propre a ce mode) ; le corps de
   `exitImmersive()` restitue via `home.parent.insertBefore(activity, next)`.
3. **le CSS ne masque plus le suivi du travail** : `display: flex` (et non
   `none`), `align-self: center`, et aucun `display: none` residuel sur ce
   selecteur.
4. **un seul calcul et un seul peintre dans TOUT le projet** : scan de tous les
   modules `src/js/*.js` (hors tests) — `agentTaskCounterText(` n'apparait que
   dans `agent-activity.js`, `function paintAgentPanelTaskCount(` aussi, et
   `setAgentPanelTaskCount(` seulement dans `agent-activity.js` (definition) et
   `super-agent.js` (appel).
5. **le peintre n'ecrit que sur le noeud partage** : `paintAgentPanelTaskCount()`
   ne cite ni `sa-immersive` ni `immersive` — il ne peut pas peindre deux
   affichages differents.
6. **le noeud deplace affiche le meme compte** : `setAgentPanelTaskCount(2, 3)`
   donne `2/5` et l'infobulle « Travail : 2 taches en cours sur 5 (3 en
   attente) », avant comme apres un changement de conteneur (meme instance).

**Preuve que ces tests rougissent** (mutations volontaires, puis restauration) :

| Mutation appliquee | Resultat |
|---|---|
| remettre `display: none` sur `.superagent-immersive-active #agent-activity` | `1 failed` — « expected 'none' to be 'flex' » (test 3) |
| ajouter un appel `agentTaskCounterText(1, 2)` dans `super-agent.js` | `1 failed` — « un seul calcul du texte et un seul peintre, dans TOUT le projet » (test 4) |

## 5. Le mode normal n'a pas bouge

- `git status --short` : seuls `src/css/style.css`, `src/js/super-agent.js` et
  `src/js/compteur-taches-travail.test.js` sont modifies par cette mission
  (`src-tauri/src/agents.rs` etait deja modifie **avant** par une autre mission
  — non touche, non committe ici).
- `index.html` : **non modifie** (le noeud et son contenu sont inchanges).
- `src/js/agent-activity.js` : **non modifie** (calcul, texte, infobulle,
  plafond, panneau).
- `src/css/style.css` : la **seule** regle touchee est
  `.superagent-immersive-active #agent-activity` (mode immersif uniquement) ;
  `#agent-activity`, `#agent-activity-entry`, `#agent-activity-count` et
  `#agent-activity-dropdown` gardent leurs blocs d'origine.
- `src/js/super-agent.js` : ajouts **uniquement** dans `enterImmersive()` /
  `exitImmersive()` (code du mode) ; `publishSuperMissionsCount()` et le rendu du
  panneau sont inchanges.
- Les verrous existants qui protegent le mode normal passent tous (blocs (a) a
  (f) de `compteur-taches-travail.test.js`, `travail-visible.test.js`,
  `panneau-suivi-trois-onglets.test.js`, `barre-fenetre-assistant-seul.test.js`).
- Preserve : largeur de colonne 280 px, hauteur du bandeau, logo, themes, les
  deux boutons deja deplaces dans la zone, et aucun element remis ailleurs.

## 6. Suite de tests complete (compte reel)

```
npm test   (vitest run)

 Test Files  190 passed (190)
      Tests  3307 passed (3307)
   Duration  21.18s
```

Aucun test en echec. Les messages « Erreur session agent: … getCurrentWindow »
qui apparaissent dans la sortie proviennent d'un test qui simule l'absence de
Tauri (attendus, sans echec).

## 7. Ce qui n'a pas pu etre verifie a l'ecran

**Non verifie a l'ecran.** Aucune execution de Pilot n'a ete faite pendant cette
mission : la correction est constatee par le code, le CSS et les tests
automatises (Vitest, sans navigateur). A confirmer visuellement par le
proprietaire :

- l'alignement du bouton « Travail » dans la barre de 58 px du mode (hauteur,
  centrage, air a droite avec le point des agents et le ⚙) ;
- l'ouverture du panneau a trois onglets depuis ce mode (il s'ancre sous le
  bouton, `right: 0` : il s'etend vers la gauche depuis la nouvelle position) ;
- le rendu sur une fenetre etroite (le panneau garde ses plafonds
  `100vw - marge`).
