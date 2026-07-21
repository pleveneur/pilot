// diff-view.js — Diff Review Agent (A4)
//
// Affiche un diff inline (avant/après) des modifications de fichiers faites par
// l'agent, avec Accepter / Rejeter par outil. Voir spec_diff_review.md.
//
// V1 : accept/reject par outil (par fichier). Per-hunk = V2.
// Algorithme : LCS ligne à ligne (Myers simplifié), sans dépendance.

import { invoke } from "@tauri-apps/api/core";

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Calcule un diff ligne à ligne (LCS) entre deux textes.
 * @returns {Array<{type:"context"|"added"|"removed", text:string}>}
 */
export function computeLineDiff(before, after) {
  const a = (before == null ? "" : String(before)).split("\n");
  const b = (after == null ? "" : String(after)).split("\n");
  const n = a.length, m = b.length;

  // Table LCS (dp). On limite la taille pour éviter l'explosion mémoire sur les
  // très gros fichiers : si > 4000 lignes au total, on fait un diff naïf ligne à
  // ligne sur le prefix commun puis suffix commun.
  if (n + m > 4000) {
    return naiveLineDiff(a, b);
  }

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "removed", text: a[i] });
      i++;
    } else {
      out.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "removed", text: a[i++] }); }
  while (j < m) { out.push({ type: "added", text: b[j++] }); }
  return out;
}

/** Diff naïf pour très gros fichiers : prefix commun + bloc supprimé/ajouté + suffix commun. */
function naiveLineDiff(a, b) {
  const out = [];
  let i = 0, j = 0;
  // prefix commun
  while (i < a.length && j < b.length && a[i] === b[j]) {
    out.push({ type: "context", text: a[i] });
    i++; j++;
  }
  // bloc divergent : tout ce qui reste dans a est "removed", tout dans b est "added"
  while (i < a.length) { out.push({ type: "removed", text: a[i++] }); }
  while (j < b.length) { out.push({ type: "added", text: b[j++] }); }
  return out;
}

/** Compte les lignes ajoutées/supprimées d'un diff. */
function diffStats(diff) {
  let added = 0, removed = 0;
  for (const d of diff) {
    if (d.type === "added") added++;
    else if (d.type === "removed") removed++;
  }
  return { added, removed };
}

/** Construit le HTML du diff (lignes colorées), avec troncature à maxLines. */
function renderDiffHtml(diff, maxLines = 200) {
  const lines = diff.slice(0, maxLines);
  const truncated = diff.length - lines.length;
  let html = "";
  for (const d of lines) {
    const cls = d.type === "added" ? "diff-add" : d.type === "removed" ? "diff-del" : "diff-ctx";
    const marker = d.type === "added" ? "+" : d.type === "removed" ? "−" : " ";
    html += `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${esc(d.text) || "&nbsp;"}</span></div>`;
  }
  if (truncated > 0) {
    html += `<div class="diff-truncated">… ${truncated} ligne(s) non affichée(s) …</div>`;
  }
  return html;
}

/**
 * Restitue le contenu `before` à `absPath`. Gère les cas création/suppression.
 * @param {string} absPath - chemin absolu du fichier
 * @param {string|null} before - contenu d'origine (null = fichier n'existait pas)
 * @param {string|null} after - contenu après l'outil (null = fichier supprimé)
 * @returns {Promise<string>} message décrivant l'action effectuée
 */
export async function applyReject(absPath, before, after) {
  if (before == null && after != null) {
    // Création → rejeter = supprimer le fichier créé
    try { await invoke("delete_file_or_dir", { path: absPath }); return "fichier créé supprimé"; }
    catch (e) { throw new Error("Suppression échouée : " + e); }
  }
  if (before != null && after == null) {
    // Suppression → rejeter = recréer le fichier avec le contenu d'origine
    try { await invoke("write_file_content", { path: absPath, content: before }); return "fichier restauré"; }
    catch (e) { throw new Error("Restauration échouée : " + e); }
  }
  // Modification → rejeter = réécrire le contenu d'origine
  try { await invoke("write_file_content", { path: absPath, content: before }); return "contenu restauré"; }
  catch (e) { throw new Error("Restauration échouée : " + e); }
}

/**
 * Crée le bloc DOM de revue de diff.
 *
 * @param {object} opts
 * @param {string} opts.path - chemin relatif (pour l'affichage)
 * @param {string} opts.absPath - chemin absolu (pour restore)
 * @param {string|null} opts.before - contenu avant
 * @param {string|null} opts.after - contenu après
 * @param {string} [opts.toolName] - nom de l'outil qui a modifié
 * @param {boolean} [opts.multiEdit] - true si d'autres outils ont touché le même fichier
 * @param {function} [opts.onResolved] - callback(action:"accept"|"reject")
 * @returns {HTMLElement}
 */
