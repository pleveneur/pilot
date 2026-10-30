# Rapport — les panneaux translucides prennent la teinte du thème, tout de suite

Demande du propriétaire : les panneaux translucides de l'interface (surfaces
translucides, effets de verre) doivent prendre la **teinte du thème actif** et
**suivre un changement de thème sans redémarrage**. Aucune couleur en dur, aucun
nouveau réglage, aucun stockage.

Départ : commit `476ba3f` (« les quatre remarques du propriétaire sur l'écran
Vocal »). Suite complète : **257 fichiers, 4849 tests, 0 échec**.

---

## 1. Ce qui n'allait pas — deux défauts, pas un

Les deux ont été établis **avant** de coder, par lecture du source (`fichier:ligne`)
puis **mesure au navigateur** (harnais HTML chargeant le vrai `style.css`, quatre
palettes : sombre, clair, nord, solarized).

### Défaut 1 — des teintes écrites en dur, donc jamais celles du thème

| Surface | Ce qui était écrit | Conséquence |
|---|---|---|
| `.modal` (`style.css:3355`) | `background: rgba(0, 0, 0, 0.5)` | noir, quel que soit le thème |
| `.gds-menu-overlay` (`:1422`), `.pdf-export-overlay` (`:2754`), `.git-diff-overlay` (`:4032`), `.agent-ext-dialog-overlay` (`:4908`) | `rgba(0, 0, 0, 0.5)` / `0.55` / `0.45` | idem |
| `.palette-backdrop` (`:6945`), `.recent-files-backdrop` (`:7127`) | `rgba(0, 0, 0, 0.5)` | idem |
| `#loading-overlay` (`:6742`), `#rag-building-overlay` (`:6785`) | `rgba(0, 0, 0, 0.25)` / `0.35` | idem |
| `.agent-status-card.active` et `.asc-chip.active` (`:8795`) | `#a6e3a133` (vert **Catppuccin**, recopié) | vert fixe dans les dix palettes |
| `.csv-table tbody tr:nth-child(even)` / `tr:hover` (`:4374`, `:4380`) | `rgba(128, 128, 160, 0.05)` / `0.12` | gris-bleu fixe |
| `.agent-message-error`, badge d'erreur, `.agent-retry-btn:hover` (`:3337`, `:4502`, `:4525`) | `rgba(243, 139, 168, …)` (rose Catppuccin) | rose fixe |
| `.help-msg-body code` / `pre` (`:7815`, `:7823`) | `rgba(255, 255, 255, 0.08)` / `rgba(0, 0, 0, 0.25)` | le jeton de code devenait **invisible en thème clair** |

### Défaut 2 — le « redémarrage requis » : l'instantané du compositeur

`.projects-dropdown` (`:1370`) et `.context-menu` (`:3952`) déclaraient
`backdrop-filter: blur(16px)` sur `background: var(--surface-floating)` —
une surface **opaque** : le flou ne montrait donc rien, c'était un pur coût de
composition.

Et surtout : une surface qui floute l'arrière-plan est composée **à part**, le
moteur garde un **instantané** de ce qu'il y a derrière. Changer de thème repeint
la page, mais **pas cet instantané** : le panneau gardait la teinte de l'ancien
thème **jusqu'au redémarrage**. C'est exactement le symptôme rapporté.

Personne n'écoutait `theme-changed` pour ces panneaux : les seuls auditeurs
étaient `editor.js`, `preview.js`, `terminal.js` et `code-graph-view.js`
(CodeMirror, terminal, graphe) — aucun pour une surface floutée.

---

## 2. Ce qui a changé

### 2.1 Une seule source de teinte : trois jetons, deux déclarations

`src/css/style.css` — `.theme-dark` (`:339`) et `.theme-light` (`:475`) :

```
--glass-tint       = 94 % de --surface-floating   · panneau flottant (« verre »)
--glass-scrim      = 62 % de --bg-app  (sombre)   · voile de modale
                     26 % de --text-primary (clair)
--glass-scrim-soft = 40 % de --bg-app  (sombre)   · voile d'attente
                     12 % de --text-primary (clair)
```

- **Rien n'est recopié** : chaque jeton est un `color-mix()` sur des variables
  déjà redéfinies par **chaque** palette. Les dix thèmes suivent donc sans une
  ligne de plus, et **aucun sous-thème ne les fige** (vérifié par test) : ils
  héritent des deux blocs de base.
