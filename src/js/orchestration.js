// orchestration.js — Fonctions pures du Mode Orchestration (architecte + codeur)
//
// Ce module regroupe toutes les fonctions *pures* (sans dépendance à l'état UI)
// utilisées par le Mode Orchestration de l'onglet Agent Pi :
//   - Construction des prompts (plan, tâche, escalade, révision)
//   - Parsing / normalisation du plan JSON
//   - Filtrage de l'arborescence projet
//   - Extraction de résumés de tâches
//   - Validation post-tâche (vérification que les fichiers ont changé)
//   - Métriques finales du plan
//
// Les fonctions qui manipulent l'état/UI restent dans agent-pi.js.

// ── Dossiers/fichiers ignorés lors de la construction de l'arborescence ──
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "target",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".parcel-cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".pilot",
]);

// ── Limites ──
const MAX_FILE_LINES_PROMPT = 200;   // truncation par fichier injecté dans un prompt
const MAX_TREE_DEPTH = 4;             // profondeur max de l'arborescence injectée
const MAX_TREE_LINES = 200;           // limite globale de l'arborescence injectée
const SUMMARY_MAX_CHARS = 200;

// ──────────────────────────────────────────────────────────────────────────
// Normalisation du plan (point J)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Normalise un tableau de tâches issu du parsing JSON.
 * Garantit que chaque tâche possède tous les champs attendus avec des valeurs
 * par défaut sûres, et que les dépendances pointent vers des tâches existantes.
 *
 * @param {Array} planArray - tableau brut issu du JSON
 * @returns {Array} tableau normalisé
 */
export function normalizePlan(planArray) {
  if (!Array.isArray(planArray)) return [];
  const rawIds = planArray.map((t) => {
    if (!t || typeof t !== "object") return null;
    const id = typeof t.id === "number" ? t.id : parseInt(t.id, 10);
    return Number.isFinite(id) ? id : null;
  });
  const validIds = new Set(rawIds.filter((id) => id !== null && id >= 0));

  return planArray
    .filter((t) => t && typeof t === "object")
    .map((t, idx) => {
      const id = rawIds[idx];
      const files = Array.isArray(t.files) ? t.files.filter((f) => typeof f === "string") : [];
      const dependsOn = Array.isArray(t.depends_on)
        ? t.depends_on
            .map((d) => (typeof d === "number" ? d : parseInt(d, 10)))
            .filter((d) => Number.isFinite(d) && validIds.has(d))
        : [];
      return {
        id: Number.isFinite(id) ? id : -1,
        title: typeof t.title === "string" ? t.title : `Tâche ${id}`,
        description: typeof t.description === "string" ? t.description : "",
        files,
        context: typeof t.context === "string" ? t.context : "",
        depends_on: dependsOn,
        // Flag indiquant qu'une tâche est une sous-tâche issue d'une subdivision
        // (point M) : ces tâches ne sont pas re-subdivisables en cas d'échec.
        subtask: !!t.subtask,
      };
    })
    .filter((t) => t.id >= 0);
}

// ──────────────────────────────────────────────────────────────────────────
// Parsing de la réponse de l'orchestrateur (plan JSON)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse la réponse de l'orchestrateur pour extraire le plan JSON et la
 * directive globale (Mode Orchestration V2 — Boussole du Contexte).
 * Multi-étapes : bloc markdown ```json, objet {"plan": ...}, candidats JSON, parse global.
 *
 * @param {string} text - réponse brute de l'orchestrateur
 * @returns {{plan: Array|null, globalDirective: string|null}} tableau de tâches normalisé + directive globale
 */
export function parsePlanResponse(text) {
  if (!text || !text.trim()) return { plan: null, globalDirective: null };
  let cleaned = text.trim();

  // Étape 1 : supprimer les délimiteurs markdown ```json ... ```
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  // Étape 2 : chercher {"plan" directement et extraire l'objet équilibré
  // Tolérant aux espaces après l'accolade ouvrante (ex: { "plan": [...] })
  const planMatch = cleaned.match(/\{\s*"plan"\s*:/);
  if (planMatch) {
    const startIdx = cleaned.search(/\{\s*"plan"\s*:/);
    const extracted = extractBalancedJson(cleaned, startIdx);
    if (extracted) {
      const parsed = tryParsePlan(extracted);
      if (parsed) {
        return {
          plan: normalizePlan(parsed),
          globalDirective: extractGlobalDirective(extracted),
        };
      }
    }
  }

  // Étape 3 : chercher n'importe quel objet JSON contenant "plan"
  const candidates = findAllTopLevelJsonObjects(cleaned);
  for (const candidate of candidates) {
    if (candidate.includes('"plan"')) {
      const parsed = tryParsePlan(candidate);
      if (parsed) {
        return {
          plan: normalizePlan(parsed),
          globalDirective: extractGlobalDirective(candidate),
        };
      }
    }
  }

  // Étape 4 : parser tout le texte comme JSON
  const parsedGlobal = tryParsePlan(cleaned);
  if (parsedGlobal) {
    return {
      plan: normalizePlan(parsedGlobal),
      globalDirective: extractGlobalDirective(cleaned),
    };
  }

  return { plan: null, globalDirective: null };
}

/** Extrait la directive globale d'une chaîne JSON brute si présente. */
function extractGlobalDirective(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.global_directive === "string" && parsed.global_directive.trim()) {
      return parsed.global_directive.trim();
    }
  } catch (_) {
    // fallback regex léger
    const m = jsonStr.match(/"global_directive"\s*:\s*"([^"]+)"/);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/** Extrait un objet JSON équilibré à partir d'un index donné. */
function extractBalancedJson(text, startIdx) {
  if (startIdx < 0 || text[startIdx] !== "{") return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) return text.substring(startIdx, i + 1);
  }
  return null;
}

/** Trouve tous les objets JSON top-level (accolades équilibrées) dans le texte. */
function findAllTopLevelJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    }
    if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.substring(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

/** Tente de parser un JSON et retourne le tableau plan si valide. */
function tryParsePlan(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.plan)) return parsed.plan;
  } catch (_) {
    // ignore
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Arborescence projet (point H)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Filtre récursivement un arbre de fichiers en retirant les dossiers ignorés
 * et en limitant la profondeur. Retourne un nouvel arbre filtré.
 *
 * @param {object} node - nœud { name, is_dir, children? }
 * @param {number} depth - profondeur courante (commence à 0)
 * @param {number} maxDepth - profondeur maximale
 * @returns {object|null} nœud filtré, ou null si ignoré
 */
export function filterTree(node, depth = 0, maxDepth = MAX_TREE_DEPTH) {
  if (!node || typeof node !== "object") return null;
  // Ignorer les dossiers sensibles (uniquement pour les dossiers)
  if (node.is_dir && IGNORED_DIRS.has(node.name)) return null;

  const filtered = {
    name: node.name,
    is_dir: !!node.is_dir,
    children: [],
  };
  if (node.is_dir && Array.isArray(node.children) && depth < maxDepth) {
    for (const child of node.children) {
      const f = filterTree(child, depth + 1, maxDepth);
      if (f) filtered.children.push(f);
    }
  }
  return filtered;
}

/**
 * Construit une représentation textuelle indentée d'un arbre filtré.
 * Limite le nombre total de lignes produites.
 *
 * @param {object} node - nœud racine (déjà filtré idéalement)
 * @param {number} maxDepth - profondeur max
 * @returns {string} texte de l'arborescence
 */
export function buildTreeString(node, maxDepth = MAX_TREE_DEPTH) {
  const filtered = node ? filterTree(node, 0, maxDepth) : null;
  if (!filtered) return "";
  const lines = [];
  renderTreeLines(filtered, 0, maxDepth, lines);
  if (lines.length > MAX_TREE_LINES) {
    return lines.slice(0, MAX_TREE_LINES).join("\n") + `\n... (${lines.length - MAX_TREE_LINES} lignes omises)`;
  }
  return lines.join("\n");
}

function renderTreeLines(node, depth, maxDepth, out) {
  if (!node) return;
  const indent = "  ".repeat(depth);
  const prefix = node.is_dir ? "📁 " : "📄 ";
  out.push(indent + prefix + node.name);
  if (node.is_dir && Array.isArray(node.children) && depth < maxDepth) {
    for (const child of node.children) {
      renderTreeLines(child, depth + 1, maxDepth, out);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Construction des prompts
// ──────────────────────────────────────────────────────────────────────────

/**
 * Construit le prompt pour demander un plan à l'orchestrateur.
 * Inclut l'arborescence filtrée et le contenu des fichiers clés (point C).
 *
 * @param {string} userText - demande utilisateur
 * @param {object|null} existingPlan - plan existant (pour révision contextuelle)
 * @param {string} projectTree - arborescence filtrée (texte)
 * @param {object} keyFileContents - { path: content } des fichiers clés à injecter
 * @param {string} [granularity] - niveau de granularité ("fine", "medium", "large")
 * @returns {string} prompt complet
 */
export function buildPlanPrompt(userText, existingPlan, projectTree, keyFileContents, granularity) {
  const g = granularity || "fine";

  // Consignes de découpage selon la granularité
  const sizeGuides = {
    fine: {
      lines: "~30-60 lignes",
      files: "2 fichiers",
      count: "5 à 25 tâches",
      desc: "PRINCIPE CLÉ — une micro-tâche = UNE seule petite chose à faire, réalisable en ~30-60 lignes de code par un modèle codeur moins puissant, SANS ambiguïté. Si une tâche nécessite de toucher plus de 2 fichiers ou de produire plus de ~60 lignes, DÉCOUPE-LA en sous-tâches plus petites.",
    },
    medium: {
      lines: "~60-120 lignes",
      files: "3 fichiers",
      count: "3 à 12 tâches",
      desc: "PRINCIPE — chaque tâche doit être cohérente et réalisable en ~60-120 lignes de code. Tu peux grouper des opérations liées (ex: créer une route + sa validation) dans une même tâche. Évite de découper trop finement.",
    },
    large: {
      lines: "~100-200 lignes",
      files: "5 fichiers",
      count: "2 à 6 tâches",
      desc: "PRINCIPE — le codeur est un modèle puissant et rapide. Produis des tâches de ~100-200 lignes couvrant des fonctionnalités complètes. Ne découpe que si c'est vraiment nécessaire (dépendances, fichiers très différents).",
    },
  };
  const guide = sizeGuides[g] || sizeGuides.fine;
  let planContext = "";
  if (existingPlan) {
    const progress = existingPlan.progress || {};
    const completed = progress.completed || [];
    const escalated = progress.escalated || [];
    const doneIds = [...completed, ...escalated];
    const remaining = existingPlan.plan.filter((t) => !doneIds.includes(t.id));

    let summariesSection = "";
    const summaries = progress.task_summaries || {};
    if (Object.keys(summaries).length > 0) {
      const summaryLines = Object.entries(summaries)
        .map(([id, summary]) => `#${id} : ${summary}`)
        .join("\n");
      summariesSection = `\n\nRésultats des tâches déjà faites :\n${summaryLines}`;
    }

    planContext = `

Plan existant (${existingPlan.plan.length} tâches, ${doneIds.length} déjà faites) :
${JSON.stringify(existingPlan.plan, null, 2)}

Tâches restantes : ${remaining.map((t) => `#${t.id} ${t.title}`).join(", ") || "aucune"}${summariesSection}

