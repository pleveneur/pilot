# Rapport — 5ᵉ vérification du commit `0ad7815` (verrou de documentation)

> Mission : élargir le seul verrou encore faux (règle périmée « une relance par
> passe »), sans toucher au comportement des relances. Dernière modification
> avant publication.

## État de départ (mesuré sur `0ad7815`)

| Mesure | Avant `0ad7815` | Après `0ad7815` |
|---|---|---|
| Inventaire des découpages de source | 35 fichiers fautifs | 0 |
| Positions de découpage aveugles | 110 | 0 |
| Aide intégrée relancée seule (bornée) | 20 000 car. | 447 car., comptes d'omis exacts |
| Verrou « aucune règle périmée vivante » | — | **faux** : 3 formulations passent |

Les trois formulations mesurées par l'audit, toutes non attrapées :

1. « Un tick ne peut déclencher qu'une relance, jamais davantage. »
2. « Le planificateur livre au maximum un rappel dans une même passe. »
3. « Le ticker ne livre jamais deux rappels dans une même passe. »

## Trous structurels identifiés (et corrigés)

- **Trou 1 — lien « dans **une même** passe »** : `LIEN_DROITE` ne connaissait que
  `dans la même`, pas `dans une même`. → le lien accepte désormais `la` **ou**
  `une`.
- **Trou 2 — préfixe de « passe »** : le motif (b) exigeait un article
  (`chaque|une|la|par|à chaque|toute`) juste avant « passe » ; « **Un** tick ne
  peut … qu'une relance » n'en avait pas. → le préfixe accepte aussi un `un/une`
  nu (`\bun[e]?`).

## Correction

Fichier unique : `src/js/relances-relecture.test.js` (+23 / −3).

- `LIEN_DROITE` : `dans${ENTRE_MOTS}(?:la|une)${ENTRE_MOTS}même`.
- Motif (b) : préfixe `\bun[e]?` ajouté à l'alternance.
- Les trois phrases inédites sont ajoutées aux reformulations testées.
- Les deux cas anti-faux-positif existants (« un seul ENVOI par passe … ») sont
  **conservés**, complétés de deux variantes qui couvrent précisément les
  élargissements (lien « dans une même », préfixe « un tick »).

Aucun autre fichier modifié. Aucun changement de comportement : bornes,
marquage, engagement, écoute applicative, voix, rappels, panneau des tâches
intacts. `npm run build:handbook` relancé → `help/handbook.md` **inchangé**
(aucun bloc `HELP` touché), donc rien à committer de ce côté.

## Preuve par neutralisation (essayée puis restaurée)

| Neutralisation | Résultat |
|---|---|
| Les **deux** élargissements retirés | 🔴 `reformulation non attrapée : « Un tick ne peut déclencher qu'une relance, jamais davantage. »` |
| Seul le lien « dans **une** même » retiré | 🔴 `reformulation non attrapée : « Le planificateur livre au maximum un rappel dans une même passe. »` |
| Fichier restauré (état livré) | 🟢 34/34 sur `relances-relecture.test.js` |

Aucun faux positif : les 4 cas « règle APPLIQUÉE » (dont 2 nouveaux) rendent
`[]`, et le balayage des 5 fichiers du périmètre (`super_agent.rs`,
`tests/schedule-tests.md`, `super-agent-schedule.test.js`,
`super-agent-schedule.js`, `spec_super_agent.md`) ne remonte aucune occurrence
non citée — les citations « … » et « et non « … » » restent tolérées.

## Résultats de tests (réels)

- `npm test` (`npx vitest run`) → **2813 passés, 0 échec**.
- `npx vitest run src/js/relances-relecture.test.js` → **34 passés, 0 échec**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **722 passés,
  1 ignoré** (build OK, aucun warning nouveau).

## Commit

Un seul commit local au-dessus de `0ad7815` (fichier de test + ce rapport).
Aucun bump de version, aucun tag, aucune publication, application non lancée.
