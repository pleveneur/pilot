# Évolution : Conversion PDF → Markdown, et export Markdown → PDF

> Phase 1 et Phase 2 implémentées. L'**export Markdown → PDF** (sens inverse) est
décrit en fin de fichier — il n'utilise **aucune** impression.

## Objectif

Pour un fichier `.pdf` dans l'explorateur, ajouter au menu contextuel (clic droit) l'option **« 📝 Créer un fichier Markdown »** qui extrait le contenu du PDF et génère un `.md` structuré, le plus fidèle possible au document original.

---

## Statut

| Phase | Description | Statut |
|---|---|---|
| Phase 1 | Extraction + heuristiques (titres, paragraphes, listes, sauts de page) | ✅ Implémentée |
| Phase 2 | Amélioration IA (session pi temporaire, modèle configurable) | ✅ Implémentée |

---

## Phase 1 — Extraction heuristique

### Fonctionnement

1. Clic droit sur un `.pdf` dans l'explorateur → **📝 Créer un fichier Markdown**
2. Le PDF est chargé via PDF.js (`read_file_binary` + `pdfjsLib.getDocument`)
3. Pour chaque page, `getTextContent()` extrait les items texte avec leurs métadonnées de position
4. Heuristiques appliquées :
   - **Titres** : police > 130 % de la moyenne → `#`, `##` ou `###` selon le ratio
   - **Listes** : détection des puces (`•`, `-`, `*`, `●`, etc.) et listes numérotées
   - **Paragraphes** : regroupement par ligne (coordonnée Y), sauts de paragraphe détectés par gap vertical
   - **Séparateurs de page** : `--- *Page N*`
5. Le `.md` est écrit à côté du PDF (même nom, extension `.md`)
6. Si le fichier existe déjà, un suffixe numérique est ajouté (`-1.md`, `-2.md`...)
7. Le fichier est ouvert automatiquement dans l'éditeur

---

## Phase 2 — Amélioration IA

### Fonctionnement

Si un modèle IA est configuré dans les **Paramètres** (champ « Modèle IA pour PDF → MD », format `provider/modelId`), Pilot lance une session `pi --mode rpc --no-session` temporaire pour restructurer le Markdown extrait par la Phase 1.

Workflow :
1. Phase 1 : extraction heuristique du texte
2. Vérification : si `pdf_md_model` est renseigné dans la config
3. Lancement d'un processus pi temporaire (`--no-session`)
4. Séquence RPC : `new_session` → `set_model` → `prompt` (demande de restructuration Markdown)
5. Collecte des deltas texte jusqu'à `agent_end`
6. Écriture du Markdown restructuré dans le fichier `.md`
7. Nettoyage : le processus pi est tué après la réponse

Si la conversion IA échoue (pi non installé, modèle introuvable, timeout), le résultat de la Phase 1 est utilisé comme fallback — l'utilisateur obtient toujours un fichier `.md`.

### Configuration

- **Paramètres** → champ « Modèle IA pour PDF → MD » (ex: `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4-20250514`)
- Si le champ est vide, seule la Phase 1 (heuristiques) est utilisée
- Timeout : 120 secondes

### Fichiers

| Fichier | Rôle |
|---|---|
| `src/js/pdf-to-markdown.js` | Extraction PDF.js + heuristiques + appel IA |
| `src/js/sidebar.js` | Menu contextuel `.pdf` → handler `convertPdfToMd` |
| `index.html` | Bouton `ctx-create-md` + champ settings |
| `src/js/settings.js` | Chargement/sauvegarde du champ `pdf_md_model` |
| `src-tauri/src/lib.rs` | Config `pdf_md_model` + commande `convert_pdf_to_md_ai` |
| `src-tauri/src/rpc_manager.rs` | Fonction `convert_text_with_pi` (session temporaire) |

---

## Export Markdown → PDF (sans impression)

### Ce que fait le geste

