# Rapport — les voix françaises locales dans les réglages

> Écrit AVANT toute écriture de code, puis complété au fil du travail
> (constat, preuves `fichier:ligne`, vérifications exécutées, mesures, commit).
> Dépôt : `G:\IA_PL\pilot` — HEAD de départ `c760a8d` (`v0.5.0-61-gc760a8d`).

## 1. Constat central : le défaut décrit n'est PLUS dans le code du dépôt

La régression décrite dans `RAPPORT-diag-voix-locales-absentes.md` (section
« Lecture des réponses » vidée, ligne d'état figée sur « vérification du moteur
en cours… ») était réelle **dans la version publiée `v0.5.0`**, et elle est
**déjà corrigée dans l'arbre de travail**.

Chronologie vérifiée par git :

| Date | Commit | État |
|---|---|---|
| 2026-10-24 | `794b6c3` | le diagnostic est écrit ici (défaut présent) |
| 2026-10-25 | `bbce78f` « fix(parametres): l etat des voix locales se charge tout seul » | **correctif appliqué** (`src/js/settings.js`, `src/js/local-voice.js`, `src/js/read-aloud.js` + 14 tests) |
| — | `v0.5.0` (étiquette) | antérieure au correctif ⇒ **non publiée** |

`git merge-base --is-ancestor 794b6c3 bbce78f` répond oui : le diagnostic est
antérieur au correctif. **Conséquence directe : un utilisateur qui voit encore
le symptôme fait tourner une version ≤ `0.5.0`**, pas cet arbre.

### Cause exacte (pour mémoire, et pour ne pas la réintroduire)

Ancien `refreshReadAloudVoice` (`src/js/settings.js`, version `v0.5.0`) :

```js
const known = model ? localVoiceStatusFor(model) : null;   // model = voix locale choisie
if (model && !localVoiceStatusFor(model)) ensureLocalVoiceChecked(...);
```

Avec le réglage par défaut (`read_aloud_voice: ""`), `model` valait `null` :
1. l'état du moteur n'était **jamais demandé** ;
2. `voiceChoiceOptions(voices, null)` ne propose **aucune** voix locale
   (`src/js/read-aloud.js` : les voix locales ne sont ajoutées que si l'état est
   fourni, ce que verrouille `src/js/voix-locale.test.js`) ;
3. la note restait la note d'attente.

État actuel (`src/js/settings.js`) — le modèle vérifié n'est plus jamais `null` :

```js
const statusModel = model || DEFAULT_LOCAL_VOICE_MODEL;   // << le point du correctif
const known = localVoiceStatusFor(statusModel);
...
if (options && options.gesture) ensureLocalVoiceChecked(wanted, true);
else if (!localVoiceAutoChecked) ensureLocalVoiceChecked(wanted, false);  // une fois par ouverture
```

## 2. Preuves sur le poste (le disque contient bien de quoi afficher)

Rappel de la consigne du propriétaire : le diagnostic avait été écrit **quand les
modèles manquaient** ; ce n'est plus le cas.

| Élément | Version installée (`com.pilot.editor`) | Version de test (`com.pilot.editor.dev`) |
|---|---|---|
| `config.json` → `read_aloud_voice` | `local:piper` | `local:piper:fr_FR-tom-medium` |
| Modèles dans `voix-locale/voix/` | `siwis-medium`, `tom-medium`, `gilles-low`, `siwis-low` (**4**) | `siwis-medium`, `tom-medium` |
| Moteur `voix-locale/piper/` | **présent** | absent (moteur partagé avec la version installée) |

