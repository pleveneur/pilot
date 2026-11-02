# Proposition — les Réglages deviennent un onglet (et cessent d'être une fenêtre)

> **Statut : proposition à appliquer.** Le contenu du lot 7 est **figé** (en-tête, « Accès
> directs », nav 200 px, 4 groupes, pied) : seule la **forme** change. Le contenu est
> **déplacé** dans l'onglet, jamais recopié. Chaque affirmation porte sa preuve `fichier:ligne`.

## 0. La décision

`#settings-modal` (`index.html:389`) cesse d'être une fenêtre : son nœud est déplacé tel quel dans
le conteneur d'onglets et prend la classe `.modal-in-tab`, qui neutralise *uniquement* le
positionnement de fenêtre (`style.css:3005-3017`). Le balisage interne (`index.html:390-1431`)
reste **identique** : c'est ce qui garantit que rien du lot 7 ne bouge.

## 1. Ouverture de l'onglet

- **Geste** : clic sur `#btn-settings` (« Réglages ») — `index.html:85`, `settings.js:1643`.
- **`mode`** : `"settings"` ; **titre** : `Réglages`, le mot du bouton et de l'en-tête
  (`index.html:85` / `:394-396`) ; **icône** : aucune ; couleur `.tab-special` en ajoutant `"settings"` à `tabs.js:3012` (`style.css:2245`).
- **Déjà ouvert** : `switchTab(existing.id)`, **aucun rechargement** — modèle `_openVault`
  (`tabs.js:1158-1170`). **Palette** : commande `settings` → « Ouvrir les Réglages » (`main.js:56-74`).
- **Autres entrées** : `pilot-open-settings` (santé pi, Assistant) ouvre le même onglet sur la
  catégorie demandée (`tabs.js:619`, `super-agent.js:3425`/`:3580`, `settings.js:2509`).
- **Cycle de vie** : transverse, survit à une bascule de projet (`tab-scoping.js:42`, `:52`).

`_openSettings()` copie `_openVault` : `find(t.mode === "settings")` → `switchTab` ; sinon
`++tabIdCounter`, `wrapper.className = "editor-wrapper settings-wrapper"`, `switchTab`, puis
`const { createSettings } = await import("./settings.js")` (**import dynamique**, comme le coffre :
aucun cycle `tabs ↔ settings`).

## 2. Ce qui disparaît, ce qui survit

**Disparaît (la forme seulement)**
- Le conteneur-fenêtre `position: fixed; inset: 0; z-index: 100`, fond `rgba(0,0,0,.5)`,
  `backdrop-filter: blur(8px)` (`style.css:3006-3018`) et la taille `920px / 92vw / 88vh` (`:3068`).
- Le carton flottant (fond, bordure, rayon, `--shadow-lg`, `style.css:3024-3036`) → transparent :
  les panneaux posent déjà `--surface-2` (`:367`/`:460`), et les deux `animation` (pop-in, zoom du
  clic par `animateModalOpen`, `modal-anim.js:22`) — l'onglet zoome déjà par `animatePanelOpen`.
- La fermeture au clic d'un « accès direct » (`settings.js:409-412`) : son seul motif était
  « l'onglet ouvert resterait caché derrière la fenêtre ».
- *Rien d'autre* : ni Échap ni clic extérieur n'existaient (`settings.js:1634-1635`, seule la modale d'audit en a un).

**Survit à l'identique** — les 11 clés internes `general`, `avatar`, `agent`, `models`,
`providers`, `rag`, `codegraph`, `remote`, `mcp`, `laya`, `superagent` (`index.html:420-445`) ; les
4 portes `btn-vault`, `btn-feedback`, `btn-gds-admin`, `btn-gds-params` (`index.html:406-409`) et
leur câblage intact (`main.js:823`, `:835`, `:842`, `:849`) ; la nav 200 px (`style.css:3316`), les 4
groupes (`:3327`), l'en-tête 15/11 px (`:3226`), la bascule interne (`settings.js:374-400`, scopée à
`modal.querySelectorAll`, insensible au déplacement), le pied collé en bas (`style.css:3068` + `:3309`
`min-height: 0` + `:3377` : les panneaux défilent, le pied reste visible).

## 3. Le pied « Annuler / Enregistrer » — décision

**Constat (mixte, donc à trancher) :** l'enregistrement est réel et différé — `btnSave` appelle
`save_config` (`settings.js:2807`) — mais beaucoup de cases persistent **immédiatement**
(`settings.js:1602`, `:1608-1620`, `:2593`, `:2480-2490`). D'où : **on garde le pied**
(« Annuler » à gauche, « Enregistrer » à droite, `index.html:1430-1431`), mais il ne ferme plus rien.

- **Enregistrer** : `save_config` + `applyTheme` + toast « Réglages enregistrés » ; l'onglet reste
  ouvert → on voit le résultat de ce qu'on vient de changer.
- **Annuler** : relit `get_config`, **remplit à nouveau** le formulaire, annule l'aperçu de thème
  (`applyTheme(savedTheme, savedSubtheme)`) et `stopReading()` (`settings.js:2500`) ; on reste ouvert.
- **✕ de l'onglet** = exactement « Annuler », puis `unlisten()` remet le nœud dans `body` avec
  `.hidden` : l'application redevient ce qu'elle était avant.

Dans une fenêtre, « Annuler » devait *sortir* de l'écran ; dans un onglet, sortir de l'écran est un
✕ et le pied sert à ce qu'il dit. Aucun réglage n'est perdu en silence.

## 4. Clavier et souris

- **Réglages déjà ouvert** : ramène l'onglet (`tabs.js:1158`). **Clic extérieur** : rien (n'existait
  pas — `settings.js:1634-1635`).
