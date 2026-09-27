// laya-gateway.js — Cœur PUR de la passerelle Laya pour Pilot.
//
// SOURCE UNIQUE, sans aucune dépendance (ni Tauri, ni Node, ni typebox) :
//   1. testé par Vitest  → `src/js/laya-gateway.test.js` ;
//   2. embarqué dans Pilot via `include_str!` et écrit, au lancement d'une
//      session d'agent, à côté de l'extension pi `pilot-laya.ts`
//      (<app_data>/extensions/). L'extension l'importe par `./laya-gateway.js`.
//
// Il traduit « une question typée » (choix parmi des libellés, note sur une
// échelle, oui/non) en appel HTTP vers le service Laya LOCAL unique
// (`laya-service.mjs`, http://127.0.0.1:3017) — celui que Pilot lance et
// surveille — et met en forme la réponse avec sa confiance. Le service garde le
// modèle (≈ 1,6 Gio) en mémoire : AUCUN appel de ce module ne charge un modèle.
//
// Contrat du service, repris tel quel (aucun format inventé) :
//   POST /classify {"text", "questions"[,"state"]}
//     → 200 {"ok":true, "answers":{<nom>:{…}}, "ms":<entier>}
//     → 400/500 {"ok":false, "error":"<message>"}
//   GET  /status    → {"ready":bool, "model":"<dossier>"}
// Réponses (`answers`), champs exacts du moteur :
//   choice : {type:"choice", choice, probabilities, confidence, answer_confidence, action}
//   score  : {type:"score", score, legend, probabilities, confidence, answer_confidence, action}
//   noul   : {type:"noul", noul, confidence, answer_confidence, action}

/** URL par défaut du service Laya local (même hôte/port que Pilot). */
export const DEFAULT_LAYA_API_URL = "http://127.0.0.1:3017";
/**
 * Délai maximal d'un appel de classification (ms). Large à dessein : le PREMIER
 * appel charge le modèle (≈ 2,5 s mesurés) ; les suivants répondent en ≈ 0,1 s.
 * Borné pour ne jamais bloquer l'appelant indéfiniment.
 */
export const DEFAULT_LAYA_TIMEOUT_MS = 30000;
/** Route de classification du service. */
export const LAYA_CLASSIFY_ROUTE = "/classify";
/** Les trois types de question du service (termes exacts du moteur). */
export const LAYA_QUESTION_TYPES = ["choice", "score", "noul"];
/** Nom de la question envoyée au service (le service renvoie `answers[clé]`). */
export const LAYA_QUESTION_KEY = "answer";
/** En dessous de cette confiance, la réponse n'est pas retenue (repli). */
export const LAYA_MIN_CONFIDENCE = 0.5;

/**
 * Les types de message de l'Assistant (mêmes libellés que
 * `classifyAssistantMessage` de `telegram-dialog.js`). Le service les classe :
 * c'est Laya qui décide, pas une liste de mots-clés.
 */
export const LAYA_ASSISTANT_KINDS = [
  "alert",
  "approval",
  "question",
  "report",
  "intermediate",
];

/**
 * Question de classement d'un message de l'Assistant (fonction PURE).
 * Sert à la décision INTERNE de Pilot (relais sortant, `telegram-dialog.js`).
 * @returns {object} objet `questions` au format du service.
 */
export function buildAssistantKindQuestion() {
  return {
    assistant_message_kind: {
      type: "choice",
      instructions:
        "Which kind of message is `body`? It is a message an AI assistant just wrote to its user.",
      criteria: {
        alert:
          "something went wrong and needs the user's attention now: error, failure, anomaly, blockage, danger",
        approval: "the assistant asks the user to agree or to make a decision",
        question: "the assistant asks the user a question",
        report: "a result, a finished task, a delivered work or an answer to the user",
        intermediate:
          "narration of a work step in progress, technical chatter, acknowledgement with no content",
      },
    },
  };
}

