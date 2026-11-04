# Rapport — Exporter un Markdown en PDF sans fenêtre d'impression

Date : 2026-11-04
Périmètre : `src-tauri/src/pdf_export.rs` (nouveau), `src-tauri/extensions/pilot-pdf.ts`
(nouveau), `src/js/pdf-gateway.js` (nouveau), `src/js/pdf-export.js` (réécrit),
`src/js/machine-sentinel.js`, `src/js/super-agent.js`, `src/js/agent-pi.js`,
`src/js/agents-bus.js`, `src-tauri/src/agent_service.rs`, `src-tauri/src/lib.rs`,
`src/css/style.css`, `spec_pdf2md.md`, `spec_pilot.md`, `AGENTS.md`, `help/handbook.md`.

---

## 1. Le problème

L'action « 📕 Exporter en PDF » (clic droit sur un `.md`) passait par l'impression
du navigateur embarqué : un `iframe` hors écran, `contentWindow.print()` et la
fenêtre d'impression de WebView2. Résultat constaté par l'utilisateur : le geste
« mouline en permanence » et **fige l'application**, aucun PDF n'est écrit, et
le bouton « Fermer » de la fenêtre modale est le seul recours.

## 2. Ce qui a été fait

### 2.1 Une commande interne qui écrit un VRAI PDF

`src-tauri/src/pdf_export.rs` (~1 900 lignes) est un **écrivain PDF en Rust pur**,
sans nouvelle dépendance téléchargée (seul `flate2`, déjà présent dans le
verrouillage, sert à décoder les PNG) :

| Élément | Rôle |
|---|---|
| `parse_blocks` | Markdown → blocs de rendu (titres, paragraphes, listes, citations, code, tableaux, images) via `pulldown-cmark` 0.12.2 |
| `render_markdown_pdf` | blocs → flux PDF (A4, polices base 14, WinAnsi) |
| `markdown_to_pdf_blocking` | **traitement d'un lot**, fichier par fichier |
| `convert_one` | un fichier : refus si non-Markdown, lecture, rendu, écriture, **relecture** |
| `serialize_pdf` | catalogue, `Pages`, polices, XObjects, table `xref`, trailer, `%PDF-1.7` … `%%EOF` |
| `#[tauri::command] pub async fn markdown_to_pdf(sources, out_dir)` | la commande exposée, en `spawn_blocking` |

Le PDF produit est **vérifié après écriture** (`has_pdf_signature` + taille
réelle) : un fichier vide ou tronqué est un **échec nommé**, jamais un succès.

### 2.2 Hors du fil d'affichage

```rust
tauri::async_runtime::spawn_blocking(move || {
    markdown_to_pdf_blocking(&sources, out_dir.as_deref())
})
.await
```

Patron déjà en place dans le projet et déjà verrouillé par
`src/js/commandes-agent-non-bloquantes.test.js` (`pub async fn` **et**
`spawn_blocking` exigés). Les images sont lues et décodées dans ce même fil de
travail : aucune boucle bloquante sur le fil de la fenêtre.

### 2.3 L'outil mis à disposition des agents

`src-tauri/extensions/pilot-pdf.ts` (embarquée, écrite par
`agent_service::write_pdf_extension` aux **4 sites** de copie d'extensions) :

- outil `export_markdown_pdf`, `executionMode: "sequential"` ;
- paramètres `sources` (un ou plusieurs `.md`) et `out_dir` (facultatif) ;
- délai d'attente `PILOT_UI_OPTS = { timeout: 180_000 }` en **littéral** (le
  garde-fou statique `extensions-ui-timeout.test.js` lit la source, il n'évalue
  pas un import) ;
- l'échec d'écriture de l'extension est **remonté** (`BatchReport` +
  `log_extension_failures`), jamais avalé.

### 2.4 Le geste « Exporter en PDF » ne passe plus par l'impression

`src/js/pdf-export.js` est **entièrement réécrit** autour de deux points uniques :

- `runPdfExportRequest` → `invoke("markdown_to_pdf", { sources, outDir })` ;
- `runPdfSentinelRequest` → même appel, pour les trois canaux agents.

L'`iframe`, le `contentWindow.print()` et toute dépendance au dialogue
d'impression ont disparu. La modale affiche le **rapport ligne par ligne**
(`.pdf-export-report`, `.pdf-export-line`, `-ok`, `-fail`), et le bouton
« Fermer » `#pdf-export-close` n'est **jamais** désactivé (Échap ferme aussi).

