// csv-preview.js — Prévisualisation de fichier CSV avec tableau aligné

import { invoke } from "@tauri-apps/api/core";

/**
 * Détecte le séparateur le plus probable dans une ligne CSV
 * (virgule, point-virgule ou tabulation)
 * @param {string} headerLine - Première ligne du fichier
 * @returns {string} Le séparateur détecté
 */
function detectSeparator(headerLine) {
  const candidates = [",", ";", "\t"];
  let bestSep = ",";
  let bestCount = 0;
  for (const sep of candidates) {
    // On ne compte que les séparateurs hors guillemets
    let count = 0;
    let inQuotes = false;
    for (const ch of headerLine) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && ch === sep) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestSep = sep;
    }
  }
  return bestSep;
}

/**
 * Parse une ligne CSV en gérant les guillemets et les échappements
 * @param {string} line - Ligne CSV brute
 * @param {string} separator - Séparateur de colonnes
 * @returns {string[]} Tableau des champs
 */
function parseCSVLine(line, separator) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Guillemet échappé (doublé) ou fin de champ
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip le deuxième guillemet
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === separator) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse un contenu CSV complet
 * @param {string} content - Contenu du fichier CSV
 * @returns {{headers: string[], rows: string[][]}}
 */
function parseCSV(content) {
  if (!content || content.trim() === "") {
    return { headers: [], rows: [] };
  }

  const lines = [];
  let currentLine = "";
  let inQuotes = false;

  // On parcourt caractère par caractère pour gérer les sauts de ligne dans les champs
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      // Guillemet échappé ?
      if (inQuotes && i + 1 < content.length && content[i + 1] === '"') {
        currentLine += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      currentLine += ch;
    } else if ((ch === "\n" || (ch === "\r" && content[i + 1] === "\n")) && !inQuotes) {
      lines.push(currentLine);
      currentLine = "";
      if (ch === "\r") i++; // skip \n du \r\n
    } else {
      currentLine += ch;
    }
  }
  // Dernière ligne (même vide)
  if (currentLine || lines.length === 0) {
    lines.push(currentLine);
  }

  // Filtrer les lignes vides
  const nonEmptyLines = lines.filter((l) => l.trim() !== "");
  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Détecter le séparateur sur la première ligne
  const separator = detectSeparator(nonEmptyLines[0]);

  // Parser chaque ligne
  const parsed = nonEmptyLines.map((line) => parseCSVLine(line, separator));

  const headers = parsed[0];
  const rows = parsed.slice(1);

  return { headers, rows };
}

/**
 * Échappe le HTML pour éviter les injections XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Crée un panneau de prévisualisation CSV
 * @param {HTMLElement} container
 * @param {string} filePath - chemin absolu du fichier CSV
 * @returns {Promise<HTMLElement>}
 */
export async function createCsvPreview(container, filePath) {
  const wrapper = document.createElement("div");
  wrapper.className = "csv-preview-wrapper";

  // Barre d'outils
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-toolbar";
  toolbar.innerHTML = `
    <span class="csv-row-count" id="csv-row-count"></span>
    <span class="pdf-sep">|</span>
    <span class="csv-col-count" id="csv-col-count"></span>
  `;
  wrapper.appendChild(toolbar);

  // Conteneur du tableau avec scroll
  const tableContainer = document.createElement("div");
  tableContainer.className = "csv-table-container";
  wrapper.appendChild(tableContainer);

  // Charger et parser le CSV
  try {
    const content = await invoke("read_file_content", { path: filePath });
    const { headers, rows } = parseCSV(content);

    if (headers.length === 0) {
      tableContainer.innerHTML = `<div class="pdf-error">⚠️ Fichier CSV vide ou invalide</div>`;
      wrapper.querySelector("#csv-row-count").textContent = "0 lignes";
      wrapper.querySelector("#csv-col-count").textContent = "0 colonnes";
      return wrapper;
    }

    // Mettre à jour les compteurs
    wrapper.querySelector("#csv-row-count").textContent = `${rows.length} ligne${rows.length !== 1 ? "s" : ""}`;
    wrapper.querySelector("#csv-col-count").textContent = `${headers.length} colonne${headers.length !== 1 ? "s" : ""}`;

    // Construire le tableau
    const table = document.createElement("table");
    table.className = "csv-table";

    // En-tête
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    // Colonne d'index
    const thIdx = document.createElement("th");
    thIdx.className = "csv-index-col";
    thIdx.textContent = "#";
    headerRow.appendChild(thIdx);
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Corps
    const tbody = document.createElement("tbody");
    for (let i = 0; i < rows.length; i++) {
      const tr = document.createElement("tr");
      // Colonne d'index
      const tdIdx = document.createElement("td");
      tdIdx.className = "csv-index-col";
      tdIdx.textContent = i + 1;
      tr.appendChild(tdIdx);
      for (const cell of rows[i]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);
  } catch (err) {
    tableContainer.innerHTML = `<div class="pdf-error">❌ Erreur : impossible de charger le fichier CSV<br><small>${err.message || err}</small></div>`;
  }

  container.appendChild(wrapper);
  return wrapper;
}