- **Aucun cache, aucun redémarrage** : ce sont des variables CSS, recalculées
  dès que `document.body` change de classes — c'est `theme.js` qui pose ces
  classes, il n'y a rien à rescanner.
- **Plage 92–95 %** pour le verre : c'est la mesure déjà retenue par le panneau
  du suivi du travail (`--agent-activity-panel-alpha: 94%`). En dessous de 92 %
  le texte peut passer sous AA selon ce qu'il y a derrière, au-dessus le fond
  redevient opaque (le flou ne sert plus à rien).
- **En thème clair, les voiles viennent de l'encre** (`--text-primary`), pas du
  fond : un voile clair posé sur une application déjà claire ne masquerait rien.
  `--text-primary` reste la teinte propre du thème, donc les dix palettes suivent.

### 2.2 Les surfaces concernées prennent ces jetons (11 remplacements)

`background: var(--glass-tint)` → `.projects-dropdown` (`:1375`),
`.context-menu` (`:3953`).
`background: var(--glass-scrim)` → `.gds-menu-overlay` (`:1422`),
`.pdf-export-overlay` (`:2754`), `.modal` (`:3355`),
`.git-diff-overlay` (`:4032`), `.agent-ext-dialog-overlay` (`:4908`),
`.palette-backdrop` (`:6945`), `.recent-files-backdrop` (`:7127`).
`background: var(--glass-scrim-soft)` → `#loading-overlay` (`:6742`),
`#rag-building-overlay` (`:6785`).

Les deux menus flottants étant désormais **translucides**, leur
`backdrop-filter: blur(16px)` fait enfin son travail (il était inopérant sur un
fond opaque) — aucun changement de forme, de taille, de position ni de contenu.

### 2.3 Les autres teintes dérivées du thème (6 remplacements)

| Sélecteur | Avant | Après |
|---|---|---|
| `.agent-status-card.active` (`:8795`) | `#a6e3a133` | `color-mix(in srgb, var(--success) 20%, transparent)` |
| `.agent-status-card .asc-chip.active` (`:8801`) | `#a6e3a133` | idem |
| `.csv-table tbody tr:nth-child(even)` (`:4374`) | `rgba(128,128,160,0.05)` | `color-mix(… var(--text-primary) 4%, transparent)` |
| `.csv-table tbody tr:hover` (`:4380`) | `rgba(128,128,160,0.12)` | `color-mix(… var(--text-primary) 8%, transparent)` |
| `.agent-message-error` (`:3337`) | `rgba(243,139,168,0.08)` | `color-mix(… var(--danger) 8%, transparent)` |
| badge / `.agent-retry-btn:hover` (`:4502`, `:4525`) | `rgba(243,139,168,0.1 / 0.18)` | `color-mix(… var(--danger) 10 % / 18 %, transparent)` |
| `.help-msg-body code` (`:7815`) | `rgba(255,255,255,0.08)` | `color-mix(… var(--text-primary) 8%, transparent)` |
| `.help-msg-body pre` (`:7823`) | `rgba(0,0,0,0.25)` | `color-mix(… var(--text-primary) 6%, transparent)` |

### 2.4 Le mécanisme de recapture (le « sans redémarrage »)

`src/css/style.css` (`:13026`, **en fin de fichier**) :

```
body.glass-refresh .modal, .gds-menu-overlay, .projects-dropdown,
.context-menu, #agent-activity-dropdown {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
```

`src/js/glass-theme.js` (**nouveau**) : `refreshGlassSurfaces(win, doc)` pose la
classe, puis la retire **après deux images** (`GLASS_REFRESH_FRAMES = 2`) —
une seule image ne suffit pas : le compositeur ne recapture qu'à l'image
suivant le retrait du flou, donc une seule image laisserait l'ancien instantané.
Sans surface à l'écran, la fonction ne fait **rien** (retour 0, aucun `rAF`
programmé). `installGlassThemeRefresh(win, doc)` écoute l'évènement de thème,
**une seule fois par fenêtre** (`WeakSet`), et retourne `true` au premier
câblage.

`src/js/theme.js` : le nom de l'évènement devient une **source unique**,
`export const THEME_CHANGED_EVENT = "theme-changed"`, utilisée par `applyTheme`
pour émettre — et importée par `glass-theme.js`. Renommer l'évènement casserait
maintenant un test au lieu de cesser silencieusement de rafraîchir.

