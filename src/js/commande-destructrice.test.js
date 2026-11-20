/**
 * GARDE-FOU DES COMMANDES DESTRUCTRICES — la DÉCISION (module pur).
 *
 * FAIT MESURÉ (2026-11-20) : sur un modèle LOCAL, une commande de suppression
 * massive a été proposée 3 fois sur 3 SANS demander d'accord. Rien n'a été
 * exécuté, mais le défaut est réel : Pilot ne regardait pas le contenu des
 * outils de commande (`bash` / `shell`).
 *
 * Ce fichier verrouille la SOURCE UNIQUE de la décision
 * (`src/js/destructive-command.js`) :
 *  1. chacune des familles exigées par la demande est reconnue sur une commande
 *     RÉELLE (suppression récursive, suppression forcée, disque, formatage,
 *     extinction, droits en masse, envoi forcé, historique git, hors projet) ;
 *  2. les commandes du QUOTIDIEN passent normalement (un garde-fou qui bloque
 *     tout ne sert à rien : il serait désactivé) ;
 *  3. le message dit, en français simple : la commande, POURQUOI c'est
 *     dangereux, et CE QUI ARRIVE si l'on accepte ;
 *  4. la décision ne dépend NI du modèle, NI de la configuration, NI d'un
 *     réglage d'autonomie (contrat d'import : zéro dépendance).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASH_GATE_SENTINEL,
  DESTRUCTIVE_FAMILIES,
  FAMILY_PRIORITY,
  SHELL_COMMAND_KEYS,
  SHELL_TOOL_NAMES,
  analyzeDestructiveCommand,
  destructiveCommandMessage,
  destructiveGatePayload,
  destructiveGateRefusal,
  destructiveGateSentinelMessage,
  destructiveGateTitle,
  isDestructiveGateMessage,
  isPathUnderRoot,
  normalizePathForCompare,
  parseDestructiveGateMessage,
  planShellToolCall,
  writesOutsideProject,
} from "./destructive-command.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = "/home/dev/projet";

/** Analyse avec une racine de projet connue (cas réel d'une session). */
function analyze(command, projectRoot = PROJECT) {
  return analyzeDestructiveCommand(command, { projectRoot });
}

