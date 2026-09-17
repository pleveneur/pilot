// super-agent-memory.js — logique pure de la mémoire de session de l'assistant.
//
// L'extension pilot-assistant-session-memory envoie ses requêtes via
// `ctx.ui.input` préfixées par un sentinel, avec une charge utile JSON. Ce
// module lit ces charges utiles. Fonctions pures, testables sans dépendances
// Tauri/DOM (le branchement concret vit dans super-agent.js).

// Décode une charge utile JSON en objet. "" (aucune charge utile) est accepté
// comme objet vide (ex: restoration du retrait le plus récent). Toute charge
// utile illisible ou non-objet retourne `{ error }` sans lever d'exception.
function parsePayloadObject(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return { value: {} };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Payload mémoire invalide (JSON illisible)." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Payload mémoire invalide (objet attendu)." };
  }
  return { value: parsed };
}

// Charge utile de l'outil remove_session_memory : { target, field? }.
// `target` désigne le rang 1-based ou le texte du projet / titre d'un travail en
// cours ; `field` (optionnel) désigne un champ texte simple à vider. Au moins
// l'un des deux est requis (côté Rust, `field` prime sur `target`).
export function parseMemoryRemovePayload(raw) {
  const base = parsePayloadObject(raw);
  if (base.error) return base;
  const target = typeof base.value.target === "string" ? base.value.target.trim() : "";
  const field = typeof base.value.field === "string" ? base.value.field.trim() : "";
  if (!target && !field) {
    return { error: "Payload mémoire invalide : cible (target) ou champ (field) requis." };
  }
  return { target, field };
}

// Charge utile de l'outil restore_session_memory : { id? }. Un id absent ou vide
// signifie « restaure le retrait le plus récent » (décision prise côté Rust).
export function parseMemoryRestorePayload(raw) {
  const base = parsePayloadObject(raw);
  if (base.error) return base;
  const id = typeof base.value.id === "string" ? base.value.id.trim() : "";
  return { id };
}

// Charge utile de l'outil list_session_memory_trash : aucune donnée à
// transporter (le parcours lit la corbeille côté Rust). Une charge utile vide
// ou un objet vide sont acceptés ; tout le reste est refusé sans exception.
export function parseMemoryTrashListPayload(raw) {
  const base = parsePayloadObject(raw);
  if (base.error) return base;
  return {};
}

// Réponse de la commande super_agent_list_session_memory_trash
// (`{ count, entries: [{ id, kind, removed_at, preview }] }`, du plus récent au
// plus ancien) : conserve l'ordre et le contenu, et produit en plus un texte
// court prêt à lire. Entrée inexploitable → champs vides, jamais d'exception.
export function formatMemoryTrashList(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  const source = data && Array.isArray(data.entries) ? data.entries : [];
  const entries = source.map((e) => ({
    id: e && typeof e.id === "string" ? e.id : "",
    kind: e && typeof e.kind === "string" ? e.kind : "",
    removed_at: e && typeof e.removed_at === "string" ? e.removed_at : "",
    preview: e && typeof e.preview === "string" ? e.preview : "",
  }));
  const text =
    entries.length === 0
      ? "Corbeille de mémoire vide : aucun retrait à remettre en place."
      : entries
          .map((e, i) => {
            const date = e.removed_at || "date inconnue";
            const preview = e.preview || "(contenu indisponible)";
            const kind = e.kind || "fait";
            return `${i + 1}. id=${e.id} — ${kind} — retiré le ${date} : ${preview}`;
          })
          .join("\n");
  return { count: entries.length, entries, text };
}
