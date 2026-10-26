# Rapport — « un seul geste installe le moteur et les voix » + repli annoncé

> Date : 2026-08 (session de vérification)
> Base : `f30c878 feat(voix locale) : un seul geste installe le moteur et les deux voix françaises`
> (+ `4dffca3 fix(lecture): annoncer le repli de voix là où l'on écoute`)

## 1. Ce que demandait la tâche

- **A.** Un **seul geste** installe (1) le **moteur** Piper avec tout ce qu'il
  lui faut pour tourner (binaire, DLL, dossier `espeak-ng-data`) et (2) les
  **deux voix moyennes** (`siwis-medium` femme par défaut, `tom-medium` homme).
- **B.** Le **repli sur la voix du système** est **annoncé visiblement là où
  l'utilisateur écoute** (pas seulement dans une section fermée des Options) et
  reste **journalisé**.

## 2. État trouvé sur le disque (vérifié, pas supposé)

L'essentiel était déjà **écrit et committé** par `f30c878`. J'ai donc vérifié
chaque exigence une par une, puis j'ai cherché ce qui **manquait encore**.

**Chiffres recomptés par moi-même** (consigne : ne figer aucune taille sans la
recompter ; l'audit `RAPPORT-etat-voix-locales.md` a été confronté au disque et
au réseau) :

| Objet | Mesure | Comment |
|---|---|---|
| `piper_windows_amd64.zip` | **22 477 236 o** | téléchargé, sha256 `f3c58906…11efcea` |
| Archive décompressée | **38 846 222 o**, **363 entrées**, toutes sous `piper/` | `unzip -l` + somme |
| Contenu attendu présent | `piper.exe`, `espeak-ng.dll`, `onnxruntime.dll`, `piper_phonemize.dll`, `espeak-ng-data/` | inspection de l'archive |
| `fr_FR-siwis-medium.onnx` | **63 201 294 o** (+ config **4 875 o**) | API HuggingFace + fichier local |
| `fr_FR-tom-medium.onnx` | **63 511 038 o** (+ config **4 959 o**) | API HuggingFace + fichier local |
| Total du geste | **149 199 402 o** téléchargés (≈ 142 Mio), ≈ 165 Mio installés | somme |

**Aucun écart avec l'audit** : ses chiffres correspondent au disque et au
réseau. Rien à signaler de ce côté.

**Reprise (`Range`) réellement possible** : requête `Range: bytes=0-99` sur
l'archive moteur → **`206`** avec un préfixe identique ; idem sur les modèles via
le CDN HuggingFace. La reprise n'est donc pas une intention, elle est servie.

## 3. Vérification exigence par exigence (état `f30c878`)

| Exigence | Où | Verdict |
|---|---|---|
| Geste **unique** (moteur + 2 voix) | `tts_local_download.rs` `plan_bundle` + `BUNDLE_MODELS` | ✅ |
| URL **exactes et stables** | URL des releases Piper 2023.11.14-2 + dépôt `rhasspy/piper-voices` | ✅ (joignables, tailles exactes) |
| **Un seul fichier / un seul téléchargement** à la fois | garde atomique `DOWNLOADING` + boucle séquentielle | ✅ |
| `.part` puis **renommage** une fois complet | écriture `.part`, renommage final | ✅ |
| **Reprise** sans rien supprimer | `Range: bytes=<déjà reçu>` | ✅ (serveurs répondent 206) |
| **Taille comparée** après téléchargement | `received != expected` → échec, jamais « installé » | ✅ |
| Progression **octets + %** à l'écran | évènement `tts-local-download-progress` (`step_*`, `bytes`, `percent`) | ✅ |
| État **relisible à tout moment** | `tts_local_download_state` (enregistrée dans `lib.rs`) | ✅ |
| **Arrêt** qui n'efface **rien** | `tts_local_cancel_download` : aucun `remove_file` | ✅ |
| **Aucun téléchargement sans geste** | ni au démarrage, ni à l'ouverture des Options, ni à la lecture | ✅ |
| **Aucun appel réseau à la lecture** | synthèse 100 % locale | ✅ |
| Moteur **jamais fourni** (le défaut d'origine) | étape `ENGINE_STEP` décompressée dans `voix-locale/piper/`, `piper.exe` vérifié | ✅ **corrigé** |
| **Windows d'abord**, ailleurs message clair | `engine_install_supported()` = `cfg!(windows)` ; ailleurs : aucune étape, aucune erreur, repli système | ✅ |
| Repli **annoncé là où l'on écoute** | `readAloudFallbackNotice(cause)` → `span.agent-read-notice` dans la rangée du bouton 🔊 | ✅ (`4dffca3`) |
| Repli **journalisé** | `logLocalVoice()` → `voix-locale.log` | ✅ |

## 4. Le défaut que j'ai trouvé **et corrigé** dans cette session

Le geste unique n'installait que `BUNDLE_MODELS` : le modèle **réellement
demandé** n'était plus lu. Conséquence : choisir `fr_FR-gilles-low` ou
`fr_FR-siwis-low` (voix hors paquet) téléchargeait le moteur et les deux voix
moyennes, **mais jamais la voix choisie** — elle restait manquante pour
toujours, l'écran affichant un avertissement au lieu de la voix demandée. C'était
une **régression du téléchargement par voix** qui existait avant le geste unique.

Correction : `install_order(requested)` (`tts_local_download.rs`) —
**le paquet d'abord** (moteur → femme → homme), **puis la voix demandée** si elle
n'en fait pas partie, **sans doublon** (une voix inconnue retombe sur la voix par
défaut, sans être ajoutée deux fois). `download_bundle` transmet désormais
`Some(model)`.