describe("1. chaque famille destructrice est reconnue (commande réelle)", () => {
  const CASES = [
    // ── suppression récursive / forcée ──
    ["rm -rf build", "suppression_recursive"],
    ["rm -r ./dist", "suppression_recursive"],
    ["rmdir /s /q ancien", "suppression_recursive"],
    ["rm -f resultat.txt", "suppression_forcee"],
    ["del /q donnees.csv", "suppression_forcee"],
    // ── disque / formatage ──
    ["rm -rf /", "disque"],
    ["dd if=/dev/zero of=/dev/sda bs=1M", "disque"],
    ["cat image.iso > /dev/nvme0n1", "disque"],
    ["mkfs.ext4 /dev/sdb1", "formatage"],
    ["format C: /q", "formatage"],
    ["diskpart", "formatage"],
    ["diskutil eraseDisk JHFS+ Vide disk2", "formatage"],
    // ── extinction ──
    ["shutdown -h now", "extinction"],
    ["sudo reboot", "extinction"],
    ["systemctl poweroff", "extinction"],
    ["poweroff", "extinction"],
    // ── droits en masse ──
    ["chmod -R 777 .", "droits_masse"],
    ["chown -R root:root /home/dev/projet", "droits_masse"],
    ["icacls C:\\data /grant Everyone:F /t", "droits_masse"],
    // ── git : envoi forcé / historique ──
    ["git push --force origin main", "git_push_force"],
    ["git push -f", "git_push_force"],
    ["git push --force-with-lease origin main", "git_push_force"],
    ["git -C /home/dev/projet push --force", "git_push_force"],
    ["git reset --hard origin/main", "git_historique"],
    ["git clean -fd", "git_historique"],
    ["git filter-branch --force -- --all", "git_historique"],
    ["git branch -D vieille-branche", "git_historique"],
    ["git stash clear", "git_historique"],
    // ── hors du projet ──
    ["cp rapport.md /home/dev/autre-projet/rapport.md", "hors_projet"],
    ["echo bonjour > /etc/hosts", "hors_projet"],
    ["rm /home/dev/autre-projet/fichier.txt", "hors_projet"],
    ["del C:\\Windows\\System32\\drivers\\etc\\hosts", "hors_projet"],
  ];

  for (const [command, family] of CASES) {
    it(`« ${command} » → ${family}`, () => {
      const finding = analyze(command);
      expect(finding.dangerous, `« ${command} » doit être reconnue`).toBe(true);
      expect(finding.family).toBe(family);
      expect(finding.label).toBe(DESTRUCTIVE_FAMILIES[family].label);
      expect(finding.command).toBe(command);
    });
  }

  it("la famille la PLUS grave est annoncée quand plusieurs se reconnaissent", () => {
    // Suppression récursive ET écriture hors projet : c'est la suppression
    // récursive qui est annoncée (elle est plus grave que « hors projet »).
    const finding = analyze("rm -rf /home/dev/autre-projet");
    expect(finding.family).toBe("suppression_recursive");
    // Un disque l'emporte sur tout le reste.
    expect(analyze("dd if=/dev/zero of=/dev/sda && rm -rf build").family).toBe("disque");
  });

  it("une commande destructrice est vue DANS un enchaînement", () => {
    for (const command of [
      "npm run build && rm -rf dist",
      "git add -A ; git push --force",
      "echo ok | sudo tee /etc/motd",
      "cd build && rm -rf *",
    ]) {
      expect(analyze(command).dangerous, command).toBe(true);
    }
  });

  it("chaque famille a un libellé, une raison et une conséquence en français", () => {
    for (const [id, family] of Object.entries(DESTRUCTIVE_FAMILIES)) {
      expect(family.label, id).toBeTruthy();
      expect(family.why.length, id).toBeGreaterThan(30);
      expect(family.consequence.length, id).toBeGreaterThan(20);
      // Simple français : aucune identité machine, aucun jargon de sentinelle.
      expect(family.label + family.why + family.consequence).not.toContain("PILOT_");
    }
    expect(Object.keys(DESTRUCTIVE_FAMILIES).sort()).toEqual([...FAMILY_PRIORITY].sort());
  });
});

