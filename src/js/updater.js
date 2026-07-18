// updater.js — Vérification automatique des mises à jour (Tauri v2 updater plugin)
//
// Au démarrage de Pilot, on interroge l'endpoint configuré dans
// tauri.conf.json (plugins.updater.endpoints). Si une mise à jour est
// disponible, on affiche une notification toast proposant de la télécharger
// et de l'installer. L'installation relance l'application automatiquement.
//
// L'utilisateur peut aussi déclencher une vérification manuelle via la
// commande « check-update » de la palette (voir main.js).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toastInfo, toastSuccess, toastError } from "./toast.js";

let _checking = false;

/**
 * Vérifie les mises à jour et installe si demandé.
 * @param {boolean} silent — si true, n'affiche rien quand aucune MAJ n'est disponible
 * @returns {Promise<void>}
 */
export async function checkForUpdate(silent = true) {
  if (_checking) return;
  _checking = true;
  try {
    const update = await check();
    if (update?.available) {
      toastInfo(
        `Mise à jour disponible : v${update.version}. Téléchargement…`,
        8000
      );
      try {
        let contentLength = 0;
        let downloaded = 0;
        // downloadAndInstall accepte des callbacks d'avancement (Tauri v2).
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength ?? 0;
              break;
            case "Progress":
              downloaded += event.data.chunkLength ?? 0;
              break;
            case "Finished":
              break;
          }
        });
        toastSuccess("Mise à jour téléchargée. Redémarrage…", 5000);
        await relaunch();
      } catch (e) {
        console.error("Erreur installation MAJ:", e);
        toastError("Échec de l'installation de la mise à jour.");
      }
    } else if (!silent) {
      toastInfo("Pilot est à jour.", 4000);
    }
  } catch (e) {
    console.error("Erreur vérification MAJ:", e);
    if (!silent) {
      toastError("Impossible de vérifier les mises à jour.");
    }
  } finally {
    _checking = false;
  }
}

/**
 * Initialise la vérification automatique au démarrage.
 * Attend quelques secondes pour ne pas bloquer le démarrage de l'app.
 */
export function initUpdater() {
  // Vérification différée (10s) pour ne pas ralentir le démarrage.
  setTimeout(() => {
    checkForUpdate(true).catch(() => {});
  }, 10000);
}