// recent-files.js — Recent files popover (C4, Ctrl+Alt+R)
//
// Maintient un historique par projet des 20 derniers fichiers ouverts
// (persistance localStorage, clé `pilot:recents:<projectPath>`). Affiche un
// popover fuzzy-search pour rouvrir rapidement un fichier récent.
//
// Indépendant de la persistance d'onglets (qui restaure la session entière) :
// ici on liste tous les fichiers touchés récemment, pas seulement ceux ouverts
// au dernier démarrage. Per-project, jamais envoyé au cloud.

const MAX_RECENTS = 20;

/** Clé localStorage pour un projet donné. */
function keyFor(projectPath) {
  return "pilot:recents:" + (projectPath || "_global");
}

/**
 * Enregistre un fichier comme récemment ouvert (au début de la liste,
 * dédoublonné, limité à MAX_RECENTS). Persistance localStorage par projet.
 * @param {string} filePath - chemin absolu
 */
export function recordRecentFile(filePath) {
  if (!filePath) return;
  const project = window._pilotProjectPath || "";
  const key = keyFor(project);
  let list = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch (_) {
    list = [];
  }
  // Dédoublonner (insensible au sens des séparateurs)
  const norm = (p) => p.replace(/\\/g, "/");
  const target = norm(filePath);
  list = list.filter((p) => norm(p) !== target);
  list.unshift(filePath);
  if (list.length > MAX_RECENTS) list = list.slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (_) {}
}

/**
 * Récupère la liste des fichiers récents du projet courant.
 * @returns {string[]}
 */
export function getRecentFiles() {
  const project = window._pilotProjectPath || "";
  try {
    const raw = localStorage.getItem(keyFor(project));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

// ── Popover ──

let popover = null;
let input = null;
let listEl = null;
let tabsManager = null;
let filtered = [];
let activeIndex = 0;
let isMounted = false;

/** Monte le popover dans le DOM (une fois). */
function mount() {
  if (isMounted) return;
  popover = document.createElement("div");
  popover.id = "recent-files-popover";
  popover.className = "recent-files-popover hidden";
  popover.innerHTML = `
    <div class="recent-files-backdrop"></div>
    <div class="recent-files-content">
      <input type="text" id="recent-files-input" placeholder="Fichiers récents…" autocomplete="off" />
      <ul id="recent-files-list"></ul>
      <div class="recent-files-hint">↑↓ naviguer · Entrée ouvrir · Échap fermer</div>
    </div>
  `;
  document.body.appendChild(popover);
  input = popover.querySelector("#recent-files-input");
  listEl = popover.querySelector("#recent-files-list");
  const backdrop = popover.querySelector(".recent-files-backdrop");

  backdrop.addEventListener("click", closeRecentPopover);
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    const recents = getRecentFiles();
    filtered = recents.filter((p) => p.toLowerCase().includes(q));
    activeIndex = 0;
    renderList();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeRecentPopover();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      openSelected();
    }
  });
  isMounted = true;
}

/** Ouvre le popover (monté + visible + focus). */
export function openRecentPopover(tabs) {
  tabsManager = tabs;
  mount();
  filtered = getRecentFiles();
  activeIndex = 0;
  popover.classList.remove("hidden");
  input.value = "";
  renderList();
  setTimeout(() => input.focus(), 0);
}

/** Ferme le popover. */
export function closeRecentPopover() {
  if (popover) popover.classList.add("hidden");
}

/** Rend la liste filtrée. */
function renderList() {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (filtered.length === 0) {
    listEl.innerHTML = '<li class="recent-empty">Aucun fichier récent</li>';
    return;
  }
  const project = (window._pilotProjectPath || "").replace(/\\/g, "/");
  filtered.forEach((path, i) => {
    const li = document.createElement("li");
    if (i === activeIndex) li.classList.add("active");
    const name = path.replace(/\\/g, "/").split("/").pop();
    let rel = path.replace(/\\/g, "/");
    if (project && rel.startsWith(project + "/")) rel = rel.slice(project.length + 1);
    li.innerHTML = `<span class="recent-name">${esc(name)}</span><span class="recent-path">${esc(rel)}</span>`;
    li.addEventListener("click", () => {
      activeIndex = i;
      openSelected();
    });
    li.addEventListener("mouseenter", () => {
      activeIndex = i;
      renderList();
    });
    listEl.appendChild(li);
  });
}

/** Ouvre le fichier sélectionné dans un onglet. */
function openSelected() {
  const path = filtered[activeIndex];
  if (!path) return;
  closeRecentPopover();
  if (tabsManager) tabsManager.openFile(path, "edit");
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}