describe("2. le quotidien passe normalement (le garde-fou reste UTILE)", () => {
  const ORDINARY = [
    "npm test",
    "npm run build",
    "npm install",
    "git status",
    "git diff HEAD",
    "git log --oneline -20",
    "git add -A && git commit -m \"rm -rf n'est pas lancé ici\"",
    "git push origin main",
    "ls -la",
    "cat package.json",
    "rg \"rm -rf\" src",
    "grep -rn chmod src/js",
    "mkdir -p src/js/tests",
    "touch notes.md",
    "cp src/a.js src/b.js",
    "mv build/old.js build/old2.js",
    "echo bonjour > resultat.txt",
    "echo erreur 2> journal.txt",
    "node scripts/build.js",
    "python -m pytest",
    "cargo test --workspace",
    "chmod 644 README.md",
    "find . -name \"*.tmp\"",
    "du -sh node_modules",
    "kill 1234",
    "/dev/null",
    "cat fichier 2>&1",
    "echo test > /tmp/pilot-essai.txt",
    "",
  ];

  for (const command of ORDINARY) {
    it(`« ${command} » n'est pas signalée`, () => {
      const finding = analyze(command);
      expect(finding.dangerous, `« ${command} » ne doit PAS être signalée`).toBe(false);
      expect(finding.family).toBe("");
      expect(finding.label).toBe("");
    });
  }

  it("une commande de la MÊME famille sans danger reste libre (chmod non récursif)", () => {
    expect(analyze("chmod +x scripts/run.sh").dangerous).toBe(false);
  });

  it("une redirection dans le dossier courant reste libre", () => {
    expect(analyze("cat data.json > backup.json").dangerous).toBe(false);
  });

  it("écrire dans un dossier temporaire reste libre", () => {
    expect(analyze("echo x > /tmp/a.txt").dangerous).toBe(false);
    expect(analyze("echo x > /dev/null").dangerous).toBe(false);
  });

  it("la comparaison de chemins respecte la FRONTIÈRE de dossier", () => {
    // Le piège classique : `/a/bc` ne doit pas passer pour « sous /a/b ».
    expect(isPathUnderRoot("/a/b/c", "/a/b")).toBe(true);
    expect(isPathUnderRoot("/a/bc", "/a/b")).toBe(false);
    expect(isPathUnderRoot("/a/b", "/a/b")).toBe(true);
    expect(isPathUnderRoot("C:\\Projet\\src\\a.js", "c:/projet")).toBe(true);
    expect(isPathUnderRoot("/autre", "/a/b")).toBe(false);
    expect(normalizePathForCompare("C:\\Projet\\")).toBe("c:/projet");
    expect(writesOutsideProject("resultat.json", PROJECT)).toBe(false);
    expect(writesOutsideProject("/home/dev/projet/x/y.txt", PROJECT)).toBe(false);
    expect(writesOutsideProject("/home/dev/autre/x.txt", PROJECT)).toBe(true);
  });

  it("sans racine de projet connue, seuls les emplacements SYSTÈME sont signalés", () => {
    // Aucune racine : on ne peut pas dire « hors projet » d'un simple chemin
    // absolu, donc on ne signale que le système (aucun faux positif massif).
    expect(analyzeDestructiveCommand("rm /home/dev/x.txt").dangerous).toBe(false);
    expect(analyzeDestructiveCommand("echo x > /etc/hosts").dangerous).toBe(true);
    expect(analyzeDestructiveCommand("cp a /usr/local/bin/tool").dangerous).toBe(true);
  });
});

describe("3. le message dit la commande, le danger et la conséquence", () => {
  it("le corps du dialogue porte les trois informations, en français simple", () => {
    const finding = analyze("rm -rf /home/dev/projet");
    const message = destructiveCommandMessage(finding);
    expect(message).toContain("rm -rf /home/dev/projet");
    expect(message).toContain("Pourquoi c'est dangereux");
    expect(message).toContain(finding.why);
    expect(message).toContain("Si vous acceptez");
    expect(message).toContain(finding.consequence);
    // Ce qui se passe en cas de refus est dit aussi (l'utilisateur sait qu'il
    // ne casse rien en refusant).
    expect(message).toContain("n'est pas lancée");
    // Aucun identifiant machine dans le texte affiché.
    expect(message).not.toContain("PILOT_");
    expect(message).not.toContain("{");
  });

  it("le titre nomme la famille reconnue", () => {
    expect(destructiveGateTitle(analyze("git push --force"))).toBe(
      "Commande dangereuse : envoi forcé qui écrase un dépôt",
    );
  });

  it("le refus est explicite et interdit de contourner", () => {
    const refusal = destructiveGateRefusal(analyze("rm -rf /"));
    expect(refusal).toContain("REFUSÉE");
    expect(refusal).toContain("NON exécutée");
    expect(refusal).toContain("rm -rf /");
    expect(refusal).toContain("N'essaie pas de la relancer");
    expect(refusal).not.toContain("PILOT_");
  });
});