Adapte ou complète ce plan selon la demande utilisateur. Conserve les tâches déjà faites.`;
  }

  let treeSection = "";
  if (projectTree) {
    treeSection = `\n\n=== ARBORESCENCE DU PROJET ===\n${projectTree}`;
  }

  let filesSection = "";
  if (keyFileContents && Object.keys(keyFileContents).length > 0) {
    const entries = Object.entries(keyFileContents)
      .filter(([, content]) => content !== null && content !== undefined)
      .map(([path, content]) => truncateFile(path, content))
      .join("\n\n");
    if (entries) {
      filesSection = `\n\n=== FICHIERS CLÉS DU PROJET ===\n${entries}`;
    }
  }

  return `Tu es un architecte logiciel. Analyse la demande utilisateur.

⚠️ Si la demande est une simple question (ex: "explique ce code", "quelle est la structure du projet ?", "comment fonctionne X ?") qui ne nécessite AUCUNE modification de code, réponds directement en texte, sans JSON, sans plan.

Si la demande nécessite des modifications de code, produis un plan de développement détaillé découpé en MICRO-TÂCHES.

${guide.desc} Un plan trop grossier fait perdre du temps au codeur ; un plan bien découpé s'exécute vite et sûrement.

Règles de découpage :
- Vise ${guide.count} selon l'ampleur de la demande. Ne JAMAIS produire une seule tâche géante pour un projet entier.
- Chaque tâche doit concerner au maximum ${guide.files}. Au-delà, c'est une macro-tâche → découper.
- Chaque tâche doit produire environ ${guide.lines} de code.
- Évite les tâches vagues du type « implémente X ». Découpe plutôt en : créer la signature/le type, puis implémenter la logique principale, puis gérer les cas d'erreur, puis ajouter les tests.
- Le champ "description" doit être STRUCTURÉ et détaillé : liste les sous-étapes, les fonctions/classes à créer avec leurs signatures, les comportements attendus, les cas d'erreur à gérer. Une description d'une ligne est INSUFFISANTE.
- Le champ "context" doit donner tout ce qu'un codeur moins puissant a besoin de savoir : conventions du projet, dépendances déjà installées, patterns à suivre, lien avec les tâches précédentes.
- Indique pour chaque tâche les fichiers concernés (chemins réels existants quand possible, depuis l'arborescence fournie).
- Ordonne les tâches par dépendances et remplis "depends_on" avec les IDs des prérequis.
- Réponds UNIQUEMENT avec le JSON du plan, pas d'explications. Pas de markdown, pas de balises de code, juste le JSON brut.

EXEMPLE DE BON DÉCOUPAGE (à imiter) :
Demande : « Crée une API REST pour gérer des tâches »
  #1 "Définir le modèle Task" — description: "Créer src/models/task.py avec une dataclass Task ayant les champs id:int, title:str, done:bool=False, created_at:datetime. Inclure __repr__ et une méthode to_dict()." — files: ["src/models/task.py"] — depends_on: []
  #2 "Créer la route GET /tasks" — description: "Ajouter dans src/app.py une route Flask GET /tasks qui retourne la liste des tâches en JSON (200). Utiliser le modèle Task. Gérer le cas liste vide." — files: ["src/app.py"] — depends_on: [1]
  #3 "Créer la route POST /tasks" — description: "Ajouter route POST /tasks recevant JSON {title}, créer une Task, retourner 201 avec la tâche. Valider que title est non vide (sinon 400)." — files: ["src/app.py"] — depends_on: [2]
  #4 "Ajouter les tests du modèle Task" — description: "Créer tests/test_task.py avec pytest : test de construction, test to_dict, test default done=False." — files: ["tests/test_task.py"] — depends_on: [1]
  #5 "Ajouter les tests des routes" — description: "Créer tests/test_routes.py avec pytest+Flask test_client : GET /tasks 200, POST /tasks 201, POST sans title 400." — files: ["tests/test_routes.py"] — depends_on: [3]

MAUVAIS DÉCOUPAGE (à éviter absolument) :
  #1 "Créer l'API REST des tâches" — description: "Implémenter l'API" — files: ["src/app.py"] — depends_on: []
  → TROP GROSSIER : un seul fichier, description vague. Le codeur ne sait pas par où commencer et va passer beaucoup de temps à tout faire d'un coup, avec risque d'échec.

Format de réponse obligatoire :
{"global_directive": "Objectif final immuable du projet en une phrase très concise", "plan": [{"id": 1, "title": "...", "description": "...", "files": [...], "context": "...", "depends_on": [...]}, ...]}

La \"global_directive\" est un résumé immuable et très concis de l'objectif final du projet. Elle sera réinjectée en haut de chaque prompt de tâche pour ancrer le codeur dans la bonne direction.${treeSection}${filesSection}${planContext}

Demande utilisateur : ${userText}`;
}

/**
 * Construit le contexte commun injecté dans les prompts de tâche et d'escalade
 * (point I — factorisation).
 *
 * @param {object} previousSummaries - { taskId: summary }
 * @returns {string} sections formatées
 */
export function buildCommonContext(previousSummaries) {
  let summariesSection = "";
  if (previousSummaries && Object.keys(previousSummaries).length > 0) {
    const lines = Object.entries(previousSummaries)
      .map(([id, summary]) => `#${id} : ${summary}`)
      .join("\n");
    summariesSection = `\n\n=== TÂCHES PRÉCÉDENTES TERMINÉES ===\n${lines}`;
  }

  return summariesSection;
}

/**
 * Construit le prompt pour envoyer une tâche au codeur.
 *
 * @param {object} task - tâche normalisée
 * @param {number} attemptNumber - numéro de tentative (1-based)
 * @param {object} previousSummaries - { taskId: summary }
 * @param {string} projectTree - arborescence filtrée (texte)
 * @param {string[]} upcomingTaskTitles - titres des tâches suivantes (vue d'ensemble)
 * @param {string} [granularity] - niveau de granularité ("fine", "medium", "large")
 * @param {string} [globalDirective] - directive globale du plan (V2)
 * @returns {string} prompt complet
 */
