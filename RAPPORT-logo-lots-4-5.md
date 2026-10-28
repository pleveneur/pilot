# Rapport — logo bouton des trois modes, lots L4 et L5

> Suite du commit `535ceb1` (`feat(screen-modes): make the Pilot logo the single
> three-mode button (lots 1-3)`) et de `RAPPORT-logo-lots-1-2-3.md`.
> Ce rapport couvre **uniquement** L4 (tests) et L5 (documentation) de
> `CONCEPTION-logo-bouton-des-trois-modes.md`. **Aucun fichier de production
> n'a été modifié** (`index.html`, `src/css/style.css`, `src/js/screen-mode.js`,
> `src/js/super-agent.js`, `src/js/window-controls.js` : inchangés — vérifié par
> `git status`). Les lots L1 à L3 ne sont pas revenus en arrière.

---

## 1. État avant / après

| | Avant (HEAD `535ceb1`) | Après |
|---|---|---|
| Suite frontend | **PASS 3641 / FAIL 10** (4 fichiers) | **PASS 3678 / FAIL 0** |
| Nombre de tests (recompté) | 3651 | **3678** (+27 : le nouveau verrou) |
| Documentation | décrit l'ancien bouton dédié + « Autres écrans ▾ » | décrit le logo-bouton + « Action ▾ » |
| Aide intégrée (`help/handbook.md`) | pastille + libellé (faux) | régénérée depuis `help/overview.md` |

Les 10 échecs décrivaient tous l'**ancien dispositif** (un bouton dédié
`#screen-mode-button` dans la rangée d'onglets, avec un mot et une pastille).
Aucune régression fonctionnelle n'a été trouvée : le code livré en L1-L3 était
juste, ce sont les assertions qui avaient vieilli.

---

## 2. Adaptation des tests existants (L4)

Principe appliqué : **adapter, pas réécrire**. Chaque test garde son intention
(une place, un ordre, un libellé, une absence) et la vérifie sur le nouveau
dispositif. **Aucune assertion n'a été supprimée sans justification écrite**, et
plusieurs ont été **renforcées** au passage.

### 2.1 `src/js/trois-modes-ecran.test.js` — `PASS (23) FAIL (0)`

