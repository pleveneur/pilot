# Évolution : Conversion PDF → Markdown

> Phase 1 et Phase 2 implémentées.

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

<!-- HELP:pdf -->
## PDF : conversion en Markdown et export

- **Conversion PDF → Markdown** : dans l'explorateur (barre latérale),
  **clic-droit sur un fichier `.pdf`** → « 📝 Créer un fichier Markdown ».
  Pilot extrait le texte du PDF puis le fait restructurer en Markdown propre par
  l'IA (agent Pi). Le fichier `.md` est créé à côté du PDF et s'ouvre dans un
  onglet. Modèle utilisé : Paramètres ⚙️ → « Modèle de conversion PDF → MD ».
- **Export PDF** : dans l'explorateur, **clic-droit sur un fichier `.md`** →
  « 📕 Exporter en PDF ». Génère un PDF rendu de la prévisualisation Markdown.
<!-- /HELP:pdf -->
