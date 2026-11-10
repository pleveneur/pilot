# Rapport — la fin d'une session de dictée PÉRIMÉE ne réarme plus (coupure de la dictée locale)

Date : 2026-11-15 · Projet : `G:\IA_PL\pilot`
Demande du propriétaire : corriger **à la racine** « la dictée locale marche un
moment, puis elle coupe », en traitant les **trois causes** nommées par le
diagnostic (`docs/rapports/RAPPORT-diagnostic-coupure-dictee-locale.md`), avec
une preuve automatisée qui échoue sur chacune, au moins **trois mutations**
mesurées, les nombres **recomptés** par une exécution réelle, et un commit
**local** seulement.

---

## 1. Ce qui était cassé (rappel mesuré par le diagnostic)

Le diagnostic a établi les faits suivants sur le poste, journal du pont en main :
**11 dictées ouvertes et jamais fermées** en 2 min 30, des
« session précédente refermée » à répétition, puis la phrase d'échec
« La dictée n'a pas fonctionné : écrivez votre demande. ».

La cascade, dans l'ordre :

1. **Une fin d'écoute PÉRIMÉE remettait l'écran au repos.** `rec.onerror` et
   `rec.onend` faisaient `voiceActive = false; voiceRec = null;` sans regarder
   **de quelle session** venait l'évènement. Or le canal du pont est **global**
   (`asr-voicestudio-transcript`) : l'oreille d'une session remplacée recevait
   encore la fin de la session vivante, et la refermait à l'écran.
2. **Le réarmement en ouvrait une autre.** `startVoiceInput` ne voyait plus de
   dictée active (l'écran venait d'être remis au repos) et fabriquait une oreille
   neuve — donc une **session neuve** — **sans fermer la précédente**.
3. **Le pont refermait alors la session vivante**, parce que c'est sa règle
   (« une seule dictée à la fois : la précédente est refermée »,
   `src-tauri/src/asr_voicestudio.rs`, `slot.take()`), et **le texte déjà
   reconnu partait avec elle**.
4. Trois fins vides instantanées atteignaient le plafond
   (`VOCAL_EMPTY_SESSION_LIMIT = 3`), d'où la phrase d'échec.

**Le défaut était donc dans la fenêtre**, pas dans le service : c'est la fenêtre
qui ne savait pas **à qui** appartenait une fin, et qui ouvrait sans fermer.

---

## 2. Ce qui a été changé

### 2.1 Module nouveau — `src/js/session-dictee.js` (238 lignes, pur)

Aucun DOM, aucun import Tauri, aucune I/O : les trois décisions sont donc
**décidables en test**, conformément à la convention du projet.

| Décision | Ce qu'elle dit |
|---|---|
| **l'IDENTITÉ** | `createDictationSessionRegistry()` tient un jeton **monotone, jamais réutilisé, jamais 0**. `dictationSessionStillCurrent(registre, jeton)` ne répond `true` que pour la session **courante**. Registre absent ⇒ `false` (on ne touche à rien). |
| **l'ORDRE** | `startDictationSession(registre, { active, previous, stopPrevious })` ferme la session précédente par **son propre chemin d'arrêt** **AVANT** que le jeton n'avance. Une dictée déjà ouverte n'est **jamais** refermée par une tentative d'ouverture (idempotence : `DICTATION_ALREADY_OPEN`). |
| **le TEXTE** | `dictationTextStillAccepted(registre, jeton)` accepte le texte de la session **courante** *et* de la **seule** session qu'on vient de remplacer (son arrêt est asynchrone, ses mots ont déjà été prononcés — les refuser les effacerait). **Aucune session plus ancienne** (pas de chaîne), et **rien d'autre** n'est reçu d'elle : l'état reste sous la garde d'identité. |

Le registre expose aussi `derniereFermee()` (jeton de la session remplacée) et
`dictationEndLogLine({ raison, jeton, perimee, dureeMs, longueurTexte })` pour la
trace.

### 2.2 `src/js/super-agent.js` (+121 lignes, aucun comportement réécrit)

