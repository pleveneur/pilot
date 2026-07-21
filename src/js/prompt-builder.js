// prompt-builder.js — Onglet Prompt Builder (construction de prompts avec contexte)

import { invoke } from "@tauri-apps/api/core";
import { toastError, toastWarning } from "./toast.js";

// Lazy-load markdown-it pour isoler d'éventuelles erreurs d'import
let md = null;
async function getMd() {
  if (!md) {
    try {
      const markdownit = (await import("markdown-it")).default;
      md = markdownit({ html: false, linkify: true, typographer: true, breaks: true });
    } catch (err) {
      console.error("[PromptBuilder] Erreur chargement markdown-it:", err);
      // Fallback : ne pas rendre le Markdown, afficher le texte brut
      md = {
        render: (text) => `<pre style="white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`
      };
    }
  }
  return md;
}

// ── Templates intégrés ──
const BUILTIN_TEMPLATES = {
  "code-review": {
    label: "🔍 Code Review",
    instructions: "Fais une code review approfondie des fichiers sélectionnés. Analyse :\n- La qualité du code et la lisibilité\n- Les bugs potentiels et erreurs de logique\n- Les vulnérabilités de sécurité\n- Les problèmes de performance\n- Le respect des bonnes pratiques et conventions\n\nPropose des améliorations concrètes avec des exemples de code."
  },
  "refactor": {
    label: "🔧 Refactorisation",
    instructions: "Refactore les fichiers sélectionnés en appliquant :\n- Les principes SOLID et DRY\n- L'extraction de fonctions/duplication de code\n- L'amélioration de la lisibilité et de la maintenabilité\n- La simplification de la logique complexe\n\nConserve le comportement existant. Montre les changements proposés avec des diffs."
  },
  "generate-docs": {
    label: "📖 Générer documentation",
    instructions: "Génère une documentation complète pour les fichiers sélectionnés :\n- Commentaire JSDoc/docstring pour chaque fonction publique\n- Documentation des types et paramètres\n- Exemples d'utilisation\n- Un README si pertinent\n\nUtilise le style de documentation adapté au langage de chaque fichier."
  },
  "add-tests": {
    label: "🧪 Ajouter des tests",
    instructions: "Écris des tests unitaires complets pour les fichiers sélectionnés :\n- Teste chaque fonction publique et ses cas limites\n- Inclue les cas nominaux et les cas d'erreur\n- Utilise le framework de test du projet (ou suggère-en un)\n- Vise une couverture maximale\n\nMontre le code de test complet, prêt à être exécuté."
  },
  "explain": {
    label: "💡 Expliquer le code",
    instructions: "Explique le code des fichiers sélectionnés de façon claire et pédagogique :\n- L'architecture et la structure globale\n- Le rôle de chaque fonction/classe importante\n- Le flux de données et les dépendances\n- Les design patterns utilisés\n\nAdapte l'explication pour un développeur junior qui découvre le projet."
  },
  "find-bugs": {
    label: "🐛 Trouver les bugs",
    instructions: "Analyse les fichiers sélectionnés pour trouver tous les bugs potentiels :\n- Erreurs de logique et conditions de course\n- Fuites mémoire et erreurs de gestion des ressources\n- Gestion défectueuse des erreurs et exceptions\n- Problèmes de validation des entrées\n\nPriorise les bugs par sévérité (critique, majeur, mineur) et propose un correctif pour chacun."
  }
};

/**
 * Crée l'onglet Prompt Builder.
 * @param {HTMLElement} container - Élément conteneur (.editor-wrapper)
 * @param {object} sidebar - Instance de la Sidebar
 * @returns {Promise<{wrapper: HTMLElement, unlisten: Function}>}
 */
