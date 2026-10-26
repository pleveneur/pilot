# Tests Rust sous Linux — pourquoi la release 0.6.0 n'a rien produit

> Diagnostic **reproduit**, pas deviné : la suite Rust a été relancée dans un
> conteneur `ubuntu:22.04` avec les mêmes paquets que le workflow.
> Un seul test échouait, toujours le même, sur Linux **et** sur macOS
> (les deux plateformes où Pilot ne fournit pas le moteur de voix locale).

---

## 1. La sortie brute du test en échec (Ubuntu 22.04, conteneur)

```
---- tts_local::tests::dossier_vide_moteur_non_installe_et_le_dit stdout ----

thread 'tts_local::tests::dossier_vide_moteur_non_installe_et_le_dit' (22050) panicked at src-tauri/src/tts_local.rs:829:9:
assertion failed: status.hint.contains("sur votre demande")


failures:
    tts_local::tests::dossier_vide_moteur_non_installe_et_le_dit

test result: FAILED. 782 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 11.57s
```

C'est exactement la signature du run 40348321897 : étape « Run Rust unit tests »,
code de sortie **101**, échec immédiat (le reste de la suite est vert).

---

## 2. La cause

Le test `dossier_vide_moteur_non_installe_et_le_dit` vérifiait, sur un dossier de
données **vide** (moteur absent + les deux voix absentes), la phrase affichée à
l'utilisateur. Il affirmait :

```rust
assert!(status.hint.contains("Installer la voix locale"));
assert!(status.hint.contains("sur votre demande"));
```

Or `tts_local::missing_hint` a **trois** branches, et le choix dépend de la
plateforme (`engine_install_supported()` → vrai uniquement sous Windows) :

| Situation | Branche | Texte |
|---|---|---|
| moteur absent, plateforme équipable (Windows) | 2ᵉ | « Cliquez sur « Installer la voix locale » … **sur votre demande** … » |
| moteur absent, plateforme non équipable (macOS, Linux) | 1ʳᵉ | « Pilot **ne fournit pas le moteur** de lecture pour ce système … cliquez sur « **Vérifier à nouveau** » … » |
| seul un modèle manque | 3ᵉ | « Cliquez sur « Télécharger » … sur votre demande … » |

Sous Unix, `missing_hint` prend la **1ʳᵉ** branche : elle nomme bien
« Installer la voix locale » (pour les voix) mais ne contient **pas**
« sur votre demande ». L'assertion était donc **vraie par accident sous Windows
seulement** : elle décrivait un comportement de plateforme, pas le contrat
commun.

Ce n'était pas le code de production qui était fautif : la branche Unix est
correcte et volontaire (Pilot ne fournit pas de binaire Piper sur macOS/Linux,
il le dit et donne le dossier où déposer le moteur). C'était **le test qui était
malhonnête** — il promettait une installation que Pilot ne sait pas faire hors
Windows. Le test voisin
`le_moteur_n_est_propose_au_telechargement_que_la_ou_pilot_sait_l_installer`
faisait déjà ce distinguo : c'est le modèle appliqué.

---

## 3. La correction

`src-tauri/src/tts_local.rs`, dans le module `tests` (test corrigé, **aucune**
ligne de production touchée, **aucun** `#[ignore]` ajouté) :

```rust
        assert!(status.hint.contains("Installer la voix locale"));
        // Le MOTEUR, lui, ne se télécharge que là où Pilot sait l'installer
        // (Windows). Ailleurs (macOS, Linux), la phrase doit dire la limite et
        // le geste qui reste à faire — jamais promettre une installation que
        // Pilot ne sait pas faire.
        if engine_install_supported() {
            assert!(
                status.hint.contains("sur votre demande"),
                "le téléchargement doit être dit « sur votre demande » : {}",
                status.hint
            );
        } else {
            assert!(
                status.hint.contains("ne fournit pas le moteur"),
                "la limite de la plateforme doit être dite : {}",
                status.hint
            );
            assert!(
                status.hint.contains(&piper_dir(&root).display().to_string()),
                "le dossier attendu du moteur doit être donné : {}",
                status.hint
            );
            assert!(
                status.hint.contains("Vérifier à nouveau"),
                "le geste à faire doit être nommé : {}",
                status.hint
            );
        }
```

