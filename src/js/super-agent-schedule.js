// super-agent-schedule.js — logique pure du ticker des relances programmées
// de l'assistant (chantier #13). Fonctions pures, testables sans dépendances
// Tauri/DOM. Le ticker lui-même (setInterval) vit dans super-agent.js.

// Garde-fou 4 : pas de tick si la session super-agent est morte (onglet 🧭
// fermé). Retourne true seulement si l'onglet est ouvert.
export function shouldScheduleTick(open) {
  return open === true;
}

// ── Relecture du correctif `d26717e` : échecs, retardataires, retenue ────────

// DÉFAUT 2 — Nombre d'ÉCHECS CONSÉCUTIFS d'envoi d'un rappel au-delà duquel il
// est MIS À L'ÉCART, le temps qu'un autre rappel passe. Le compteur vit
// UNIQUEMENT en mémoire côté ticker : aucune écriture en base (la table
// `assistant_schedules` n'a pas à porter l'état d'un tunnel d'envoi).
export const REMINDER_MAX_CONSECUTIVE_FAILURES = 3;

// DÉFAUT 3 — Un rappel est « RETARDATAIRE » quand son échéance est dépassée de
// plus de DEUX intervalles (cas type : arriéré accumulé pendant que Pilot était
// fermé). Les retardataires partent GROUPÉS dans UN SEUL message — un seul tour
// de l'assistant — au lieu d'occuper l'assistant pendant des heures (une
// relance par passe = un prompt système complet = un tour complet).
export const REMINDER_LAGGARD_INTERVAL_FACTOR = 2;

// DÉFAUT 3bis (2ᵉ relecture) — Le LOT DE RELANCES était SANS BORNE : il pouvait
// porter jusqu'à 20 relances (plafond de planifications actives) dont les textes
// n'ont aucune longueur maximale, alors que tout le reste du projet plafonne ce
// qu'il verse dans la conversation (référence : `MAX_INJECTED_MESSAGE_CHARS` =
// 4000, `src-tauri/src/super_agent.rs`). Un lot est donc borné DEUX fois :
//
//  - en NOMBRE (`REMINDER_BATCH_MAX_ITEMS`) : la sélection est faite dans
//    `planDueReminderInjections`, donc les relances en trop restent DÛES (dans
//    `held`, jamais marquées) et partent à la passe suivante ;
//  - en LONGUEUR (`REMINDER_BATCH_MAX_CHARS`, miroir volontaire de la constante
//    Rust) : au-delà, le message est tronqué avec un avis EXPLICITE (nombre de
//    caractères omis), jamais silencieusement.
//
// DÉFAUT SÉRIEUX (3ᵉ audit) — la borne en LONGUEUR du MESSAGE ne suffisait pas :
// quand le lot dépassait `REMINDER_BATCH_MAX_CHARS`, le message était tronqué…
// puis TOUTES les relances du lot étaient marquées comme envoyées. Mesure de
// l'audit : 8 relances de 3011 caractères → message de 4000, « 20496 caractère(s)
// omis », seules les relances 1 et 2 lisibles, et les 8 marquées : six relances
// disparaissaient pour toujours. La promesse « les relances laissées de côté
// restent dues » n'était donc tenue que par la borne en NOMBRE.
//
// La troncature du MESSAGE est donc rendue STRUCTURELLEMENT IMPOSSIBLE : chaque
// relance est bornée DANS le lot (`REMINDER_ITEM_MAX_CHARS`, troncature annoncée
// PAR RELANCE), de sorte que le lot maximal (8 relances + en-tête) tient
// toujours sous `REMINDER_BATCH_MAX_CHARS`. Le texte réellement rendu (donc
// lisible) est rendu à l'appelant par `buildReminderInjection` : c'est cette
// liste-là — et elle seule — qui peut être marquée comme envoyée.
export const REMINDER_BATCH_MAX_ITEMS = 8;
export const REMINDER_BATCH_MAX_CHARS = 4000;

