//! `gds-server` — binaire serveur GDS autonome (headless).
//!
//! Squelette créé en L1.2 : il fixe dès maintenant la frontière de compilation
//! (aucune dépendance Tauri). Le démarrage réel (lecture de l'environnement,
//! pool PostgreSQL, migrations, routeur HTTP `gds_core::http`) est implémenté
//! dans le lot L2, micro-tâche `L2.1`.

fn main() {
    println!("gds-server : squelette L1.2 — implémentation prévue en L2.1");
}