`src/js/main.js` : `installGlassThemeRefresh(window, document);` juste après
`initTheme()`.

Aucun réglage, aucun stockage, aucune préférence : le module ne fait que
basculer une classe (vérifié par test).

### 2.5 L'interface web distante

`web/css/web.css` : `--scrim` défini dans `:root` (62 % de `--bg`) et dans
`html[data-theme="light"]` (26 % de `--fg`) ; `.modal-overlay` passe de
`rgba(0,0,0,0.6)` à `var(--scrim)`.

---

## 3. Preuve empirique (mesure au navigateur, pas seulement lecture de code)

Harnais chargeant le vrai `style.css`, `getComputedStyle().backgroundColor` :

| Surface | sombre | clair | nord | solarized |
|---|---|---|---|---|
| `.modal` | `bg-app` 62 % | `#1a1d24` 26 % | `bg-app` 62 % | `#657b83` 26 % |
| `.projects-dropdown` | `#1c1f26` 94 % | `#ffffff` 94 % | `#3b4252` 94 % | `#fdf6e3` 94 % |
| `.context-menu` | idem | idem | idem | idem |
| `#agent-activity-dropdown` | déjà translucide | idem | idem | idem |
| `.agent-status-card.active` | `--success` 20 % | idem | idem | idem |
| `.help-msg-body code` | blanc 8 % | encre 8 % | blanc 8 % | encre 8 % |
| `body.glass-refresh` posée | `backdrop-filter: none` | — | — | — |
| classe retirée | `blur(16px)` | — | — | — |

Les valeurs suivent la palette dans les quatre cas (avant correctif : noirs
identiques partout, et `.help-msg-body code` invisible en clair).

---

## 4. Verrouillages

`src/js/panneaux-translucides-theme.test.js` (**nouveau**, 19 tests) : jetons
présents dans les deux thèmes de base, dérivés de variables (aucun littéral de
couleur), aucun sous-thème ne les fige, opacité du verre dans 92–95 %, le voile
masque réellement, chaque voile/verre prend le bon jeton, plus aucune couleur en
dur sur ces sélecteurs, contraste du texte du verre ≥ AA (ou ≥ son contraste
natif) sur les **dix** palettes, la liste de `body.glass-refresh` est
**identique** à celle du module et ne contient aucune couleur, l'évènement de
thème n'est jamais recopié, le rafraîchissement est branché après `initTheme()`,
comportement du module (classe posée puis retirée, aucune surface = aucun effet,
écoute unique par fenêtre), aucun `localStorage`/réglage, colonnes vocales
inchangées, `web.css` aligné.

**Onze mutations réellement rejouées** (source restaurée à chaque fois, `diff`
propre vérifié) — chacune fait échouer la suite :

| Mutation | Résultat |
|---|---|
| `--glass-scrim` retiré du thème clair | 3 échecs |
| `rgba(0,0,0,0.5)` remis sur `.modal` | 1 échec |
| `.context-menu` remis opaque (`--surface-floating`) | 1 échec |
| un sous-thème (nord) fige `--glass-tint` | 1 échec |
| une surface retirée de `body.glass-refresh` | 1 échec |
| évènement recopié dans `glass-theme.js` | 1 échec |
| `installGlassThemeRefresh` retiré de `main.js` | 1 échec |
| classe jamais posée | 2 échecs |
| pastille active remise en `#a6e3a133` | 1 échec |
| colonne `.vocal-side-tasks` peinte | 1 échec |
| voile web remis en `rgba(0,0,0,0.6)` | 1 échec |

### Un test existant mis à jour, pas assoupli

`src/js/barre-fenetre-disposer.test.js:232` exigeait
`background: var(--surface-floating)` sur `.context-menu` : il **épinglait le
défaut** (fond opaque). Son intention — « l'apparence vient des menus
contextuels, donc elle suit les palettes, aucune couleur en dur » — est
conservée et **renforcée** : la nouvelle assertion exige `var(--glass-tint)`
**et** l'absence de tout littéral de couleur dans la règle. Aucun test supprimé.

---

## 5. Ce qui n'a pas bougé