export async function createPromptBuilder(container, sidebar) {
  const wrapper = document.createElement("div");
  wrapper.className = "prompt-builder-container";

  // ── En-tête ──
  const header = document.createElement("div");
  header.className = "prompt-builder-header";
  header.innerHTML = `
    <span class="prompt-builder-title">🧩 Prompt Builder</span>
    <span class="prompt-builder-hint">📂 Clic-droit sur un fichier → « Ajouter au Prompt Builder »</span>
  `;
  wrapper.appendChild(header);

  // ── Corps principal (split vertical) ──
  const body = document.createElement("div");
  body.className = "prompt-builder-body";

  // ── Panneau gauche : contrôles ──
  const panel = document.createElement("div");
  panel.className = "prompt-builder-panel";

  // Zone d'instructions
  const instrLabel = document.createElement("label");
  instrLabel.className = "pb-label";
  instrLabel.textContent = "📝 Instructions";
  panel.appendChild(instrLabel);

  const instructionsEl = document.createElement("textarea");
  instructionsEl.className = "pb-instructions";
  instructionsEl.placeholder = "Ex: Fais une code review de ces fichiers, vérifie les bonnes pratiques...";
  instructionsEl.rows = 4;
  panel.appendChild(instructionsEl);

  // Sélecteur de template
  const tmplRow = document.createElement("div");
  tmplRow.className = "pb-template-row";
  tmplRow.innerHTML = `
    <label class="pb-label" style="margin-bottom:0;">📋 Template</label>
    <div class="pb-template-select-row">
      <select class="pb-template-select" id="pb-template-select">
        <option value="">-- Aucun --</option>
      </select>
      <button class="pb-btn pb-btn-sm" id="pb-btn-save-template" title="Enregistrer comme template">💾</button>
    </div>
  `;
  panel.appendChild(tmplRow);

  // Liste des fichiers sélectionnés
  const filesLabel = document.createElement("label");
  filesLabel.className = "pb-label";
  filesLabel.id = "pb-files-label";
  filesLabel.textContent = "📂 Fichiers sélectionnés (0)";
  panel.appendChild(filesLabel);

  const filesList = document.createElement("div");
  filesList.className = "pb-files-list";
  filesList.id = "pb-files-list";
  filesList.innerHTML = '<div class="pb-files-empty">📂 Cliquez-droit sur un fichier dans l\'arborescence → « Ajouter au Prompt Builder »</div>';
  panel.appendChild(filesList);

  // Options d'assemblage
  const optionsRow = document.createElement("div");
  optionsRow.className = "pb-options-row";
  optionsRow.innerHTML = `
    <label class="pb-option" title="Inclure l'arborescence globale du projet">
      <input type="checkbox" id="pb-opt-tree" /> Arborescence
    </label>
    <label class="pb-option" title="Limite la profondeur de l'arborescence">
      <select id="pb-opt-tree-depth" class="pb-opt-depth">
        <option value="1">1 niveau</option>
        <option value="2" selected>2 niveaux</option>
        <option value="3">3 niveaux</option>
        <option value="0">Complète</option>
      </select>
    </label>
  `;
  panel.appendChild(optionsRow);

  // Afficher/cacher la profondeur selon la checkbox arborescence
  const optTreeCb = optionsRow.querySelector("#pb-opt-tree");
  const optTreeDepthEl = optionsRow.querySelector("#pb-opt-tree-depth");
  optTreeDepthEl.style.opacity = "0.4";
  optTreeDepthEl.disabled = true;
  optTreeCb.addEventListener("change", () => {
    optTreeDepthEl.disabled = !optTreeCb.checked;
    optTreeDepthEl.style.opacity = optTreeCb.checked ? "1" : "0.4";
  });

  // Boutons d'action
  const actions = document.createElement("div");
  actions.className = "pb-actions";
  actions.innerHTML = `
    <button class="pb-btn pb-btn-primary" id="pb-btn-assemble">🔄 Assembler</button>
    <button class="pb-btn pb-btn-send" id="pb-btn-send">▶️ Envoyer à l'agent</button>
    <button class="pb-btn" id="pb-btn-save-md">💾 Sauvegarder en .md</button>
  `;
  panel.appendChild(actions);

  body.appendChild(panel);

  // ── Panneau droit : aperçu ──
  const previewPanel = document.createElement("div");
  previewPanel.className = "prompt-builder-preview";
  previewPanel.innerHTML = `
    <div class="pb-preview-header">
      <span>👁️ Aperçu du prompt</span>
      <span class="pb-preview-hint" id="pb-preview-hint">Cliquez "Assembler" pour générer</span>
    </div>
    <div class="pb-preview-content" id="pb-preview-content">
      <div class="pb-preview-empty">Le prompt assemblé apparaîtra ici</div>
    </div>
  `;
  body.appendChild(previewPanel);

  wrapper.appendChild(body);

  container.appendChild(wrapper);

  // ── Références DOM ──
  const templateSelect = wrapper.querySelector("#pb-template-select");
  const filesLabelEl = wrapper.querySelector("#pb-files-label");
  const filesListEl = wrapper.querySelector("#pb-files-list");
  const previewContent = wrapper.querySelector("#pb-preview-content");
  const previewHint = wrapper.querySelector("#pb-preview-hint");

  // ── État interne ──
  let assembledPrompt = "";
  let selectedPaths = new Set();

  // ── Charger les templates disponibles ──
  await refreshTemplates(templateSelect, sidebar);

  // ── Écouter les ajouts de fichiers depuis le menu contextuel de l'arborescence ──
  function onFileAdded(e) {
    if (e.detail && e.detail.path) {
      selectedPaths.add(e.detail.path);
      renderFilesList();
    }
  }
  document.addEventListener("prompt-builder-add-file", onFileAdded);

  // ── Rendu de la liste des fichiers ──
  function renderFilesList() {
    const count = selectedPaths.size;
    filesLabelEl.textContent = `📂 Fichiers sélectionnés (${count})`;

    if (count === 0) {
      filesListEl.innerHTML = '<div class="pb-files-empty">📂 Cliquez-droit sur un fichier dans l\'arborescence → « Ajouter au Prompt Builder »</div>';
      return;
    }

    const projectPath = window._pilotProjectPath || "";
    const sep = projectPath.includes("\\") ? "\\" : "/";
    let html = "";
    const sorted = [...selectedPaths].sort();
    for (const path of sorted) {
      const relative = projectPath ? path.replace(projectPath + sep, "") : path;
      html += `
        <div class="pb-file-item" data-path="${escapeAttr(path)}">
          <span class="pb-file-name" title="${escapeHtml(path)}">${escapeHtml(relative)}</span>
          <button class="pb-file-remove" data-remove="${escapeAttr(path)}" title="Retirer de la sélection">×</button>
        </div>
      `;
    }
    filesListEl.innerHTML = html;

    // Gérer les clics sur le bouton de retrait
    filesListEl.querySelectorAll(".pb-file-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = btn.dataset.remove;
        selectedPaths.delete(path);
        renderFilesList();
      });
    });
  }

  // ── Assembler le prompt ──
  async function assemblePrompt() {
    const instructions = instructionsEl.value.trim();
    const count = selectedPaths.size;

    if (count === 0 && !instructions) {
      previewContent.innerHTML = '<div class="pb-preview-empty">⚠️ Sélectionnez au moins un fichier ou entrez des instructions</div>';
      return "";
    }

    previewContent.innerHTML = '<div class="pb-preview-empty">⏳ Assemblage en cours...</div>';

    const projectPath = window._pilotProjectPath || "";
    const projectName = projectPath ? projectPath.replace(/\\/g, "/").split("/").pop() : "";
    const sep = projectPath.includes("\\") ? "\\" : "/";

    let prompt = "";

    // Titre
    if (projectName) {
      prompt += `# Projet : ${projectName}\n\n`;
    }

    // Instructions
    if (instructions) {
      prompt += `## Instructions\n\n${instructions}\n\n`;
    }

    // Arborescence (optionnel)
    const maxDepth = parseInt(optTreeDepthEl.value, 10);
    if (optTreeCb.checked && count > 0 && sidebar.treeData) {
      prompt += `## Arborescence du projet\n\n`;
      prompt += renderTreeSummary(sidebar.treeData, "", sep, maxDepth > 0 ? maxDepth : Infinity);
      prompt += "\n";
    }

    // Contenu des fichiers
    if (count > 0) {
      prompt += `## Fichiers sélectionnés\n\n`;
      const sorted = [...selectedPaths].sort();
      for (const path of sorted) {
        const relative = projectPath ? path.replace(projectPath + sep, "") : path;
        try {
          const content = await invoke("read_file_content", { path });
          const ext = path.split(".").pop()?.toLowerCase() || "";
          prompt += `### ${relative}\n\n`;
          prompt += "```" + ext + "\n";
          prompt += content;
          if (!content.endsWith("\n")) prompt += "\n";
          prompt += "```\n\n";
        } catch (err) {
          prompt += `### ${relative}\n\n`;
          prompt += "```\n";
          prompt += `[Erreur de lecture : ${err}]\n`;
          prompt += "```\n\n";
        }
      }
    }

    assembledPrompt = prompt;

    // Afficher l'aperçu
    const mdRenderer = await getMd();
    previewContent.innerHTML = mdRenderer.render(prompt);
    previewHint.textContent = `${count} fichier(s) assemblé(s) — ${prompt.length} caractères`;

    return prompt;
  }

  // ── Envoyer à l'agent ──
  async function sendToAgent() {
    let prompt = assembledPrompt;
    if (!prompt) {
      prompt = await assemblePrompt();
    }
    if (!prompt) return;

    try {
      // Ouvrir l'onglet Agent Pi
      const { agentDisplayLabel } = await import("./backend-info.js");
      await sidebar.tabs.openFile(agentDisplayLabel(), "agent");
      // Attendre un peu que l'onglet s'ouvre
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Envoyer le prompt
      await invoke("send_agent_prompt", { message: prompt });
    } catch (err) {
      toastError("Erreur envoi agent : " + err);
    }
  }

  // ── Sauvegarder en .md ──
  async function saveAsMd() {
    let prompt = assembledPrompt;
    if (!prompt) {
      prompt = await assemblePrompt();
    }
    if (!prompt) return;

    const projectPath = window._pilotProjectPath;
    if (!projectPath) {
      toastWarning("Aucun projet ouvert.");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `prompt_${timestamp}.md`;
    const sep = projectPath.includes("\\") ? "\\" : "/";
    const filePath = projectPath + sep + fileName;

    try {
      await invoke("write_file_content", { path: filePath, content: prompt });
      previewHint.textContent = `✅ Sauvegardé : ${fileName}`;
    } catch (err) {
      toastError("Erreur sauvegarde : " + err);
    }
  }

  // ── Charger un template ──
  async function loadTemplate() {
    const selected = templateSelect.value;
    if (!selected) return;

    // Template intégré
    if (selected.startsWith("builtin:")) {
      const key = selected.slice(8);
      const tmpl = BUILTIN_TEMPLATES[key];
      if (tmpl) {
        instructionsEl.value = tmpl.instructions;
        previewHint.textContent = `📋 Template intégré : ${tmpl.label}`;
      }
      return;
    }

    // Template utilisateur
    const projectPath = window._pilotProjectPath;
    if (!projectPath) return;

    const fileName = selected.startsWith("user:") ? selected.slice(5) : selected;
    const sep = projectPath.includes("\\") ? "\\" : "/";
    const tmplPath = projectPath + sep + "templates" + sep + fileName;

    try {
      const content = await invoke("read_file_content", { path: tmplPath });
      // Extraire les instructions (tout ce qui est avant "## Arborescence" ou "## Fichiers")
      const parts = content.split(/^## (?:Arborescence|Fichiers)/m);
      const instructions = parts[0]
        ? parts[0].replace(/^# Projet :.*\n+/m, "").replace(/^## Instructions\n+/m, "").trim()
        : "";
      instructionsEl.value = instructions;
      previewHint.textContent = `📋 Template chargé : ${fileName}`;
    } catch (err) {
      toastError("Erreur chargement template : " + err);
    }
  }

  // ── Sauvegarder comme template ──
  async function saveAsTemplate() {
    let prompt = assembledPrompt;
    if (!prompt) {
      prompt = await assemblePrompt();
    }
    if (!prompt) return;

    const projectPath = window._pilotProjectPath;
    if (!projectPath) {
      toastWarning("Aucun projet ouvert.");
      return;
    }

    const name = window.prompt("Nom du template (sans extension) :");
    if (!name || !name.trim()) return;

    const safeName = name.trim().replace(/[\\/:"*?<>|]/g, "_");
    const sep = projectPath.includes("\\") ? "\\" : "/";
    const tmplDir = projectPath + sep + "templates";
    const tmplPath = tmplDir + sep + safeName + ".md";

    try {
      // Créer le dossier templates s'il n'existe pas
      await invoke("create_folder", { path: tmplDir }).catch(() => {});
      await invoke("write_file_content", { path: tmplPath, content: prompt });
      previewHint.textContent = `✅ Template sauvegardé : ${safeName}.md`;
      // Rafraîchir la liste des templates
      await refreshTemplates(templateSelect, sidebar);
      templateSelect.value = safeName + ".md";
    } catch (err) {
      toastError("Erreur sauvegarde template : " + err);
    }
  }

  // ── Événements boutons ──
  wrapper.querySelector("#pb-btn-assemble").addEventListener("click", assemblePrompt);
  wrapper.querySelector("#pb-btn-send").addEventListener("click", sendToAgent);
  wrapper.querySelector("#pb-btn-save-md").addEventListener("click", saveAsMd);
  wrapper.querySelector("#pb-btn-save-template").addEventListener("click", saveAsTemplate);

  // Charger automatiquement le template dès sa sélection dans la liste
  templateSelect.addEventListener("change", () => {
    if (templateSelect.value) {
      loadTemplate();
    }
  });

  // ── Nettoyage ──
  const unlisten = () => {
    document.removeEventListener("prompt-builder-add-file", onFileAdded);
  };

  return { wrapper, unlisten };
}

// ── Utilitaires ──

/**
 * Rafraîchit la liste des templates disponibles dans le select.
 * Les templates intégrés apparaissent en premier, les fichiers utilisateur en dessous.
 */
async function refreshTemplates(selectEl, sidebar) {
  let html = '<option value="">-- Choisir un template --</option>';

  // Templates intégrés
  html += '<optgroup label="Templates intégrés">';
  for (const key of Object.keys(BUILTIN_TEMPLATES)) {
    html += `<option value="builtin:${key}">${BUILTIN_TEMPLATES[key].label}</option>`;
  }
  html += '</optgroup>';

  // Templates utilisateur (dossier templates/ du projet)
  const projectPath = window._pilotProjectPath;
  if (projectPath && sidebar.treeData) {
    const templatesNode = findNode(sidebar.treeData, "templates");
    const tmplFiles = [];
    if (templatesNode && templatesNode.children) {
      for (const child of templatesNode.children) {
        if (!child.is_dir && child.name.endsWith(".md")) {
          tmplFiles.push(child.name);
        }
      }
    }
    if (tmplFiles.length > 0) {
      html += '<optgroup label="Templates personnalisés">';
      for (const f of tmplFiles.sort()) {
        html += `<option value="user:${escapeAttr(f)}">${escapeHtml(f)}</option>`;
      }
      html += '</optgroup>';
    }
  }

  selectEl.innerHTML = html;
}

/**
 * Trouve un nœud par nom dans l'arborescence (recherche récursive).
 */
function findNode(node, name) {
  if (!node) return null;
  if (node.name === name && node.is_dir) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Génère un résumé textuel de l'arborescence du projet.
 * @param {object} node - Nœud racine
 * @param {string} prefix - Indentation
 * @param {string} sep - Séparateur de chemin
 * @param {number} maxDepth - Profondeur max (0/Infinity = illimitée)
 * @param {number} depth - Profondeur courante (interne)
 */
function renderTreeSummary(node, prefix, sep, maxDepth = Infinity, depth = 1) {
  if (!node || !node.children) return "";
  let result = "";
  for (const child of node.children) {
    // Ignorer les dossiers cachés et node_modules
    if (child.name.startsWith(".") && child.name !== ".gitignore") continue;
    if (child.name === "node_modules" && child.is_dir) continue;
    if (child.is_dir) {
      result += `${prefix}📁 ${child.name}/\n`;
      if (child.children && depth < maxDepth) {
        result += renderTreeSummary(child, prefix + "  ", sep, maxDepth, depth + 1);
      }
    } else {
      result += `${prefix}📄 ${child.name}\n`;
    }
  }
  return result;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
