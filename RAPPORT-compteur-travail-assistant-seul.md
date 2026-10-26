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

---

# Second passage — re-verification demandee (meme objectif, meme fichier de rapport)

> Cette section est **ajoutee** a la suite du premier passage (ci-dessus), qui
> n'est ni reecrit ni supprime : il reste la trace de la correction d'origine
> (`5af237d`). Le travail de ce second passage ne refait pas le compteur : il
> **verifie l'etat reel du disque** et **ferme ce qui n'etait pas verrouille**.

## 8. Etat trouve sur le disque (avant toute modification de ce passage)

### 8.1 Combien de calculs ? **UN SEUL.**

| Etape | Fichier | Ligne | Role |
|---|---|---|---|
| donnees d'activite | `src/js/agent-activity.js` | `activityRefresh()` ~720 | poll partage (2 s) + push `agent-state-changed` |
| liste des missions | `src/js/super-agent.js` | `collectQueuedMissions()` 2649 | 4 familles d'attente (delegations, `run_agents`, commandes manuelles, file du bus) |
| **calcul unique** | `src/js/super-agent.js` | `publishSuperMissionsCount()` **2600** | `buildRunningMissions(...)` puis `splitMissions(...)` puis `setAgentPanelTaskCount(running.length, waiting.length)` |
| texte visible | `src/js/agent-activity.js` | `agentTaskCounterText()` **1204** | `en cours / total` (total = en cours + attente), vide si rien, plafond `99+` |
| infobulle + nom lu | `src/js/agent-activity.js` | `agentTaskCounterLabel()` **1219** | nombres reels |
| **peintre unique** | `src/js/agent-activity.js` | `paintAgentPanelTaskCount()` **1248** | ecrit `#agent-activity-count` (texte, `hidden`, classe `working`) + `title`/`aria-label` de `#agent-activity-entry` |
| point d'entree | `src/js/agent-activity.js` | `setAgentPanelTaskCount()` **1275** | seul appele par `super-agent.js:2603` |

### 8.2 Combien de chemins d'affichage ? **UN SEUL NOEUD, DEPLACE.**

- `index.html:282-283` : `#agent-activity` porte l'entree « Travail » et le
  chiffre `#agent-activity-count` (un seul de chaque dans tout le document).
- Mode standard : ce noeud vit dans la rangee d'onglets.
- Mode « Assistant seul » : `src/js/super-agent.js:3513-3517` (`enterImmersive`)
  prend **le noeud existant** (`document.getElementById("agent-activity")`) et
  l'insere dans la barre du mode (`insertBefore(activity, agentsHost)`) ;
  `src/js/super-agent.js:3557-3562` (`exitImmersive`) le restitue a sa place
  exacte **avant** le retrait de l'overlay.
- `src/css/style.css:11240` : `.superagent-immersive-active #agent-activity`
  passe de `display: none` (avant `5af237d`) a `display: flex` : le compteur est
  **affiche**, pas recopie.

**Conclusion de l'etat trouve : les deux modes ne divergent plus** — ils
affichent le meme element, peint par le meme code, alimente par le meme calcul.
Aucune divergence de chiffre n'etait donc a corriger dans ce passage.

## 9. Ce qui a ete unifie dans CE passage : **rien de plus, et c'est volontaire**

Aucun second calcul n'a ete cree, aucun noeud n'a ete duplique, aucun reglage
n'a ete ajoute, la largeur de colonne et les menus du bas ne sont pas touches.

Ce passage ferme une **porte ouverte** : les tests existants verifiaient le
*calcul* unique, le *noeud* unique et le *deplacement*, mais **pas qu'aucune
regle CSS propre au mode « Assistant seul » ne masque une partie du compteur**.
Une regle du type `.superagent-immersive-active #agent-activity-count { display:
none }` aurait rendu le second mode muet **sans faire rougir un seul test** :
les deux modes n'auraient alors plus affiche le meme chiffre, ce qui est
exactement le defaut que la decision 361 interdit.

Ajout dans `src/js/compteur-taches-travail.test.js` — nouveau bloc **(h)**, 5
tests, aucun ancien test supprime ni modifie :

1. **aucune regle du mode assistant seul ne cache une partie du compteur** :
   balayage de *toutes* les regles dont le selecteur contient
   `.superagent-immersive-active` et l'une des cinq parties visibles
   (`#agent-activity`, `#agent-activity-entry`, `#agent-activity-count`,
   `#agent-activity-dot`, `.agent-activity-entry-label`) ; aucune ne doit porter
   `display: none`, `visibility: hidden` ni `opacity: 0`.
2. **la barre du mode ne rogne pas le compteur** : `.sa-immersive-top` ne porte
   aucun `overflow: hidden` (qui couperait le bouton et son panneau).