export function renderDiffBlock(opts) {
  const { path: relPath, absPath, before, after, toolName, multiEdit, onResolved } = opts;
  const diff = computeLineDiff(before, after);
  const stats = diffStats(diff);
  // Si aucune ligne ajoutée ni supprimée → pas de diff (ne devrait pas arriver)
  if (stats.added === 0 && stats.removed === 0) return null;

  const isCreate = before == null && after != null;
  const isDelete = before != null && after == null;
  const action = isCreate ? "créé" : isDelete ? "supprimé" : "modifié";

  const el = document.createElement("div");
  el.className = "agent-diff-review";
  const header = document.createElement("div");
  header.className = "agent-diff-header";
  header.innerHTML =
    `<span class="agent-diff-icon">${isDelete ? "🗑️" : "📝"}</span>` +
    `<span class="agent-diff-path">${esc(relPath)}</span>` +
    `<span class="agent-diff-action">${action}${toolName ? " par " + esc(toolName) : ""}</span>` +
    `<span class="agent-diff-stats"><span class="diff-stat-add">+${stats.added}</span> <span class="diff-stat-del">−${stats.removed}</span></span>` +
    `<span class="agent-diff-toggle" title="Replier/Déplier">▾</span>`;
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "agent-diff-body";
  body.innerHTML = renderDiffHtml(diff);
  el.appendChild(body);

  // Mode lecture seule (ex: diff Git C1) : aucun bouton Accepter/Rejeter — la
  // modale sert uniquement à visualiser, ne jamais toucher au disque.
  if (opts.readOnly) {
    return el;
  }

  const actions = document.createElement("div");
  actions.className = "agent-diff-actions";
  if (multiEdit) {
    const warn = document.createElement("div");
    warn.className = "agent-diff-warn";
    warn.textContent = "⚠️ Rejeter restaure l'état avant cet outil — les modifications ultérieures du même fichier seront aussi perdues.";
    actions.appendChild(warn);
  }
  const btnAccept = document.createElement("button");
  btnAccept.className = "agent-diff-btn agent-diff-accept";
  btnAccept.textContent = "✓ Accepter";
  const btnReject = document.createElement("button");
  btnReject.className = "agent-diff-btn agent-diff-reject";
  btnReject.textContent = "↩️ Rejeter";
  actions.appendChild(btnAccept);
  actions.appendChild(btnReject);
  el.appendChild(actions);

  // Toggle collapse
  header.addEventListener("click", (e) => {
    if (e.target.closest(".agent-diff-btn")) return;
    body.classList.toggle("collapsed");
    header.classList.toggle("collapsed");
  });

  let resolved = false;
  function resolve(action) {
    if (resolved) return;
    resolved = true;
    btnAccept.remove();
    btnReject.remove();
    if (action === "accept") {
      el.classList.add("resolved-accept");
      header.querySelector(".agent-diff-toggle").textContent = "✓";
    } else {
      el.classList.add("resolved-reject");
      header.querySelector(".agent-diff-toggle").textContent = "↩️";
    }
    if (typeof onResolved === "function") onResolved(action);
  }

  btnAccept.addEventListener("click", (e) => { e.stopPropagation(); resolve("accept"); });

  btnReject.addEventListener("click", async (e) => {
    e.stopPropagation();
    btnReject.disabled = true;
    btnReject.textContent = "↩️ Restauration…";
    try {
      await applyReject(absPath, before, after);
      resolve("reject");
    } catch (err) {
      btnReject.disabled = false;
      btnReject.textContent = "↩️ Rejeter";
      // Afficher l'erreur dans le bloc
      const errEl = document.createElement("div");
      errEl.className = "agent-diff-error";
      errEl.textContent = "❌ " + err;
      actions.appendChild(errEl);
    }
  });

  return el;
}

/**
 * Diff Review (A4 V2) — dialogue de porte pré-écriture.
 *
 * Affiche un diff avant/après AVANT que l'outil write/edit ne s'exécute (pi est
 * bloqué en attendant la réponse). Boutons : ✓ Accepter (l'outil s'exécute) /
 * ✗ Refuser (l'outil est bloqué, fichier inchangé). Aucune restauration disque
 * — le fichier n'a pas été modifié.
 *
 * @param {object} opts
 * @param {string} opts.relPath - chemin relatif (affichage)
 * @param {string} opts.toolName - "write" | "edit"
 * @param {string|null} opts.before - contenu actuel (avant écriture)
 * @param {string|null} opts.after - contenu prévu après l'outil
 * @param {function} opts.onDecision - callback(accepted: boolean)
 * @returns {HTMLElement}
 */
