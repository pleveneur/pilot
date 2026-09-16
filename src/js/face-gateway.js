// face-gateway.js — Cœur PUR de la passerelle du visage (PLface) pour Pilot.
//
// SOURCE UNIQUE, sans aucune dépendance (ni Node, ni SDK MCP, ni typebox) :
//   1. testé par Vitest  → `src/js/face-gateway.test.js` ;
//   2. embarqué dans Pilot via `include_str!` et écrit, au lancement de la
//      session de l'assistant, à côté de l'extension pi `pilot-face.ts`
//      (<app_data>/extensions/). L'extension l'importe par `./face-gateway.js`.
//
// Il traduit des « outils » (set_expression, get_status, set_position, reset)
// en appels HTTP vers l'API locale du visage (http://127.0.0.1:3000), exactement
// comme la passerelle MCP d'origine (projet PLface/mcp/plface-mcp.js) — mêmes
// noms d'outils, mêmes paramètres — mais SANS processus externe à installer.

/** URL par défaut de l'API locale du visage. */
export const DEFAULT_FACE_API_URL = "http://127.0.0.1:3000";
/** Délai maximal d'une requête (ms). */
export const DEFAULT_FACE_TIMEOUT_MS = 5000;

/** Noms d'outils exposés — identiques à la passerelle MCP d'origine. */
export const FACE_TOOL_NAMES = [
  "set_expression",
  "get_status",
  "set_position",
  "reset",
];

/** Erreur d'accès à l'API locale du visage (message destiné à l'utilisateur). */
export class FaceApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "FaceApiError";
  }
}

/**
 * Traduit un outil et ses arguments en requête HTTP (fonction PURE).
 * @returns {{pathname: string, params: object}|null} null si outil inconnu.
 */
export function buildFaceRequest(toolName, args = {}) {
  switch (toolName) {
    case "set_expression":
      return { pathname: "/emotion", params: { name: args.emotion } };
    case "get_status":
      return { pathname: "/status", params: {} };
    case "set_position":
      return { pathname: "/set_position", params: { x: args.x, y: args.y } };
    case "reset":
      return { pathname: "/neutral", params: {} };
    default:
      return null;
  }
}

/**
 * Message clair et non technique quand le visage est éteint ou injoignable.
 */
export function faceOffMessage(baseUrl = DEFAULT_FACE_API_URL) {
  return (
    `Le visage ne répond pas sur ${baseUrl}. ` +
    `Démarre le visage (Paramètres → Avatar) puis réessaie.`
  );
}

/**
 * Appelle l'API HTTP locale du visage (fonction asynchrone, injectable).
 * @param {object} options
 * @param {string} [options.baseUrl]    URL de base (défaut DEFAULT_FACE_API_URL).
 * @param {string} options.pathname     Chemin (ex. « /emotion »).
 * @param {object} [options.params]     Paramètres de requête (non nuls seulement).
 * @param {number} [options.timeoutMs]  Délai maximal.
 * @param {Function} [options.fetchImpl] Implémentation fetch (tests).
 * @returns {Promise<{endpoint:string,status:number,ok:boolean,text:string}>}
 * @throws {FaceApiError} si la connexion échoue ou dépasse le délai.
 */
export async function callFaceApi({
  baseUrl = DEFAULT_FACE_API_URL,
  pathname,
  params = {},
  timeoutMs = DEFAULT_FACE_TIMEOUT_MS,
  fetchImpl,
} = {}) {
  const base = String(baseUrl || DEFAULT_FACE_API_URL).replace(/\/+$/, "");
  const url = new URL(pathname, `${base}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const endpoint = `${url.pathname}${url.search}`;
  const doFetch = fetchImpl || globalThis.fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await doFetch(url, { signal: controller.signal });
  } catch {
    const reason = controller.signal.aborted
      ? `délai dépassé (${timeoutMs} ms)`
      : "connexion refusée";
    throw new FaceApiError(
      `Le visage ne répond pas sur ${base} (${reason}). ` +
        `Démarre le visage (Paramètres → Avatar) puis réessaie.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = (await response.text()).trim();
  return { endpoint, status: response.status, ok: response.ok, text };
}

/**
 * Exécute un outil de haut niveau et renvoie un résultat normalisé
 * (jamais d'exception : l'erreur est capturée dans `error`).
 * @returns {Promise<{ok:boolean,text:string,error:string}>}
 */
export async function runFaceTool(toolName, args, options = {}) {
  const request = buildFaceRequest(toolName, args);
  if (!request) {
    return { ok: false, text: "", error: `Outil visage inconnu : ${toolName}` };
  }
  let res;
  try {
    res = await callFaceApi({
      baseUrl: options.baseUrl,
      pathname: request.pathname,
      params: request.params,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  } catch (err) {
    return {
      ok: false,
      text: "",
      error:
        err instanceof FaceApiError
          ? err.message
          : `Erreur inattendue de la passerelle du visage : ${
              err && err.message ? err.message : String(err)
            }`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      text: "",
      error: `La demande a été refusée (HTTP ${res.status}) : ${res.text}`,
    };
  }
  return { ok: true, text: `Visage → ${res.text}  [${res.endpoint}]`, error: "" };
}