// Budget d'UNE relance rendue dans un lot (numéro + texte + avis de troncature
// éventuel, indentation des lignes suivantes comprise). Marge vérifiée :
// 8 × 450 + 7 sauts de ligne + en-tête (~190) < 4000.
export const REMINDER_ITEM_MAX_CHARS = 450;

// Instant (ms epoch) d'une échéance renvoyée par Rust. `datetime('now')` de
// SQLite produit « 2026-08-29 14:30:00 », c'est-à-dire de l'UTC SANS fuseau :
// `new Date("2026-08-29 14:30:00")` l'interpréterait en heure locale (décalage
// du fuseau dans la latence calculée). On force donc le suffixe `Z`. Retourne
// null si la valeur est absente ou illisible (l'appelant retombe alors sur le
// comportement d'avant : aucun regroupement, rien n'est inventé).
export function parseScheduleInstant(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// Le rappel est-il un RETARDATAIRE à l'instant `nowMs` ? Faux (donc : livraison
// une par passe, comme avant) dès que l'échéance ou l'intervalle manque.
export function isOverdueLaggard(reminder, nowMs) {
  const dueAt = parseScheduleInstant(reminder && reminder.nextFireAt);
  const every = Number(reminder && reminder.every);
  const now = Number(nowMs);
  if (dueAt === null || !Number.isInteger(every) || every <= 0) return false;
  if (!Number.isFinite(now)) return false;
  return now - dueAt > REMINDER_LAGGARD_INTERVAL_FACTOR * every * 1000;
}

// Nombre d'échecs consécutifs mémorisé pour un rappel (Map ou objet simple).
function reminderFailureCount(failureCounts, id) {
  if (!failureCounts) return 0;
  const raw = failureCounts instanceof Map ? failureCounts.get(id) : failureCounts[id];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Numérotation d'un rappel DANS UN LOT. Les lignes suivantes d'un texte
// multi-lignes sont INDENTÉES sous leur numéro : sans cela, la suite du texte se
// confondait avec les items suivants du lot (« 2. », « 3. » internes au rappel).
function numberReminderLine(index, prompt) {
  const pad = " ".repeat(String(index).length + 2);
  const lines = String(prompt).replace(/\r\n/g, "\n").split("\n");
  const first = lines[0].trim();
  const rest = lines
    .slice(1)
    .map((line) => (line.trim() === "" ? "" : `${pad}${line.replace(/\s+$/, "")}`));
  return [`${index}. ${first}`, ...rest].join("\n");
}

// Avis de troncature d'UNE relance (jamais celle du lot entier) : il dit ce qui
// manque ET où lire le texte intégral, de sorte qu'une relance tronquée reste
// honnêtement « livrée » (son contenu utile est là, le reste est consultable).
function reminderTruncationNotice(omitted) {
  return (
    `[…relance tronquée : ${omitted} caractère(s) omis — texte intégral dans la ` +
    `programmation du rappel (⚙️ → Assistant)]`
  );
}

// Coupe un texte sur une frontière lisible (fin de ligne, puis espace) sans
// jamais dépasser `keep` caractères. Aucune coupe au milieu d'un mot quand une
// frontière existe dans la fenêtre.
function cutTextAt(texte, keep) {
  const chars = Array.from(String(texte).replace(/\r\n/g, "\n"));
  if (chars.length <= keep) return chars.join("");
  const window = chars.slice(0, Math.max(0, keep));
  const brut = window.join("");
  const ligne = brut.lastIndexOf("\n");
  if (ligne > keep * 0.6) return brut.slice(0, ligne);
  const espace = brut.lastIndexOf(" ");
  if (espace > keep * 0.6) return brut.slice(0, espace);
  return brut;
}

// Rend UNE relance dans un budget de `budget` caractères : le texte complet s'il
// tient, sinon un texte coupé sur une frontière SUIVI de l'avis de troncature,
// l'ensemble restant sous le budget (indentation des lignes suivantes comprise).
function renderReminderItemWithin(index, prompt, budget) {
  const total = Array.from(String(prompt).replace(/\r\n/g, "\n"));
  if (Array.from(numberReminderLine(index, prompt)).length <= budget) {
    return { rendered: numberReminderLine(index, prompt), truncated: false, omitted: 0 };
  }
  let keep = total.length;
  for (;;) {
    const omitted = total.length - keep;
    const candidate = cutTextAt(total.join(""), keep) + reminderTruncationNotice(omitted);
    const rendered = numberReminderLine(index, candidate);
    const length = Array.from(rendered).length;
    if (length <= budget) return { rendered, truncated: true, omitted };
    const shrink = length - budget + 4;
    if (keep <= 0) return { rendered: numberReminderLine(index, reminderTruncationNotice(total.length)), truncated: true, omitted: total.length };
    keep = Math.max(0, keep - shrink);
  }
}

// Borne le message RÉELLEMENT versé dans la conversation (relance SEULE : le lot
// est, lui, borné par relance, cf. `buildReminderInjection`). La troncature est
// DITE (nombre de caractères omis) et l'avis compte lui-même dans la taille, si
// bien que le résultat ne dépasse jamais `REMINDER_BATCH_MAX_CHARS`.
function capReminderMessage(message) {
  const chars = Array.from(message);
  if (chars.length <= REMINDER_BATCH_MAX_CHARS) return message;
  let keep = REMINDER_BATCH_MAX_CHARS;
  for (;;) {
    const omitted = chars.length - keep;
    const notice =
      `\n\n[…lot tronqué : ${omitted} caractère(s) omis. Le texte intégral de chaque ` +
      `relance reste enregistré dans sa programmation (⚙️ → Assistant) : traite ` +
      `d'abord ce qui est lisible ici.]`;
    const used = keep + Array.from(notice).length;
    if (used <= REMINDER_BATCH_MAX_CHARS) return chars.slice(0, keep).join("") + notice;
    keep -= used - REMINDER_BATCH_MAX_CHARS;
    if (keep <= 0) return notice;
  }
}

// En-tête d'un lot de N relances. Sa taille ne dépend que du nombre de chiffres
// de N (≤ 8 → un chiffre), ce qui rend le budget par relance calculable.
function groupHeader(n) {
  return (
    `[⏰ ${n} relances échues] ${n} relances programmées sont arrivées à échéance ` +
    `sans avoir pu être livrées (Assistant occupé, onglet fermé). Traite-les ` +
    `toutes, dans l'ordre, sans les confondre :\n`
  );
}

// Compose le message d'un lot. Chaque relance est rendue DANS son budget
// (`REMINDER_ITEM_MAX_CHARS`) : le message complet ne peut donc pas dépasser le
// plafond par construction, et aucune relance ne peut être « coupée en silence ».
function composeGroupMessage(items) {
  if (items.length === 0) return "";
  const lines = items.map((d, i) => renderReminderItemWithin(i + 1, d.prompt, REMINDER_ITEM_MAX_CHARS).rendered);
  return groupHeader(items.length) + lines.join("\n");
}

// PLAN DE LIVRAISON d'un lot de rappels (3ᵉ audit, défaut sérieux) : rend le
// message ET la liste des relances RÉELLEMENT LISIBLES dedans (`delivered`),
// plus celles qui n'ont pas pu être rendues (`withheld`, restant DUES). Le
// marquage ne doit porter QUE sur `delivered` : c'est ce qui rend impossible de
// marquer « envoyée » une relance dont le texte n'est pas dans le message.
export function buildReminderInjection(items) {
  const list = Array.isArray(items)
    ? items.filter((d) => d && typeof d.prompt === "string" && d.prompt.trim() !== "")
    : [];
  if (list.length === 0) return { message: "", delivered: [], withheld: [] };
  // Ceinture et bretelles : le plan borne déjà la sélection (et retient les
  // relances en trop, jamais marquées) ; on ne dépasse jamais le plafond ici non
  // plus, quel que soit l'appelant.
  const capped = list.slice(0, REMINDER_BATCH_MAX_ITEMS);
  const overflow = list.slice(REMINDER_BATCH_MAX_ITEMS);
  if (capped.length === 1) {
    // Relance SEULE : format historique, texte complet sous le plafond global.
    return {
      message: capReminderMessage(`[⏰ Rappel programmé] ${capped[0].prompt}`),
      delivered: capped,
      withheld: overflow,
    };
  }
  // Lot : on ne garde que les relances qui tiennent ENTIÈREMENT (chacune déjà
  // bornée). La boucle est une garantie structurelle : elle vide le lot plutôt
  // que de couper le message, et ce qui est retiré redevient « dû ».
  let kept = capped.slice();
  let message = composeGroupMessage(kept);
  let removed = [];
  while (kept.length > 0 && Array.from(message).length > REMINDER_BATCH_MAX_CHARS) {
    removed = [kept[kept.length - 1], ...removed];
    kept = kept.slice(0, -1);
    message = composeGroupMessage(kept);
  }
  return { message, delivered: kept, withheld: [...removed, ...overflow] };
}

// Texte seul (appelants qui n'ont pas de marquage à faire). Le TICKER, lui, doit
// utiliser `buildReminderInjection` : il a besoin de savoir ce qui est lisible.
export function buildReminderInjectionMessage(items) {
  return buildReminderInjection(items).message;
}

// Libellé du panneau 🔔 / toast pour un LOT livré : « ⏰ 3 relances — 29/08 à
// 14:30 ». Une seule ligne par lot (l'heure reste celle de la LIVRAISON).
export function formatReminderGroupNotificationLabel(count, deliveredAt) {
  const n = Number(count) || 0;
  if (n <= 1) return formatReminderNotificationLabel(deliveredAt);
  const when = formatReminderDate(deliveredAt);
  return when ? `⏰ ${n} relances — ${when}` : `⏰ ${n} relances`;
}

// DÉFAUT 4 — Signal SYSTÈME de la retenue (affiché UNE fois par session par le
// ticker) : le propriétaire n'est plus laissé dans l'ignorance du fait que des
// relances attendent son premier message. Chaîne vide si rien n'est retenu.
export function formatReminderHoldNotice(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1
    ? "1 relance en attente — écrivez, ou activez ⚙️ → Assistant"
    : `${n} relances en attente — écrivez, ou activez ⚙️ → Assistant`;
}

// Garde « UNE SEULE fois par session » du signal de retenue : la règle
// d'unicité est donc écrite ici et testable seule, et le ticker ne fait que
// l'interroger à chaque passe (10 s) sans jamais la réécrire. `reset()` est
// appelé à l'ouverture d'une session de conversation (startScheduleTicker).
export function createReminderHoldGuard() {
  let notified = false;
  return {
    reset() {
      notified = false;
    },
    /** Vrai au plus UNE fois par session, et seulement s'il y a à dire. */
    shouldNotify(waitingForOwner) {
      if (!(Number(waitingForOwner) > 0)) return false;
      if (notified) return false;
      notified = true;
      return true;
    },
  };
}

// DÉCISION UNIQUE d'injection des relances dues (une passe de tick).
//
// Trois règles, écrites ici et NULLE PART ailleurs (le ticker de super-agent.js
// ne fait qu'exécuter le plan rendu) :
//
//  1. RÉGLAGE DU PROPRIÉTAIRE « Vérifier les points à faire à l'ouverture de la
//     session (relances programmées) » (`super_agent_auto_check_startup`,
//     DÉSACTIVÉ par défaut — index.html, case `setting-superagent-auto-check-startup`).
//     Sa promesse est explicite : désactivé, « l'Assistant ne lance pas
//     automatiquement un rappel dû au démarrage ». Le tick démarre à l'ouverture
//     de l'onglet 🧭 (donc au démarrage de Pilot) et rattrape TOUT le retard
//     accumulé pendant que Pilot était fermé : sans cette règle, un rappel dû
//     partait tout seul au démarrage et l'assistant se lançait dans un travail
//     que personne n'avait demandé (constaté : reprise de chantier + mission
//     de publication au lancement). Tant que le propriétaire n'a pas lui-même
//     écrit dans cette session (`ownerEngaged`), un rappel reste DÛ (rien n'est
//     perdu, aucun marquage) et partira dès qu'il ouvrira la conversation — ou
//     immédiatement si le réglage est activé.
//  2. UN SEUL ENVOI par passe (donc UN SEUL tour de l'assistant). Plusieurs
//     rappels échus ensemble (typique après une fermeture de plusieurs jours)
//     partaient dans la même passe, à la suite, chacun ouvrant un vrai tour de
//     génération → assistant occupé et messages du propriétaire refusés. Un
//     envoi peut toutefois porter PLUSIEURS relances REGROUPÉES (règle 3) : la
//     limite est celle du nombre de TOURS, pas du nombre de rappels traités.
//     Les rappels non livrés restent DUS et partent à la passe suivante (10 s),
//     une fois l'assistant redevenu libre.
//  3. REGROUPEMENT DES RETARDATAIRES et ROTATION EN CAS D'ÉCHEC :
//     - les rappels en retard de plus de deux intervalles (`isOverdueLaggard`)
//       partent GROUPÉS dans un seul message (« N relances échues : … ») ;
//     - parmi les autres, un seul part par passe, en commençant par celui qui a
//       le MOINS d'échecs consécutifs (compteur en mémoire, `failureCounts`) ;
//       un rappel qui échoue `REMINDER_MAX_CONSECUTIVE_FAILURES` fois de suite
//       est ÉCARTÉ tant qu'un autre peut partir — il n'est jamais perdu et il
//       n'affame plus les suivants (`schedule_due` renvoie toujours `ORDER BY
//       id`, donc sans cette règle le premier éligible monopolise la passe).
//  4. LOT BORNÉ (2ᵉ relecture, défaut 3) : un envoi ne porte jamais plus de
//     `REMINDER_BATCH_MAX_ITEMS` relances, et le message est plafonné à
//     `REMINDER_BATCH_MAX_CHARS` (même plafond que le reste des injections
//     automatiques, `MAX_INJECTED_MESSAGE_CHARS` côté Rust). Les relances en
//     trop ne sont NI marquées NI perdues : elles restent dans `held` et
//     partent à la passe suivante.
//
// `backendBusy` et `pendingIds` restent les gardes historiques (assistant en
// train de répondre, injection déjà en vol).
//
// @returns {{toInject: object[], mode: "none"|"single"|"group", held: object[],
//   waitingForOwner: number}} plan de la passe
//   (`held` = rappels laissés DUS, jamais perdus, jamais marqués ; `mode` =
//   forme de l'UNIQUE message à envoyer ; `waitingForOwner` = nombre de
//   rappels retenus PARCE QUE le propriétaire n'a pas encore écrit, seule
//   cause qui mérite un signal à l'écran).
export function planDueReminderInjections(opts) {
  const {
    due,
    pendingIds,
    backendBusy,
    autoCheckStartup,
    ownerEngaged,
    failureCounts,
    now,
  } = opts || {};
  const list = Array.isArray(due) ? due : [];
  const pending = pendingIds instanceof Set ? pendingIds : new Set();
  const held = [];
  const eligible = [];
  const waitingForOwner = [];
  const startupAllowed = autoCheckStartup === true || ownerEngaged === true;
  for (const d of list) {
    if (!d || d.id === undefined || d.id === null) continue;
    if (!startupAllowed) { held.push(d); waitingForOwner.push(d); continue; }
    if (backendBusy) { held.push(d); continue; }
    if (pending.has(d.id)) { held.push(d); continue; }
    eligible.push(d);
  }
  // ROTATION / MISE À L'ÉCART : les rappels qui viennent d'échouer passent APRÈS
  // ceux qui n'ont jamais échoué ; un rappel écarté n'est retenté que s'il ne
  // reste rien d'autre à livrer (aucun rappel n'est donc jamais perdu).
  const ranked = eligible
    .map((d, index) => ({ d, index, failures: reminderFailureCount(failureCounts, d.id) }))
    .sort((a, b) => a.failures - b.failures || a.index - b.index);
  const healthy = ranked.filter((r) => r.failures < REMINDER_MAX_CONSECUTIVE_FAILURES);
  const quarantined = ranked.filter((r) => r.failures >= REMINDER_MAX_CONSECUTIVE_FAILURES);
  const laggards = healthy.filter((r) => isOverdueLaggard(r.d, now));
  let chosen = [];
  let mode = "none";
  if (laggards.length > 0) {
    // Lot BORNÉ en nombre : les retardataires en trop restent DÛS (ajoutés à
    // `held` plus bas) et partent à la passe suivante — aucun n'est marqué ni
    // perdu.
    chosen = laggards.slice(0, REMINDER_BATCH_MAX_ITEMS).map((r) => r.d);
    mode = chosen.length > 1 ? "group" : "single";
  } else if (healthy.length > 0) {
    chosen = [healthy[0].d];
    mode = "single";
  } else if (quarantined.length > 0) {
    // Plus rien de sain : on retente ENSEMBLE les rappels écartés. Aucun n'est
    // perdu et aucun ne prend la place d'un autre (aucune famine possible).
    chosen = quarantined.slice(0, REMINDER_BATCH_MAX_ITEMS).map((r) => r.d);
    mode = chosen.length > 1 ? "group" : "single";
  }
  const chosenIds = new Set(chosen.map((d) => d.id));
  for (const d of eligible) {
    if (!chosenIds.has(d.id)) held.push(d);
  }
  return { toInject: chosen, mode, held, waitingForOwner: waitingForOwner.length };
}

// Validation miroir de la borne Rust (every >= 60 s). Retourne null si valide,
// sinon un message d'erreur.
export function parseScheduleEvery(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    return "L'intervalle doit être un entier.";
  }
  if (n < 60) {
    return "L'intervalle doit être >= 60 s.";
  }
  return null;
}

// Formate une date/heure de rappel au format français court « 29/08 à 14:30 »
// (jour/mois à HH:MM, heure locale). Retourne "" si la date est absente ou
// invalide : l'appelant garde alors la bulle inchangée (jamais « Invalid
// Date »/« NaN » à l'écran). Formatage manuel (pas d'Intl) pour garantir le
// même rendu sur Windows/macOS/Linux quel que soit le moteur.
export function formatReminderDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} à ${hh}:${mi}`;
}

// Bulle de relance discrète (retours utilisateur 2026-08-29). Le prompt du
// rappel est une consigne technique destinée à l'assistant : l'afficher en
// clair pollue la conversation pour rien. La bulle ne montre donc qu'un
// marqueur court « ⏰ relance — 29/08 à 14:30 » (garde-fou discret) ; la date
// n'apparaît que si formatReminderDate en a produit une. Le prompt complet
// reste consultable au survol (title, côté super-agent.js).
export function formatReminderQuietLabel(when) {
  return when ? `⏰ relance — ${when}` : "⏰ relance";
}

// Libellé de notification pour le panneau Événements / toast (issue #36).
// Combine le marqueur discret et l'HEURE DE LIVRAISON : « ⏰ relance —
// 29/08 à 14:30 ». Attention au sens, souvent confondu : ce n'est PAS
// l'échéance théorique du rappel (`nextFireAt`), mais l'instant où l'appelant a
// effectivement livré la relance à l'assistant (`new Date()` côté
// super-agent.js) — les deux diffèrent dès qu'un tick a du retard (onglet
// fermé, assistant occupé, rappel rejoué). Le prompt complet reste consultable
// au survol (title, côté super-agent.js), jamais affiché en clair.
export function formatReminderNotificationLabel(deliveredAt) {
  return formatReminderQuietLabel(formatReminderDate(deliveredAt));
}

// Validation miroir de l'opération Rust schedule_set_enabled (désactivation /
// réactivation d'un rappel sans le supprimer). Retourne null si valide, sinon
// un message d'erreur. `id` doit être un entier positif, `enabled` un booléen.
export function parseScheduleSetEnabled(id, enabled) {
  const n = Number(id);
  if (!Number.isInteger(n) || Number.isNaN(n) || n <= 0) {
    return "L'id du rappel doit être un entier positif.";
  }
  if (typeof enabled !== "boolean") {
    return "enabled doit être un booléen.";
  }
  return null;
}