export function buildTaskPrompt(task, attemptNumber, previousSummaries, projectTree, upcomingTaskTitles, granularity, globalDirective) {
  const attempt = attemptNumber || 1;
  const g = granularity || "fine";

  const sizeObjectives = {
    fine: "~30-60 lignes",
    medium: "~60-120 lignes",
    large: "~100-200 lignes",
  };
  const sizeObj = sizeObjectives[g] || sizeObjectives.fine;

  let retryContext = "";
  if (attempt > 1) {
    retryContext = `

⚠️ C'est ta ${attempt}e tentative. Ta réponse précédente n'a pas été jugée satisfaisante.
Assure-toi d'inclure DONE: <résumé> quand tu as vraiment terminé ET que les fichiers sont effectivement modifiés/créés.
Si tu es bloqué, utilise NEED_HELP: <question> pour demander de l'aide.`;
  }

  const commonContext = buildCommonContext(previousSummaries);

  let filesInstruction = "";
  if (task.files && task.files.length > 0) {
    filesInstruction = `

⚠️ DÉLÉGATION DE LECTURE OBLIGATOIRE — Lis toi-même les fichiers suivants avec ton outil read_file AVANT toute modification :
${task.files.map(f => `  - ${f}`).join("\n")}

N'attends pas que le contenu te soit injecté dans ce prompt. Analyse activement chaque fichier, puis propose les modifications chirurgicales demandées.`;
  }

  let treeSection = "";
  if (projectTree) {
    treeSection = `\n\n=== ARBORESCENCE DU PROJET ===\n${projectTree}`;
  }

  let upcomingSection = "";
  if (Array.isArray(upcomingTaskTitles) && upcomingTaskTitles.length > 0) {
    upcomingSection = `\n\n=== TÂCHES SUIVANTES PRÉVUES (pour ta compréhension, n'en fais que la tienne) ===\n${upcomingTaskTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  }

  const directiveBanner = globalDirective
    ? `=== OBJECTIF GLOBAL (NE PAS PERDRE DE VUE) ===\n${globalDirective}\n\n`
    : "";

  return `${directiveBanner}Tu exécutes une micro-tâche précise. Tu DOIS respecter les 3 phases ci-dessous DANS L'ORDRE, en marquant chacune par son en-tête obligatoire. Ne saute aucune phase, n'en inverse aucune.

Tâche : ${task.title}
Description : ${task.description}
Fichiers concernés : ${task.files && task.files.length ? task.files.join(", ") : "non spécifiés"}
Contexte : ${task.context || "aucun"}${commonContext}${filesInstruction}${treeSection}${upcomingSection}${retryContext}

=== PHASE 1 — RÉFLEXION ===
- Liste les fichiers que tu vas lire avec read_file et ce que tu cherches dans chacun.
- Énonce en 3-5 points ce que tu vas modifier/créer et pourquoi.
- Identifie les cas d'erreur / edge cases à gérer.
Termine cette phase par EXACTEMENT la ligne : REFLEXION_DONE

=== PHASE 2 — EXECUTION ===
- Applique les modifications avec les formats SEARCH/REPLACE ou CREATE (voir ci-dessous).
- Une fois toutes les modifications appliquées, termine cette phase par EXACTEMENT la ligne :
  MODIFS_DONE: <liste des fichiers modifiés/créés>

=== PHASE 3 — CONTRÔLES ===
- Relis chaque fichier modifié avec read_file (l'état réel après tes modifications).
- Vérifie point par point que chaque élément de la description est couvert.
- Vérifie qu'il n'y a pas de régression (import cassé, fonction orpheline, type manquant, etc.).
- Si TOUT est bon, réponds : DONE: <résumé concis de ce qui a été fait>.
- Si tu détectes un défaut, réponds : SELF_FIX: <défaut constaté en une phrase>, puis ARRÊTE-TOI (ne corrige pas dans ce tour — un nouveau tour te sera donné pour corriger dans la même session).
- Si la tâche est réellement trop grosse ou impossible, réponds : NEED_HELP: <question>.

Tu as droit à 3 cycles Phase 2 + Phase 3 au total. Ne dépasse pas.

=== FORMAT OBLIGATOIRE POUR LES MODIFICATIONS ===
Tu es obligé d'utiliser EXCLUSIVEMENT l'un de ces deux formats pour tout changement de fichier. N'envoie JAMAIS un fichier entier en réponse libre.

1. MODIFICATION d'un fichier existant (un ou plusieurs blocs par fichier) :
SEARCH/REPLACE: <filepath>
<<<<<<< SEARCH
(ancien code EXACT à remplacer — espaces, indentations et sauts de ligne doivent correspondre au fichier)
=======
(nouveau code)
>>>>>>> REPLACE

2. CRÉATION d'un nouveau fichier :
CREATE: <filepath>
(contenu complet du fichier)

Règles strictes :
- Si plusieurs zones d'un même fichier changent, utilise plusieurs blocs SEARCH/REPLACE avec le même <filepath>.
- Le texte dans SEARCH doit être extrait tel quel du fichier lu via read_file.
- Si tu as lu les fichiers et qu'aucune modification n'est nécessaire, réponds EXACTEMENT : NO_CHANGE: <filepath> — aucune modification nécessaire, puis DONE: <résumé>.
- Si tu crées un fichier, le bloc CREATE doit contenir le contenu COMPLET et rien d'autre après le chemin.

Règles de conduite :
- Lis les fichiers avec read_file avant toute modification.
- Écris/modifie UNIQUEMENT les fichiers nécessaires à cette tâche.
- Produis du code fonctionnel et propre.
- N'envoie JAMAIS de code en dehors des blocs SEARCH/REPLACE / CREATE.
- OBJECTIF DE TAILLE : ${sizeObj} pour cette tâche. Si elle est réellement trop grosse, signale NEED_HELP: "tâche trop grosse, demander un découpage" plutôt que de tout faire d'un coup.
- Si tu as lu les fichiers et qu'aucune modification n'est nécessaire, réponds EXACTEMENT : NO_CHANGE: <filepath> — aucune modification nécessaire, puis DONE: <résumé>.

Commence par la PHASE 1.`;
}

/**
 * Construit un prompt de retry reformulé pour le codeur local.
 * Au 2e essai, on ne répète pas le même prompt : on rappelle le format
 * attendu avec un exemple minimal, on mentionne l'erreur précédente et on
 * durcit les contraintes.
 *
 * @param {object} task - tâche normalisée
 * @param {number} attemptNumber - numéro de tentative (1-based, attendu >= 2)
 * @param {string} lastError - feedback de l'échec précédent
 * @param {object} previousSummaries - { taskId: summary }
 * @param {string} projectTree - arborescence filtrée (texte)
 * @param {string[]} upcomingTaskTitles - titres des tâches suivantes
 * @param {string} [granularity] - niveau de granularité
 * @param {string} [globalDirective] - directive globale du plan (V2)
 * @returns {string} prompt complet
 */
export function buildRetryTaskPrompt(task, attemptNumber, lastError, previousSummaries, projectTree, upcomingTaskTitles, granularity, globalDirective) {
  const basePrompt = buildTaskPrompt(task, attemptNumber, previousSummaries, projectTree, upcomingTaskTitles, granularity, globalDirective);

  const strictAddendum = `

=== ⚠️ RETENTATIVE ${attemptNumber} — CORRIGE L'ERREUR CI-DESSOUS ===
Lors de ta tentative précédente, le problème suivant a été constaté :
${lastError || "La réponse n'a pas été jugée satisfaisante (format manquant, fichiers non modifiés, ou DONE absent)."}

Avant de répondre :
1. Relis les fichiers concernés avec read_file.
2. Vérifie que chaque bloc SEARCH/REPLACE ou CREATE respecte EXACTEMENT le format demandé.
3. N'écris PAS de prose autour des blocs.
4. Si tu as lu les fichiers et qu'aucune modification n'est nécessaire, réponds EXACTEMENT : NO_CHANGE: <filepath> — aucune modification nécessaire, puis DONE: <résumé>.
5. Termine obligatoirement par : DONE: <résumé concis de ce qui a été fait>.

Exemple valide pour une modification :
SEARCH/REPLACE: src/example.js
<<<<<<< SEARCH
function old() { return 1; }
=======
function old() { return 2; }
>>>>>>> REPLACE

DONE: Mise à jour de old() dans src/example.js.
`;

  return basePrompt.replace(
    /⚠️ C'est ta \d+e tentative\. Ta réponse précédente n'a pas été jugée satisfaisante\.\nAssure-toi d'inclure DONE: <résumé> quand tu as vraiment terminé ET que les fichiers sont effectivement modifiés\/créés\.\nSi tu es bloqué, utilise NEED_HELP: <question> pour demander de l'aide\./,
    strictAddendum.trim()
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Mode Orchestration V3 — auto-contrôle du codeur (SELF_FIX)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Détecte le DERNIER marqueur émis par le codeur dans sa réponse.
 * Marqueurs reconnus (par position décroissante dans le texte) :
 *   SELF_FIX: <défaut>   — le codeur a détecté un défaut en Phase 3 et demande
 *                           un nouveau tour pour corriger (même session).
 *   DONE: <résumé>        — tâche terminée et auto-contrôlée.
 *   NEED_HELP: <question> — le codeur est bloqué.
 *   NO_CHANGE: <filepath> — aucun changement nécessaire (tâche de vérification).
 * Le marqueur le plus loin dans le texte gagne (gère le cas où le codeur émet
 * SELF_FIX puis DONE dans le même tour — auquel cas DONE prime car il est après).
 *
 * @param {string} text - réponse brute du codeur
 * @returns {{marker: string|null, payload: string|null}}
 */
export function detectCoderMarker(text) {
  if (!text || typeof text !== "string") return { marker: null, payload: null };
  const markers = [
    { name: "SELF_FIX", re: /\bSELF_FIX\s*:\s*([\s\S]*?)(?=\n(?:DONE|NEED_HELP|NO_CHANGE|SELF_FIX)\s*:|$)/gi },
    { name: "DONE", re: /\bDONE\s*:\s*([\s\S]*?)(?=\n(?:DONE|NEED_HELP|NO_CHANGE|SELF_FIX)\s*:|$)/gi },
    { name: "NEED_HELP", re: /\bNEED_HELP\s*:\s*([\s\S]*?)(?=\n(?:DONE|NEED_HELP|NO_CHANGE|SELF_FIX)\s*:|$)/gi },
    { name: "NO_CHANGE", re: /\bNO_CHANGE\s*:\s*([^\n]+)/gi },
  ];
  let last = { idx: -1, name: null, payload: null };
  for (const mk of markers) {
    let m;
    // reset lastIndex pour les regex globales
    mk.re.lastIndex = 0;
    while ((m = mk.re.exec(text)) !== null) {
      const idx = m.index;
      if (idx > last.idx) last = { idx, name: mk.name, payload: (m[1] || "").trim() };
      if (m.index === mk.re.lastIndex) mk.re.lastIndex++; // évite boucle infinie sur match vide
    }
  }
  return { marker: last.name, payload: last.payload };
}

/**
 * Construit le prompt court renvoyé au codeur après un SELF_FIX (Phase 3 — CONTRÔLER).
 * Ce prompt est envoyé DANS LA MÊME SESSION (sans new_session) : le codeur garde
 * son contexte et peut relire le fichier réel (modifié par applySearchReplaceBlocks
 * au tour précédent) puis corriger le défaut qu'il a lui-même constaté.
 *
 * @param {object} task - tâche normalisée
 * @param {string} defect - défaut constaté par le codeur (payload du SELF_FIX)
 * @param {string} [globalDirective] - directive globale du plan (V2)
 * @param {number} [cyclesRemaining] - nombre de cycles de correction restants (max 3)
 * @returns {string} prompt de correction in-session
 */
export function buildSelfFixPrompt(task, defect, globalDirective, cyclesRemaining) {
  const directiveBanner = globalDirective
    ? `=== OBJECTIF GLOBAL ===\n${globalDirective}\n\n`
    : "";
  const remaining = typeof cyclesRemaining === "number" ? cyclesRemaining : 2;
  return `${directiveBanner}Tu es en PHASE 3 (CONTRÔLES) de la tâche : ${task.title}.

Tu as toi-même détecté ce défaut après relisage : ${defect || "(défaut non précisé)"}

Corrige-le maintenant, dans la même session :
1. Relis le fichier concerné avec read_file (l'état actuel sur disque, déjà modifié au tour précédent).
2. Applique la correction avec un bloc SEARCH/REPLACE: <path> ... >>>>>>> REPLACE (ou CREATE: <path> si nouveau fichier). Respecte EXACTEMENT le format.
3. Recontrôle : vérifie que le défaut est résolu ET que tu n'as rien cassé d'autre.
4. Si tout est bon, réponds : DONE: <résumé concis>.
5. Si tu détectes un AUTRE défaut, réponds : SELF_FIX: <défaut>, puis arrête-toi.
6. Si tu es bloqué, réponds : NEED_HELP: <question>.

Il te reste ${remaining} cycle(s) de correction après celui-ci. Commence.`;
}

/**
 * Construit le prompt d'escalade à l'orchestrateur (point I — réutilise buildCommonContext).
 * Mode Orchestration V2 : l'orchestrateur choisit explicitement une action parmi 4.
 *
 * @param {object} task - tâche normalisée
 * @param {number} attempts - nombre de tentatives codeur déjà échouées
 * @param {string} lastError - dernière erreur/feedback du codeur
 * @param {object} previousSummaries - { taskId: summary }
 * @param {object} [metrics] - { durationMs, responseChars } de la dernière tentative codeur (point N)
 * @param {Array} [toolCalls] - outils utilisés par le codeur pendant la dernière tentative [{ name, args }]
 * @param {string} [globalDirective] - directive globale du plan (V2)
 * @returns {string} prompt complet
 */
export function buildEscalationPrompt(task, attempts, lastError, previousSummaries, metrics, toolCalls, globalDirective) {
  const commonContext = buildCommonContext(previousSummaries);

  let filesInstruction = "";
  if (task.files && task.files.length > 0) {
    filesInstruction = `\n\n⚠️ Fichiers concernés :\n${task.files.map(f => `  - ${f}`).join("\n")}`;
  }

  let metricsSection = "";
  if (metrics && typeof metrics === "object") {
    const parts = [];
    if (typeof metrics.durationMs === "number") parts.push(`durée : ${(metrics.durationMs / 1000).toFixed(1)}s`);
    if (typeof metrics.responseChars === "number") parts.push(`longueur réponse : ${metrics.responseChars} car.`);
    if (parts.length) metricsSection = `\n\nMétriques de la dernière tentative codeur : ${parts.join(", ")}.`;
  }

  let toolCallsSection = "";
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const lines = toolCalls.map((tc) => {
      const args = tc.args || {};
      const target = args.path || args.file || args.command || args.target || "";
      return `  - ${tc.name}${target ? `(${target})` : ""}`;
    });
    toolCallsSection = `\n\nOutils utilisés par le codeur pendant sa dernière tentative :\n${lines.join("\n")}`;
  }

  const directiveBanner = globalDirective
    ? `\n\n=== OBJECTIF GLOBAL ===\n${globalDirective}`
    : "";

  return `Le codeur a échoué ${attempts} fois sur la tâche suivante. Choisis EXPLICITEMENT l'action la plus adaptée parmi les 4 options ci-dessous. Ne réponds pas en dehors du format demandé.${directiveBanner}

Tâche #${task.id} : ${task.title}
Description : ${task.description}
Fichiers concernés : ${task.files && task.files.length ? task.files.join(", ") : "non spécifiés"}
Contexte : ${task.context || "aucun"}${commonContext}${filesInstruction}

Dernière erreur/feedback : ${lastError || "Pas de feedback spécifique"}${metricsSection}${toolCallsSection}

Choisis une action et réponds avec le marqueur correspondant :

[ACTION: REDECOUPER]
→ La tâche est trop grosse ou ambiguë pour le codeur. Redécoupe-la en 2 à 4 sous-tâches plus petites.
Format attendu : {"plan": [{"id": N, "title": "...", "description": "...", "files": [...], "context": "...", "depends_on": [...]}, ...]}

[ACTION: EXECUTER]
→ Le codeur manque de la logique requise ; tu vas réaliser la tâche toi-même avec tes outils.
Format attendu : exécute les modifications, puis inclus DONE: <résumé>.

[ACTION: REVISER]
→ Il y a une faille conceptuelle dans le plan global. Révise les tâches restantes du plan.
Format attendu : {"plan": [...]} (uniquement les tâches restantes à faire).

[ACTION: COMMANDE]
→ Le problème est purement technique/environnemental (ex: dépendance manquante).
Format attendu : [COMMANDE: <commande à exécuter>]
Tu peux ensuite, si besoin, ajouter DONE: <résumé> quand la commande est lancée.

Réponds maintenant.`;
}

/**
 * Construit le prompt de révision mid-plan pour l'orchestrateur (point E).
 * L'orchestrateur revoit les tâches restantes à la lumière de ce qui a été fait,
 * en incluant les MÉTRIQUES RÉELLES par tâche (durée, tentatives, échecs) — point N.
 * Cela permet à l'orchestrateur d'ajuster la granularité des tâches restantes
 * (découper plus fin si les tâches ont pris trop de temps / tentatives).
 *
 * @param {object} currentPlan - { plan: [...], progress: {...} }
 * @param {string} projectTree - arborescence filtrée
 * @param {Array} [toolCalls] - outils utilisés pendant les dernières tâches (point 5.10)
 * @returns {string} prompt de révision
 */
export function buildRevisionPrompt(currentPlan, projectTree, toolCalls) {
  const progress = currentPlan.progress || {};
  const completed = progress.completed || [];
  const escalated = progress.escalated || [];
  const doneIds = new Set([...completed, ...escalated]);
  const doneTasks = currentPlan.plan.filter((t) => doneIds.has(t.id));
  const remainingTasks = currentPlan.plan.filter((t) => !doneIds.has(t.id));

  const summaries = progress.task_summaries || {};
  const metrics = progress.task_metrics || {};
  const doneLines = doneTasks
    .map((t) => {
      const m = metrics[t.id];
      const parts = [`#${t.id} ${t.title} — ${summaries[t.id] || "(pas de résumé)"}`];
      if (m) {
        const bits = [];
        if (typeof m.attempts === "number") bits.push(`${m.attempts} tentative(s)`);
        if (typeof m.durationMs === "number") bits.push(`durée ${(m.durationMs / 1000).toFixed(1)}s`);
        if (m.status === "escalated") bits.push("ESCALADÉE");
        if (m.subdivided) bits.push("subdivisée");
        if (bits.length) parts.push(`   [${bits.join(", ")}]`);
      }
      return parts.join("\n");
    })
    .join("\n");

  let treeSection = "";
  if (projectTree) {
    treeSection = `\n\n=== ARBORESCENCE ACTUELLE DU PROJET ===\n${projectTree}`;
  }

  // Analyse automatique des métriques pour guider l'orchestrateur (point P)
  let metricsHint = "";
  const doneMetrics = doneTasks.map((t) => metrics[t.id]).filter(Boolean);
  if (doneMetrics.length >= 2) {
    const avgDuration = doneMetrics.reduce((s, m) => s + (m.durationMs || 0), 0) / doneMetrics.length;
    const avgAttempts = doneMetrics.reduce((s, m) => s + (m.attempts || 1), 0) / doneMetrics.length;
    const escalades = doneMetrics.filter((m) => m.status === "escalated").length;
    const hints = [];
    if (avgDuration > 90000) hints.push(`durée moyenne par tâche élevée (${(avgDuration / 1000).toFixed(0)}s) → DÉCOUPE plus finement les tâches restantes`);
    if (avgAttempts > 1.3) hints.push(`nombre moyen de tentatives élevé (${avgAttempts.toFixed(1)}) → tâches probablement trop grosses ou ambiguës, découpe-les`);
    if (escalades / doneMetrics.length > 0.4) hints.push(`beaucoup d'escalades (${escalades}/${doneMetrics.length}) → affine les descriptions et le contexte des tâches restantes`);
    if (hints.length) metricsHint = `\n\n=== ANALYSE DES MÉTRIQUES (guidage) ===\n${hints.join("\n")}`;
  }

  let toolCallsSection = "";
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const lines = toolCalls.map((tc) => {
      const args = tc.args || {};
      const target = args.path || args.file || args.command || args.target || "";
      return `  - ${tc.name}${target ? `(${target})` : ""}`;
    });
    toolCallsSection = `\n\n=== OUTILS UTILISÉS RÉCEMMENT PAR LE CODEUR ===\n${lines.join("\n")}`;
  }

  return `Tu es l'architecte d'un plan en cours d'exécution. Le codeur a réalisé certaines tâches. Revois le plan RESTANT à la lumière de ce qui a été fait réellement (fichiers créés, approche adoptée) ET des métriques observées (durée, tentatives, escalades).

=== TÂCHES DÉJÀ RÉALISÉES (avec métriques) ===
${doneLines || "(aucune)"}

=== TÂCHES RESTANTES (plan actuel) ===
${JSON.stringify(remainingTasks, null, 2)}${treeSection}${metricsHint}${toolCallsSection}

Consignes :
- Conserve les IDs des tâches déjà faites (ne les re-crée pas)
- Tu peux réorganiser, fusionner, découper ou annuler les tâches restantes
- Si les métriques montrent que les tâches ont pris trop de temps ou généré beaucoup de tentatives/escalades, DÉCOUPE plus finement les tâches restantes (max 2 fichiers, ~30-60 lignes chacune)
- Les nouveaux IDs doivent être > ${maxId(currentPlan.plan)} pour éviter les collisions
- Garde le même format JSON : {"plan": [...]}
- Réponds UNIQUEMENT avec le JSON du plan révisé (uniquement les tâches restantes à faire), pas d'explications.

Format :
{"plan": [{"id": N, "title": "...", "description": "...", "files": [...], "context": "...", "depends_on": [...]}, ...]}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Résumés de tâches (point G)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extrait un résumé concis de la réponse de l'agent.
 * Priorise le texte après `DONE:`. Sinon, prend la dernière ligne non vide
 * (tronquée). Plus robuste qu'avant : retire les formules de politesse courantes.
 *
 * @param {string} responseText - réponse brute de l'agent
 * @param {number} taskId - ID de la tâche (pour fallback)
 * @returns {string} résumé concis
 */
export function extractTaskSummary(responseText, taskId) {
  if (!responseText || !responseText.trim()) return `Tâche #${taskId} terminée`;

  // 1. Chercher DONE: ... (sur la même ligne, jusqu'à la fin de ligne)
  const doneMatch = responseText.match(/DONE\s*:\s*([\s\S]*?)(?:\n(?:NEED_HELP|DONE)\s*:|$)/i);
  if (doneMatch && doneMatch[1]) {
    let summary = doneMatch[1].trim();
    // Prendre la première ligne significative du résumé
    const firstLine = summary.split("\n").find((l) => l.trim().length > 0);
    if (firstLine) summary = firstLine.trim();
    return clampSummary(summary, taskId);
  }

  // 2. Fallback : dernière ligne non vide, en filtrant le bruit
  const noise = /^(voilà|voici|n'hésite|n'hésitez|bon courage|à ta disposition|c'est fait|terminé\.?)\s*[!?.]*$/i;
  const lines = responseText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !noise.test(l));
  if (lines.length > 0) {
    return clampSummary(lines[lines.length - 1], taskId);
  }
  return `Tâche #${taskId} terminée`;
}

