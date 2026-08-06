#!/usr/bin/env node
// tauri.js — Wrapper de la CLI Tauri (issue #25).
//
// Pour la sous-commande `dev`, ajoute `--config src-tauri/tauri.dev.conf.json`
// afin que la version dev utilise un identifiant d'application séparé
// (`com.pilot.editor.dev`) et puisse tourner en parallèle de la version
// installée (verrou single-instance distinct, app_data_dir distinct, port web
// décalé de +1). Les autres sous-commandes (`build`, `signer`, etc.) sont
// laissées inchangées.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const isDev = args[0] === "dev";
const tauriArgs = isDev
  ? ["dev", "--config", "src-tauri/tauri.dev.conf.json", ...args.slice(1)]
  : args;

const child = spawn("tauri", tauriArgs, { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
