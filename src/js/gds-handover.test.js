// Tests — PORTAGE d'un projet entre postes, côté INTERFACE (plan mode reseau
// multi-postes, §7 etape 5). Fichier de preuve nomme par le plan :
//   npx vitest run src/js/gds-handover.test.js
//
// Ce fichier prouve, sans base ni serveur :
//  1. la LECTURE des reponses de portage (`mapHandoverState`) ;
//  2. l'HEURE DE FIN lisible (`formatHandoverUntil`) et le BANDEAU qui la dit ;
//  3. la LECTURE SEULE : ce qu'on ne peut pas publier, et le refus DIT au clic ;
//  4. le TRAVAIL LOCAL non publiable + « prendre le projet pour publier » ;
//  5. le bouton de RESTITUTION (seulement quand ce poste tient le projet) ;
//  6. la LIBERATION par un administrateur seul, avec motif, TRACEE (nom + motif) ;
//  7. le CABLAGE reel : chaque geste qui publie passe par la porte d'ecriture,
//     le bandeau vit dans l'en-tete GDS (jamais au-dessus des onglets), et le
//     bloc est VIDE quand il n'y a rien a dire (aucun bandeau parasite).
//
// Plusieurs tests lisent le source (`bite` = morsure) : ils echouent si la
// lecture seule disparait, si le bandeau n'affiche plus l'heure de fin, ou si un
// geste qui publie oublie la porte d'ecriture.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  HANDOVER_FREE,
  HANDOVER_MINE,
  HANDOVER_OTHER,
  HANDOVER_UNKNOWN,
  countLocalChanges,
  formatHandoverUntil,
  handoverBanner,
  handoverHasGiveBack,
  handoverHasTake,
  handoverLocalWorkNotice,
  handoverWriteAllowed,
  handoverWriteRefusal,
  mapHandoverState,
} from "./gds-status.js";

import {
  canReleaseProject,
  handoverReleaseReasonError,
  handoverReleaseTraceLine,
  renderProjectReleaseConfirmHtml,
  renderProjectsSectionHtml,
} from "./gds-admin.js";
import { sliceSource } from "./source-slice.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lit un source du projet, fins de ligne normalisees (piege CI Windows/CRLF). */
function sourceOf(name) {
  return readFileSync(join(HERE, name), "utf8").replace(/\r\n/g, "\n");
}

/** Lit le CSS, fins de ligne normalisees. */
function cssSource() {
  return readFileSync(join(HERE, "..", "css", "style.css"), "utf8").replace(/\r\n/g, "\n");
}

/** Un « maintenant » fixe : 26/10/2026 09:00 heure locale. */
const NOW = new Date(2026, 9, 26, 9, 0, 0);
/** Une echeance le MEME jour, a 14:35 heure locale. */
const SAME_DAY = new Date(2026, 9, 26, 14, 35, 0);
/** Une echeance un AUTRE jour de la meme annee. */
const OTHER_DAY = new Date(2026, 11, 3, 8, 5, 0);
/** Une echeance une AUTRE annee. */
const OTHER_YEAR = new Date(2027, 0, 15, 18, 45, 0);