function clampSummary(text, taskId) {
  let s = text.replace(/^[*\-•]\s*/, "").trim();
  if (s.length > SUMMARY_MAX_CHARS) s = s.substring(0, SUMMARY_MAX_CHARS - 3) + "...";
  return s || `Tâche #${taskId} terminée`;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation post-tâche (point A)
// IMPORTANT : les chemins listés/mentionnés sont relatifs au projet ouvert, mais
// file_exists/file_mtime s'exécutent dans le cwd du process Tauri (qui n'est PAS
// le projet ouvert). On doit donc résoudre en chemin absolu avant d'invoquer.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Résout un chemin potentiellement relatif par rapport au projet ouvert.
 * Si le chemin est déjà absolu (Windows X:\, UNC \\\\, Unix /), on le garde tel quel.
 * Si projectPath est vide, on retourne le chemin inchangé (fallback cwd).
 * @param {string} path
 * @param {string} [projectPath]
 * @returns {string}
 */
export function resolvePath(path, projectPath) {
  if (!path) return path;
  // Absolu Windows (X:\) ou UNC (\\\\) ou Unix (/)
  if (/^([A-Za-z]:[\\/]|\\\\\\\\|\/)/.test(path)) return path;
  if (!projectPath) return path;
  const base = projectPath.replace(/[\\/]+$/, "");
  const rel = path.replace(/^[\\/]+/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return base + sep + rel;
}

/**
 * Capture l'état des fichiers d'une tâche avant exécution (existence + mtime).
 * Utilise les commandes Tauri `file_exists` et `file_mtime`. Les chemins sont
 * résolus par rapport au projet ouvert.
 *
 * @param {object} task - tâche normalisée
 * @param {Function} invokeFn - fonction invoke de Tauri
 * @param {string} [projectPath] - chemin absolu du projet ouvert
 * @returns {Promise<object>} { path: { exists: bool, mtime: number|null } } (clé = chemin relatif original)
 */
export async function captureFileState(task, invokeFn, projectPath) {
  const state = {};
  if (!task || !Array.isArray(task.files) || task.files.length === 0) return state;
  const results = await Promise.all(task.files.map(async (path) => {
    if (typeof path !== "string" || !path.trim()) return null;
    const abs = resolvePath(path, projectPath);
    try {
      const exists = await invokeFn("file_exists", { path: abs });
      let mtime = null;
      if (exists) {
        try {
          mtime = await invokeFn("file_mtime", { path: abs });
        } catch (_) {
          mtime = null;
        }
      }
      return { path, state: { exists: !!exists, mtime } };
    } catch (_) {
      return { path, state: { exists: false, mtime: null } };
    }
  }));
  for (const r of results) {
    if (r) state[r.path] = r.state;
  }
  return state;
}

/**
 * Extrait les chemins de fichiers mentionnés dans le texte de réponse du codeur
 * (utile quand le codeur improvise des fichiers non listés dans la tâche).
 * Reconnaît les chemins relatifs avec une extension de code/doc courante.
 *
 * @param {string} text - texte de la réponse du codeur
 * @returns {string[]} liste de chemins uniques (sans le ./ éventuel)
 */
export function extractMentionedFiles(text) {
  if (!text || typeof text !== "string") return [];
  const files = new Set();

  // Extraction explicite des marqueurs NO_CHANGE: <path> et CREATE: <path>
  const explicitMarkers = /(?:^|\n)\s*(?:NO_CHANGE|CREATE)\s*:\s*([^\n]+)/gmi;
  let em;
  while ((em = explicitMarkers.exec(text)) !== null) {
    const raw = (em[1] || "").trim();
    if (raw) files.add(raw.replace(/\s.*$/, ""));
  }

  const ext =
    "md|markdown|js|mjs|cjs|ts|tsx|jsx|json|jsonc|css|scss|sass|html|htm|rs|toml|yaml|yml|txt|sh|bash|py|go|java|c|cc|cpp|h|hpp|rb|php|sql|vue|svelte|xml|csv|env|gitignore|lock";
  // Regex plus permissif : accepte espaces/accents dans les chemins, en exigeant un séparateur avant.
  const re = new RegExp(
    "(?:^|[\s\\\"\'\(\[\{])(?:\./)?(?:[^\s\\\"\'\(\[\{]*?\/)?[^\s\\\"\'\(\[\{]+\.(?:" + ext + ")(?=[\s\\\"\'\)\]\}]|$)",
    "gmi"
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
      .replace(/^[\s\\\"\'\(\[\{]+/, "")
      .replace(/^\./, "")
      .trim();
    if (!raw) continue;
    // Ignorer les faux positifs évidents (versions comme 1.2.3, URLs, etc.)
    if (/^\d+\./.test(raw)) continue;
    if (/^(http|https|ftp):\/\//i.test(raw)) continue;
    files.add(raw);
  }
  return [...files];
}

/**
 * Vérifie qu'au moins un fichier listé a été créé ou modifié après l'exécution.
 * Si la vérification stricte échoue, on assouplit en examinant les fichiers
 * mentionnés dans la réponse DONE du codeur (cas où il improvise des fichiers
 * non listés dans la tâche).
 *
 * @param {object} task - tâche normalisée
 * @param {object} beforeState - état capturé avant exécution (via captureFileState)
 * @param {Function} invokeFn - fonction invoke de Tauri
 * @param {string} [responseText] - texte de la réponse du codeur (pour assouplissement)
 * @param {string} [projectPath] - chemin absolu du projet ouvert (pour résoudre les chemins relatifs)
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function checkTaskFilesChanged(task, beforeState, invokeFn, responseText = "", projectPath) {
  let created = 0;
  let modified = 0;
  let unchanged = 0;
  const listed = (task && Array.isArray(task.files)) ? task.files.filter((p) => typeof p === "string" && p.trim()) : [];

  // 1) Vérification stricte sur les fichiers listés dans la tâche (parallélisée)
  const fileResults = await Promise.all(listed.map(async (path) => {
    const before = beforeState[path] || { exists: false, mtime: null };
    const abs = resolvePath(path, projectPath);
    let afterExists = false;
    let afterMtime = null;
    try {
      afterExists = await invokeFn("file_exists", { path: abs });
      if (afterExists) {
        try {
          afterMtime = await invokeFn("file_mtime", { path: abs });
        } catch (_) {
          afterMtime = null;
        }
      }
    } catch (_) {
      afterExists = false;
    }
    if (!before.exists && afterExists) return "created";
    if (before.exists && afterExists && before.mtime !== null && afterMtime !== null && before.mtime !== afterMtime) return "modified";
    return "unchanged";
  }));
  for (const r of fileResults) {
    if (r === "created") created++;
    else if (r === "modified") modified++;
    else unchanged++;
  }
  if (created > 0 || modified > 0) {
    return {
      ok: true,
      reason: `${created} fichier(s) créé(s), ${modified} modifié(s), ${unchanged} inchangé(s)`,
    };
  }

  // 2) Pas de fichier listé modifié : assouplissement via fichiers mentionnés dans la réponse
  const mentioned = extractMentionedFiles(responseText);
  for (const path of mentioned) {
    if (listed.includes(path)) continue; // déjà vérifié ci-dessus
    const abs = resolvePath(path, projectPath);
    try {
      const exists = await invokeFn("file_exists", { path: abs });
      if (exists) {
        return {
          ok: true,
          reason: `fichier mentionné dans la réponse DONE : ${path} (non listé dans la tâche)`,
        };
      }
    } catch (_) {
      /* ignore */
    }
  }

  // 3) Tâche de vérification : le codeur a lu les fichiers et indique explicitement qu'aucune modification n'est nécessaire.
  const noChangeMatch = responseText.match(/NO_CHANGE\s*:\s*([^\n]+)/i);
  if (noChangeMatch) {
    const noChangePath = noChangeMatch[1].trim().split(/\s/)[0];
    if (noChangePath) {
      const abs = resolvePath(noChangePath, projectPath);
      try {
        const exists = await invokeFn("file_exists", { path: abs });
        if (exists) {
          return {
            ok: true,
            reason: `fichier vérifié, aucune modification nécessaire (NO_CHANGE: ${noChangePath})`,
          };
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  if (listed.length === 0) {
    return { ok: true, reason: "pas de fichiers listés à valider" };
  }
  return {
    ok: false,
    reason: `Aucun fichier listé n'a été créé ou modifié (${unchanged} inchangé(s)) et aucun fichier mentionné dans la réponse n'existe. Le codeur n'a probablement pas écrit les fichiers attendus.`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Sélection de la prochaine tâche (point D — respect de depends_on)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sélectionne la prochaine tâche exécutable : la première tâche non terminée
 * dont TOUTES les dépendances sont satisfaites (présentes dans doneIds).
 *
 * @param {Array} tasks - tâches du plan
 * @param {Set<number>} doneIds - IDs terminés (completed ∪ escalated)
 * @returns {object|null} tâche exécutable, ou null si bloqué
 */
export function pickNextTask(tasks, doneIds) {
  for (const t of tasks) {
    if (doneIds.has(t.id)) continue;
    const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
    if (deps.every((d) => doneIds.has(d))) {
      return t;
    }
  }
  return null;
}

/**
 * Détermine si le plan est bloqué : il reste des tâches non terminées mais
 * aucune n'a ses dépendances satisfaites (cycle ou dépendance échouée).
 *
 * @param {Array} tasks - tâches du plan
 * @param {Set<number>} doneIds - IDs terminés
 * @returns {boolean} true si bloqué
 */
export function isPlanBlocked(tasks, doneIds) {
  const remaining = tasks.filter((t) => !doneIds.has(t.id));
  return remaining.length > 0 && pickNextTask(tasks, doneIds) === null;
}

// ──────────────────────────────────────────────────────────────────────────
// Fusion d'un plan révisé (point E)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fusionne un plan révisé (tâches restantes) avec le plan courant.
 * Conserve les tâches déjà terminées, remplace les tâches restantes par
 * la révision de l'orchestrateur.
 *
 * @param {object} currentPlan - { plan: [...], progress: {...} }
 * @param {Array} revisedRemaining - tâches révisées (normalisées)
 * @returns {object} nouveau plan fusionné
 */
export function mergeRevisedPlan(currentPlan, revisedRemaining) {
  const progress = currentPlan.progress || {};
  const doneIds = new Set([...(progress.completed || []), ...(progress.escalated || [])]);
  const doneTasks = currentPlan.plan.filter((t) => doneIds.has(t.id));
  const normalizedRevised = normalizePlan(revisedRemaining);
  // Nettoyer les task_attempts/summaries des tâches supprimées
  const revisedIds = new Set(normalizedRevised.map((t) => t.id));
  const newTaskAttempts = {};
  if (progress.task_attempts) {
    for (const [id, n] of Object.entries(progress.task_attempts)) {
      if (doneIds.has(Number(id)) || revisedIds.has(Number(id))) {
        newTaskAttempts[id] = n;
      }
    }
  }
  return {
    plan: [...doneTasks, ...normalizedRevised],
    progress: {
      ...progress,
      current_task: 0,
      task_attempts: newTaskAttempts,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Métriques finales (point K)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ajuste la granularité effective selon le taux d'échec récent.
 * Si les dernières tâches ont nécessité beaucoup de retries, on passe en
 * granularité plus fine. Si tout se passe bien, on peut rester ou remonter.
 *
 * @param {string} baseGranularity - "fine", "medium" ou "large"
 * @param {object} progress - { completed, failed, escalated, task_attempts }
 * @param {number} windowSize - nombre de dernières tâches à considérer
 * @returns {string} granularité effective
 */
export function getAdaptiveGranularity(baseGranularity, progress, windowSize = 5) {
  const order = { fine: 0, medium: 1, large: 2 };
  const attempts = progress?.task_attempts || {};
  const allIds = Object.keys(attempts).map(Number).filter((n) => Number.isFinite(n));
  if (allIds.length === 0) return baseGranularity;
  const recentIds = allIds.slice(-windowSize);
  const avgAttempts = recentIds.reduce((sum, id) => sum + (attempts[id] || 0), 0) / recentIds.length;
  let current = order[baseGranularity] ?? 1;
  if (avgAttempts >= 1.5) current = Math.max(0, current - 1);
  else if (avgAttempts <= 0.2) current = Math.min(2, current + 1);
  return Object.keys(order).find((k) => order[k] === current) || baseGranularity;
}

/**
 * Estime le nombre de tokens d'un texte (approximation grossière : 1 token ≈ 4 caractères).
 * À n'utiliser que pour des ordres de grandeur et des garde-fous basiques.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Compresse un prompt de tâche en réduisant l'arbre et les résumés si on dépasse
 * la fenêtre de contexte cible. Retourne le prompt compacté.
 *
 * @param {string} prompt - prompt complet
 * @param {number} maxTokens - seuil cible
 * @returns {string}
 */
export function compactTaskPrompt(prompt, maxTokens) {
  if (estimateTokens(prompt) <= maxTokens) return prompt;
  let compacted = prompt;
  // 1) Réduire la section arbre
  compacted = compacted.replace(
    /=== ARBORESCENCE DU PROJET ===[\s\S]*?(?=\n=== TÂCHES SUIVANTES PRÉVUES ===|\n=== FORMAT OBLIGATOIRE)/,
    "=== ARBORESCENCE DU PROJET ===\n(arborescense tronquée pour tenir dans le contexte)"
  );
  if (estimateTokens(compacted) <= maxTokens) return compacted;
  // 2) Réduire les résumés des tâches précédentes
  // V3 (Bug 1) : libellés réels produits par buildCommonContext =
  // "=== TÂCHES PRÉCÉDENTES TERMINÉES ===", suivis par l'arborescence, les
  // tâches suivantes, le format obligatoire, ou le bloc de retentative.
  compacted = compacted.replace(
    /=== TÂCHES PRÉCÉDENTES TERMINÉES ===[\s\S]*?(?=\n=== ARBORESCENCE DU PROJET ===|\n=== TÂCHES SUIVANTES PRÉVUES ===|\n=== FORMAT OBLIGATOIRE POUR LES MODIFICATIONS ===|\n=== ⚠️ RETENTATIVE)/,
    "=== TÂCHES PRÉCÉDENTES TERMINÉES ===\n(résumés tronqués pour tenir dans le contexte)"
  );
  return compacted;
}

/**
 * Produit un résumé textuel des métriques finales du plan.
 *
 * @param {object} progress - { completed, escalated, failed, task_attempts }
 * @param {number} total - nombre total de tâches
 * @returns {string} résumé affichable dans le chat
 */
export function summarizePlan(progress, total) {
  const completed = (progress.completed || []).length;
  const escalated = (progress.escalated || []).length;
  const attempts = progress.task_attempts || {};
  let totalAttempts = 0;
  for (const n of Object.values(attempts)) totalAttempts += n || 0;
  const coderTasks = completed; // tâches réussies par le codeur (escalated = orchestrateur)
  const rate = total > 0 ? Math.round((coderTasks / total) * 100) : 0;
  return `📊 Bilan du plan : ${coderTasks}/${total} tâches réussies par le codeur, ${escalated} escaladée(s) à l'orchestrateur. ${totalAttempts} tentative(s) au total. Taux de réussite codeur : ${rate}%.`;
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt de vérification finale (après exécution complète du plan)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Construit le prompt de vérification finale envoyé à l'orchestrateur.
 * La consigne exacte est : "Vérifis que tout ce qui devait être fait a été fait correctement."
 * On y ajoute un résumé des tâches terminées/échouées + l'arborescence pour donner
 * le contexte minimal nécessaire, tout en repartant d'une session vierge.
 *
 * @param {object} currentPlan - plan avec ses tâches et son progress
 * @param {string} projectTree - arborescence projet filtrée
 * @returns {string} prompt de vérification finale
 */
export function buildFinalReviewPrompt(currentPlan, projectTree) {
  const progress = currentPlan?.progress || {};
  const doneIds = new Set([
    ...(progress.completed || []),
    ...(progress.escalated || []),
    ...(progress.failed || []),
  ]);
  const doneTasks = (currentPlan?.plan || []).filter((t) => doneIds.has(t.id));
  const failedTasks = (currentPlan?.plan || []).filter((t) => progress.failed?.includes(t.id));

  let prompt = "Vérifis que tout ce qui devait être fait a été fait correctement.\n\n";

  if (currentPlan?.global_directive) {
    prompt += `=== OBJECTIF GLOBAL ===\n${currentPlan.global_directive}\n\n`;
  }

  if (doneTasks.length > 0) {
    prompt += "=== TÂCHES TERMINÉES ===\n";
    for (const t of doneTasks) {
      const status = progress.completed?.includes(t.id)
        ? "✅ réussie"
        : progress.escalated?.includes(t.id)
        ? "🔧 escaladée"
        : "❌ échouée";
      prompt += `- ${status} #${t.id} : ${t.title}\n`;
      if (t.description) {
        const firstLine = t.description.split("\n")[0].trim();
        if (firstLine) prompt += `  ${firstLine}\n`;
      }
    }
    prompt += "\n";
  }

  if (failedTasks.length > 0) {
    prompt += "=== TÂCHES EN ÉCHEC ===\n";
    for (const t of failedTasks) {
      prompt += `- #${t.id} : ${t.title}\n`;
      if (t.description) {
        const firstLine = t.description.split("\n")[0].trim();
        if (firstLine) prompt += `  ${firstLine}\n`;
      }
    }
    prompt += "\n";
  }

  if (projectTree) {
    prompt += `=== ARBORESCENCE DU PROJET ===\n${projectTree}\n\n`;
  }

  prompt += `Si tu constates que des éléments sont manquants ou incorrects, réponds UNIQUEMENT avec un plan JSON au format {"plan":[...]} pour les corriger.
Si tout est correct, réponds par un message texte simple (pas de JSON) pour confirmer.`;
  return prompt;
}

/**
 * V3 (étape 4) — Vérification finale par le CODEUR (et non l'orchestrateur).
 * L'orchestrateur ne voit que les résumés de tâches (il est « aveugle » aux fichiers
 * réels). Le codeur, lui, peut relire les fichiers modifiés avec read_file et
 * juger factuellement si la description de chaque tâche est couverte.
 *
 * Le codeur répond par l'une de ces options :
 *   DONE_FINAL: <résumé court>     — tout est correct
 *   FINAL_FIX: <défaut + fichier>  — défaut constaté, correction demandée dans un
 *                                    nouveau tour in-session (boucle max 3)
 *   {"plan":[...]}                — tâches entières manquantes (nouveau plan)
 *
 * @param {object} currentPlan - plan en cours (avec progress)
 * @param {string} projectTree - arborescence filtrée (texte)
 * @returns {string} prompt de vérification finale pour le codeur
 */
export function buildCoderFinalReviewPrompt(currentPlan, projectTree) {
  const progress = currentPlan?.progress || {};
  const doneIds = new Set([
    ...(progress.completed || []),
    ...(progress.escalated || []),
    ...(progress.failed || []),
  ]);
  const doneTasks = (currentPlan?.plan || []).filter((t) => doneIds.has(t.id));
  const failedTasks = (currentPlan?.plan || []).filter((t) => progress.failed?.includes(t.id));

  let prompt = "Tu es en PHASE DE VÉRIFICATION FINALE du plan. Tu dois relire toi-même les fichiers modifiés pendant ce plan et vérifier qu'ils couvrent bien les tâches prévues.\n\n";
  if (currentPlan?.global_directive) {
    prompt += `=== OBJECTIF GLOBAL ===\n${currentPlan.global_directive}\n\n`;
  }

  prompt += "=== TÂCHES TERMINÉES ===\n";
  for (const t of doneTasks) {
    const status = progress.completed?.includes(t.id)
      ? "✅ réussie"
      : progress.escalated?.includes(t.id)
      ? "🔧 escaladée"
      : "❌ échouée";
    prompt += `- ${status} #${t.id} : ${t.title}\n`;
    if (t.description) {
      const firstLine = t.description.split("\n")[0].trim();
      if (firstLine) prompt += `  ${firstLine}\n`;
    }
    if (t.files && t.files.length) prompt += `  Fichiers : ${t.files.join(", ")}\n`;
  }
  prompt += "\n";

  if (failedTasks.length > 0) {
    prompt += "=== TÂCHES EN ÉCHEC (à re-faire si possible) ===\n";
    for (const t of failedTasks) {
      prompt += `- #${t.id} : ${t.title}\n`;
      if (t.files && t.files.length) prompt += `  Fichiers : ${t.files.join(", ")}\n`;
    }
    prompt += "\n";
  }

  if (projectTree) prompt += `=== ARBORESCENCE DU PROJET ===\n${projectTree}\n\n`;

  prompt += `=== CONSIGNE ===\nPour CHAQUE tâche terminée ci-dessus :\n1. Relis avec read_file le(s) fichier(s) concerné(s) (état réel sur disque).\n2. Vérifie que la description de la tâche est bien couverte par le code.\n3. Vérifie l'absence de régression (import cassé, fonction orpheline, syntaxe).\n\nRéponds ensuite par EXACTEMENT l'une de ces options :\n- DONE_FINAL: <résumé court confirmant que tout est correct>\n- FINAL_FIX: <défaut constaté en une phrase + fichier concerné>  (ne corrige PAS dans ce tour ; un nouveau tour te sera donné pour corriger dans la même session)\n- {"plan":[...]}  (JSON valide) si tu estimes qu'il manque des tâches entières pour atteindre l'objectif global.\n\nTu as droit à 3 cycles de correction (FINAL_FIX) au total. Commence.`;
  return prompt;
}

/**
 * V3 (étape 4) — Prompt court renvoyé au codeur après un FINAL_FIX, en session
 * (sans new_session), pour corriger le défaut constaté lors de la vérification
 * finale. Symétrique de buildSelfFixPrompt mais pour la phase de vérif finale.
 *
 * @param {string} defect - défaut constaté (payload du FINAL_FIX)
 * @param {number} cyclesRemaining - cycles de correction restants (max 3)
 * @param {string} [globalDirective] - directive globale du plan
 * @returns {string} prompt de correction in-session
 */
export function buildCoderFinalReviewContinuePrompt(defect, cyclesRemaining, globalDirective) {
  const directiveBanner = globalDirective ? `=== OBJECTIF GLOBAL ===\n${globalDirective}\n\n` : "";
  return `${directiveBanner}Tu es en VÉRIFICATION FINALE. Tu as toi-même détecté ce défaut : ${defect || "(non précisé)"}.\n\nCorrige-le maintenant, dans la même session :\n1. Relis le fichier concerné avec read_file (l'état réel sur disque).\n2. Applique la correction avec un bloc SEARCH/REPLACE: <path> ... >>>>>>> REPLACE (ou CREATE: <path>). Respecte EXACTEMENT le format.\n3. Recontrôle : vérifie que le défaut est résolu ET que tu n'as rien cassé d'autre.\n4. Si tout est bon, réponds : DONE_FINAL: <résumé court>.\n5. Si tu détectes un AUTRE défaut, réponds : FINAL_FIX: <défaut>, puis arrête-toi.\n\nIl te reste ${cyclesRemaining} cycle(s) de correction. Commence.`;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation de la qualité du plan (point L)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Évalue la qualité d'un plan après parsing. Détecte les tâches trop grossières
 * (description courte, trop de fichiers, plan suspectement petit pour la demande).
 * V3 (Bug 5) : retourne severity "reject" (plan bloquant) si le plan est vide
 * OU manifestement trop grossier (moins de 3 tâches pour une demande
 * substantielle > 100 car.). Dans ce cas, le handler de agent-pi.js demande
 * automatiquement un re-plan à l'orchestrateur (max 1 tentative). Les autres
 * défauts (description courte, > 3 fichiers, titre trop long) restent des
 * warnings non bloquants — l'exécution continue, et la subdivision auto
 * (point M) corrigera les tâches trop grandes en cas d'échec.
 *
 * @param {Array} plan - tableau de tâches normalisées
 * @param {string} userPrompt - demande utilisateur d'origine (pour estimer l'ampleur)
 * @returns {{severity: "ok"|"warn"|"reject", warnings: string[]}}
 */
export function validatePlan(plan, userPrompt) {
  const warnings = [];
  let blocking = false;
  if (!Array.isArray(plan) || plan.length === 0) {
    return { severity: "reject", warnings: ["Plan vide ou introuvable."] };
  }
  for (const t of plan) {
    const descLen = typeof t.description === "string" ? t.description.trim().length : 0;
    if (descLen < 40) {
      warnings.push(`Tâche #${t.id} « ${t.title} » : description trop courte (${descLen} car.) — risque d'ambiguïté pour le codeur.`);
    }
    if (Array.isArray(t.files) && t.files.length > 3) {
      warnings.push(`Tâche #${t.id} « ${t.title} » : ${t.files.length} fichiers concernés — tâche potentiellement trop large, envisager un découpage.`);
    }
    if (typeof t.title === "string" && t.title.length > 80) {
      warnings.push(`Tâche #${t.id} : titre trop long (${t.title.length} car.), max 80 conseillé.`);
    }
  }
  const promptLen = (userPrompt || "").length;
  if (plan.length < 3 && promptLen > 100) {
    warnings.push(`Plan de ${plan.length} tâche(s) pour une demande de ${promptLen} car. — découpage manifestement insuffisant.`);
    blocking = true;
  }
  return { severity: blocking ? "reject" : (warnings.length > 0 ? "warn" : "ok"), warnings };
}

// ──────────────────────────────────────────────────────────────────────────
// Subdivision d'une tâche échouée (point M)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Construit le prompt demandant à l'orchestrateur de re-découper une tâche
 * qui a échoué (trop grosse ou ambiguë) en 2 à 4 sous-tâches plus petites.
 *
 * @param {object} task - tâche normalisée en échec
 * @param {number} attempts - nombre de tentatives codeur déjà échouées
 * @param {string} errors - texte cumulé des erreurs/feedbacks du codeur
 * @param {object} [metrics] - { durationMs, responseChars } de la dernière tentative
 * @param {number} nextIdBase - prochain ID disponible (pour éviter les collisions)
 * @returns {string} prompt de subdivision
 */
export function buildSubdividePrompt(task, attempts, errors, metrics, nextIdBase) {
  let metricsSection = "";
  if (metrics && typeof metrics === "object") {
    const parts = [];
    if (typeof metrics.durationMs === "number") parts.push(`durée dernière tentative : ${(metrics.durationMs / 1000).toFixed(1)}s`);
    if (typeof metrics.responseChars === "number") parts.push(`longueur réponse : ${metrics.responseChars} car.`);
    if (parts.length) metricsSection = `\n\nMétriques de la dernière tentative : ${parts.join(", ")}.`;
  }
  const base = typeof nextIdBase === "number" ? nextIdBase : 0;
  return `Tu es l'architecte d'un plan en cours d'exécution. Le codeur a échoué ${attempts} fois sur une tâche qui semble trop grosse ou ambiguë. Re-découpe cette tâche en 2 à 4 SOUS-TÂCHES plus petites et précises, que le codeur pourra exécuter individuellement.

Tâche problématique #${task.id} : ${task.title}
Description actuelle : ${task.description}
Fichiers concernés : ${task.files && task.files.length ? task.files.join(", ") : "non spécifiés"}
Contexte : ${task.context || "aucun"}

Échecs/feedback du codeur :
${errors || "(pas de feedback explicite)"}${metricsSection}

Consignes :
- Produis 2 à 4 sous-tâches seulement (pas plus).
- Chaque sous-tâche doit concerner au maximum 1-2 fichiers et viser ~30-60 lignes.
- Les sous-tâches doivent s'enchaîner logiquement (remplis depends_on entre elles, la première dépend des prérequis externes de la tâche d'origine).
- Donne des descriptions STRUCTURÉES et détaillées (sous-étapes, signatures, cas d'erreur).
- Les nouveaux IDs doivent être >= ${base} pour éviter les collisions.
- Garde le même format JSON : {"plan": [...]}.
- Réponds UNIQUEMENT avec le JSON brut, pas d'explications.

Format :
{"plan": [{"id": ${base}, "title": "...", "description": "...", "files": [...], "context": "...", "depends_on": [...]}, ...]}`;
}

/**
 * Remplace une tâche échouée par ses sous-tâches dans le plan (point M).
 * - Les sous-tâches reçoivent des IDs séquentiels à partir de nextIdBase.
 * - La première sous-tâche hérite des depends_on EXTERNES de la tâche d'origine.
 * - Les sous-tâches s'enchaînent par depends_on interne (chaîne linéaire).
 * - Les tâches qui dépendaient de la tâche d'origine sont rebranchées sur la DERNIÈRE sous-tâche.
 * - Les sous-tâches sont marquées `subtask: true` (non re-subdivisables en cas d'échec).
 * - Les task_attempts/summaries de la tâche d'origine sont nettoyés ; son ID est ajouté à progress.subdivided.
 *
 * @param {object} currentPlan - { plan: [...], progress: {...} }
 * @param {number} failedTaskId - ID de la tâche à remplacer
 * @param {Array} subtasksRaw - sous-tâches brutes issues du parsing JSON
 * @returns {object} nouveau plan fusionné
 */
export function replaceTaskWithSubtasks(currentPlan, failedTaskId, subtasksRaw) {
  const progress = currentPlan.progress || {};
  const plan = [...currentPlan.plan];
  const idx = plan.findIndex((t) => t.id === failedTaskId);
  if (idx < 0) return currentPlan;
  const base = maxId(plan) + 1;
  const raw = Array.isArray(subtasksRaw) ? subtasksRaw : [];
  const originalDeps = Array.isArray(plan[idx].depends_on) ? plan[idx].depends_on : [];
  const sub = [];
  let prevId = null;
  raw.forEach((t, i) => {
    const newId = base + i;
    const externalDeps = i === 0 ? originalDeps : [];
    const internalDeps = prevId !== null ? [prevId] : [];
    sub.push({
      id: newId,
      title: typeof t.title === "string" ? t.title : `Sous-tâche ${newId}`,
      description: typeof t.description === "string" ? t.description : "",
      files: Array.isArray(t.files) ? t.files.filter((f) => typeof f === "string") : [],
      context: typeof t.context === "string" ? t.context : "",
      depends_on: [...externalDeps, ...internalDeps],
      subtask: true,
    });
    prevId = newId;
  });
  const lastSubId = prevId;
  // Rebrancher les successeurs de la tâche d'origine sur la dernière sous-tâche
  for (const t of plan) {
    if (Array.isArray(t.depends_on) && t.depends_on.includes(failedTaskId)) {
      t.depends_on = t.depends_on
        .filter((d) => d !== failedTaskId)
        .concat(lastSubId !== null ? [lastSubId] : []);
    }
  }
  const newPlan = [...plan.slice(0, idx), ...sub, ...plan.slice(idx + 1)];
  // Nettoyer progress : task_attempts / task_summaries de la tâche d'origine
  const newTaskAttempts = {};
  if (progress.task_attempts) {
    for (const [id, n] of Object.entries(progress.task_attempts)) {
      if (Number(id) !== failedTaskId) newTaskAttempts[id] = n;
    }
  }
  const newSummaries = {};
  if (progress.task_summaries) {
    for (const [id, s] of Object.entries(progress.task_summaries)) {
      if (Number(id) !== failedTaskId) newSummaries[id] = s;
    }
  }
  const newMetrics = {};
  if (progress.task_metrics) {
    for (const [id, m] of Object.entries(progress.task_metrics)) {
      if (Number(id) !== failedTaskId) newMetrics[id] = m;
    }
  }
  const subdivided = Array.isArray(progress.subdivided) ? [...progress.subdivided] : [];
  if (!subdivided.includes(failedTaskId)) subdivided.push(failedTaskId);
  return {
    plan: newPlan,
    progress: {
      ...progress,
      current_task: 0,
      task_attempts: newTaskAttempts,
      task_summaries: newSummaries,
      task_metrics: newMetrics,
      subdivided,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Édition chirurgicale — SEARCH/REPLACE & CREATE (Mode Orchestration V2)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse les blocs d'édition chirurgicale dans la réponse du codeur.
 * Formats supportés :
 *   SEARCH/REPLACE: <path>
 *   <<<<<<< SEARCH
 *   ancien code exact
 *   =======
 *   nouveau code
 *   >>>>>>> REPLACE
 *
 *   CREATE: <path>
 *   contenu complet du fichier
 *
 * Les blocs peuvent être entourés de balises markdown ``` ; elles sont ignorées.
 *
 * @param {string} text - réponse brute du codeur
 * @returns {{blocks: Array, hasBlocks: boolean, hasInvalidFormat: boolean}}
 *   blocks : [{ type: 'search_replace'|'create', path, search?, replace?, content? }]
 *   hasBlocks : true si au moins un bloc valide a été trouvé
 *   hasInvalidFormat : true si du code libre a été détecté en dehors des balises
 */
export function parseSearchReplaceBlocks(text) {
  if (!text || typeof text !== "string") return { blocks: [], hasBlocks: false, hasInvalidFormat: false };

  // Nettoyer les balises markdown ``` autour des blocs
  let cleaned = text.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (match, inner) => inner);

  const blocks = [];
  const srRe = /SEARCH\/REPLACE:\s*([^\n]+)\s*\n\s*<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n\s*=======\s*\n([\s\S]*?)\n\s*>>>>>>>\s*REPLACE/g;
  let m;
  while ((m = srRe.exec(cleaned)) !== null) {
    blocks.push({
      type: "search_replace",
      path: m[1].trim(),
      search: m[2],
      replace: m[3],
    });
  }

  // Parser CREATE: de manière robuste (plusieurs fichiers possibles)
  const createBlocks = parseCreateBlocks(cleaned);
  blocks.push(...createBlocks);

  const hasBlocks = blocks.length > 0;

  // Heuristique de détection de format invalide :
  // on regarde le texte restant (hors blocs) et on cherche des signes de code libre
  // (lignes commençant par import/export/function/class/const/let/var/public/def).
  let remaining = cleaned;
  for (const b of blocks) {
    const marker = b.type === "search_replace"
      ? `SEARCH/REPLACE: ${b.path}`
      : `CREATE: ${b.path}`;
    remaining = remaining.replace(marker, "");
    if (b.type === "search_replace") {
      remaining = remaining.replace(`<<<<<<< SEARCH\n${b.search}\n=======\n${b.replace}\n>>>>>>> REPLACE`, "");
    } else {
      remaining = remaining.replace(`CREATE: ${b.path}\n${b.content}`, "");
    }
  }
  remaining = remaining.replace(/DONE\s*:/gi, "").replace(/NEED_HELP\s*:/gi, "").replace(/\[ACTION:\s*\w+\]/gi, "");
  const freeCodeRe = /^(?:import\s+|export\s+|function\s+|class\s+|const\s+|let\s+|var\s+|public\s+|def\s+|struct\s+|impl\s+|fn\s+|#include\s+)/m;
  const hasInvalidFormat = !hasBlocks && freeCodeRe.test(remaining.trim());

  return { blocks, hasBlocks, hasInvalidFormat };
}

/**
 * Applique les blocs d'édition chirurgicale au disque via les commandes Tauri.
 *
 * @param {Array} blocks - blocs retournés par parseSearchReplaceBlocks
 * @param {Function} invokeFn - fonction invoke de Tauri
 * @param {string} [projectPath] - chemin absolu du projet ouvert
 * @returns {Promise<{ok: boolean, errors: string[], changedFiles: string[]}>}
 */
export async function applySearchReplaceBlocks(blocks, invokeFn, projectPath) {
  const errors = [];
  const changedFiles = new Set();
  const pathOrder = [];

  // Grouper les blocs par chemin
  const byPath = new Map();
  for (const b of blocks) {
    const p = b.path;
    if (!byPath.has(p)) {
      byPath.set(p, []);
      pathOrder.push(p);
    }
    byPath.get(p).push(b);
  }

  for (const relPath of pathOrder) {
    const abs = resolvePath(relPath, projectPath);
    const blocs = byPath.get(relPath);

    try {
      // Mélanger les blocs dans l'ordre d'apparition (search_replace puis create)
      let currentContent = "";
      let exists = false;
      try {
        exists = await invokeFn("file_exists", { path: abs });
        if (exists) {
          currentContent = await invokeFn("read_file_content", { path: abs });
        }
      } catch (_) {
        errors.push(`${relPath} : impossible de lire le fichier existant`);
        continue;
      }

      for (const b of blocs) {
        if (b.type === "create") {
          currentContent = b.content;
          exists = true;
        } else if (b.type === "search_replace") {
          if (!exists) {
            errors.push(`${relPath} : SEARCH/REPLACE impossible, le fichier n'existe pas`);
            break;
          }
          if (!currentContent.includes(b.search)) {
            // Afficher un extrait pour le debug
            const snippet = b.search.length > 80 ? b.search.slice(0, 77) + "..." : b.search;
            errors.push(`${relPath} : le bloc SEARCH n'a pas été trouvé dans le fichier (\"${snippet.replace(/\n/g, "\\n")}\")`);
            break;
          }
          currentContent = currentContent.replace(b.search, b.replace);
        }
      }

      if (errors.length === 0 || !errors.some((e) => e.startsWith(`${relPath} :`))) {
        await invokeFn("write_file_content", { path: abs, content: currentContent });
        changedFiles.add(relPath);
      }
    } catch (e) {
      errors.push(`${relPath} : ${e.message || e}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    changedFiles: [...changedFiles],
  };
}

/**
 * Construit le prompt de correction syntaxique à renvoyer au codeur.
 *
 * @param {string} linterOutput - sortie brute du linter
 * @param {object} task - tâche en cours
 * @returns {string} prompt de correction
 */
export function buildLintFailurePrompt(linterOutput, task) {
  return `NEED_HELP: Correction syntaxique requise pour la tâche "${task.title || `Tâche #${task.id}`}".

Le linter a détecté des erreurs sur les fichiers modifiés. Corrige-les toi-même en utilisant le format SEARCH/REPLACE ou CREATE, puis termine par DONE: <résumé>.

Sortie du linter :
\`\`\`
${linterOutput}
\`\`\`

N'escalade pas. Corrige et relance.`;
}

/**
 * Parse les blocs CREATE: d'un texte de manière robuste.
 * Chaque bloc commence par "CREATE: <path>" et s'étend jusqu'au prochain
 * marqueur SEARCH/REPLACE:, CREATE:, [ACTION:, DONE: ou NEED_HELP:.
 *
 * @param {string} text - texte nettoyé (sans balises markdown)
 * @returns {Array} blocs CREATE [{ type: 'create', path, content }]
 */
function parseCreateBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  const markerRe = /^(SEARCH\/REPLACE:|CREATE:|\[ACTION:\s*\w+\]|DONE\s*:|NEED_HELP\s*:)/i;
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const createMatch = line.match(/^CREATE:\s*(.+?)\s*$/i);
    if (createMatch) {
      if (current) blocks.push(current);
      current = { type: "create", path: createMatch[1].trim(), contentLines: [] };
      continue;
    }
    if (current) {
      if (markerRe.test(line)) {
        blocks.push(current);
        current = null;
      } else {
        current.contentLines.push(line);
      }
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({
    type: b.type,
    path: b.path,
    // Supprimer les lignes vides en début/fin de contenu, tout en gardant une trailing newline
    content: b.contentLines.join("\n").replace(/^\n+|\n+$/g, "") + "\n",
  }));
}

/**
 * Détermine l'action choisie par l'orchestrateur lors d'une escalade V2.
 *
 * @param {string} text - réponse brute de l'orchestrateur
 * @returns {{action: 'redecouper'|'executer'|'reviser'|'commande'|'unknown', payload: string|null}}
 */
export function determineEscalationAction(text) {
  if (!text || typeof text !== "string") return { action: "unknown", payload: null };
  const m = text.match(/\[ACTION:\s*(REDECOUPER|EXECUTER|REVISER|COMMANDE)\s*\]/i);
  if (!m) return { action: "unknown", payload: null };
  const action = m[1].toLowerCase();
  if (action === "commande") {
    const cmdMatch = text.match(/\[COMMANDE:\s*([^\]]+)\]/i);
    return { action, payload: cmdMatch ? cmdMatch[1].trim() : null };
  }
  return { action, payload: null };
}

// ──────────────────────────────────────────────────────────────────────────
// Utilitaires internes
// ──────────────────────────────────────────────────────────────────────────

/** Tronque le contenu d'un fichier à MAX_FILE_LINES_PROMPT lignes. */
function truncateFile(path, content) {
  const lines = content.split("\n");
  const truncated =
    lines.length > MAX_FILE_LINES_PROMPT
      ? lines.slice(0, MAX_FILE_LINES_PROMPT).join("\n") + `\n... (${lines.length - MAX_FILE_LINES_PROMPT} lignes omises)`
      : content;
  return `--- ${path} ---\n${truncated}`;
}

/** Retourne le plus grand ID de tâche d'un plan. */
function maxId(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  return Math.max(...tasks.map((t) => (typeof t.id === "number" ? t.id : 0)));
}