Tests ajoutés qui **échouent** si cette règle disparaît :
- Rust `la_voix_choisie_hors_du_paquet_est_installee_aussi` (ordre exact, dernier
  rang = voix choisie, aucun doublon) ;
- JS `la voix réellement choisie est transmise au plan` (`catalogue-voix-locales.test.js`).

## 5. Le test « le moteur n'est plus proposé » (cœur du défaut)

Déjà présent, et **prouvé qu'il mord** — deux mutations faites puis annulées :

1. condition de l'étape moteur neutralisée (`if false && …`) → le test Rust
   `le_plan_installe_le_moteur_puis_la_femme_puis_l_homme` **échoue**
   (`["siwis-medium","tom-medium"]` au lieu de `["engine","siwis-medium","tom-medium"]`) ;
2. bloc de l'étape moteur **supprimé** → `catalogue-voix-locales.test.js`
   **échoue** (2 assertions : `!tts_local::piper_exe(engine_root` absent, étape
   moteur introuvable).

Le fichier Rust mutilé a été **restauré** (`git diff` ne montre que mes ajouts
voulus).

## 6. Documentation mise à jour

- `spec_read_aloud.md` § 4.4 : règle `install_order` (voix choisie hors paquet
  installée aussi, sans doublon).
- `help/overview.md` (bloc `HELP:lire-reponses`) : le libellé périmé
  « Télécharger le modèle » devient **« Installer la voix locale »**, et la
  phrase dit que **c'est la voix choisie qui est installée** en plus du paquet.
- `help/handbook.md` **régénéré** : `npm run build:handbook` (45 blocs,
  276 595 octets).
- `AGENTS.md` : **aucun changement** (pas de nouveau module, pas de nouveau
  fichier de code — la correction vit dans un fichier déjà décrit).

## 7. Tests

| Commande | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib tts_local` | **24 passed**, 0 failed |
| `npx vitest run` (8 fichiers voix) | **121 passed**, 0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (complet) | voir § 8 |
| `npm test` (complet) | voir § 8 |

## 8. Résultats des suites complètes

```
cargo test --manifest-path src-tauri/Cargo.toml --lib
  → 786 passed, 0 failed, 1 ignored (27,16 s)

npm test
  → Test Files  193 passed (193)
     Tests      3380 passed (3380)
```

(Les tallies exactes sont celles des deux commandes lancées juste après ce
rapport ; aucune régression : les seuls fichiers touchés sont
`tts_local_download.rs`, `catalogue-voix-locales.test.js`, la spec et l'aide.)

## 9. Ce qui n'est **pas** vérifié ici (honnêteté)

- **Aucun son n'a été écouté** : je n'ai pas lancé `piper.exe` sur un vrai texte,
  donc la qualité audio des deux voix moyennes n'est pas constatée par moi (elle
  l'est par la spec, source unique du catalogue).
- **Aucun téléchargement réel bout en bout depuis l'écran** n'a été exécuté dans
  cette session (le réseau a servi à vérifier URL, tailles et support `Range`,
  pas à dérouler l'IHM) : le chemin est couvert par les tests du plan, de la
  reprise, de la taille et de l'extraction, pas par un clic humain.
- L'écart **macOS/Linux** n'est vérifié que par le code (`cfg!(windows)`), pas
  exécuté sur ces systèmes.

## 10. Reste ouvert (hors périmètre de cette tâche)

- Purger les nombreux `RAPPORT-*.md` non suivis à la racine (travail antérieur,
  non touché ici).

VERDICT : **Le défaut d'origine est corrigé et tenu par des tests qui échouent
si le moteur cesse d'être proposé ; le geste unique installe bien le moteur et
les deux voix moyennes (149 199 402 o recomptés), le repli est annoncé là où
l'on écoute et journalisé, et la régression « voix choisie hors paquet jamais
téléchargée » que j'ai trouvée est corrigée avec ses tests — suites Rust et JS
vertes.**