### 2.5 Les quatre canaux qui déclenchent la même conversion

| Canal | Point d'entrée |
|---|---|
| Clic droit « Exporter en PDF » | `sidebar.js` → `exportMarkdownToPdf` |
| Session de l'Assistant 🧭 | `super-agent.js` (avant `SCHEDULE_SENTINEL`) |
| Relais des questions d'agent (onglet chat) | `agent-pi.js` |
| Agents en arrière-plan (bus) | `agents-bus.js` (+ `notify` de fin) |

Tous passent par `runPdfSentinelRequest` → `runPdfExportRequest` →
`invoke("markdown_to_pdf")`. Aucun ne réimplémente un rendu.

La sentinelle `PILOT_PDF_EXPORT::` a sa **famille propre** dans
`machine-sentinel.js` (phrase française : « Je vais convertir le document en PDF
et l'enregistrer sur cet ordinateur, sans fenêtre d'impression. Je continue ? »),
et `isSelfAnsweredMachineRequest` la reconnaît pour ne pas réclamer de réponse.

### 2.6 Un lot : un fichier par fichier, un échec n'annule pas les autres

`PdfExportReport { produced, failed, results: Vec<PdfFileResult> }` : chaque
fichier a son entrée (`source`, `output`, `bytes`, `pages`, `error`). Le lot
continue après un échec, et le total annoncé est **mesuré**, pas déclaré.

## 3. Le défaut trouvé pendant la vérification, et corrigé

Le premier PDF réel produit collait deux mots : `codagepi`, `ePasser`. Cause
exacte : chaque morceau de style (normal / gras / italique / code) était
**positionné à la main** (`Td`) à partir d'une largeur calculée. Les largeurs
AFM n'étant connues que pour l'ASCII, tout caractère hors ASCII était approximé,
et l'erreur **se cumulait** jusqu'à faire chevaucher le morceau suivant.

Mesure du décalage : pour la phrase
`HTML/CSS/JS/Vite) dont le cœur est constitué des agents IA de codage `, la
largeur calculée valait 333,83 pt, d'où un `Td` à `x = 389,83` — alors que le
rendu réel du `œ` de `cœur` (0,944 em) plaçait la fin du texte **après** 389,83.

**Correction à la racine** : une ligne du PDF est désormais **un seul objet
texte**. Les morceaux s'y enchaînent (`/F1 … Tf (…) Tj /F2 … Tf (…) Tj`) et c'est
le **moteur PDF** qui avance avec les largeurs réelles de la police. Plus aucune
position calculée au milieu d'une ligne : le décalage cumulé est impossible, et
cela vaut aussi pour les caractères que nous ne savons pas mesurer.

Les largeurs approchées ne servent plus qu'au **découpage en lignes** et aux
centrages (au pire un mot se coupe un peu tôt, jamais il ne se colle).

Verrou : `une_ligne_est_un_seul_objet_texte` (exactement 1 `BT`, 1 `Td`, les
trois polices dans le même objet). Il échoue si le positionnement morceau par
morceau revient.

### Encodage : replis visibles, jamais d'octet inventé

