# Rapport de correction — l'écran Vocal ne sortait jamais de « Je vous écoute… »

> Agent CODEUR. Correctif appliqué, tests ajoutés/corrigés, documentation et aide
> intégrée mises à jour, commit local (non poussé). Aucune publication, aucun
> changement de version.
> Source du diagnostic : `RAPPORT-diagnostic-etat-ecran-vocal.md` (§ 4 hypothèse
> B, § 6 correction minimale).

---

## 1. Cause retenue (celle du diagnostic, confirmée)

Le drapeau qui décide de l'état affiché (`vocalMicListening`) n'était écrit
qu'à **l'ouverture** et à **l'arrêt** du flux micro — jamais depuis le niveau
sonore. `onListening` (contrat « vrai seulement quand le micro capte ») n'est
émis par `vocal-mic.js` que deux fois, à `demander()` et dans `liberer()`. Le
niveau mesuré, lui, partait par `onLevel` → `vocalSetLevel`, qui n'écrivait que
la variable CSS `--vocal-level`. **Aucun seuil n'existait** : dès la permission
accordée, l'écran restait en « écoute » (vert, « Je vous écoute… ») quel que soit
le silence, alors que le trait, lui, suivait bien la voix.

## 2. Correction appliquée (minimale, `src/js/super-agent.js`)

| Élément | Détail |
|---|---|
| `VOCAL_VOICE_ON = 0.06` / `VOCAL_VOICE_OFF = 0.03` | seuils RMS sur le niveau **lissé** |
| `vocalCapte(niveau, etait)` (PURE) | **hystérésis** : entre au-dessus de 0,06, sort sous 0,03 |
| `vocalVoiceStep({niveau, capte, microOuvert})` (PURE) | un pas = `{capte, ecoute}`, les deux valeurs ensemble (l'état ne peut pas s'allumer micro fermé) |
| `vocalMicCapte` | nouveau drapeau : le micro **capte** (distinct du micro **ouvert**) |
| `vocalSetLevel(niveau)` | fait le pas de détection **avant** d'écrire `--vocal-level` et ne réapplique l'état **que quand la décision change** (aucun travail par image, aucun clignotement) |
| `applyVocalState()` | `listening: vocalMicListening && vocalMicCapte` |
| Remises à zéro | `vocalSetListening(false)`, `vocalMicFailure`, `enterVocal`, `exitVocal` ⇒ `vocalMicCapte = false` (la détection repart du silence) |

**Priorité des états** : inchangée et non réécrite — `speaking > reflecting >
listening > idle` dans `vocalScreenState` (aucune ligne modifiée).

**`src/js/vocal-mic.js` : pas touché** (vérifié : `git diff --stat` ne le liste
pas). Micro, permission au premier geste, arrêt réel à la sortie et garde
anti-auto-coupure du lot 4a sont intacts. Aucun CSS, aucun texte de ligne
d'état, aucun réglage, aucun bouton, aucune émission du micro modifiés.

### Pourquoi ces valeurs (0,06 / 0,03)

Les valeurs du rapport sont reprises **telles quelles**, pour trois raisons
vérifiées sur le code et sur la sonde du diagnostic :

1. **Même unité et même ordre de grandeur** que le seul plancher déjà retenu par
   le projet (`BARGE_IN_MIN_LEVEL = 0.05` dans `vocal-mic.js`) : une voix réelle
   donne des RMS nettement supérieurs (la sonde du diagnostic mesure 0,4–0,6
   brut → 0,2–0,45 lissé), le souffle et le bruit de fond restent sous 0,03 dès
   que `noiseSuppression` est appliquée (contrainte déjà demandée par
   `MIC_CONSTRAINTS`).
2. **L'hystérésis est indispensable, pas cosmétique** : `smoothLevel` descend à
   0,12 par image. Avec un seuil unique, la valeur lissée traverse la zone du
   seuil pendant ~0,3 s après chaque fin de phrase, ce qui ferait clignoter
   l'écran (repos/écoute/repos). Deux seuils ⇒ **une seule bascule dans chaque
   sens** (vérifié par test sur 90 images).
3. **Réactivité conservée** : montée à 0,5 par image ⇒ 0,4 est atteint en 3–4
   images (~50 ms) ; la retombée sous 0,03 depuis 0,45 prend ~22 images
   (~0,37 s à 60 i/s), ce qui se lit comme « immédiat » sans clignotement.

Aucune autre valeur n'a été nécessaire : je n'ai constaté aucun cas où 0,06/0,03
ne tenaient pas (voir § 4 pour la limite assumée : pas de mesure sur matériel
réel dans cette mission).

## 3. Tests

Fichier : `src/js/ecran-vocal-lot3.test.js` (34 → **37** tests). Aucun test
supprimé.