| Assertion d'origine (ancien dispositif) | Nouvelle assertion | Pourquoi (§ 4.3) |
|---|---|---|
| en-tête : « bouton dédié dans la rangée d'onglets, libellé + pastille » | en-tête : logo dans `#project-selector`, **avant** le nom du projet, infobulles exactes, **plus de libellé ni de pastille** | le bouton **est** le logo ; le documenter autrement ferait décrire un écran qui n'existe plus |
| `#screen-mode-button` présent dans `index.html` | **un seul** `#mode-logo`, entre `#project-selector` et `#btn-project-name`, **pas** dans `#tab-row` ; `screen-mode-button` absent de `index.html` **et** de `super-agent.js` | vérifie la **place** (intention conservée) sur le nouveau nœud |
| déplacement : `immersiveTop.appendChild(screenModeButton)` (dans la barre) | `immersiveOverlay.appendChild(screenModeButton)` (dans l'overlay), **jamais** `insertBefore(screenModeButton, agentsHost)` | le logo sort du flux ; la barre de 58 px ne porte plus le bouton |
| retour : `tabRow.insertBefore(modeButton, …)` | restitution chez le **parent mémorisé** + voisin (`immersiveModeButtonHome`, `vocalModeButtonHome`), **avant** `immersiveOverlay.remove()` | la place d'origine est le bandeau, plus la rangée ; l'ordre « restituer puis détruire l'overlay » reste vérifié |
| infobulle : `>Détaillé</span>` + `.screen-mode-dot` | `data-screen-mode="detailed"`, titre « Mode d'écran : Détaillé », `aria-label`, **image** `#btn-project-logo` + `logo_pilot_vector.svg` dedans, **pas** de `>Détaillé</span>`, **pas** de pastille | décision Q2 = A : le logo est **muet**, c'est l'infobulle qui parle |
| apparence : 88 px, `font-size`, `position` en mode Détaillé | **28 × 28 px**, marges calculées (-3 / -4 px), `--radius-sm`, `cursor: pointer`, ni `font-size` ni `position` en Détaillé | la géométrie a changé de nature (carré d'icône, pas pilule de texte) ; l'intention « le mode Détaillé ne déplace pas le bouton » reste vérifiée |
| place en plein écran : un bloc par mode | **une seule règle à deux sélecteurs** (`body.superagent-immersive-active #mode-logo, body.pilot-vocal-active #mode-logo {`), top 8 / left 13 / margin 0 / z-index 2 / pas de `width` | « même place dans les trois modes » devient **structurel** : impossible de separer les deux sélecteurs sans rougir |
| pastille présente | pastille **absente** partout (CSS, JS, HTML) | décision Q2 = A |

Ajout : un helper `blocPleinsEcrans()` lit la règle commune aux deux overlays
(fragment court, `sliceSource(..., 120)` — le bloc fait 156 caractères).

### 2.2 `src/js/barre-fenetre-assistant-seul.test.js` — `PASS (12) FAIL (0)`

Test renommé « **(aucun bouton de mode n'y revient)** » : il vérifiait que le
bouton ne finissait pas **dans la barre** du mode Assistant seul — c'est
exactement ce que la conception exige encore (le logo entre dans l'**overlay**,
hors du flux). Assertions adaptées : `immersiveTop.appendChild(screenModeButton)`
interdit, `mode-logo` absent du source de la barre, `immersiveModeButtonHome`
présent.

### 2.3 `src/js/ecran-vocal-lot2.test.js` — `PASS (44) FAIL (0)`

- Test 1 devient « le logo se pose à la **même place** que dans l'autre plein
  écran » : au lieu de chercher un bouton dans la barre vocale, il lit le bloc
  `body.pilot-vocal-active #mode-logo` (absolute / top 8 / left 13), exige la
  présence de la **règle commune** et l'absence de `.screen-mode-dot` /
  `#screen-mode-button`.
- Test de la barre de 44 px : la barre est **vide**, sa géométrie est inchangée,
  et le balisage produit contient `<div class="vocal-top"></div>`. L'intention
  d'origine (« la barre garde sa hauteur ») est conservée et même durcie.

### 2.4 `src/js/ecran-vocal-nu.test.js` — `PASS (15) FAIL (0)`

- En-tête, item 2 mis à jour (le logo fait partie des nœuds déplacés).
- Test « les seuls nœuds déplacés sont la barre de saisie et le logo des modes » :
  `zone.appendChild(inputBar)` **et** `vocalOverlay.appendChild(modeButton)`, et
  surtout **pas** `barre.appendChild(modeButton)` — la vérification de l'unicité
  du déplacement est conservée.

---

## 3. Nouveau verrou : `src/js/logo-bouton-trois-modes.test.js` (27 tests)

Fichier neuf ; il ne décrit pas le passé, il fixe ce qui doit rester vrai. Neuf
sections, une par règle ferme (§ 4.4) :

1. **un seul bouton, et c'est le logo** — un seul `id="mode-logo"`, dans le
   bandeau, avant le nom, jamais dans la rangée ; aucun `#screen-mode-button` ;
2. **le bouton dédié a disparu** — plus la moindre chaîne `screen-mode-button`
   (HTML, CSS, `super-agent.js`, `main.js`) ; `SCREEN_MODE_BUTTON_ID` déclaré
   **une** fois et valant `mode-logo` ;
3. **le dessin du logo est conservé** — `#btn-project-logo`, même `src`, **dans**
   le bouton ; image à 24 px, jamais redimensionnée par un plein écran ;
4. **un carré de 28 px, muet** — 28 × 28, curseur main, `--radius-sm`, aucun
   jeton de texte ; survol `--surface-2`, anneau clavier `--accent`, pas d'anneau
   au clic souris ; ni mot, ni icône, ni pastille nulle part ;
5. **la même place dans les trois modes** — aucune règle absolue en Détaillé ;
   **une** règle à deux sélecteurs portant `top: 8px` / `left: 13px` (une seule
   déclaration de chaque côté : impossible de les séparer) ; les barres de 58 px
   et 44 px gardent leur hauteur ;
6. **la garde de 400 ms** — valeur exacte, sous le seuil système de 500 ms ;
   premier clic jamais ignoré ; 399 ms plus tard ignoré ; exactement 400 ms pris
   en compte ; valeurs non numériques jamais bloquantes ; garde **branchée avant**
   l'application du mode, horodatage avancé seulement sur un clic pris en compte ;
   cycle `detailed → assistant → vocal` ;
7. **déplacé, jamais créé** — le nœud est lu (`getElementById`), jamais fabriqué ;
   il entre dans les **deux** overlays et revient **deux** fois chez son parent
   (deux mémorisations, deux oublis : aucun état ne survit d'un plein écran à
   l'autre) ;
8. **le mode Zen est inchangé** (décision D7 = A) — la colonne de gauche est
   masquée donc le logo aussi, **aucune** règle ni ligne de code spéciale ;
   les **deux** bascules `F11` sont intactes ; `Ctrl+Shift+A` reste le chemin
   quand le bandeau a disparu ;
9. **glisser et double-clic restent actifs ailleurs** — `WINDOW_GESTURE_BLOCKLIST`
   contient `button` ; un nœud **dans** un bouton (le logo, ou son image) bloque
   le geste, le vide du bandeau et de la rangée reste glissable ; les deux zones
   de glissement n'ont pas bougé et `window-controls.js` ignore le mode d'écran.

---

## 4. Preuve du mordant

Deux mutations temporaires, appliquées puis **annulées** (fichiers restaurés à
l'identique, `git status` propre sur `index.html` et `src/css/style.css`).

| Mutation (retour en arrière simulé) | Résultat |
|---|---|
| réintroduire `<button id="screen-mode-button"><span class="screen-mode-dot"></span></button>` juste avant le logo dans `index.html` | **2 tests rouges** : « aucun bouton dedie » (§ 4.4-1) et « plus la moindre chaine `screen-mode-button` » (§ 4.4-2) |
| passer `left: 13px` à `left: 12px` **dans un seul** des deux sélecteurs de la règle commune | **1 test rouge** : « les DEUX pleins ecrans partagent UNE seule regle : meme top, meme left » (§ 4.4-5) |

La règle centrale (« le logo-bouton unique, à la même place dans les trois
modes ») est donc réellement tenue par les tests, et pas seulement décrite.

---

## 5. Documentation (L5)

| Fichier | Modification |
|---|---|
| `spec_pilot.md` § 1 « Trois modes d'écran » | réécrit : le bouton unique **est** le logo (`#mode-logo` autour de `#btn-project-logo`), muet, infobulle = mode courant + suivant, garde de 400 ms, même place (13/8) dans les deux pleins écrans, restitution exacte ; **nouvelle ligne « Comment changer de mode »** (logo, `Ctrl+Shift+A`, `Échap`, fermeture de l'onglet 🧭 ; rien d'autre) ; **nouvelle ligne Mode Zen** (`F11`, logo masqué avec la colonne, `Ctrl+Shift+A` reste le chemin, aucun mécanisme ajouté) ; référence au document de conception |
| `spec_pilot.md` § C | **correction en attente** : « **Autres écrans ▾** » → « **Action ▾** » (libellé **affiché**, au singulier), en précisant que le menu ouvert garde son nom interne « Autres écrans » (10 entrées, ouvert vers le haut) — aucune ambiguïté possible sur ce qui est lu à l'écran |
| `spec_help.md` | **correction en attente** : « première entrée du menu « Autres écrans » (dix entrées) » → « première entrée du menu ouvert par la dernière ligne, dont le libellé **affiché** est « Action ▾ » (le menu garde son nom interne « Autres écrans », dix entrées) » |
| `help/overview.md` bloc `<!-- HELP:modes-ecran -->` | l'ancien texte (« Le mode courant est rappelé par son libellé et une pastille ») est remplacé par la vérité du logo-bouton : le **logo** est le bouton, **ni mot ni pastille**, c'est l'**infobulle** qui dit le mode courant et annonce le suivant, un double-clic réflexe ne change qu'un seul mode, même place en plein écran ; **trois autres façons de changer de mode** listées (`Ctrl+Shift+A`, `Échap`, fermeture de l'onglet 🧭). Les phrases déjà verrouillées par `ecran-vocal-nu.test.js` (« écran nu », « Rien de la conversation n'y est affiché ») sont **conservées mot pour mot** |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (46 blocs, 284 512 octets, 48 topics) — jamais édité à la main |

---

## 6. Vérifications

```bash
npx vitest run src/js/logo-bouton-trois-modes.test.js   # PASS (27) FAIL (0)
npm test                                                # Tests 3678 passed (3678)
npm run build:handbook                                  # 46 blocs, handbook.md regenere
npm run build                                           # ✓ built in 12.61s (avertissements de decoupage preexistants)
```

- `npm test` : **3678 tests, 3678 réussis, 0 échec** (compté par l'agent, pas
  repris d'un chiffre fourni) ; avant L4 : 3651 tests dont 10 en échec ;
  +27 = le nouveau fichier.
- `npm run build` : succès (seuls les avertissements Vite préexistants sur le
  découpage des *chunks*).
- Aucun fichier de production modifié ; aucun bouton, option ou réglage ajouté.

---

## 7. Reste à faire

- **Rien pour L4/L5** : la suite est verte, la documentation et l'aide intégrée
  disent la même chose que le code.
- À trancher plus tard, hors de ce lot : la **relecture du document de
  conception** (`CONCEPTION-logo-bouton-des-trois-modes.md`) pour y ajouter le
  renvoi vers ce rapport et vers le nouveau fichier de verrou, si le propriétaire
  souhaite que la conception cite ses tests.
- Non traité volontairement (décision D7 = A) : le **mode Zen** n'offre toujours
  aucun accès direct aux trois modes (le logo disparaît avec la colonne) — c'est
  le comportement accepté, `Ctrl+Shift+A` reste le chemin.