- **`Échap`** : rien, l'onglet ne se ferme pas (`main.js:683` : Échap ne masque que le menu
  contextuel ; aucun autre onglet de Pilot ne se ferme ainsi).
- **Changer d'écran** : `Ctrl+Tab` / `Ctrl+Shift+Tab` / `Ctrl+1…9` (`main.js:898-915`). **✕ de
  l'onglet** : « Annuler » puis retrait (`closeTab`, `tabs.js:1826`).

## 5. Ce qui ne doit pas changer (verrous)

- Les 11 `data-settings-tab` / `data-settings-panel` et l'ordre des groupes ; les 4 ids `btn-*` des
  accès directs et leur câblage `main.js` ; `#btn-settings` + « Réglages » (`lot2-colonne-haut.test.js:182-199`).
- `reglage-voix-onglet-assistant.test.js:50-55` découpe `index.html` sur `<div class="settings-panel"`
  → ne pas réindenter ; `settings-defaults.test.js:27` → aucun `id` de champ supprimé.
- `apercu-voix-parametres.test.js:236-249` : **seul test qui change de prémisse** (il exige un
  `classList.add("hidden")` après `stopReading()` dans `btnClose` et `btnSave`). Il doit vérifier le
  même fond — aucun son orphelin — sur **Annuler**, **Enregistrer** et **`unlisten()`**.
- `tab-scoping.test.js` : ajouter `"settings"` à `GLOBAL_TAB_MODES` n'enlève aucune garantie.

## 6. Pièges réels trouvés dans le code

1. **`hidden` viderait l'onglet** : `settings.js:2504` et `:2883` font `modal.classList.add("hidden")`
   → **supprimer ces deux lignes** (test §5) ; le `remove("hidden")` se fait dans `createSettings`.
2. **Écouteurs de thème** : `selectTheme`/`selectSubtheme` sont liés dans le handler d'ouverture
   (`settings.js:1871-1877`) → un écouteur de plus à chaque ouverture ; les lier dans `initSettings`.
3. **Mode « assistant seul »** : `.superagent-immersive-active .modal` monte les modales à
   `z-index: 99995` (`style.css:10597-10599`) ; un onglet est *sous* l'overlay → ⚙ depuis l'overlay
   ouvrirait un onglet invisible : appeler `exitImmersive()` avant le dispatch (`super-agent.js:3424`).
4. **`btnClose.click()` sert de « fermer la fenêtre »** aux 4 accès directs (`settings.js:409-412`)
   → boucle à supprimer. **`remoteBadge` fait `btnSettings.click()`** (`settings.js:3076`) : garder
   le gestionnaire sur `btn-settings`, simplement redirigé vers l'onglet.
5. **Styles partagés** : `.modal`, `.modal-content`, `.modal.hidden`, `.modal-actions` servent aux
   autres fenêtres → tout est porté par `#settings-modal.modal-in-tab` (id, zéro effet de bord).
6. **`saveTabSession` ignore les onglets sans `path`** (`session-persistence.js:26-33`) : pas de
   restauration au redémarrage — acceptable (comme Coffre).
7. **Cycle de vie Laya** (`settings.js:2304`/`:2310`) : `unlisten()` appelle aussi
   `stopLayaModelPoll()` et `stopLayaProgressListener()` (`:2347`/`:2358`).

CSS à ajouter (bloc unique, après `style.css:3068`) :

```css
.editor-wrapper.settings-wrapper { overflow: hidden; }
#settings-modal.modal-in-tab { position: static; inset: auto; z-index: auto;
  background: none; backdrop-filter: none; animation: none; flex: 1; min-height: 0; }
#settings-modal.modal-in-tab > .modal-content.settings-content {
  width: 100%; max-width: none; max-height: none; height: 100%; margin: 0;
  border: 0; border-radius: 0; box-shadow: none; background: transparent; animation: none; }
```

Fenêtre étroite : rien à ajouter — les champs sont déjà empilés (libellé puis `input` à 100 %,
`style.css:3116-3121`) et la nav garde ses 200 px validés.

## 7. Lots (2, ordre imposé : onglet d'abord, fenêtre ensuite)

- **Lot A — préparation invisible** : extraire le remplissage dans `fillSettingsFromConfig(config)`
  depuis `settings.js:1643-1881` ; lier les écouteurs de thème une seule fois (piège 2) ; ajouter le
  bloc CSS `modal-in-tab` (inerte) ; ajouter `"settings"` à `GLOBAL_TAB_MODES`.
- **Lot B — bascule atomique** : `_openSettings` + `mode` + `special` + branche `closeTab` +
  `createSettings` (déplacement et retour du nœud) + `btn-settings` et `pilot-open-settings` vers
  l'onglet + commande palette + suppression des deux `add("hidden")` et de la boucle des accès
  directs + `exitImmersive()` (piège 3) + adaptation du test du §5.

Après A l'application est inchangée, après B les Réglages sont dans un onglet. Si `createSettings`
échoue, l'erreur s'affiche **dans l'onglet** et `unlisten()` rend le nœud à `body`.

## 8. Questions fermées (3 au plus)

1. Le ✕ de l'onglet vaut « Annuler » (rien de perdu en silence) — ou confirmer si des champs ont changé ?
2. Garde-t-on les **deux** boutons « Annuler / Enregistrer » (recommandé, §3), plutôt qu'un seul
   « Fermer » à application immédiate ?
3. En mode « assistant seul », cliquer ⚙ **quitte le mode** (piège 3) : OK, ou l'interdire avec un message ?

DONE: docs/proposition-reglages-en-onglet.md, 140 lignes, 2 lots, 3 questions