- `dicteeSessions = createDictationSessionRegistry()` (une par écran).
- `fermerOreilleDictee(rec)` : **une seule** façon de fermer une oreille —
  `stopVoiceInput()` si c'est l'oreille courante (le chemin du bouton 🎙️, de
  l'envoi et de la sortie du mode), sinon `rec.stop()`. **Jamais** un abandon,
  jamais `asr_voicestudio_cancel` (le texte final doit venir).
- `journaliserFinDictee(infos)` : `void invoke("asr_voicestudio_log", …)`,
  fail-open, **jamais** le texte reconnu (seulement sa longueur).
- `startVoiceInput` : l'ouverture passe par `startDictationSession(...)` ; le
  jeton de la session devient `dicteeJeton`, avec deux gardes dérivées :
  `dicteeCourante()` (état) et `dicteeTexteAccepte()` (texte).
- `rec.onresult` → `if (!dicteeTexteAccepte()) return;` (le texte).
- `rec.onerror` → `if (!dicteeCourante()) { journaliserFinDictee({ raison:
  "erreur-perimee", … }); return; }` (l'état).
- `rec.onend` → `if (!dicteeCourante()) { journaliserFinDictee({ raison:
  "fin-perimee", … }); return; }` (l'état), puis la trace normale de la fin
  (`raison` réelle, jeton, durée mesurée, longueur du texte).

### 2.3 `src/js/oreille-locale-moteur.js` (+8 lignes)

Le canal du pont étant **global**, l'oreille ignore désormais les évènements dont
le `session_id` n'est pas le sien :

```js
const origine = typeof p.session_id === "string" ? p.session_id : "";
if (origine && sessionId && origine !== sessionId) return;
```

Un évènement **sans** `session_id` reste accepté (contrat tolérant : on ne casse
pas un pont qui ne le donne pas).

### 2.4 Journal (déjà là, jusqu'ici appelé par personne)

`asr_voicestudio_log` existait (`src-tauri/src/asr_voicestudio.rs` +
`lib.rs`) et **aucun** appel de la fenêtre. Il est maintenant appelé à chaque fin
d'écoute, avec : raison (`erreur-perimee`, `fin-perimee`, `texte-vide`,
`inconnue`, ou la raison réelle du moteur), jeton de session, durée mesurée, et
longueur du texte. C'est exactement le trou de trace relevé par le diagnostic.
L'appel est `void` : il ne retarde **jamais** la fin d'écoute.

---

## 3. La preuve automatisée

`src/js/fin-de-session-perimee-ne-rearme-pas.test.js` — **11 verrous**, 5 groupes.
Le pont de test (`pontRealiste()`) applique la règle **réelle** d'`asr_voicestudio.rs` :
un `start` sur une session encore ouverte la referme lui-même (et jette son texte).
L'état par défaut est donc le pont **fautif** : le test ne peut passer que si la
fenêtre ferme avant d'ouvrir.

| § | Titre exact du test |
|---|---|
| 1 | la garde d'identité refuse tout jeton qui n'est pas celui de la session courante |
| 1 | le jeton ne se réutilise jamais : une session révolue ne redevient pas courante |
| 1 | le réarmement ne rouvre RIEN tant qu'une dictée est ouverte |
| 2 | pendant sa fermeture, la session précédente est encore celle qui tient la dictée |
| 2 | la session précédente est close par son propre arrêt AVANT l'ouverture de la suivante |
| 2 | le texte déjà reconnu de la session close proprement n'est pas jeté |
| 2 | le pont n'a jamais à refermer une session que l'écran a déjà close |
| 3 | une oreille n'écoute que sa propre session (canal global du pont) |
| 3 | la cascade du diagnostic ne peut plus partir : ni réarmement, ni texte jeté |
| 4 | le journal de la fin d'écoute dit la raison, la durée et la longueur du texte |
| 5 | l'écran applique la garde dans les trois gestionnaires (source) |

Le § 3 rejoue **la cascade entière** du diagnostic : une fin étrangère arrive,
l'écran ne bouge pas, aucun réarmement n'est ouvert, le pont ne referme rien, et
la phrase dictée arrive à l'écran. Sur le code d'avant (identité absente,
ouverture avant fermeture, pas de filtre de session), ce test ne peut pas passer.

Les évènements de test sont émis **au tour suivant** (`queueMicrotask`), comme les
vrais : le canal du pont rend la main **après** la commande. Sans cela, le test
serait plus indulgent que la réalité.

---

## 4. Les mutations (mesurées, restaurées après chacune)

Chaque mutation a été appliquée sur une copie du code, la suite ciblée relancée,
puis le fichier **restauré et comparé** (`diff` : identique) avant la suivante.

| # | Mutation | Résultat mesuré sur les 11 verrous |
|---|---|---|
| 1 | les **trois gardes** de `super-agent.js` neutralisées (`if (false)`) | **1 échec / 10 réussis** — le § 5 tombe |
| 2 | **ordre inversé** dans `session-dictee.js` : `registre.ouvrir()` **avant** `stopPrevious` | **1 échec / 10 réussis** — « pendant sa fermeture, la session précédente est encore celle qui tient la dictée » |
| 3 | **filtre de session retiré** dans `oreille-locale-moteur.js` | **3 échecs / 8 réussis** — les deux tests du § 3 + le § 5 |
| 4 | **identité toujours vraie** (`dictationSessionStillCurrent` → `return attendu > 0`) | **3 échecs / 8 réussis** — § 1 (jeton réutilisé), § 2 (fermeture, pont) |

Aucune mutation n'a été « crue » : les quatre ont fait **échouer** la suite. La
mutation 1 ne tombe que sur le § 5 parce que les § 1–4 éprouvent les décisions
**pures** (module et moteur) : supprimer le branchement ne peut se voir que dans
la source, et c'est précisément ce que le § 5 verrouille.

### Ce que la mutation 2 a appris (et qui a renforcé le test)

Au premier essai, inverser l'ordre **ne faisait rien échouer** : le pont ne voit
que l'**ordre de ses appels** (`stop` puis `start`), et le texte de la session
remplacée reste reçu par la grâce décidée au § 2.1. C'était une **insuffisance du
test**, pas une invulnérabilité du code. Le verrou manquant a été ajouté : pendant
la fermeture, `registre.courante()` doit **encore** nommer la session précédente —
c'est cela qui fait que son texte final appartient à la dictée. La mutation 2
échoue maintenant. Aucune mutation n'a été déclarée « non concluante » sans être
traitée.

---

## 5. Nombres recomptés (exécution réelle, pas de reprise d'un chiffre antérieur)

| Mesure | Valeur |
|---|---|
| Suite complète **avant** ces changements | non établie (aucune exécution conservée) |
| Suite complète **après**, exécutée deux fois | **5880 tests, 0 échec** (`PASS (5880) FAIL (0)`) |
| Dont le nouveau verrou | **11 tests** |
| Registre des comportements validés | **24 entrées** (4 ajoutées), garde-fou **10/10** |
| Tests Rust | **aucun fichier Rust modifié** ⇒ suite Rust non relancée (rien à couvrir) |

Le chiffre de 5880 a été **mesuré** deux fois de suite après l'ensemble des
modifications (code, test, registre, spec, handbook) ; il inclut les 11 nouveaux
tests. Le compte d'avant n'a pas été mesuré : il est donc annoncé **non établi**
plutôt que déduit.

---

## 6. Registre et documentation

- `spec_registre_comportements_valides.md` : entrées **21 à 24** (identité,
  réarmement, fermeture avant ouverture + texte conservé, cascade impossible),
  chacune avec le **titre exact** du `it()` correspondant.
- `spec_voice_input.md` § 9 : nouvelle sous-section « La session de dictée a une
  IDENTITÉ — et elle est fermée AVANT la suivante » (défaut, trois décisions,
  filtre de session, journal, verrou, mutations mesurées).
- Bloc `<!-- HELP:dictee-vocale -->` : une phrase utilisateur (« La dictée ne
  s'arrête plus toute seule »), sans jargon ni nom de fichier.
- `help/handbook.md` **régénéré** (`npm run build:handbook`, 50 blocs).

---

## 7. Ce que ce correctif ne fait pas (dit franchement)

- **La règle du pont n'est pas touchée.** `asr_voicestudio_start` referme
  toujours une session encore ouverte : c'est un filet de sécurité utile, et le
  défaut n'était pas là. La fenêtre ne lui en donne simplement plus l'occasion.
  Aucun fichier Rust n'est modifié.
- **La latence du service local est inchangée** (~9,5 s de texte final pour
  ~5,6 s de parole, mesure de l'étape 1). Ce correctif ne rend pas la dictée
  fluide ; il empêche qu'elle **coupe**.
- **Aucune vérification en conditions réelles n'a été faite** dans ce lot : ni
  service VoiceStudio joint, ni micro ouvert, ni application relancée. La preuve
  est la suite de tests, avec un pont de test qui applique la règle réelle du
  pont Rust. Le comportement sur poste reste **à confirmer par le propriétaire**.
- Le journal `asr_voicestudio_log` est écrit côté service ; **son contenu réel
  n'a pas été relu** après une vraie dictée (aucune session réelle ouverte ici).

---

## 8. Commandes à lancer

```bash
npm test                                              # suite front (5880 / 0 attendu)
npx vitest run src/js/fin-de-session-perimee-ne-rearme-pas.test.js
npx vitest run src/js/registre-comportements-valides.test.js
npm run build:handbook                                # si un bloc HELP est retouché
```

Aucun fichier Rust n'étant modifié, `cargo test` n'est pas nécessaire pour ce
lot.

---

## 9. Fichiers

| Fichier | Nature |
|---|---|
| `src/js/session-dictee.js` | **créé** — les trois décisions (identité, ordre, texte) |
| `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` | **créé** — 11 verrous |
| `src/js/super-agent.js` | modifié — branchement (registre, fermeture, gardes, journal) |
| `src/js/oreille-locale-moteur.js` | modifié — filtre de session (canal global) |
| `spec_registre_comportements_valides.md` | modifié — entrées 21 à 24 |
| `spec_voice_input.md` | modifié — § 9 + bloc HELP |
| `help/handbook.md` | régénéré |
| `docs/rapports/RAPPORT-correction-rearmement-session-perimee.md` | ce rapport |
