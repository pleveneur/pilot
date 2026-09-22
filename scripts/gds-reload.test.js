// gds-reload.test.js — filet de sécurité de scripts/gds-reload.js.
//
// Aucun Docker réel : on teste la partie DÉCIDABLE (analyse des arguments,
// refus des intentions destructrices, enchaînement des étapes, construction des
// commandes). C'est ce test qui prouve que la logique ne se casse pas.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTTP_PORT,
  IMAGE,
  PROJECT,
  STATE_VOLUMES,
  assertCommandsSafe,
  buildHealthUrl,
  buildImageCommand,
  buildRecreateCommand,
  buildStopCommand,
  buildVolumeBackupCommand,
  formatReport,
  parseArgs,
  parseHttpPort,
  planSteps,
  refuseMessage,
  timestamp,
} from "./gds-reload.js";

describe("analyse des arguments", () => {
  it("accepte le mode par défaut (rechargement complet)", () => {
    const parsed = parseArgs([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.opts.mode).toBe("reload");
    expect(parsed.opts.backupDir).toBeNull();
  });

  it("accepte --image-only, --backup-dir et --timeout", () => {
    const parsed = parseArgs(["--image-only", "--backup-dir", "/tmp/sauvegarde", "--timeout", "60"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.opts).toMatchObject({ mode: "image-only", backupDir: "/tmp/sauvegarde", timeoutS: 60 });
  });

  it("refuse toute intention destructive, avec explication", () => {
    for (const argv of [["-v"], ["--volumes"], ["down", "-v"], ["down"], ["volume", "rm", "pilot-gds_pgdata"], ["prune"], ["rm", "-rf", "/"], ["--purge"]]) {
      const parsed = parseArgs(argv);
      expect(parsed.ok, `attendu refusé : ${argv.join(" ")}`).toBe(false);
      expect(parsed.error).toContain("refusé");
    }
    expect(parseArgs(["-v"]).error).toContain("ne supprime JAMAIS les volumes");
  });

  it("refuse un argument inconnu (liste blanche stricte)", () => {
    const parsed = parseArgs(["--nope"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Seuls les arguments");
  });

  it("refuse une valeur manquante", () => {
    expect(parseArgs(["--backup-dir"]).ok).toBe(false);
    expect(parseArgs(["--timeout", "abc"]).ok).toBe(false);
  });
});

describe("enchaînement des étapes", () => {
  it("sauvegarde avant de reconstruire, reconstruit avant de recréer", () => {
    const steps = planSteps("reload");
    expect(steps).toEqual(["precheck", "backup", "build", "recreate", "health", "report"]);
    expect(steps.indexOf("backup")).toBeLessThan(steps.indexOf("build"));
    expect(steps.indexOf("build")).toBeLessThan(steps.indexOf("recreate"));
    expect(steps.indexOf("recreate")).toBeLessThan(steps.indexOf("health"));
  });

  it("ne sauvegarde ni ne recrée en mode image seule", () => {
    expect(planSteps("image-only")).toEqual(["precheck", "build", "report"]);
  });
});

describe("sécurité des commandes construites", () => {
  const allCommands = [
    buildStopCommand(),
    ...STATE_VOLUMES.map((volume) => buildVolumeBackupCommand(volume, "/tmp/sauvegarde")),
    buildImageCommand(),
    buildRecreateCommand(),
  ];

  it("aucune commande de la chaîne n'est destructive", () => {
    expect(assertCommandsSafe(allCommands)).toBeNull();
  });

  it("la recréation ne touche pas aux volumes (up -d, jamais down -v)", () => {
    const recreate = buildRecreateCommand();
    expect(recreate.args).toEqual(["compose", "up", "-d"]);
    expect(recreate.args).not.toContain("-v");
    expect(recreate.args).not.toContain("--volumes");
  });

  it("la reconstruction ne touche pas au conteneur", () => {
    expect(buildImageCommand().args).toEqual(["compose", "build"]);
  });

  it("la sauvegarde monte chaque volume d'état en lecture seule", () => {
    for (const volume of STATE_VOLUMES) {
      const command = buildVolumeBackupCommand(volume, "/tmp/sauvegarde");
      expect(command.args).toContain(`${PROJECT}_${volume}:/data:ro`);
      expect(command.args).toContain("/tmp/sauvegarde:/backup");
      expect(command.args).toContain(`/backup/${volume}.tgz`);
      expect(command.args).toContain(IMAGE);
    }
  });

  it("détecte une commande destructive fabriquée à la main", () => {
    expect(assertCommandsSafe([{ cmd: "docker", args: ["compose", "down", "-v"], label: "down -v" }])).toContain("destructrice");
    expect(assertCommandsSafe([{ cmd: "docker", args: ["volume", "rm", "pilot-gds_pgdata"], label: "volume rm" }])).toContain("volume");
    expect(assertCommandsSafe([{ cmd: "docker", args: ["system", "prune"], label: "prune" }])).toContain("destructrice");
    expect(assertCommandsSafe([{ cmd: "docker", args: ["volume", "ls", "--filter", "--volumes"], label: "volumes" }])).toContain("destructrice");
  });

  it("le message de refus nomme le geste dangereux", () => {
    expect(refuseMessage("down")).toContain("effacerait sans retour la base");
  });
});

describe("lecture du port et compte rendu", () => {
  it("lit GDS_HOST_HTTP_PORT sans ouvrir de secret", () => {
    expect(parseHttpPort("POSTGRES_PASSWORD=secret\nGDS_HOST_HTTP_PORT=55432\nGDS_BIND_ADDR=0.0.0.0")).toBe(55432);
    expect(parseHttpPort("GDS_HOST_HTTP_PORT=8080")).toBe(8080);
    expect(parseHttpPort("")).toBe(DEFAULT_HTTP_PORT);
    // Une variable commentée dans le modèle `.env.example` ne compte pas.
    expect(parseHttpPort("# GDS_HOST_HTTP_PORT=9999")).toBe(DEFAULT_HTTP_PORT);
  });

  it("construit l'URL de santé depuis le .env (adresse d'écoute comprise)", () => {
    expect(buildHealthUrl("GDS_HOST_HTTP_PORT=8080\nGDS_BIND_ADDR=0.0.0.0")).toBe("http://127.0.0.1:8080/api/gds/health");
    expect(buildHealthUrl("GDS_HTTP_BIND_ADDR=127.0.0.1\nGDS_HOST_HTTP_PORT=8080")).toBe("http://127.0.0.1:8080/api/gds/health");
    expect(buildHealthUrl("GDS_HTTP_BIND_ADDR=100.101.102.103\nGDS_HOST_HTTP_PORT=9443")).toBe("http://100.101.102.103:9443/api/gds/health");
  });

  it("produit un horodatage utilisable comme nom de dossier", () => {
    expect(timestamp(new Date("2026-01-31T09:05:00.000Z"))).toBe("2026-01-31T09-05-00");
  });

  it("le compte rendu dit ce qui a été fait, où est la sauvegarde et si le service répond", () => {
    const report = formatReport({
      mode: "reload",
      steps: planSteps("reload"),
      backupDir: "G:/sauvegarde-gds/2026-01-31T09-05-00",
      backupFiles: [{ name: "pgdata.tgz", size: 2048 }],
      backupSkippedReason: "",
      image: IMAGE,
      containerTouched: true,
      healthUrl: "http://127.0.0.1:8080/api/gds/health",
      healthOk: true,
      elapsedS: 12.34,
    });
    expect(report).toContain("G:/sauvegarde-gds/2026-01-31T09-05-00");
    expect(report).toContain("pgdata.tgz (2.0 Ko)");
    expect(report).toContain("RÉPOND");
    expect(report).toContain("volumes intacts");
  });

  it("le compte rendu d'une reconstruction seule dit que le service n'est pas touché", () => {
    const report = formatReport({
      mode: "image-only",
      steps: planSteps("image-only"),
      backupDir: null,
      backupFiles: [],
      backupSkippedReason: "",
      image: IMAGE,
      containerTouched: false,
      healthUrl: "",
      healthOk: false,
      elapsedS: 3,
    });
    expect(report).toContain("image SEULE");
    expect(report).toContain("NON touché");
  });
});
