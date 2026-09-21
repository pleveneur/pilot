/**
 * Garde-fou du banc d'essai serveur (L7.6) — L7.7.
 *
 * Le parcours de bout en bout `gds-server/tests/e2e.sh` construit une image,
 * démarre un conteneur et écrit en base. Sa contrainte la plus forte est de ne
 * JAMAIS toucher une installation de production (composition
 * `gds-server/docker-compose.yml`, son `.env`, ses conteneurs, volumes et
 * images). Ces tests lisent les deux fichiers du banc d'essai et verrouillent
 * cette isolation, pour qu'une modification distraite (mauvais fichier de
 * composition, port recopié, socket Docker monté) échoue AVANT tout lancement.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const SCRIPT = lire("gds-server/tests/e2e.sh");
const COMPOSE_TEST = lire("gds-server/docker-compose.test.yml");
const COMPOSE_PROD = lire("gds-server/docker-compose.yml");

/** Ports publiés par une composition (`"<hôte>:<conteneur>"`). */
const portsPublies = (compose) =>
  [
    ...compose.matchAll(/^\s*-\s*"?(?:[^"\s]*:)?(\d+):(\d+)"?\s*$/gm),
  ].map((m) => m[1]);

describe("banc d'essai serveur — isolation", () => {
  it("n'utilise jamais la composition de production ni son .env", () => {
    // Un nom `docker-compose.yml` (sans `.test`) = composition de production.
    expect(SCRIPT).not.toMatch(/docker-compose\.yml/);
    expect(SCRIPT).not.toContain("--env-file");
    // Le fichier de test est bien celui qui est utilisé.
    expect(SCRIPT).toContain("docker-compose.test.yml");
  });

  it("porte un nom de projet Compose distinct", () => {
    // Le nom est déclaré dans la composition de test (et non hérité du dossier),
    // pour que conteneur, réseau et volumes s'appellent `pilot-gds-e2e_*`.
    expect(COMPOSE_TEST).toMatch(/^name:\s*pilot-gds-e2e\s*$/m);
    expect(COMPOSE_PROD).not.toMatch(/^name:\s*pilot-gds-e2e\s*$/m);
  });

  it("n'occupe aucun port de la production", () => {
    const test = portsPublies(COMPOSE_TEST);
    const prod = portsPublies(COMPOSE_PROD);
    expect(test.length).toBeGreaterThanOrEqual(3);
    for (const port of test) {
      expect(prod, `port ${port} déjà publié par la composition de production`).not.toContain(port);
    }
    // Les ports hauts choisis pour le banc d'essai (le 5432 du poste est pris).
    for (const port of ["18080", "12222", "55432"]) {
      expect(test, `port ${port} attendu dans la composition de test`).toContain(port);
    }
  });

  it("n'écrase jamais l'image locale de production", () => {
    // L'étiquette construite par le banc d'essai est propre au test ; celle de
    // la production ne doit apparaître sur aucune ligne `image:`.
    expect(COMPOSE_TEST).toMatch(/^\s*image:\s*pilot-gds:e2e-local\s*(#.*)?$/m);
    expect(COMPOSE_TEST).not.toMatch(/^\s*image:\s*pilot-gds:local\s*$/m);
    expect(SCRIPT).toContain("pilot-gds:e2e-local");
  });

  it("ne monte aucun socket Docker", () => {
    expect(COMPOSE_TEST).not.toContain("docker.sock");
    expect(SCRIPT).not.toContain("docker.sock");
  });

  it("est jetable : nettoyage complet en fin de parcours", () => {
    // La composition redémarre jamais toute seule et laisse un arrêt propre.
    expect(COMPOSE_TEST).toMatch(/restart:\s*"?no"?/);
    // Le script supprime conteneur, volumes et image, puis contrôle l'isolation.
    expect(SCRIPT).toContain("down -v");
    expect(SCRIPT).toMatch(/\brmi\b/);
    expect(SCRIPT).toContain("contrôle d'isolation");
  });

  it("écrit ses fichiers de travail hors du dépôt", () => {
    // Tout passe par un dossier temporaire : aucun reste dans le dépôt.
    expect(SCRIPT).toContain("mktemp -d");
    expect(SCRIPT).toContain("WORK=");
  });
});
