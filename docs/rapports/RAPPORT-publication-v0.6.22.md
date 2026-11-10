# Rapport de publication — Pilot v0.6.22

Date : 2026-11-19 · Rédigé par le publieur (agent du registre).
Accord de publication : **explicite du propriétaire pour cette version**, donné
avant le début du travail (décision ferme : publier dès que tout est terminé et
vérifié, sans attendre son test).
Portée demandée pour cette exécution : **locale seulement** — commit et
étiquette sur la machine, **aucun envoi vers GitHub, aucune release, aucune pull
request**. Ce rapport ne dit donc jamais « publié » au sens d'une mise à
disposition : rien n'est parti vers l'extérieur.

## 1. État du dépôt avant publication

- Branche : `main`.
- Dernier commit avant bump : `137e114` — « registre des comportements validés
  + garde-fou qui refuse une ligne sans test » (conforme au commit attendu).
- Écart avec la dernière étiquette : **18 commits** depuis `v0.6.21`
  (`632dd36`, « chore: bump version to 0.6.21 »).
- Travail non commité au départ : **aucun fichier suivi modifié**. Onze
  documents non suivis étaient présents (`docs/rapports/rapport-*.md`), laissés
  en place — voir § 7.
- Version présente dans les quatre fichiers avant bump : `0.6.21` (aucune
  incohérence).
- GDS : `.pilot/gds.json` existe mais porte `"enabled": false` — le projet n'est
  **pas** basculé sur le GDS. La règle absolue « aucun envoi vers GitHub si le
  projet est sur le GDS » n'a donc pas eu à s'appliquer ; aucun envoi n'a été
  fait de toute façon.

## 2. Version retenue

**0.6.22** — incrément du dernier chiffre, conformément à la règle du projet
(correctifs = dernier chiffre), sans jamais reculer : la dernière étiquette est
`v0.6.21`, et `v0.6.22` n'existait pas (vérifié avant création). Le lot contient
aussi des ajouts, mais l'incrément reste celui du troisième chiffre, comme pour
toutes les versions précédentes de la série 0.6.x.

Quatre fichiers portent la version, tous alignés après modification :
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`Cargo.lock` (ciblé sur le paquet `pilot`, ligne 3335 — **une seule** occurrence
de `0.6.22` dans le verrou, vérifié).

## 3. Changelog utilisateur

Fichier : `release-notes/v0.6.22.md` (52 lignes, français simple, accents
compris). Contenu, en résumé :

**Nouvelles fonctionnalités**
- On parle librement sans redire le nom à chaque phrase : la garde du nom ne
  s'arme qu'après 20 secondes de silence ; chaque parole remet le compte à zéro.
- On peut demander l'arrêt de l'écoute à la voix ; l'écran cesse de se présenter
  comme à l'écoute, plus rien n'est lu, le nom réveille toujours.
- Un personnage peut discuter sans aucun outil (« Discussion seulement via
  llama », propre à chaque personnage), avec refus net et dit si le modèle local
  ne répond pas.

**Corrections**
- La barre de saisie respire encore quand le système demande de réduire les
  animations (plus doux, mais présent).
- L'ordre d'arrêt d'écoute arrête vraiment l'écoute : même état que la veille de
  20 s, micro non fermé, réveil par le nom possible, aucune lecture à voix haute.
- La veille de 20 s ne s'arme plus au milieu d'un travail long ni d'une lecture.
- L'exemple des mots de réveil affiché dans les Paramètres est exact.

**Améliorations**
- Le lancement du mode développement ne bute plus sur le dossier de compilation
  ni sur la préparation du service de voix locale.
- Le projet tient la liste des comportements validés, avec pour chacun le
  contrôle automatique qui le protège.

## 4. Contrôles exécutés avant l'étiquette (chiffres recomptés, pas recopiés)

Les deux suites ont été lancées **deux fois** : une première fois sur l'arbre
reçu (`137e114`), une seconde fois sur l'arbre exact qui a été étiqueté
(c'est-à-dire après le bump de version et l'ajout du changelog). Les deux
passages donnent le même verdict.

| Contrôle | Commande | Résultat réel |
|---|---|---|
| Tests interface | `npx vitest run` | **PASS (5854) — FAIL (0)** (les deux passages) |
| Tests cœur (workspace Rust complet : desktop + socle + serveur) | `cargo test --workspace` | **1137 réussis, 14 ignorés, 0 échec** — 6 suites (12,69 s puis 12,33 s) |
| Fabrication du front | `npm run build` | **succès** (code de sortie 0, `dist/` produit ; seuls des avertissements de découpage de morceaux, présents avant) |
| Compilation en mode livraison | `cargo build --release -p pilot` | **succès** — `Finished release profile [optimized]` en 4 min 23 s, aucun avertissement autre que les 31 avertissements de code déjà présents |

