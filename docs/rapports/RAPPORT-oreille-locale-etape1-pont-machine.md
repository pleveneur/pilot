# Rapport — Oreille locale, étape 1 : le pont machine

**Date** : 2026-11-04
**Demande du propriétaire** : « la dictée doit être transcrite sur l'ordinateur,
par le logiciel de voix local, au lieu d'envoyer mon son à Google ou Microsoft ».
**Périmètre de cette étape** : **le pont machine seulement**. Aucun écran, aucun
bouton, aucun réglage ne change ; la fenêtre n'est pas encore branchée dessus.

---

## 1. Ce qui est livré

Un module Rust **frère** de la voix imitée : `src-tauri/src/asr_voicestudio.rs`
(1 914 lignes, dont 21 tests unitaires + 2 preuves réelles `#[ignore]`).

| Élément | Détail |
|---|---|
| `asr_voicestudio_status()` | La dictée locale est-elle possible ? Sinon **pourquoi**, en **une phrase française** + un code stable : `disponible`, `service-absent`, `service-muet`, `aucun-modele-francais`, `modele-non-accepte`, `dictee-non-prete`. |
| `asr_voicestudio_start(model?)` | Ouvre **une** session de flux et rend `session_id`, le modèle **retenu**, `sample_rate` (16 000). Refus explicite sinon. |
| `asr_voicestudio_send(session_id, chunk)` | Reçoit un morceau de son (PCM 16 kHz mono 16 bits, ≤ `MAX_CHUNK_BYTES` = 0,5 s). **Ne bloque jamais.** |
| `asr_voicestudio_stop(session_id)` | Ferme proprement ; le service rend son **texte final**. |
| `asr_voicestudio_cancel(session_id)` | Interrompt **en pleine dictée** ; rien n'est gardé, rien n'est promis. Interrompre une session déjà finie n'est **pas** une erreur. |
| `asr_voicestudio_log(message)` | Journal texte (même fichier que la voix imitée, `voix-locale.log`). |

Un **seul** évènement vers la fenêtre, au nom stable `asr-voicestudio-transcript` :
`started` (moteur **réellement** retenu), `partial`, `final` (+ `final_kind`
`utterance`/`summary`), `error` (message français + code stable), `ended`.

**Une seule porte** : la fenêtre ne joint **jamais** le service (verrou test) ;
elle ne connaît que ces commandes — même dessin que la voix imitée.

---

## 2. Décisions tenues, et pourquoi

| Décision | Raison |
|---|---|
| **Le modèle français est IMPOSÉ** dans l'adresse (`?model=…`) | Sans cela le service prend **son** défaut, qui est le plus petit modèle. On n'hérite jamais d'un choix fait pour nous. |
| Préféré `sherpa-parakeet-tdt-v3`, sinon un autre modèle **installé** capable de français | Meilleur modèle européen du poste (25 langues). Les libellés réels du service sont reconnus (« french », « european », « multilingual », « 90+ », « 100+ »). |
| **Aucun téléchargement** | Un modèle absent est une **erreur dite**, jamais un téléchargement déclenché en douce. |
| **Aucune licence acceptée à la place de l'utilisateur** | Le service refuse un modèle installé dont la licence n'est pas acceptée. Le module **LIT** cet état (`GET /models/licenses/acceptance/<repo>`, jamais `POST`), écarte le modèle et **nomme la serrure** : « c'est à vous de l'accepter dans son catalogue des modèles ». Une licence **illisible** ne condamne jamais un modèle. |
| **Une seule dictée à la fois** | Ouvrir une session referme la précédente : deux micros ouverts = deux textes mélangés. |
| **Aucun fichier audio sur le disque** | Le son vit en mémoire ; le journal texte reçoit au plus une ligne. |
| **Aucun autre appel réseau** | Boucle locale uniquement, aucune clé, aucun secret ; l'adresse n'est pas recopiée (elle vient du frère `tts_voicestudio.rs`). |
| **`pub async fn` + `spawn_blocking`** | Règle du projet : aucune commande ne fige l'écran (`commandes-agent-non-bloquantes.test.js`). |
| **Deux dépendances ajoutées** | `tokio-tungstenite` (socket de flux, sans TLS : boucle locale) et `futures-util` (`split`/`SinkExt`). **Toutes deux étaient déjà dans `Cargo.lock`** (tirées par `axum`/`reqwest`) : aucun téléchargement nouveau de caisse. |