Clic droit sur un `.md` → **📕 Exporter en PDF** : Pilot écrit un fichier PDF
**à côté du document source** (ou dans le dossier demandé par l'appelant) et
affiche un compte rendu. **Aucune fenêtre d'impression, aucun dialogue,
aucune attente de l'interface** : l'ancien chemin (aperçu `iframe` +
`window.print()`) est supprimé, et un test échoue s'il revient.

### Chaîne technique (une seule voie)

| Couche | Rôle |
|---|---|
| `src-tauri/src/pdf_export.rs` | **Écrit le PDF** (aucune dépendance nouvelle) : analyse Markdown via `pulldown-cmark`, pages A4, polices base 14, WinAnsi, images JPEG et PNG 8 bits (`flate2`, déjà présent), sérialisation PDF complète (xref, trailer, `%PDF-1.7`). Relit le fichier écrit et exige la signature `%PDF`. |
| Commande `markdown_to_pdf(sources, out_dir)` | Lot **fichier par fichier** : un échec remplit `error` pour ce fichier et **n'annule pas** les autres. `pub async fn` + `spawn_blocking` : la conversion ne tient jamais le fil d'affichage (verrou `commandes-agent-non-bloquantes.test.js`). Rend `PdfExportReport { results, produced, failed }`. |
| `src/js/pdf-gateway.js` | **Cœur pur partagé** (aucun DOM, aucune I/O) : décisions de demande, de compte rendu et de réponse d'outil. Un seul exemplaire logique, utilisé par la fenêtre, les trois canaux d'agent et les tests. |
| `src/js/pdf-export.js` | **Point d'exécution unique** `runPdfExportRequest` (fenêtre **et** agents) + la fenêtre de compte rendu (fermeture toujours possible, `Échap`). |
| `src-tauri/extensions/pilot-pdf.ts` | Outil **`export_markdown_pdf`** (agents) : `sources` (tableau de chemins absolus) + `out_dir` optionnel, `executionMode: "sequential"`. |
| `src/js/machine-sentinel.js` | Famille de sentinelle `PILOT_PDF_EXPORT::` : la demande de confirmation n'est **jamais** affichée brute (« Je vais convertir le document en PDF… »), et une action interne déjà exécutée n'est pas reprise comme une question à l'utilisateur. |

### Les canaux qui déclenchent la même conversion

1. **Le geste** : clic droit → Exporter en PDF (`sidebar.js` → `exportMarkdownToPdf`).
2. **La session de l'Assistant** (`super-agent.js`).
3. **Le relais des questions d'agents** vers la conversation de l'Assistant (`super-agent.js`).
4. **Le chat du projet** (`agent-pi.js`) et les **agents en arrière-plan**
   (`agents-bus.js`, qui notifie l'utilisateur du résultat).

Tous passent par `runPdfSentinelRequest` → `runPdfExportRequest` →
`invoke("markdown_to_pdf")`. Aucun ne réimplémente la conversion.

### Limites dites honnêtement

- **Position du texte** : une ligne du PDF est **un seul objet texte** dont les
  morceaux (normal, gras, italique, code) se suivent — c'est le **moteur PDF qui
  avance** avec les largeurs réelles de la police. Aucune position n'est
  calculée morceau par morceau : deux mots ne peuvent donc pas se coller (défaut
  « codagepi » corrigé, verrou `une_ligne_est_un_seul_objet_texte`).
- **Largeurs de caractères** : celles de Helvetica / Helvetica-Bold (fichier
  AFM) pour l'ASCII et pour le **latin-1 accentué** ; au-delà, valeurs des
  polices base 14 quand elles existent (`œ`, `Œ`, `€`, `—`, `–`, `…`, `•`,
  guillemets courbes) et approximation par classe pour le reste. Ces largeurs
  ne servent plus qu'au **découpage en lignes** et aux centrages : au pire un mot
  se coupe un peu tôt, jamais il ne se colle à son voisin.
- **Pas d'incorporation de fonte** : polices **base 14** du format PDF (aucun
  fichier à télécharger), encodage `WinAnsi`. Un caractère qui a un équivalent
  ASCII honnête est traduit (`→` en `>`, pleine chasse ramenée à l'ASCII,
  `π` du projet écrit `pi`, `ℓ` en `l`) ; une lettre non représentable devient
  `?` : jamais un octet inventé. Les **émojis** sont retirés (même règle que le
  texte lu à voix haute) — un titre qui n'était qu'un émoji entre parenthèses
  peut donc laisser `()` ; c'est la seule déformation possible du texte.
- **Images** : JPEG (non CMJN) et PNG 8 bits non entrelacé. Tout le reste rend
  une **ligne visible** `[image non incorporée : … (raison)]` — jamais un
  blocage, jamais un silence.
- **Aucun accès réseau** : une image `http(s)://` ou `data:` n'est pas récupérée.


<!-- HELP:pdf -->
## PDF : conversion en Markdown et export

- **Conversion PDF → Markdown** : dans l'explorateur (barre latérale),
  **clic-droit sur un fichier `.pdf`** → « 📝 Créer un fichier Markdown ».
  Pilot extrait le texte du PDF puis le fait restructurer en Markdown propre par
  l'IA (agent Pi). Le fichier `.md` est créé à côté du PDF et s'ouvre dans un
  onglet. Modèle utilisé : Options ⚙️ → « Modèle de conversion PDF → MD ».
- **Export PDF** : dans l'explorateur, **clic-droit sur un fichier `.md`**
  (ou `.markdown`, `.mdx`) → « 📕 Exporter en PDF ». Pilot écrit un **vrai
  fichier PDF** à côté du document, **sans fenêtre d'impression et sans
  dialogue** : la conversion se fait en arrière-plan, vous pouvez continuer à
  travailler pendant ce temps, et le bouton **Fermer** de la fenêtre de compte
  rendu répond toujours. À la fin, un compte rendu dit **ce qui a été produit**
  (chemin, taille, nombre de pages) et **ce qui a échoué**, fichier par fichier ;
  l'échec d'un fichier **n'annule pas** les autres.
- **Demandez-le à l'agent** : l'outil « export_markdown_pdf » est à la
  disposition des agents. « Convertis ces trois notes en PDF » → l'agent demande
  votre accord, écrit les fichiers et vous montre **où** ils sont.
- **Mise en page** : A4, titres, listes, tableaux, citations, blocs de code,
  images PNG et JPEG. Une image qui ne peut pas être incorporée **n'arrête
  jamais** la conversion : une ligne visible dit laquelle et pourquoi.
<!-- /HELP:pdf -->