Aucun test n'a été modifié, assoupli ni ignoré à la main.

Les **14 tests ignorés** sont des preuves `#[ignore]` qui exigent un service réel
(VoiceStudio local pour l'oreille et la voix imitée, base PostgreSQL pour le
socle GDS) : ils ne s'exécutent pas dans un passage automatique et restent hors
des chiffres ci-dessus. Ils ne sont pas comptés comme verts.

## 5. Étiquette et fichiers

- Commit du bump : **`17f4b86`** — « chore: bump version to 0.6.22 ».
- Étiquette : **`v0.6.22`** (annotée, message « Pilot v0.6.22 »), pointant sur
  `17f4b86` ; l'objet d'étiquette référence bien ce commit
  (`object 17f4b86ea8c1509187bdf644a679b3a845377ae4`). Créée **en local**.
- Fichiers du commit de version (5) : `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`,
  `release-notes/v0.6.22.md` — 56 insertions, 4 suppressions.
- Aucune poussée (`git push`) n'a été faite ; aucune release GitHub, aucune pull
  request n'a été créée. `origin/main` n'est pas configuré comme amont de la
  branche, et cela n'a pas été changé.

## 6. Ce que le propriétaire doit vérifier à la main

1. **L'envoi vers GitHub reste à décider.** L'étiquette `v0.6.22` existe
   seulement sur ce poste. Rien ne partira sans un geste explicite ; le jour où
   il enverra `main` puis `v0.6.22`, le workflow de release prendra
   `release-notes/v0.6.22.md` comme notes.
2. **Aucun installateur n'a été fabriqué.** Les contrôles couvrent les tests et
   la compilation (front + livraison Rust), pas l'assemblage Tauri ni la
   signature de mise à jour (clé privée absente de ce poste). C'est le devoir du
   propriétaire de lancer `npm run tauri build` s'il veut un installeur avant
   d'envoyer l'étiquette.
3. **Les 14 preuves ignorées n'ont pas tourné** : à rejouer à la main, avec le
   service VoiceStudio lancé et une base GDS joignable, si un doute subsiste sur
   l'oreille locale, la voix imitée ou le socle GDS.
4. **Le rendu à l'écran n'a pas été regardé** : la barre de saisie en mouvement
   réduit, l'état du rond en mode Vocal après « arrête d'écouter » et l'exemple
   des mots de réveil sont prouvés par des tests, pas par une observation à
   l'œil. Comme décidé, la publication n'a pas attendu ce test.

## 7. Points en suspens

- **Onze documents non suivis laissés en place**, volontairement non embarqués
  (ils ne m'appartiennent pas) : `docs/rapports/rapport-bip-fin-de-tour.md`,
  `rapport-correction1-stale-busy-tool-in-progress.md`,
  `rapport-correction1bis-tool-long-deux-chemins.md`,
  `rapport-correction2-abandon-file-trace.md`,
  `rapport-correction3-marqueurs-arrets-onglet-agent.md`,
  `rapport-correction4-controle-negatif-etendu.md`,
  `rapport-doc-supervision-agents.md`, `rapport-liste-agents-sans-onglet.md`,
  `rapport-publication-0.4.34.md`, `rapport-publication-0.4.35.md`,
  `rapport-test-mcp-linux.md`. À ranger ou supprimer par le propriétaire.
- **Conflit de consignes, tranché en faveur de la plus restrictive** : le
  protocole habituel du publieur prévoit une release GitHub ; la tâche de cette
  version interdit tout envoi vers l'extérieur. Aucun envoi n'a été fait. La
  « publication » s'arrête donc au commit et à l'étiquette locale.
- **Avertissements de compilation** : 31 avertissements de code (fonctions et
  méthodes jamais appelées, notamment dans `discussion_seule.rs`,
  `persona_fiche.rs`, `agent_service.rs`, `gds_sync.rs`). Sans effet sur les
  tests, ils datent du lot et n'ont pas été touchés ici — la publication
  n'ajoute ni ne retire aucun comportement.
- **Ce rapport lui-même** est committé après l'étiquette, comme les précédents
  rapports de publication : `v0.6.22` désigne le commit de version, pas celui du
  rapport.