---

## 3. Preuves RÉELLES (mesurées, pas estimées)

Service : **VoiceStudio 0.5.7**, GPU **NVIDIA RTX 5080**, `cuda`.

### 3.1 Une phrase française transcrite par le service local

Phrase prononcée (fabriquée en son par le service, accents inclus) :
« Bonjour, ceci est un essai de dictée locale avec des accents : où, déjà, être,
ça, très, français. »

Résultat du second passage, tel quel :

| Mesure | Valeur |
|---|---|
| Son produit | 271 276 octets de WAV en **1 196 ms** |
| Son converti | 180 820 octets = **5 650 ms** de parole à 16 kHz |
| Modèle **réellement** utilisé | `sherpa-whisper-tiny` (Whisper Tiny) |
| Ouverture de session | **≈ 27 ms** après la sonde (1 223 − 1 196) |
| **Premier partiel** | **2 129 ms** (≈ 0,9 s après le premier morceau) — « Bonjour ! » |
| Partiels suivants | toutes les **~1 s** (3 121 / 4 236 / 5 336 / 6 514 / 7 735 ms) |
| **Texte final** | **9 513 ms** (`final_kind: summary`) |

Texte final obtenu :

> « Bonjour, ceci est un essaye de dicter local avec des accents, ou déjà être ça
> très français. »

**Ce qui est juste** : « Bonjour, ceci est un … de dicter local avec des accents,
ou déjà être ça très français. » — les **accents**, « où », « déjà », « ça »,
« très », « français » sont corrects ; la ponctuation est posée par le modèle.

**Erreurs observées, dites honnêtement** : *essaye* au lieu de « essai » ;
*dicter* au lieu de « dictée » (le mot suivant, « locale », a d'ailleurs disparu
au premier passage : « dixthélocal »). Ce n'est **pas** de la qualité humaine,
c'est un petit modèle ; le modèle européen supérieur (`sherpa-parakeet-tdt-v3`)
est installé mais **son service le refuse** (licence non acceptée — voir §4).

Le premier passage (même test) avait rendu : « Bonjour, ceci est un essaye de
dixthélocal avec des actions où déjà être sa très français. » — *actions* pour
« accents », *sa* pour « ça ». La reconnaissance varie d'un passage à l'autre sur
les mots rares ; les accents, eux, sont **tenus**.

### 3.2 Le service n'est pas là

**Testé, et voici comment, sans mentir** : je **n'ai pas tué** VoiceStudio (c'est
l'application du propriétaire, elle sert aussi à la voix imitée). La **même** voie
de connexion a été éprouvée vers un **port fermé** — donc un **vrai** refus de
connexion, pas une simulation :

| Mesure | Valeur |
|---|---|
| Constat de la panne | **2 061 ms** (sous le plafond de 5 s) |
| État rendu | `disponible = false`, `reason = service-absent` |
| Phrase rendue | « La transcription locale n'est pas disponible : le logiciel de voix (VoiceStudio) n'est pas ouvert. Vous pouvez dicter autrement, ou écrire. » |
| Ouverture de session | refusée en **une phrase** (« le logiciel de voix n'a pas ouvert de session »), **aucune exception**, **aucune attente** |

**Non testé** : l'arrêt **en pleine dictée** (service qui meurt au milieu d'une
phrase). Le chemin est couvert par les tests unitaires (erreur du service →
`error` en français, plus `final` jamais promis), mais **je ne l'ai pas provoqué
sur le service réel** — le dire autrement serait mentir.

---

## 4. Ce que le service a refusé, et comment c'est dit