/**
 * Lit la réponse de la question de type d'un message de l'Assistant (PURE).
 * Renvoie `null` s'il n'y a pas de réponse exploitable ou si la confiance est
 * trop faible : l'appelant garde alors son propre repli, jamais une exception.
 * @param {object|null|undefined} answers  `answers` renvoyé par le service
 * @param {number} [minConfidence]
 * @returns {{kind: string, confidence: number}|null}
 */
export function assistantKindFromAnswers(answers, minConfidence = LAYA_MIN_CONFIDENCE) {
  const answer = readLayaAnswer(answers, "assistant_message_kind");
  if (!answer || answer.type !== "choice") return null;
  if (!LAYA_ASSISTANT_KINDS.includes(answer.choice)) return null;
  const confidence = typeof answer.answer_confidence === "number" ? answer.answer_confidence : 0;
  if (confidence < minConfidence) return null;
  return { kind: answer.choice, confidence };
}

/**
 * Lit une réponse dans le bloc `answers` du service (PURE).
 * @param {object|null|undefined} answers
 * @param {string} [key]
 * @returns {object|null}
 */
export function readLayaAnswer(answers, key = LAYA_QUESTION_KEY) {
  if (!answers || typeof answers !== "object") return null;
  const answer = answers[key];
  return answer && typeof answer === "object" ? answer : null;
}

/**
 * Vérifie une question typée AVANT tout appel (PURE) : renvoie un message
 * d'erreur clair, ou `null` si la question est utilisable.
 * @param {{type?: string, options?: unknown}} [question]
 * @returns {string|null}
 */
export function validateLayaQuestion(question) {
  const q = question && typeof question === "object" ? question : {};
  if (!LAYA_QUESTION_TYPES.includes(q.type)) {
    return `Type de question invalide : « ${q.type} ». Types acceptés : choice, score, noul.`;
  }
  const count = Array.isArray(q.options) ? q.options.length : 0;
  if (q.type === "choice" && count < 2) {
    return "Une question « choice » demande au moins deux libellés dans `options`.";
  }
  if (q.type === "score" && count < 2) {
    return "Une question « score » demande au moins deux niveaux dans `options`, du plus bas au plus haut.";
  }
  return null;
}

/**
 * Construit l'objet `questions` du service à partir d'une question typée (PURE).
 * `choice` → un libellé par entrée de `options` ; `score` → une échelle ordonnée
 * du plus bas au plus haut ; `noul` → oui/non (aucune option attendue).
 * @param {{type?: string, instructions?: string, options?: unknown[]}} [question]
 * @returns {object}
 */
export function buildLayaQuestion(question) {
  const q = question && typeof question === "object" ? question : {};
  const def = { type: q.type };
  if (q.instructions) def.instructions = String(q.instructions);
  const options = Array.isArray(q.options) ? q.options : [];
  if (q.type === "choice") {
    // Le service attend {libellé: description}. Un libellé nu est sa propre
    // description : c'est au demandeur de donner des libellés explicites.
    def.criteria = Object.fromEntries(
      options.map((o) =>
        typeof o === "string" ? [o, o] : [String(o.label), String(o.description ?? o.label)],
      ),
    );
  } else if (q.type === "score") {
    def.criteria = options.map((o) =>
      typeof o === "string" ? o : String(o.description ?? o.label),
    );
  }
  return { [LAYA_QUESTION_KEY]: def };
}

/**
 * Message clair et non technique quand le service est éteint ou injoignable.
 * @param {string} [baseUrl]
 * @param {string} [reason]
 */
export function layaOffMessage(baseUrl = DEFAULT_LAYA_API_URL, reason = "connexion refusée") {
  return (
    `Le service Laya ne répond pas sur ${baseUrl} (${reason}). ` +
    "La classification locale est indisponible : donne ta réponse sans elle et " +
    "signale-le à l'utilisateur (Réglages → Service Laya)."
  );
}

