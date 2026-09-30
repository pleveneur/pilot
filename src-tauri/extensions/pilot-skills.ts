// Pilot Skills — filtrage STRICT des compétences annoncées au modèle (D6).
//
// Pourquoi une extension DÉDIÉE : le filtre doit s'appliquer à TOUTE session
// d'agent, y compris quand `inherit_context` est désactivé (l'extension
// `pilot-context.ts`, qui portait ce filtre, n'est chargée qu'avec l'héritage de
// contexte). Un filtre conditionné à un réglage sans rapport laissait fuiter les
// compétences auto-découvertes : c'est une demi-fonctionnalité, interdite par D8.
//
// Principe : Pilot pose `PILOT_AGENT_SKILLS` (liste JSON des compétences de
// l'agent) pour TOUTE session d'agent. La seule PRÉSENCE de la variable est le
// signal « cet agent ne voit que ses compétences » ; sans elle (reviewer,
// assistant, session sans registre) rien n'est filtré (fail-open).
//
// Ce que ça retire : les compétences auto-découvertes par pi (`~/.pi/agent/skills`,
// `<projet>/.pi/skills`) et celles des autres agents. Exception : le skill
// `quality-gate` de Pilot n'est JAMAIS filtré (il protège toute écriture, quel
// que soit l'agent). Le nom est comparé au `name` du frontmatter ET au nom du
// dossier (pi nomme les compétences découvertes d'après leur dossier).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename, dirname } from "node:path";

// Le nom du skill technique de Pilot, jamais filtré.
const ALWAYS_ALLOWED = "quality-gate";

/** Compétence minimale manipulée par le filtre (sous-ensemble de `Skill`). */
export interface FilterableSkill {
  name?: string;
  baseDir?: string;
  filePath?: string;
}

/**
 * Ne garde que les compétences listées (+ `quality-gate`). Fail-open sur une env
 * absente ou illisible : mieux vaut trop de compétences qu'une session cassée.
 */
export function filterSkillsForAgent<T extends FilterableSkill>(
  skills: T[],
  allowedJson: string | undefined,
): T[] {
  if (allowedJson === undefined) return skills; // pas de liste → pas de filtrage
  let allowed: Set<string>;
  try {
    const parsed = JSON.parse(allowedJson);
    if (!Array.isArray(parsed)) return skills; // format inattendu → fail-open
    allowed = new Set<string>(parsed.map(String));
  } catch {
    return skills; // env illisible → on préfère ne pas filtrer
  }
  allowed.add(ALWAYS_ALLOWED);
  return skills.filter((s) => {
    const dirName = s.baseDir
      ? basename(s.baseDir)
      : s.filePath
        ? basename(dirname(s.filePath))
        : "";
    return allowed.has(s.name ?? "") || (dirName !== "" && allowed.has(dirName));
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    // AVANT toute lecture de `event.systemPrompt` : le prompt est rendu depuis
    // `event.systemPromptOptions`, muter après l'avoir lu n'aurait aucun effet.
    const listed = event.systemPromptOptions?.skills;
    if (!Array.isArray(listed)) return;
    event.systemPromptOptions.skills = filterSkillsForAgent(
      listed,
      typeof process !== "undefined" ? process.env?.PILOT_AGENT_SKILLS : undefined,
    );
  });
}