| Modèle installé | Licence (lue par `GET`) | Conséquence |
|---|---|---|
| `sherpa-parakeet-tdt-v3` (préféré) | `required: true`, `accepted: false`, `state: not_accepted` | **refusé par le service AVANT chargement** → écarté, la raison est dite |
| `sherpa-whisper-tiny` | `accepted: true` | retenu |

Le module **n'accepte rien** : accepter une licence est un acte de l'utilisateur
dans VoiceStudio. Le refus n'est donc pas une panne muette : c'est une phrase qui
dit **quel** modèle et **où** l'accepter.

---

## 5. Tests — comptes réels

| Commande | Résultat réel |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib asr_voicestudio` | **21 passés, 0 échec, 2 ignorés** (les 2 preuves réelles), 862 filtrés |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (série complète) | **882 passés, 0 échec, 3 ignorés** (885 tests) |
| `npx vitest run src/js/oreille-locale-etape1.test.js` | **18 passés, 0 échec** |
| `npm test` (série complète) | **292 fichiers, 5 415 tests, 0 échec** |
| Preuves réelles rejouées | `cargo test … asr_voicestudio -- --ignored --nocapture` → **2 passés** (transcription française + port fermé) |

Le verrou `src/js/oreille-locale-etape1.test.js` tient les promesses de l'étape :
les 6 commandes sont branchées et `pub async fn`, le chemin de flux n'existe que
dans **un** fichier, la fenêtre **ne connaît aucun** chemin de dictée, l'adresse
du service n'est **pas recopiée**, aucun `std::fs`, aucun téléchargement, aucun
secret, le modèle français est bien imposé, et les pannes sont **dites en
français** (avec la phrase « l'écran n'est pas encore branché » présente dans le
module).

---

## 6. Ce qui n'est PAS fait (et ne doit pas être annoncé comme fait)

1. **Le son de la dictée part toujours vers Google/Microsoft.** L'écran n'est pas
   branché : l'étape 1 ne change **aucun** comportement visible. La spec
   (`spec_voice_input.md` § 9) et l'en-tête du module le disent noir sur blanc.
2. **Aucun partage du son du micro** vers la machine n'existe encore (l'étape 2
   devra envoyer les morceaux PCM par `asr_voicestudio_send`).
3. **Pas de réglage** ajouté : rien dans les Options, rien dans l'écran Vocal, la
   garde du nom et l'envoi automatique sont **intacts** (aucun de leurs fichiers
   n'a été touché).
4. **Pas de repli automatique** vers le navigateur : c'est l'appelant (étape 2)
   qui décidera, avec les phrases déjà fournies par ce module.
5. Le service est **une application séparée** : Pilot ne l'installe pas, ne le
   lance pas, ne le configure pas.

---

## 7. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/asr_voicestudio.rs` | **nouveau** — le pont machine (module + 21 tests + 2 preuves `#[ignore]`) |
| `src-tauri/src/lib.rs` | `mod` + `manage(AsrSessions)` + 6 commandes enregistrées |
| `src-tauri/Cargo.toml` | 2 dépendances (déjà présentes dans `Cargo.lock`) |
| `Cargo.lock` | verrouillage de ces 2 dépendances |
| `src/js/oreille-locale-etape1.test.js` | **nouveau** — 18 verrous de non-régression |
| `spec_voice_input.md` | § 9 (pont machine livré, écran pas branché) + en-tête |
| `AGENTS.md` | arborescence (`asr_voicestudio.rs`) + navigation |

**Non touchés** : `tts_voicestudio.rs`, `tts_local.rs`, tout `src/js` de l'écran
Vocal, la garde du nom (`fa7a8c3`), la lecture à voix haute, la voix imitée, les
réglages, les modèles et l'historique du service.

---

## 8. Étape suivante (proposée, pas commencée)

Brancher l'écran de dictée sur ces commandes : envoyer le son du micro déjà capté
par la fenêtre par morceaux, écrire les `partial` dans la zone, remplacer le texte
par le `final`, et **garder telles quelles** la garde du nom de l'écran Vocal et
l'envoi automatique de fin de dictée. Ne dire au propriétaire « le son ne part
plus » qu'**après** l'avoir constaté sur son poste.