/**
 * Appelle `POST /classify` du service Laya (asynchrone, injectable).
 * Ne charge rien et ne lève JAMAIS : toute panne est renvoyée dans `error`.
 * @param {object} options
 * @param {string} [options.baseUrl]      URL de base (défaut DEFAULT_LAYA_API_URL).
 * @param {string} [options.text]         texte à classer.
 * @param {object} [options.questions]    objet `questions` (cf. buildLayaQuestion).
 * @param {number} [options.timeoutMs]    délai maximal.
 * @param {Function} [options.fetchImpl]  implémentation fetch (tests).
 * @returns {Promise<{ok:boolean, answers:object|null, ms:number|null, error:string}>}
 */
export async function askLaya({
  baseUrl = DEFAULT_LAYA_API_URL,
  text = "",
  questions = null,
  timeoutMs = DEFAULT_LAYA_TIMEOUT_MS,
  fetchImpl,
} = {}) {
  const base = String(baseUrl || DEFAULT_LAYA_API_URL).replace(/\/+$/, "");
  const url = `${base}${LAYA_CLASSIFY_ROUTE}`;
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: String(text ?? ""), questions }),
      signal: controller.signal,
    });
  } catch {
    const reason = controller.signal.aborted ? `délai dépassé (${timeoutMs} ms)` : "connexion refusée";
    return { ok: false, answers: null, ms: null, error: layaOffMessage(base, reason) };
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body && body.error ? String(body.error) : `HTTP ${response.status}`;
    return {
      ok: false,
      answers: null,
      ms: null,
      error:
        response.status === 400 || response.status === 500
          ? `Le service Laya a refusé la question : ${detail}`
          : `Le service Laya a répondu (HTTP ${response.status}) : ${detail}`,
    };
  }
  if (!body || body.ok !== true || !body.answers) {
    return {
      ok: false,
      answers: null,
      ms: null,
      error: "Le service Laya a renvoyé une réponse illisible (aucune réponse de classement).",
    };
  }
  return {
    ok: true,
    answers: body.answers,
    ms: typeof body.ms === "number" ? body.ms : null,
    error: "",
  };
}

/**
 * Met en forme une réponse du service, avec sa confiance (PURE) — termes exacts
 * du moteur (`choice`, `score`, `noul`, `confidence`, `answer_confidence`).
 * @param {object|null} answer
 * @returns {string}
 */
export function formatLayaAnswer(answer) {
  if (!answer || typeof answer !== "object") return "Réponse Laya illisible.";
  const conf = `confidence ${num(answer.confidence)} / answer_confidence ${num(answer.answer_confidence)}`;
  if (answer.type === "choice") {
    const probs = pairs(answer.probabilities);
    return `choice « ${answer.choice} » — ${conf}${probs ? ` — probabilities {${probs}}` : ""}`;
  }
  if (answer.type === "score") {
    const score = typeof answer.score === "number" ? answer.score : Number(answer.score);
    const level = Number.isFinite(score) ? ` (niveau ${Math.round(score)})` : "";
    const legend = pairs(answer.legend);
    return `score ${num(answer.score)}${level} — ${conf}${legend ? ` — legend {${legend}}` : ""}`;
  }
  if (answer.type === "noul") {
    const value = typeof answer.noul === "number" ? answer.noul : Number(answer.noul);
    return `noul ${num(answer.noul)} (${value >= 0.5 ? "vrai" : "faux"}) — ${conf}`;
  }
  return `Réponse Laya de type inconnu : ${JSON.stringify(answer)}`;
}

/** Nombre lisible (les sorties du service sont des nombres arrondis). PURE. */
function num(value) {
  return typeof value === "number" ? String(value) : "?";
}

/** Paires `clé=valeur` d'un objet de probabilités ou de légende (PURE). */
function pairs(obj) {
  if (!obj || typeof obj !== "object") return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
