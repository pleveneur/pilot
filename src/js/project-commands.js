// project-commands.js — Palette de commandes du projet (#17)
//
// Bouton du panneau d'actions → modale listant les commandes paramétrées du
// projet courant (par projet, stockées dans `.pilot/commands.json`). L'utilisateur
// peut ajouter / modifier / supprimer des commandes. Chaque commande = un nom +
// une commande shell + un dossier de travail (vide = racine du projet). Clic sur
// une commande → le système se place dans le dossier puis lance la commande dans
// un terminal embarqué (modale de résultat avec un bouton « Fermer »).

import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { createTerminal, killTerminal } from "./terminal.js";
import { refreshIcons } from "./icons.js";
import { toastSuccess, toastError } from "./toast.js";

let commandsModal, commandsList, runModal, runContainer, runName;
let currentProject = "";
let currentCommands = [];
let editingId = null;
let currentRunTerminal = null; // { unlisten, terminalId }

export function initProjectCommands() {
  commandsModal = document.getElementById("commands-modal");
  commandsList = document.getElementById("commands-list");
  runModal = document.getElementById("command-run-modal");
  runContainer = document.getElementById("command-run-container");
  runName = document.getElementById("command-run-name");

  document.getElementById("btn-commands").addEventListener("click", openCommandsModal);
  document.getElementById("btn-close-commands").addEventListener("click", () =>
    commandsModal.classList.add("hidden")
  );
  document.getElementById("btn-add-command").addEventListener("click", () =>
    openCommandForm(null)
  );

  document.getElementById("btn-save-command").addEventListener("click", saveCommand);
  document.getElementById("btn-cancel-command").addEventListener("click", () =>
    document.getElementById("command-form-modal").classList.add("hidden")
  );

  document.getElementById("btn-close-command-run").addEventListener("click", closeRunModal);

  // Entrée pour soumettre le formulaire.
  document.getElementById("cmd-command").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveCommand();
  });
}

// ── Liste des commandes ──

async function openCommandsModal() {
  currentProject = window._pilotProjectPath;
  if (!currentProject) {
    toastError("Aucun projet ouvert");
    return;
  }
  try {
    const data = await invoke("read_project_commands", { projectPath: currentProject });
    currentCommands = Array.isArray(data) ? data : [];
    renderCommands();
    commandsModal.classList.remove("hidden");
  } catch (e) {
    toastError("Lecture des commandes : " + e);
  }
}

function renderCommands() {
  commandsList.innerHTML = "";
  if (!currentCommands.length) {
    commandsList.innerHTML =
      '<div class="commands-empty">Aucune commande. Cliquez sur « Ajouter ».</div>';
    return;
  }
  currentCommands.forEach((cmd) => {
    const row = document.createElement("div");
    row.className = "command-item";
    const dir = cmd.cwd ? cmd.cwd : "racine";
    row.innerHTML = `
      <div class="command-item-main" title="Lancer cette commande">
        <div class="command-item-name"></div>
        <div class="command-item-meta"><code>${esc(cmd.command)}</code><span class="command-item-cwd"> · ${esc(dir)}</span></div>
      </div>
      <div class="command-item-actions">
        <button class="cmd-edit" data-id="${esc(cmd.id)}" title="Modifier"><i data-lucide="pencil" class="icon-sm"></i></button>
        <button class="cmd-del" data-id="${esc(cmd.id)}" title="Supprimer"><i data-lucide="trash-2" class="icon-sm"></i></button>
      </div>`;
    row.querySelector(".command-item-name").textContent = cmd.name || cmd.command;
    row.querySelector(".command-item-main").addEventListener("click", () => runCommand(cmd));
    row.querySelector(".cmd-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openCommandForm(cmd);
    });
    row.querySelector(".cmd-del").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCommand(cmd);
    });
    commandsList.appendChild(row);
  });
  refreshIcons(commandsList);
}

// ── Formulaire ajout / édition ──

function openCommandForm(cmd) {
  editingId = cmd ? cmd.id : null;
  document.getElementById("cmd-name").value = cmd ? cmd.name : "";
  document.getElementById("cmd-command").value = cmd ? cmd.command : "";
  document.getElementById("cmd-cwd").value = cmd ? cmd.cwd || "" : "";
  const title = document.getElementById("command-form-title");
  title.innerHTML = `<i data-lucide="settings-2" class="icon-lg"></i> ${
    cmd ? "Modifier la commande" : "Nouvelle commande"
  }`;
  refreshIcons(title);
  document.getElementById("command-form-modal").classList.remove("hidden");
  document.getElementById("cmd-name").focus();
}

async function saveCommand() {
  const name = document.getElementById("cmd-name").value.trim();
  const command = document.getElementById("cmd-command").value.trim();
  const cwd = document.getElementById("cmd-cwd").value.trim();
  if (!name || !command) {
    toastError("Le nom et la commande sont requis");
    return;
  }
  if (editingId) {
    const c = currentCommands.find((x) => x.id === editingId);
    if (c) {
      c.name = name;
      c.command = command;
      c.cwd = cwd;
    }
  } else {
    currentCommands.push({ id: uid(), name, command, cwd });
  }
  try {
    await invoke("save_project_commands", {
      projectPath: currentProject,
      commands: currentCommands,
    });
    document.getElementById("command-form-modal").classList.add("hidden");
    renderCommands();
    toastSuccess("Commande enregistrée");
  } catch (e) {
    toastError("Sauvegarde : " + e);
  }
}

async function deleteCommand(cmd) {
  const ok = await confirm(`Supprimer la commande « ${cmd.name} » ?`, {
    title: "Pilot",
    kind: "warning",
  });
  if (!ok) return;
  currentCommands = currentCommands.filter((x) => x.id !== cmd.id);
  try {
    await invoke("save_project_commands", {
      projectPath: currentProject,
      commands: currentCommands,
    });
    renderCommands();
  } catch (e) {
    toastError("Sauvegarde : " + e);
  }
}

// ── Exécution d'une commande (résultat dans une modale) ──

async function runCommand(cmd) {
  const fullCwd = cmd.cwd ? joinPath(currentProject, cmd.cwd) : currentProject;
  runName.textContent = cmd.name || cmd.command;
  runContainer.innerHTML = "";
  runModal.classList.remove("hidden");
  try {
    const result = await createTerminal(runContainer, currentProject, false, {
      cwd: fullCwd,
      command: cmd.command,
    });
    currentRunTerminal = { unlisten: result.unlisten, terminalId: result.terminalId };
    setTimeout(() => result.terminal.focus(), 100);
  } catch (e) {
    runContainer.innerHTML = `<div style="padding:1em;color:var(--danger);">❌ Erreur : ${e}</div>`;
  }
}

async function closeRunModal() {
  runModal.classList.add("hidden");
  if (currentRunTerminal) {
    if (currentRunTerminal.unlisten) currentRunTerminal.unlisten();
    try {
      await killTerminal(currentRunTerminal.terminalId);
    } catch (_) {
      /* ignore */
    }
    currentRunTerminal = null;
  }
  runContainer.innerHTML = "";
}

// ── Utilitaires ──

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function joinPath(root, rel) {
  const sep = root.includes("\\") ? "\\" : "/";
  const clean = String(rel).replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
  if (!clean) return root;
  return root.replace(/[\\/]+$/, "") + sep + clean;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