Donc « rien à afficher » est exclu : il y a **quatre** voix (deux de femme, deux
d'homme), et la liste doit les montrer.

## 3. Vérification EXÉCUTÉE de la chaîne (sans interface graphique)

La chaîne réelle de la section, rejouée avec un invocateur factice
(`tts_local_status` → état), puis composée comme le fait le sélecteur
(`localVoiceStatusFor` → `voiceChoiceOptions`) :

```
tts_local_status appelé 1 fois, args { model: "fr_FR-siwis-medium" }   (réglage "")
options = [
  "Automatique (voix de la langue de l'interface)",
  "Voix française locale — voix de femme (siwis, qualité moyenne)",     → local:piper
  "Voix française locale — voix d'homme (tom, qualité moyenne)",
  "Voix française locale — voix d'homme (gilles, qualité légère)",
  "Voix française locale — voix de femme (siwis, qualité légère)",
  "Alex (en-US)", "Hortense (fr-FR)"
]
note = « Voix française locale prête : … Moteur et modèle se trouvent dans
        « C:/Pilot/voix-locale ». »
```

Moteur réellement absent (`installed: false, engine_present: false`) :

```
"Voix française locale — voix de femme (siwis, qualité moyenne) — modèle à télécharger"
note = « La voix locale n'est pas encore installée sur cet ordinateur (dossier
        utilisé : « C:/Pilot/voix-locale ») … En attendant, la lecture utilise la
        voix du système. »
voiceChoiceStatus(voix locale choisie) → kind "local-missing", choix CONSERVÉ,
hint nommant explicitement le moteur manquant.
```

La ligne d'état n'est donc **jamais** l'attente figée : elle est soit « prête »
(avec le dossier), soit « pas installée » (avec le dossier), soit « inconnue »
(invocation en échec) — les trois cas sont désormais testés.

## 4. Ce que j'ai changé (et ce que je n'ai pas refait)

**Rien à corriger dans le code** : refaire le correctif de `bbce78f` aurait
dupliqué un travail déjà fait et déjà testé. Le trou restant était **celui que le
diagnostic § 5 nommait lui-même** : *aucun test n'exécutait la chaîne* « réglage
par défaut → état demandé → liste remplie ». Les 14 tests existants vérifient le
**texte du code** (présence de `DEFAULT_LOCAL_VOICE_MODEL`, de
`ensureLocalVoiceChecked(`…) et les fonctions pures séparément, mais aucun ne
reliait la mémoire d'état à la liste effectivement proposée.

Ajout dans `src/js/voix-locales-chargement-automatique.test.js` (5 tests,
**aucun test existant modifié ni supprimé**) :

| Test ajouté | Ce qu'il tient |
|---|---|
| « Automatique » → les QUATRE voix locales sont proposées, genre compris | une seule demande, pour `fr_FR-siwis-medium` ; ordre `Automatique` puis les 4 voix locales ; libellé + genre de chaque voix |
| la ligne d'état dit la vérité | la note n'est plus l'attente, elle nomme le dossier et dit « prête » |
| voix du SYSTÈME enregistrée → même liste | la liste est identique et le choix reste la voix du système |
| moteur réellement absent → la liste ne fait pas semblant | les 4 voix restent proposées, celle dont l'état est connu dit « modèle à télécharger », le choix local est conservé et le moteur nommé |
| vérification impossible → état inconnu, liste complète | aucune liste vide, note « inconnue », aucun blocage |

**Preuve que ces tests mordent** (sabotages temporaires, puis fichiers restaurés
à l'identique — `git diff` vide sur `settings.js` et `local-voice.js`) :

| Sabotage introduit | Résultat |
|---|---|
| remettre l'ancienne garde `model ? … : null` dans `settings.js` | 1 échec : le test de source de `voix-locales-chargement-automatique.test.js` (« le `DEFAULT_LOCAL_VOICE_MODEL` est dans le corps ») |
| supprimer la mémorisation par modèle (`localStatusByModel.set(...)`) | **6 échecs** : les 5 nouveaux tests + 1 ancien ⇒ la chaîne est bien tenue de bout en bout |

## 5. Tests (comptes réels)

| Mesure | Avant | Après |
|---|---|---|
| `npx vitest run` (suite complète) | **PASS 3343 / FAIL 0** | **PASS 3348 / FAIL 0** |
| `npx vitest run src/js/voix-locales-chargement-automatique.test.js` | **PASS 14 / FAIL 0** | **PASS 19 / FAIL 0** |
| `npx vitest run` des 5 fichiers de voix (`voix-locale`, `voix-locale-choix`, `reglage-voix-onglet-assistant`, `apercu-voix-parametres`, `voix-locales-chargement-automatique`) | 97 / 0 (mesuré pendant le sabotage, garde restaurée) | idem, 98 → 0 échec |
| `npm run build` (interface) | — | ✅ construite (avertissements de découpage préexistants, aucun lié à ce changement) |
| `npm run build:handbook` | — | ✅ 45 blocs, `help/handbook.md` inchangé (aucun bloc `HELP` touché) |

Non relancés : les tests Rust (`cargo test`). **Aucun fichier Rust n'a été
touché** par cette tâche, et le seul fichier Rust modifié dans l'arbre
(`src-tauri/src/agents.rs`) appartient à une autre mission — laissé tel quel.

## 6. Ce qui reste intact (vérifié par les tests ci-dessus)

- la lecture à voix haute elle-même (découpage en phrases, une seule lecture à la
  fois, arrêt propre) : `read-aloud.js` **non modifié** ;
- la valeur réservée `local:piper` (+ `local:piper:<modèle>`) et le **repli
  visible** sur la voix du système : non modifiés, et le repli est testé ;
- le nettoyage du texte dit (`speech-text.js`) : non modifié ;
- aucun bouton, aucun réglage, aucune fonctionnalité ajoutés ; section des
  réglages inchangée (mêmes éléments HTML, mêmes textes) ;
- aucun fichier de modèle ni moteur touché sur le disque : rien n'a été
  supprimé, téléchargé ni modifié (les tests n'appellent que des fonctions pures
  et un invocateur factice).

## 7. Ce que je n'ai PAS pu vérifier à l'écran

1. Le rendu réel de ⚙️ Paramètres → onglet **Assistant** → « Lecture des
   réponses » : cette session n'a pas d'affichage graphique (l'environnement de
   test est `node`, sans DOM). Ce qui est prouvé ici, c'est la **chaîne de
   données** (état → liste → note), pas les pixels.
2. La **durée** réelle de la vérification du moteur à l'ouverture (quelques
   millisecondes attendues : deux lectures d'état disque), et donc le temps
   pendant lequel la note affiche encore l'attente avant de se remplir.
3. La version **installée `0.5.0`** elle-même : elle contient encore l'ancien
   code, donc le symptôme y subsiste tant qu'une version ≥ ce correctif n'est pas
   publiée (hors de cette tâche : aucune version bumpée, aucun push, aucun tag).

## 8. À essayer dans l'application (build à jour)

1. ⚙️ Paramètres → Assistant → « Lecture des réponses », réglage sur
   **Automatique** : la liste montre les **4 voix locales** (deux de femme, deux
   d'homme) **sans clic**, et la note donne le dossier du moteur.
2. Choisir `tom` : la note reste « prête » ; « 🔊 Écouter » lit en local.
3. Choisir une voix dont le modèle n'est pas déposé : la note dit « pas encore
   installée » + « Vérifier à nouveau », et le choix n'est pas perdu.
4. Fermer / rouvrir les Paramètres : une seule vérification par ouverture, la
   liste se remplit de nouveau seule.

## 9. Verdict

**Le correctif demandé était déjà dans l'arbre (`bbce78f`) et il fonctionne :
avec le réglage par défaut, les quatre voix françaises locales sont proposées
avec leur libellé et leur genre, et la ligne d'état dit la vérité.** Le travail
de cette tâche a été de **fermer le trou de vérification** que le diagnostic
signalait (5 tests exécutables sur la chaîne réelle, qui mordent — 6 échecs si la
mémoire d'état casse), sans toucher au comportement. La suite complète est verte :
**3348 passés / 0 échec**. Pour que l'utilisateur voie la correction, il faut une
**publication** (le correctif n'a jamais été livré) — décision du propriétaire,
non faite ici.