WinAnsi (l'encodage des polices base 14) ne sait pas tout écrire :

- `→` → `>`, `←` → `<`, `↔` → `-`, `≈` → `~` ;
- formes pleine chasse ramenées à l'ASCII (`＋` → `+`) ;
- `π` (nom de l'onglet de l'agent) → `pi`, `ℓ` → `l` ;
- accents latin-1 et ponctuation typographique (`—`, `–`, `…`, `•`, `œ`, `€`,
  guillemets courbes) écrits **tels quels** en WinAnsi ;
- une lettre non représentable (cyrillique…) devient `?` : visible, jamais
  silencieuse ;
- un **émoji** est retiré (même règle que le texte lu à voix haute,
  `speech-text.js`) ; un morceau qui ne donne plus aucun caractère ne laisse pas
  d'objet texte vide.

## 4. Preuves

### 4.1 PDF réels, relus sur le disque

Conversion de **deux documents réels du projet** (`README.md`, `AGENTS.md`),
par la commande elle-même (test `un_vrai_document_du_projet_se_convertit_sans_impression`) :

```
%TEMP%\pilot-pdf-vrais-documents-4268-1793772404938111800\
  README.pdf   139.4K   Pages: 18   Page size: 595.28 x 841.89 pts (A4)
  AGENTS.pdf   168.0K   Pages: 18   Page size: 595.28 x 841.89 pts (A4)
  PDF version: 1.7
```

`pdftotext` restitue le contenu (titre, paragraphes, listes, tableaux, blocs de
code) ; rendu contrôlé à 100 dpi (pages 1 et 4) : titres, gras, italique,
puces, tableaux et code corrects, **aucun mot collé** après la correction.

Conversion d'un document de contrôle
(test `un_document_complet_est_ecrit_puis_relu_sur_le_disque`) : PDF de
**3 030 octets**, commence par `%PDF-1.7`, finit par `%%EOF`, 1 page A4,
`/Subtype /Image` présent (PNG incorporé), `bytes` annoncés = octets réels,
aucun `.part` laissé.

### 4.2 La conversion ne tourne pas sur le fil de l'interface

Test `la_conversion_s_execute_hors_du_fil_de_l_interface` : un document de
400 sections est converti par la **vraie commande** ; le moteur note son
`ThreadId` dans un témoin (`FIL_DE_CONVERSION`) et le test exige
`fil_conversion != fil_appelant`. Il échoue si `spawn_blocking` disparaît.
Le rapport est complet (`produced == 1`, `failed == 0`, plusieurs pages, PDF
sur le disque).

### 4.3 Un échec n'annule pas les autres

Test `un_lot_traite_chaque_fichier_et_un_echec_n_annule_pas_les_autres` :
trois sources dont une invalide → deux PDF écrits, un échec **nommé** dans son
entrée, le lot va au bout. `un_fichier_non_markdown_est_refuse_sans_rien_ecrire`
vérifie qu'aucun fichier n'est créé pour une source refusée.

### 4.4 Plus aucune impression dans le chemin

Recherche sur le front et les extensions (hors fichiers de test) :
`window.print`, `contentWindow.print`, `printDialog`, `.print()` →
**zéro occurrence**. `src/js/pdf-gateway.test.js` échoue si l'un revient, si un
`iframe` réapparaît, ou si `#pdf-export-close` est un jour `disabled`.

### 4.5 Suites complètes

| Suite | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **861 passed ; 0 failed ; 1 ignored** (10,7 s) |
| dont `pdf_export` | **23 tested / 0 failed** |
| `npm test` (vitest) | **290 fichiers / 5 362 tests passed** |
| `npm run build:handbook` | 47 blocs, 329 370 octets (topic `pdf` inclus) |

Aucun test existant n'a été assoupli ni supprimé ; `panneaux-translucides-theme.test.js`
(qui référence `.pdf-export-overlay`), `commandes-agent-non-bloquantes.test.js`,
`extensions-ui-timeout.test.js` et `sentinelle-jamais-affichee-brute.test.js`
passent avec leur sens d'origine.

## 5. Limites dites honnêtement

- **Pas d'incorporation de fonte** : polices base 14 (aucun fichier à
  télécharger) en WinAnsi. Un caractère hors WinAnsi suit les replis du § 3.2 ;
  les émojis sont retirés. Conséquence visible possible : un titre qui n'était
  qu'un émoji entre parenthèses laisse `()` — seule déformation de texte
  possible, documentée dans `spec_pdf2md.md`.
- **Largeurs** : AFM réelles pour l'ASCII et le latin-1 accentué, valeurs des
  polices base 14 quand elles existent, approximation ailleurs — utilisé
  uniquement pour le découpage en lignes.
- **Images** : JPEG (non CMJN) et PNG 8 bits non entrelacé incorporés ; tout le
  reste produit une **ligne visible** `[image non incorporée : … (raison)]`.
- **Aucun accès réseau** : une image `http(s)://` ou `data:` n'est pas récupérée.
- `pdftoppm` affiche des `Syntax Error: No display font for …` : c'est la
  recherche par Poppler de polices **non incorporées**, sans effet sur le rendu
  (polices base 14) — bruit de l'outil, pas un défaut du fichier.

## 6. Pour revérifier

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib pdf_export
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx vitest run src/js/pdf-gateway.test.js
npm test
npm run build:handbook
```

Le PDF de contrôle le plus lisible est celui du test des vrais documents, sous
`%TEMP%\pilot-pdf-vrais-documents-*\` : `pdfinfo README.pdf` puis
`pdftoppm -r 100 -png -f 1 -l 1 README.pdf page`.