**Angle mort corrigé — une assertion retirée, avec sa raison écrite dans le test** :
`« un périphérique retiré en pleine écoute repasse au silence et le dit »`
contenait `expect(vus.ecoutes).toEqual([true])` **après avoir joué une image de
niveau 0,3** : elle inscrivait le défaut comme comportement attendu. Elle est
remplacée par `expect(vus.niveaux).toHaveLength(1)` +
`expect(vus.niveaux[0]).toBeGreaterThan(VOCAL_VOICE_ON)` (la voix est bien
**mesurée**), le reste du test (panne `MIC_OCCUPE`, `[true, false]`, micro
inactif) étant conservé à l'identique.

**Test renforcé** — `« l'etat « ecoute » n'est vrai que si le micro CAPTE
VRAIMENT (niveau reel) »` (l'ancien test ne lisait que deux motifs de source) :
il exige désormais `listening: vocalMicListening && vocalMicCapte`,
`vocalVoiceStep(` **et** `applyVocalState()` dans `vocalSetLevel`, et
l'absence de toute API micro dans l'écran.

**Nouveau bloc `3bis. le NIVEAU decide de l'etat : silence -> voix -> silence`** :

1. **hystérésis** (`vocalCapte`) : 0 et 0,001 ⇒ faux ; 0,04 sans capture
   préalable ⇒ faux (seuil haut) ; 0,06 et 0,4 ⇒ vrai ; 0,04 **en cours de
   capture** ⇒ vrai (on ne retombe pas) ; 0,01 ⇒ faux ; bornes et `NaN` inertes.
2. **micro ouvert + silence = repos / + voix = écoute**, micro **fermé** ⇒ jamais
   « écoute » même à 0,9 ; et les deux phrases d'état sont bien différentes.
3. **chaîne réelle** : mesures brutes → `smoothLevel` (le lissage du moteur) →
   `vocalVoiceStep` → `vocalScreenState`, sur `silence × 3`, `voix (0,4) × 3`,
   puis `silence × 90`. Exigences : `idle` au début, `listening` après la voix,
   niveau final `< VOCAL_VOICE_OFF`, `idle` à la fin, et **exactement deux
   bascules** (`listening`, `idle`) — donc pas de clignotement.

Les tests d'état purs du lot 2 (`vocalScreenState` / `vocalStateClass` /
`vocalStatusText` / teintes CSS) sont inchangés et passent : ils testent la
priorité, pas le branchement.

## 4. Résultats

| Vérification | Résultat |
|---|---|
| `npm test` (Vitest, tout le front) | **200 fichiers, 3615 tests : 100 % OK** |
| `npx vitest run src/js/ecran-vocal-lot3.test.js` | **37 tests OK** |
| `npm run build:handbook` | OK — `help/handbook.md` régénéré (46 blocs), diff = les 7 lignes ajoutées au bloc `modes-ecran` uniquement |

**Limite assumée** : le réglage fin des deux seuils n'a pas pu être validé sur
le micro réel du propriétaire (aucun accès matériel dans cette mission). Ils sont
donc ceux du rapport, avec l'hystérésis qui protège du clignotement ; si le
propriétaire constate que « écoute » ne s'allume pas sur une voix parlée
normalement, le seul chiffre à baisser est `VOCAL_VOICE_ON` (0,06 → 0,04), le
seuil bas restant sous lui.

## 5. Documentation

| Fichier | Mise à jour |
|---|---|
| `spec_modes_ecran_vocal.md` | § 4 : ligne du tableau « Écoute » (seuil haut 0,06) + puce « Comment l'écoute est réellement détectée » (deux seuils, hystérésis, retour au repos ~0,3 s, jamais micro fermé) ; § 5 : le même niveau décide de l'état, un seul chemin de mesure |
| `help/overview.md` (bloc `HELP:modes-ecran`) | une puce utilisateur : l'écran distingue le silence de la parole, ouvrir le micro ne suffit pas, pas de clignotement |
| `help/handbook.md` | régénéré par `npm run build:handbook` (jamais édité à la main) |
| `README.md` | le mode Vocal distingue réellement repos/écoute, allumé par la voix |
| `AGENTS.md` | arborescence `super-agent.js` : détection de l'écoute (`vocalCapte`, `vocalVoiceStep`, `VOCAL_VOICE_ON/OFF`, `vocalMicCapte`) et `vocal-mic.js` inchangé |

## 6. Ce que la correction ne change pas (vérifié)

- Apparence de l'écran Vocal, textes de la ligne d'état, tailles, CSS : **aucun
  changement** (`src/css/style.css` non modifié).
- Coupure de la parole pendant la lecture (`vocalBargeIn`, lot 4a) et garde
  anti-auto-coupure : **intactes**, `vocal-mic.js` non modifié.
- Mode « Assistant seul », colonne de gauche, menu du bas : **fichiers non
  ouverts en écriture** (une autre mission y travaille).
- Cycle d'ouverture du micro, demande de permission, arrêt réel à la sortie :
  inchangés ; aucun réglage ni bouton ajouté.