La vérification n'est **pas affaiblie** : chaque plateforme exige désormais
trois assertions (au lieu d'une seule sous Windows, et d'une assertion
infalsifiable ailleurs). Rien n'est tu, rien n'est ignoré.

---

## 4. Comptes après correction — les deux plateformes

| Plateforme | Commande | Résultat |
|---|---|---|
| **Windows** (poste, Rust stable) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | `786 passed, 0 failed, 1 ignored` |
| **Ubuntu 22.04** (conteneur, même paquets que le workflow) | idem, dans `/work` | `ok. 783 passed; 0 failed; 1 ignored` — code de sortie **0** |

L'écart de 3 tests entre les deux comptes est normal : trois tests sont réservés
à Windows (`#[cfg(windows)]`).

Avant correction, côté Ubuntu : `FAILED. 782 passed; 1 failed; 1 ignored`
(code de sortie 101) — puis 783 réussis une fois le test corrigé.

---

## 5. Refaire la vérification (commande exacte)

```bash
# 1. Le bundle MCP est embarqué par include_str! : sans lui, pas de compilation.
npm run build:mcp

# 2. Conteneur Ubuntu 22.04 identique au workflow (une seule fois)
docker run -d --name pilot-linux-test ubuntu:22.04 sleep infinity
docker exec pilot-linux-test bash -c '
  apt-get update -y &&
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential curl git pkg-config libssl-dev libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf'
docker exec pilot-linux-test bash -c \
  'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal'

# 3. Node 24 (le workflow l'installe : actions/setup-node@v7, node-version 24)
docker exec pilot-linux-test bash -c 'cd /tmp &&
  curl -fsSLO https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz &&
  tar -xJf node-v24.22.1-linux-x64.tar.xz -C /usr/local --strip-components=1'

# 4. Copier les sources DANS le conteneur (jamais compiler sur le montage Windows)
tar -czf /tmp/pilot-src.tgz --exclude=./target --exclude=./node_modules \
    --exclude=./.git --exclude=./dist --exclude=./.pilot .
docker cp /tmp/pilot-src.tgz pilot-linux-test:/tmp/pilot-src.tgz
docker exec pilot-linux-test bash -c 'mkdir -p /work && tar -xzf /tmp/pilot-src.tgz -C /work'

# 5. Les tests, exactement comme le workflow
docker exec pilot-linux-test bash -c 'cd /work &&
  export PATH=/root/.cargo/bin:/usr/local/bin:$PATH &&
  cargo test --manifest-path src-tauri/Cargo.toml --lib'
```

Attendu : `ok. 783 passed; 0 failed; 1 ignored` et un code de sortie 0.
La première compilation prend ~10 minutes ; les suivantes ~15 secondes.

### Pièges rencontrés pendant la reproduction (à connaître)

- **Sans `npm run build:mcp`, la compilation échoue** (`pilot-mcp-client.ts`
  introuvable, fichier volontairement exclu du dépôt).
- **Sans `node` (ou avec un node trop ancien)**, cinq tests tombent pour des
  raisons d'environnement, pas de code : les 3 `mcp_config::tests::stdio_*`
  (`Impossible de lancer …: No such file or directory (os error 2)`) et les 2
  `laya*::tests::real_*` (les faux services `.mjs` utilisent un `await` de
  premier niveau, refusé par Node 12 du dépôt Ubuntu). Avec Node 24 — la version
  du workflow — ces cinq tests passent, et **seul** le test ci-dessus échoue.
- Ne pas compiler sur le montage Windows : la lenteur des I/O fausse le
  diagnostic (un job « rapide » côté GitHub ne l'est pas sur un bind mount).

---

## 6. Conclusion

La release 0.6.0 est bloquée par **un seul test mal écrit**, pas par une
régression du produit. Le test est corrigé, la suite est verte sous Windows
**et** sous Ubuntu 22.04. Un nouveau tag (0.6.1) produira les installateurs et
`latest.json`.