- Colonnes de l'écran Vocal (`.vocal-side-discussion`, `.vocal-side-tasks`) :
  toujours **sans fond** — mesuré `rgba(0,0,0,0)`, rien à recapturer ; le disque,
  le halo, le niveau, le micro, les trois sorties et le bouton de masquage sont
  intacts (verrouillés par les 19 tests + `ecran-vocal-*`, `vocal-*`).
- Le panneau du suivi du travail gardait déjà son verre teinté
  (`--agent-activity-panel-alpha: 94%`) : il n'a pas été modifié.
- Aucun nouveau réglage, aucune préférence, aucun fichier de configuration.

---

## 6. Points tranchés

| Cas | Décision | Pourquoi |
|---|---|---|
| `.agent-image-thumb-remove` — `rgba(0,0,0,0.7)` | **on garde** | croix blanche posée sur une **photo** : le noir est le seul fond lisible quelle que soit l'image, y compris en thème clair. Ce n'est pas une teinte de thème. |
| `.theme-light .cm-ghost-tab-hint` — `rgba(0,0,0,0.06)` | **on garde** | déjà **sous sélecteur de thème** (`.theme-light`), donc bien dépendant du thème. |
| `.help-msg-user` / `.help-msg-error` — vert et rouge en dur | hors périmètre | bulles **sémantiques** (succès/erreur) à bordure propre, pas des panneaux translucides ; les toucher risquerait une régression de la revue de code. |
| `.vocal-display-toggle` mesuré **identique** en clair/nord/solarized | **artefact de mesure, pas un défaut** | la pastille déclare `transition: background 0.18s` ; l'onglet du harnais étant en arrière-plan, la transition reste figée et `getComputedStyle` renvoie la valeur de départ. Vérifié : sa règle utilise déjà`color-mix(… var(--bg-elevated) 88%, transparent)`, donc elle **suit** le thème. Rien à corriger. |
| `.gds-menu-overlay` non mesuré au harnais | vérifié par lecture (`:1422`, `var(--glass-scrim)` + `blur(8px)`) puis **ajouté au harnais** pour la mesure finale (§ 3) | — |

---

## 7. Documentation mise à jour

- `spec_pilot.md` § D (design system) : les trois jetons, pourquoi ils dérivent
  des variables, et le mécanisme de recapture (`glass-theme.js`), avec le verrou.
- `spec_gestion_agents.md` (bloc HELP `agents`) : « la teinte est celle du thème
  actif et suit un changement de thème immédiatement ».
- `help/overview.md` (bloc HELP `theme-parametres`) : le changement de thème
  s'applique tout de suite, panneaux translucides compris, sans redémarrer.
  `help/handbook.md` régénéré (`npm run build:handbook`).

---

## 8. Commandes et comptes

```
npx vitest run src/js/panneaux-translucides-theme.test.js   → 19 tests, 0 échec
npm test                                                    → 257 fichiers, 4849 tests, 0 échec
npm run build:handbook                                      → 47 blocs, handbook régénéré
```

Commit unique de la mission (rapport, code et tests ensemble), à partir de
`476ba3f`.

---

## 9. Suites (2026-11-02) — le cadre des panneaux

Un lot suivant ajoute aux panneaux translucides un **cadre** dans la même famille
de couleur que leur texte : `--glass-frame` = `color-mix(in srgb, var(--text-secondary)
80%, transparent)`, arrondi par `--radius-lg` (12 px). Il est déclaré **au même
endroit** que `--glass-tint` / `--glass-scrim` / `--glass-scrim-soft` (`.theme-dark`
et `.theme-light`), donc il suit les **dix** palettes et un **changement à chaud**
exactement comme la teinte décrite ci-dessus — l'acquis de ce rapport est conservé.

Deux conséquences pour ce document :

- les deux colonnes de l'écran Vocal portent désormais ce cadre
  (`border: 1px solid var(--glass-frame)` + `border-radius: var(--radius-lg)` +
  `box-sizing: border-box` + `padding-inline: 10px`) : elles restent **sans fond**,
  comme § 5 l'exige ;
- `.projects-dropdown` et `.context-menu` passaient une bordure
  `1px solid var(--border-subtle)` : elle devient `1px solid var(--glass-frame)`,
  même jeton, même mécanisme. Rien d'autre ne change dans leurs règles.

Verrou du lot : `src/js/cadre-listes-panneaux.test.js`. Rapport détaillé :
`docs/rapports/RAPPORT-cadres-arrondis-panneaux.md`.