describe("4. la sentinelle de la porte (jamais affichée brute)", () => {
  it("aller-retour complet : message → charge utile → textes", () => {
    const finding = analyze("mkfs.ext4 /dev/sdb1");
    const message = destructiveGateSentinelMessage(finding, "bash");
    expect(message.startsWith(BASH_GATE_SENTINEL)).toBe(true);
    expect(isDestructiveGateMessage(message)).toBe(true);

    const parsed = parseDestructiveGateMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed.tool).toBe("bash");
    expect(parsed.family).toBe("formatage");
    expect(parsed.command).toBe("mkfs.ext4 /dev/sdb1");
    // `title` porte le TEXTE LISIBLE COMPLET : un chemin d'affichage générique
    // montre donc une phrase française, jamais un identifiant machine.
    expect(parsed.title).toContain("mkfs.ext4 /dev/sdb1");
    expect(parsed.title).toContain("Pourquoi c'est dangereux");
    expect(destructiveCommandMessage(parsed)).toBe(parsed.title);
  });

  it("une charge utile illisible rend null (l'appelant refuse, il n'autorise pas)", () => {
    expect(parseDestructiveGateMessage(`${BASH_GATE_SENTINEL}{oups`)).toBeNull();
    expect(parseDestructiveGateMessage(`${BASH_GATE_SENTINEL}[1,2]`)).toBeNull();
    expect(parseDestructiveGateMessage("PILOT_EDIT_GATE::{}")).toBeNull();
    expect(parseDestructiveGateMessage("rm -rf /")).toBeNull();
  });

  it("la charge utile ne transporte que des champs bornés", () => {
    const payload = destructiveGatePayload(analyze("shutdown -h now"), "shell");
    expect(Object.keys(payload).sort()).toEqual(
      ["command", "consequence", "family", "label", "title", "tool", "why"].sort(),
    );
  });
});

describe("5. quels outils sont concernés (et lesquels ne le sont pas)", () => {
  it("`bash` et `shell` sont couverts, quelle que soit la clé de la commande", () => {
    expect(SHELL_TOOL_NAMES).toEqual(["bash", "shell"]);
    for (const key of SHELL_COMMAND_KEYS) {
      const plan = planShellToolCall("bash", { [key]: "rm -rf /" }, PROJECT);
      expect(plan.gated, `clé ${key}`).toBe(true);
      expect(plan.finding.family).toBe("disque");
    }
  });

  it("les autres outils ne sont PAS filtrés ici (la porte pré-écriture fait ce travail)", () => {
    for (const tool of ["write", "edit", "read", "grep", "webfetch"]) {
      expect(planShellToolCall(tool, { content: "rm -rf /" }, PROJECT).gated).toBe(false);
    }
  });

  it("une commande vide ou absente n'ouvre aucun dialogue", () => {
    expect(planShellToolCall("bash", {}, PROJECT).gated).toBe(false);
    expect(planShellToolCall("bash", { command: "   " }, PROJECT).gated).toBe(false);
    expect(planShellToolCall("bash", null, PROJECT).gated).toBe(false);
    expect(planShellToolCall(undefined, { command: "rm -rf /" }, PROJECT).gated).toBe(false);
  });

  it("une commande ordinaire ne demande rien", () => {
    const plan = planShellToolCall("bash", { command: "npm test" }, PROJECT);
    expect(plan.gated).toBe(false);
    expect(plan.finding.dangerous).toBe(false);
  });
});

describe("6. indépendance du modèle et de la configuration", () => {
  const SOURCE = readFileSync(resolve(HERE, "destructive-command.js"), "utf8");

  it("le module n'importe RIEN (contrat d'import de l'extension)", () => {
    // Il est écrit À CÔTÉ de `pilot-bash-guard.ts`, qui l'importe par
    // `./destructive-command.js` : une dépendance casserait cet import et
    // l'agent perdrait son garde-fou en silence.
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
    expect(SOURCE).not.toMatch(/\brequire\(/);
  });

  it("la décision ne lit ni modèle, ni fournisseur, ni réglage d'autonomie", () => {
    for (const forbidden of [
      "confirm_file_edits",
      "orchestration",
      "autonomous",
      "provider",
      "model",
      "invoke(",
      "document.",
      "window.",
    ]) {
      expect(SOURCE.includes(forbidden), `« ${forbidden} » ne doit pas entrer dans la décision`).toBe(false);
    }
  });

  it("la même commande donne la même réponse quel que soit l'appelant", () => {
    const first = analyze("git push --force");
    const second = analyze("git push --force");
    expect(second).toEqual(first);
  });
});