3. **les quatre cas limites peignent la valeur EXACTE, sans etape
   intermediaire** : `(0;0)` → rien (et infobulle neutre), `(1;0)` → `1/1`,
   `(0;3)` → `0/3`, `(2;3)` → `2/5`, avec `hidden`, classe `working`, infobulle
   et `aria-label` verifies a chaque etape.
4. **un travail qui se termine pendant l'affichage** : `(1;2)` → `1/3` allume,
   puis `(0;2)` → `0/2` eteint, puis `(0;0)` → chiffre retire et infobulle
   revenue a « Suivi du travail » : le compteur **ne reste pas fige**.
5. **le compteur ne saute pas** : repeindre le meme etat ne change rien (aucun
   clignotement), et une demande de plus dans la file fait passer `2/5` a `2/6`
   — seul le total bouge, le nombre de taches en cours ne bouge pas.

## 10. Cas limites : resultat

| Cas | Attendu | Verifie par | Resultat |
|---|---|---|---|
| aucun travail | rien a l'ecran, pas de « 0/0 » | blocs (a) et (h) 3 | ✅ |
| un seul travail en cours | `1/1`, chiffre allume | (a) et (h) 3 | ✅ |
| plusieurs en attente | `0/3` (le total compte l'attente) | (a), (b) et (h) 3 | ✅ |
| en cours + attente | `2/5` = 2 + 3 | (b) et (h) 3 | ✅ |
| un travail qui se termine pendant l'affichage | redescend, jamais fige | (h) 4 | ✅ |
| file qui change | total juste, aucun echange entre les deux nombres | (h) 5 | ✅ |
| meme chiffre dans les deux modes | meme noeud, meme peintre, rien ne le masque | (g) 1-6 et (h) 1-2 | ✅ |

**Preuve que les nouveaux tests rougissent** (sabotages temporaires, sources
restaurees a l'identique ensuite ; `git status` verifie : aucune trace) :

| Sabotage applique | Resultat |
|---|---|
| ajout de `.superagent-immersive-active #agent-activity-count { display: none }` | `1 failed` — « expected [ Array(1) ] to deeply equal [] » (h) 1 |
| `overflow: hidden` ajoute sur `.sa-immersive-top` | `1 failed` — « expected 'hidden' not to be 'hidden' » (h) 2 |
| `count.hidden = false` force dans `paintAgentPanelTaskCount` (compteur qui ne s'efface plus) | `3 failed` (h) 3 et 4 |

## 11. Fichiers touches par ce second passage

- `src/js/compteur-taches-travail.test.js` : **ajout seul** du bloc (h) (5
  tests). Aucune assertion existante modifiee, aucun test supprime.
- `RAPPORT-compteur-travail-assistant-seul.md` : cette section (le rapport du
  premier passage est conserve tel quel).

**Non touches** (verifie par `git status --porcelain`) : `index.html`,
`src/js/agent-activity.js`, `src/js/super-agent.js`, `src/css/style.css`. Le
calcul unique, le peintre unique et le deplacement du noeud sont donc
**inchanges** par ce passage.

## 12. Resultat des tests

```
npx vitest run src/js/compteur-taches-travail.test.js
  Test Files  1 passed (1)
  Tests       35 passed (35)        (30 avant ce passage : +5, aucun supprime)

npm test  (vitest run)   — 7 executions consecutives vertes
  Test Files  191 passed (191)
  Tests       3355 passed (3355)     (3350 avant ce passage : +5)
  Duration    11 s
```

**A signaler (non corrige, non lie a ce passage)** : sur **8** executions
completes, **une** (la premiere, a 17:00:34) a montre `1 failed | 3354 passed`
sans que le nom du test fautif soit capture ; les **7** suivantes sont vertes a
l'identique. Le fichier modifie ici (`compteur-taches-travail.test.js`) ne
depend d'aucune horloge ni d'aucun timer : il ne peut pas etre la source de
cette intermittence. Test instable preexistant, a identifier par une execution
avec `--reporter=verbose` si l'utilisateur le souhaite.

## 13. Desaccords signales, non corriges seul

1. **Texte affiche « en cours / total »** : la decision 361 dit que le chiffre
   doit etre un TOTAL (en cours + attente). Le bouton affiche `2/5`, c'est-a-dire
   *deux* nombres. C'est conforme a la decision du proprietaire du compteur
   (`e55f60e`, RAPPORT-compteur-taches.md) et identique dans les deux modes ;
   je n'ai donc rien change. Si le proprietaire veut le seul total (`5`), c'est
   une decision a prendre, pas une correction d'ecart entre modes.
2. **Le compteur s'efface quand le reglage « onglet Taches » est desactive**
   (`paintAgentPanelTaskCount` : `panelTabEnabled.tasks !== false`). Comportement
   anterieur, identique dans les deux modes, non modifie.
3. **Non verifie a l'ecran** : aucune execution de Pilot pendant ce passage
   (Vitest sans navigateur). L'egalite est prouvee par le code, le CSS et les
   tests, pas par une capture.