export function renderEditGateDialog(opts) {
  const { relPath, toolName, before, after, onDecision } = opts;
  const diff = computeLineDiff(before, after);
  const stats = diffStats(diff);
  const hasChanges = stats.added > 0 || stats.removed > 0;
  const isCreate = before == null && after != null;
  const isDelete = before != null && after == null;
  const action = isCreate ? "créer" : isDelete ? "supprimer" : "modifier";

  const el = document.createElement("div");
  el.className = "agent-diff-review agent-edit-gate";
  const header = document.createElement("div");
  header.className = "agent-diff-header agent-gate-header";
  header.innerHTML =
    `<span class="agent-diff-icon">⏸️</span>` +
    `<span class="agent-diff-path">${esc(relPath)}</span>` +
    `<span class="agent-diff-action">${action} par ${esc(toolName)}</span>` +
    (hasChanges
      ? `<span class="agent-diff-stats"><span class="diff-stat-add">+${stats.added}</span> <span class="diff-stat-del">−${stats.removed}</span></span>`
      : `<span class="agent-diff-stats">aucun changement</span>`) +
    `<span class="agent-diff-toggle" title="Replier/Déplier">▾</span>`;
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "agent-diff-body";
  body.innerHTML = hasChanges ? renderDiffHtml(diff)
    : `<div class="diff-truncated">L'outil ne change pas le contenu (before == after).</div>`;
  el.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "agent-diff-actions";
  const btnAccept = document.createElement("button");
  btnAccept.className = "agent-diff-btn agent-diff-accept";
  btnAccept.textContent = "✓ Accepter";
  const btnReject = document.createElement("button");
  btnReject.className = "agent-diff-btn agent-diff-reject";
  btnReject.textContent = "✗ Refuser";
  actions.appendChild(btnAccept);
  actions.appendChild(btnReject);
  el.appendChild(actions);

  header.addEventListener("click", (e) => {
    if (e.target.closest(".agent-diff-btn")) return;
    body.classList.toggle("collapsed");
    header.classList.toggle("collapsed");
  });

  let resolved = false;
  function decide(accepted) {
    if (resolved) return;
    resolved = true;
    btnAccept.disabled = btnReject.disabled = true;
    if (accepted) {
      el.classList.add("resolved-accept");
      header.querySelector(".agent-diff-toggle").textContent = "✓";
      btnAccept.textContent = "✓ Accepté";
    } else {
      el.classList.add("resolved-reject");
      header.querySelector(".agent-diff-toggle").textContent = "✗";
      btnReject.textContent = "✗ Refusé";
    }
    if (typeof onDecision === "function") onDecision(accepted);
  }

  btnAccept.addEventListener("click", (e) => { e.stopPropagation(); decide(true); });
  btnReject.addEventListener("click", (e) => { e.stopPropagation(); decide(false); });

  return el;
}

/**
 * Ouvre une modale plein écran (read-only) affichant le diff Git d'un fichier
 * (C1). Réutilise `renderDiffBlock`. `before`/`after` = contenus texte (before
 * vide = fichier nouveau). Fermeture via Échap, clic sur l'overlay, ou bouton.
 */
export function openGitDiffModal(opts) {
  const { before, after, title, subtitle } = opts;
  // Nettoyer une éventuelle modale précédente.
  const prev = document.getElementById("git-diff-overlay");
  if (prev) prev.remove();

  const overlay = document.createElement("div");
  overlay.id = "git-diff-overlay";
  overlay.className = "git-diff-overlay";

  const dialog = document.createElement("div");
  dialog.className = "git-diff-dialog";

  const bar = document.createElement("div");
  bar.className = "git-diff-bar";
  bar.innerHTML =
    `<span class="git-diff-title">📝 ${esc(title || "Diff Git")}</span>` +
    (subtitle ? `<span class="git-diff-sub">${esc(subtitle)}</span>` : "") +
    `<span class="git-diff-ro">👁️ lecture seule</span>`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "git-diff-close";
  closeBtn.textContent = "✕ Fermer";
  bar.appendChild(closeBtn);
  dialog.appendChild(bar);

  const body = document.createElement("div");
  body.className = "git-diff-body";
  const block = renderDiffBlock({
    path: title || "",
    absPath: null,
    before: before == null ? "" : before,
    after: after == null ? "" : after,
    readOnly: true,
  });
  if (!block) {
    body.innerHTML = '<p class="git-diff-empty">Aucune différence avec la version commitée.</p>';
  } else {
    body.appendChild(block);
  }
  dialog.appendChild(body);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
}