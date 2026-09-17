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
