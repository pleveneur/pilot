# Rapport — lot 0.2 « etats et clavier des boutons de fenetre »

## Point a savoir d'abord
Le **lot 0.1 n'existait pas sur le disque** : aucun `#window-bar`, aucun
`window-controls.js`, aucune permission `core:window:*`, aucun `set_decorations`.
Le lot 0.2 etant impossible sans support, j'ai pose le **strict minimum** exige par
`docs/proposition-barre-fenetre.md` (§3.1 bande de 32 px, §3.2 trois boutons, §3.6
fenetre sans cadre systeme) puis applique 0.2 a la lettre. **0.3 (immersif), 0.4
(fenetre etroite) et 0.5 (menu Disposer) ne sont pas touches.**

## Valeurs avant / apres (§4.1)
| Etat du bouton | Avant | Apres |
|---|---|---|
| Repos | (inexistant) | fond transparent, icone `--text-secondary`, 46 x 32 px, rayon `--radius-xs` |
| Survol | — | fond `--surface-3`, icone `--text-primary` |
| Appui | — | idem survol + `inset 0 1px 3px rgba(0,0,0,.35)` |
| Focus clavier | — | `:focus { outline: none }` puis `:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px }` |
| Survol de Fermer | — | fond `--surface-3` + croix `--danger` — **jamais** de fond rouge plein |
| Desactive | — | aucune regle : aucun des trois boutons ne peut l'etre |

## Contrastes reels (calcul WCAG sur les jetons de `style.css`)
| Etat | Sombre | Clair | Seuil |
|---|---|---|---|
| Repos icone / fond | `#a0a6b4`/`#0f1115` = **7.75** | `#5a6170`/`#f4f5f7` = **5.70** | 4.5 |
| Survol icone / fond | `#e6e8ee`/`#262a33` = **11.73** | `#1a1d24`/`#e6e8ee` = **13.77** | 4.5 |
| Anneau / fond | `#6b8cff` = **6.14** | `#4f6ef7` = **3.92** | 3.0 |
| Anneau / fond de survol | = **4.67** | = **3.49** | 3.0 |
| Fermer survol (croix / fond) | `#f87171` = **5.19** | `#e5484d` = **3.19** | 3.0 |
| *Ecarte* : croix blanche / `--danger` plein | = **2.77** | = 3.91 | — |

## Clavier et noms
Ordre du DOM = ordre du Tab : `Reduire` → `Agrandir` → `Fermer`, tous de vrais
`<button type="button">`, aucun `tabindex`, rien qui les retire du focus, aucun
element focusable avant eux : le **premier Tab** atteint `Reduire`, puis `Agrandir`,
puis `Fermer` (anneau visible sur chacun) ; `Shift+Tab` depuis la barre laterale y
revient. Chacun porte `title` **et** `aria-label` identiques (« Reduire »,
« Agrandir la fenetre » / « Restaurer la fenetre », « Fermer Pilot »), icone et
libelle synchronises dans les deux sens (demarrage, redimensionnement, bascule).

## Verifications
- `npm test` : **163 fichiers, 2834 tests passes, 0 echec** (nouveau verrou
  `src/js/barre-fenetre-etats.test.js`, 19 tests : etats, jetons, contrastes des
  deux themes, ordre, noms, synchronisation de l'icone, `close()` jamais `destroy()`).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` : **722 passes, 1 ignore**.
- `git status --short` : seuls les 9 fichiers du lot committes, ce rapport **non committe**.

## Reste a voir a l'ecran (hors portee d'un test unitaire)
Rendu reel des icones, nettete de l'anneau de focus sur 32 px (WebView2), glissement
par la bande et double-clic d'agrandissement, comportement maximise/restaure, survol
de Fermer dans les deux themes.