/** Etat « tenu par un AUTRE poste » tel que le rend `mapHandoverState`. */
function otherPoste(until = SAME_DAY.toISOString()) {
  return mapHandoverState({
    ok: false,
    refused: true,
    error: "Projet tenu par un autre poste.",
    poste_id: "poste-A",
    state: { holder: { poste_id: "poste-B" }, expires_at: until, expired: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Lecture des reponses de portage
// ─────────────────────────────────────────────────────────────────────────────

describe("mapHandoverState — le serveur reste seul juge", () => {
  it("prise reussie par ce poste → mine", () => {
    const h = mapHandoverState({
      ok: true,
      action: "taken",
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString() },
    });
    expect(h.kind).toBe(HANDOVER_MINE);
    expect(h.mine).toBe(true);
    expect(h.holder).toBe("poste-A");
  });

  it("verdict d'ecriture autorise → mine", () => {
    const h = mapHandoverState({
      ok: true,
      allowed: true,
      claim_required: false,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString() },
    });
    expect(h.kind).toBe(HANDOVER_MINE);
  });

  it("porteur = un AUTRE poste → other, avec porteur et echeance", () => {
    const h = otherPoste();
    expect(h.kind).toBe(HANDOVER_OTHER);
    expect(h.holder).toBe("poste-B");
    expect(h.until).toBe(SAME_DAY.toISOString());
    expect(h.allowed).toBe(false);
  });

  it("porteur = ce poste mais prise EXPIREE → free (a reprendre)", () => {
    const h = mapHandoverState({
      ok: false,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString(), expired: true },
    });
    expect(h.kind).toBe(HANDOVER_FREE);
  });

  it("aucun porteur et prise demandee → free", () => {
    const h = mapHandoverState({
      ok: true,
      allowed: false,
      claim_required: true,
      poste_id: "poste-A",
      state: { holder: null },
    });
    expect(h.kind).toBe(HANDOVER_FREE);
  });

  it("panne ou reponse vide → unknown, jamais une supposition", () => {
    for (const v of [null, undefined, {}, { ok: false, error: "serveur injoignable" }]) {
      const h = mapHandoverState(v);
      expect(h.kind).toBe(HANDOVER_UNKNOWN);
      expect(h.mine).toBe(false);
      expect(h.holder).toBe("");
      expect(h.until).toBe("");
    }
    expect(mapHandoverState({ ok: false, error: "serveur injoignable" }).message).toBe(
      "serveur injoignable"
    );
  });

  it("comparaison porteur / poste insensible a la casse", () => {
    const h = mapHandoverState({
      ok: true,
      poste_id: "POSTE-a",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString() },
    });
    expect(h.kind).toBe(HANDOVER_MINE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. L'heure de fin : lisible, jamais inventee
// ─────────────────────────────────────────────────────────────────────────────

describe("formatHandoverUntil — heure lisible dans le fuseau du poste", () => {
  it("le jour meme : HH:MM", () => {
    expect(formatHandoverUntil(SAME_DAY.toISOString(), NOW)).toBe("14:35");
  });

  it("un autre jour de la meme annee : JJ/MM a HH:MM", () => {
    expect(formatHandoverUntil(OTHER_DAY.toISOString(), NOW)).toBe("03/12 a 08:05");
  });

  it("une autre annee : JJ/MM/AAAA a HH:MM", () => {
    expect(formatHandoverUntil(OTHER_YEAR.toISOString(), NOW)).toBe("15/01/2027 a 18:45");
  });

  it("accepte un horodatage SQL (espace au lieu du T)", () => {
    const sql = "2026-10-26 14:35:00";
    expect(formatHandoverUntil(sql, NOW)).toBe("14:35");
  });

  it("absente ou illisible : chaine vide, aucune heure inventee", () => {
    expect(formatHandoverUntil("", NOW)).toBe("");
    expect(formatHandoverUntil(null, NOW)).toBe("");
    expect(formatHandoverUntil("pas une date", NOW)).toBe("");
  });
});

describe("handoverBanner — dit qui tient le projet et jusqu'a quand", () => {
  it("projet tenu par un autre poste : alerte + HEURE DE FIN lisible", () => {
    const b = handoverBanner(otherPoste(), NOW);
    expect(b).not.toBeNull();
    expect(b.tone).toBe("warn");
    // MORSURE : sans l'heure de fin, ce test echoue.
    expect(b.text).toContain("tenu par un autre développeur");
    expect(b.text).toContain("jusqu'à 14:35");
    // Et il dit ce qui reste possible / ce qui ne l'est pas.
    expect(b.text).toContain("lecture");
    expect(b.text).toContain("publication");
  });

  it("echeance inconnue : le bandeau le dit sans inventer d'heure", () => {
    const b = handoverBanner(otherPoste(""), NOW);
    expect(b.tone).toBe("warn");
    expect(b.text).toContain("tenu par un autre développeur");
    expect(b.text).not.toContain("jusqu'à");
  });

  it("etat invérifiable : alerte, avec le motif", () => {
    const b = handoverBanner(
      mapHandoverState({ ok: false, error: "serveur injoignable" }),
      NOW
    );
    expect(b.tone).toBe("warn");
    expect(b.text).toContain("n'a pas pu être vérifié");
    expect(b.text).toContain("serveur injoignable");
  });

  it("projet tenu par CE poste ou libre : AUCUN bandeau (pas de parasite)", () => {
    const mine = mapHandoverState({
      ok: true,
      allowed: true,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString() },
    });
    expect(handoverBanner(mine, NOW)).toBeNull();
    const free = mapHandoverState({ ok: true, allowed: false, claim_required: true, state: {} });
    expect(handoverBanner(free, NOW)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Lecture seule : ce qui est empeche, et le motif DIT
// ─────────────────────────────────────────────────────────────────────────────

describe("handoverWriteAllowed — lecture seule quand un autre poste tient le projet", () => {
  it("MORSURE : autre poste → écriture refusée", () => {
    expect(handoverWriteAllowed(otherPoste())).toBe(false);
  });

  it("état invérifiable → on ne bloque pas le geste (le serveur reste seul juge)", () => {
    // Bloquer sur un état invérifiable empêcherait de réparer une liaison
    // cassée (« Ajouter ce projet au GDS ») : le bandeau le dit, le serveur
    // tranche au moment de publier.
    const h = mapHandoverState({ ok: false, error: "panne" });
    expect(handoverWriteAllowed(h)).toBe(true);
    expect(handoverBanner(h, NOW).text).toContain("n'a pas pu être vérifié");
    expect(handoverWriteRefusal(h, "Publier", NOW)).toBe("");
  });

  it("ce poste tient le projet, ou projet libre, ou aucun état lu : autorisé", () => {
    const mine = mapHandoverState({
      ok: true,
      allowed: true,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" }, expires_at: SAME_DAY.toISOString() },
    });
    expect(handoverWriteAllowed(mine)).toBe(true);
    expect(handoverWriteAllowed(mapHandoverState({ ok: true, claim_required: true }))).toBe(true);
    expect(handoverWriteAllowed(null)).toBe(true);
  });
});

describe("handoverWriteRefusal — jamais un refus muet", () => {
  it("nomme l'action refusee, le porteur et l'heure de fin", () => {
    const msg = handoverWriteRefusal(otherPoste(), "Synchroniser ce projet", NOW);
    expect(msg).toContain("« Synchroniser ce projet »");
    expect(msg).toContain("n'a pas été faite");
    expect(msg).toContain("tenu par un autre développeur");
    expect(msg).toContain("jusqu'à 14:35"); // MORSURE : sans l'heure, echec
    expect(msg).toContain("prenez le projet en main");
  });

  it("action non empêchée : aucun message", () => {
    const mine = mapHandoverState({
      ok: true,
      allowed: true,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" } },
    });
    expect(handoverWriteRefusal(mine, "Publier", NOW)).toBe("");
    expect(handoverWriteRefusal(null, "Publier", NOW)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Travail local non publiable + « prendre le projet pour publier »
// ─────────────────────────────────────────────────────────────────────────────

describe("handoverLocalWorkNotice — travail local jamais perdu, jamais publie par erreur", () => {
  it("autre poste + 3 fichiers : dit que ca ne peut pas etre publie, et propose", () => {
    const t = handoverLocalWorkNotice(otherPoste(), 3, NOW);
    expect(t).toContain("3 fichiers modifiés");
    expect(t).toContain("ne peut pas être publié");
    expect(t).toContain("jusqu'à 14:35");
    expect(t).toContain("conservé sur ce poste");
    expect(t).toContain("prenez le projet en main");
  });

  it("un seul fichier : singulier", () => {
    expect(handoverLocalWorkNotice(otherPoste(), 1, NOW)).toContain("1 fichier modifié");
  });

  it("projet libre avec du travail local : pas encore publie, proposer de prendre", () => {
    const free = mapHandoverState({ ok: true, claim_required: true, state: {} });
    const t = handoverLocalWorkNotice(free, 2, NOW);
    expect(t).toContain("2 fichiers modifiés");
    expect(t).toContain("n'est pas encore publié");
  });

  it("aucun changement local, ou projet tenu par ce poste : rien a dire", () => {
    expect(handoverLocalWorkNotice(otherPoste(), 0, NOW)).toBeNull();
    expect(handoverLocalWorkNotice(otherPoste(), -1, NOW)).toBeNull();
    const mine = mapHandoverState({
      ok: true,
      allowed: true,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" } },
    });
    expect(handoverLocalWorkNotice(mine, 5, NOW)).toBeNull();
  });
});

describe("handoverHasTake / handoverHasGiveBack — un bouton qui sert", () => {
  it("« prendre le projet pour publier » : autre poste, ou projet libre avec du travail local", () => {
    expect(handoverHasTake(otherPoste(), 0)).toBe(true);
    expect(handoverHasTake(mapHandoverState({ ok: true, claim_required: true }), 4)).toBe(true);
    expect(handoverHasTake(mapHandoverState({ ok: true, claim_required: true }), 0)).toBe(false);
  });

  it("« rendre le projet » : seulement quand CE poste tient le projet", () => {
    const mine = mapHandoverState({
      ok: true,
      allowed: true,
      poste_id: "poste-A",
      state: { holder: { poste_id: "poste-A" } },
    });
    expect(handoverHasGiveBack(mine)).toBe(true);
    expect(handoverHasGiveBack(otherPoste())).toBe(false);
    expect(handoverHasGiveBack(null)).toBe(false);
  });
});

describe("countLocalChanges — on ne compte jamais large", () => {
  it("git_status : nombre d'entrees", () => {
    expect(
      countLocalChanges({ is_repo: true, entries: { "a.md": "M", "b.js": "??" } })
    ).toBe(2);
  });

  it("git_status_project : `pending`", () => {
    expect(countLocalChanges({ is_repo: true, pending: 4 })).toBe(4);
  });

  it("pas un depot, reponse inattendue, negatif : 0", () => {
    expect(countLocalChanges({ is_repo: false, pending: 9 })).toBe(0);
    expect(countLocalChanges(null)).toBe(0);
    expect(countLocalChanges({})).toBe(0);
    expect(countLocalChanges({ is_repo: true, pending: -3 })).toBe(0);
    expect(countLocalChanges({ is_repo: true, pending: "beaucoup" })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Liberation d'un projet : administrateur seul, motif obligatoire, TRACEE
// ─────────────────────────────────────────────────────────────────────────────

describe("canReleaseProject — reserve a l'administrateur", () => {
  it("admin seul", () => {
    expect(canReleaseProject("admin")).toBe(true);
    expect(canReleaseProject(" Admin ")).toBe(true);
  });

  it("developpeur, role vide ou inconnu : non", () => {
    expect(canReleaseProject("developer")).toBe(false);
    expect(canReleaseProject("")).toBe(false);
    expect(canReleaseProject(null)).toBe(false);
    expect(canReleaseProject(undefined)).toBe(false);
  });
});

describe("handoverReleaseReasonError — motif obligatoire", () => {
  it("vide ou trop court : refuse avec un message clair", () => {
    expect(handoverReleaseReasonError("")).toContain("obligatoire");
    expect(handoverReleaseReasonError("   ")).toContain("obligatoire");
    expect(handoverReleaseReasonError("abc")).toContain("trop court");
  });

  it("motif utilisable : aucun message", () => {
    expect(handoverReleaseReasonError("poste en panne")).toBe("");
  });
});

describe("handoverReleaseTraceLine — jamais un geste anonyme", () => {
  it("nomme le projet, l'administrateur et le motif", () => {
    const t = handoverReleaseTraceLine({
      name: "Pilot",
      reason: "poste en panne",
      admin: "patrick@exemple.com",
      applied: false,
    });
    expect(t).toContain("« Pilot »");
    expect(t).toContain("patrick@exemple.com");
    expect(t).toContain("« poste en panne »");
    // Rien n'est annonce comme fait quand rien ne l'est.
    expect(t).toContain("Rien n'a été libéré");
  });

  it("appliquee : dit que le projet est libre (sans mentir sur le reste)", () => {
    const t = handoverReleaseTraceLine({
      name: "Pilot",
      reason: "poste en panne",
      admin: "patrick@exemple.com",
      applied: true,
    });
    expect(t).toContain("redevenu libre");
    expect(t).not.toContain("Rien n'a été libéré");
  });

  it("sans nom ni compte connu : ne fabrique pas d'identite", () => {
    const t = handoverReleaseTraceLine({});
    expect(t).toContain("(projet sans nom)");
    expect(t).toContain("(compte administrateur)");
  });
});

describe("rendu de la liberation — bouton et panneau pour l'administrateur SEUL", () => {
  const projects = [{ id: 7, name: "Pilot" }];

  it("administrateur : bouton « Libérer »", () => {
    const html = renderProjectsSectionHtml({ projects, repos: [], role: "admin" });
    expect(html).toContain('data-prj-action="release"');
    expect(html).toContain("Libérer");
  });

  it("MORSURE : développeur → aucun bouton, aucun panneau", () => {
    const html = renderProjectsSectionHtml({ projects, repos: [], role: "developer" });
    expect(html).not.toContain('data-prj-action="release"');
    const panel = renderProjectReleaseConfirmHtml({
      projects,
      role: "developer",
      releasing: { project_id: 7, name: "Pilot", reason: "" },
    });
    expect(panel).toBe("");
  });

  it("role inconnu (non connecte) : aucun bouton", () => {
    expect(renderProjectsSectionHtml({ projects, repos: [] })).not.toContain(
      'data-prj-action="release"'
    );
  });

  it("administrateur + panneau ouvert : champ de motif obligatoire et confirmation", () => {
    const html = renderProjectsSectionHtml({
      projects,
      repos: [],
      role: "admin",
      releasing: { project_id: 7, name: "Pilot", reason: "poste en panne" },
    });
    expect(html).toContain('id="gds-admin-prj-release-reason"');
    expect(html).toContain('value="poste en panne"');
    expect(html).toContain('data-prj-action="release-confirm"');
    expect(html).toContain('data-prj-action="release-cancel"');
    // Le panneau explique le geste sans promettre autre chose que lui.
    expect(html).toContain("motif OBLIGATOIRE");
  });

  it("panneau ferme : rien n'est rendu", () => {
    expect(renderProjectReleaseConfirmHtml({ projects, role: "admin", releasing: null })).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Le cablage reel : ce que le source doit garder (morsure)
// ─────────────────────────────────────────────────────────────────────────────

describe("gds.js — chaque geste qui publie passe par la porte d'ecriture", () => {
  const src = sourceOf("gds.js");

  it("le bloc de portage vit dans l'en-tete GDS (jamais au-dessus des onglets)", () => {
    expect(src).toContain('id="gds-handover"');
    // Le bandeau est rendu DANS l'ecran GDS, pas dans la rangee d'onglets.
    const headerIdx = src.indexOf('class="gds-header"');
    const zoneIdx = src.indexOf('id="gds-handover"');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(zoneIdx).toBeGreaterThan(headerIdx);
    expect(src).not.toContain('id="tab-row"');
  });

  it("MORSURE : les cinq gestes qui écrivent sont gardés, avec leur libellé", () => {
    for (const label of [
      "Activer GDS sur ce projet",
      "Ajouter ce projet au GDS",
      "Synchroniser ce projet",
      "Publier ce projet sur le GDS",
      "Retirer du GDS",
    ]) {
      expect(src).toContain(`guardWrite("${label}"`);
    }
    // La porte s'appuie sur la regle pure (aucune decision locale inventee).
    expect(src).toContain("handoverWriteAllowed(handover)");
    expect(src).toContain("handoverWriteRefusal(handover, actionLabel)");
  });

  it("les commandes de portage appelees existent cote poste (noms exacts)", () => {
    expect(src).toContain('invoke("gds_handover_can_write"');
    expect(src).toContain('invoke("gds_handover_take"');
    expect(src).toContain('invoke("gds_handover_return"');
    // Le travail local est LU (Git), jamais ecrit.
    expect(src).toContain('invoke("git_status_project"');
  });

  it("la restitution ne dit « rendu » qu'apres succes (aucun mensonge)", () => {
    const idx = src.indexOf("async function giveBackProject()");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1200);
    // Le message de succes est dans le `try`, apres l'appel ; le `catch` garde
    // le poste porteur et affiche le message du poste.
    expect(body.indexOf('invoke("gds_handover_return"')).toBeLessThan(
      body.indexOf("Projet rendu")
    );
    expect(body).toContain("catch");
  });

  it("le bandeau est VIDE quand il n'y a rien a dire", () => {
    const idx = src.indexOf("function renderHandover()");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 2400);
    expect(body).toContain("zone.innerHTML = \"\"");
  });
});

describe("gds-admin.js — liberation câblée (bouton, motif relu, trace)", () => {
  const src = sourceOf("gds-admin.js");

  it("le motif saisi est relu avant tout redessin (sinon il serait efface)", () => {
    expect(src).toContain('q("#gds-admin-prj-release-reason")');
    const idx = src.indexOf("function readProjectFields()");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 800)).toContain("gds-admin-prj-release-reason");
  });

  it("MORSURE : chaque action de libération est gardée côté source", () => {
    for (const action of ['"release"', '"release-cancel"', '"release-confirm"']) {
      expect(src).toContain(`action === ${action}`);
    }
    // La confirmation exige l'administrateur ET un motif, et ENVOIE réellement
    // la libération au socle (étape 5 : plus de trace sans action). Découpage
    // VÉRIFIÉ (ancre qui bouge → échec, jamais un fragment vide vrai par
    // construction).
    const body = sliceSource(src, 'if (action === "release-confirm")', "// ── L4.5", 1200);
    expect(body).toContain("canReleaseProject(service.role)");
    expect(body).toContain("handoverReleaseReasonError(motif)");
    expect(body).toContain("handoverReleaseTraceLine(");
  });

  it("le role du compte connecté est transmis a la section projets", () => {
    expect(src).toContain("renderProjectsSectionHtml({ ...projects, role: service.role })");
  });
});

describe("style.css — bloc de portage discret et lisible dans les deux themes", () => {
  const css = cssSource();

  it("les quatre classes du bloc existent", () => {
    for (const cls of [
      ".gds-handover ",
      ".gds-handover-line",
      ".gds-handover-msg",
      ".gds-handover-actions",
    ]) {
      expect(css).toContain(cls);
    }
  });

  it("MORSURE : vide, le bloc ne prend aucune place (aucun bandeau parasite)", () => {
    expect(css).toContain(".gds-handover:empty");
  });

  it("aucune couleur en dur : uniquement des jetons du theme", () => {
    const start = css.indexOf(".gds-handover:empty");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 900);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(block).toContain("var(--text-secondary)");
    expect(block).toContain("var(--warning");
  });
});
