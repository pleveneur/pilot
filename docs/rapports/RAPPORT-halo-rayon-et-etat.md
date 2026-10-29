# Rapport — rayon du halo et place de la phrase d'état (écran Vocal)

Date : 2026-10-28 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest)
Demande du propriétaire : deux changements **uniquement** sur l'écran Vocal —
1. le halo qui suit la voix doit atteindre **128 px de rayon** (à défaut **64 px**,
   expliqué) ; 2. la phrase d'état passe **sous le cercle → au-dessus de la barre
   de saisie**.

Protocole appliqué : `.pi/skills/quality-gate/SKILL.md` (analyse, points de
connexion, existence à préserver, modification ciblée, verrous).

---

## 1. Ce qui a été décidé (aucune question posée)

### 1.1 « Le halo qui suit la voix » = l'enveloppe de parole → **128 px retenu**

L'écran Vocal porte **deux** objets lumineux, et la spécification interdit de les
confondre (`spec_modes_ecran_vocal.md` §4) :

| Objet | Voix | Rayon | Verdict |
|---|---|---|---|
| **halo intérieur** (`.vocal-halo`) | **la vôtre** (micro mesuré) | ≤ 82 px, **dans** le disque de 168 px | **inchangé** |
| **enveloppe de parole** (`.vocal-orb::before`) | **celle de Pilot** (lue) | 84 → **128 px** | **c'est lui** |

C'est bien l'enveloppe de parole qui est visée : la demande dit que « l'enveloppe
de parole doit continuer à piloter le halo », et elle seule peut grandir **hors**
du disque. Le halo intérieur, lui, ne peut pas dépasser l'anneau : il est
*dedans* par construction (82 px), c'est la règle « le halo ne sort pas du
disque, l'enveloppe ne rentre pas dedans ». Le porter à 128 px reviendrait à
peindre par-dessus le disque, donc à changer la nature de l'objet — refusé.

**128 px est retenu, 64 px n'est pas nécessaire.** Le critère est mesurable :
la boîte du halo doit tenir dans la plus petite fenêtre autorisée.

- Boîte du halo = 168 px (disque) + 2 × 44 px = **256 px** (donc 128 px de rayon).
- Hauteur minimale de la fenêtre : **500 px** (`src-tauri/tauri.conf.json`,
  `minHeight`).
- Ce qui n'est pas la scène : barre haute 44 px + marge des boutons système
  36 px = **80 px** ; phrase 21 px + marges 8 + 12 = **41 px** ; saisie 36 px
  sur une ligne + 16 px de marge = **52 px**. Total **173 px**.
- Place laissée à la scène dans la plus petite fenêtre : 500 − 173 = **327 px**,
  soit **71 px de marge** au-delà des 256 px du halo. **Il n'écrase rien** : le
  repli à 64 px n'a pas lieu d'être.

Le seul cas limite, assumé et dit : quand la zone de saisie est remplie
jusqu'à son plafond (120 px) **dans la fenêtre minimale**, la scène tombe à
~243 px et la couronne extérieure (alpha ≤ 34 %) vient effleurer le haut de la
ligne d'état. La phrase reste **lisible et devant** la lueur (`position:
relative`, aucun fond), et la fenêtre ne défile pas (`overflow: hidden`).

### 1.2 La phrase d'état → **au-dessus de la barre de saisie**

Elle quitte `.vocal-stage` et devient un **enfant direct** de l'overlay, entre le
bloc du disque et `.vocal-input`. Même nœud, même contenu, même style, même
logique d'état (`vocalStatusLine`, `applyVocalState`, `querySelector(".vocal-status")`
inchangés) : seul l'**emplacement** change. L'ancien emplacement est **libéré** —
aucun nœud orphelin, aucun espace réservé (le `gap` de 32 px ne sert plus qu'au
bouton de dépannage du micro, masqué par défaut).

---

## 2. Modifications (ciblées, rien d'autre)

| Fichier | Changement |
|---|---|
| `src/css/style.css` | `.vocal-orb::before` : `inset: -32px` → **`-44px`** (boîte 256 px) et arrêts du dégradé re-projetés (0 % → 0 %, **66 %** = bord du disque → 0 %, 81 % → 8 %, 90 % → 20 %, 100 % → 34 %). `.vocal-envelope-live` : repli `scale` **0,8793 → 0,7969** (= 102/128, la même couronne de repos de 18 px). `.vocal-status` : sorti du bloc du disque, `position: relative`, marges `8px auto 12px`, `padding: 0 16px`. Commentaires de `.vocal-stage` et du mouvement réduit mis à jour (44 px, plus 32). |
| `src/js/vocal-enveloppe-aigu.js` | `ENVELOPE_MAX_PX` **32 → 44** (une seule constante pilote le rayon : 84 + 44 = 128). Documentation de `scale` réécrite (boîte de 128 px, pas 44 px). |
| `src/js/super-agent.js` | `buildVocalOverlay` : `.vocal-status` déplacé hors de `.vocal-stage`, juste avant `.vocal-input`. Aucune autre ligne (aucune API audio, aucun second afficheur). |

Ce qui n'a **pas** bougé : les trois modes d'écran, l'overlay du logo (même place
qu'en « Détaillé »), les trois sorties (logo, Échap, fermeture de l'onglet), la
réduction de mouvement (enveloppe **fixe mais visible**, `animation: none`), le
pilotage par la voix (deux variables, une seule source), la barre de saisie
(largeur, marge, plafond 120 px) et les quatre états.

### 2.1 Le dégradé, du centre vers le bord (aucune arête, aucune ombre)

| Position | Opacité | Rôle |
|---|---|---|
| 0 % | 0 % | centre : **rien** n'est peint sur le disque |
| 66 % (= 84 px) | 0 % | bord de l'anneau : la lueur commence **après** le disque |
| 81 % (= 104 px) | 8 % | début de couronne perceptible |
| 90 % (= 115 px) | 20 % | couronne franche |
| 100 % (= 128 px) | **34 %** | bord : le pic de lumière est **au bord** (seuil ≥ 30 % tenu) |

Interpolation `closest-side` continue : aucun palier, aucune `box-shadow`,
aucun `blur` — donc aucune arête et aucune ombre dure. `0 %` d'opacité jusqu'à
66 % : la lueur ne recouvre jamais l'objet lumineux, elle reste **autour** de lui.
Boîte **absolue** (hors flux) : elle n'élargit pas la fenêtre et ne peut pas
créer de défilement.

### 2.2 Le halo suit toujours la voix

`envelopeFromEnergy(énergie)` reste **la seule** source : `extension` 18 → 44 px
et `alpha` 0,8 → 1, appliqués par `super-agent.js` dans les deux variables
`--vocal-envelope-scale` / `--vocal-envelope-alpha` (une pose, un retrait : deux
mentions chacune, vérifié par test). La respiration de repli
(`vocal-speak-glow`) est conservée : elle oscille **autour de 128 px**
(0,94 → 1,06 × 128 = 120 → 136 px), donc l'échelle ne change pas de nature, elle
est simplement recentrée sur le nouveau rayon. Plus la voix est forte, plus le
halo est large et lumineux.

---

## 3. Verrous (tests)

Mis à jour (valeurs qui changeaient) :
`src/js/vocal-enveloppe-aigu.test.js` (0,7969 / 44 px / `inset: -44px`),
`src/js/vocal-halo-parole.test.js` (couronne à 66 %, phrase hors du bloc du
disque), `src/js/ecran-vocal-lot2.test.js` (ordre du balisage).

**Ajoutés** dans un fichier neuf
`src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` (5 groupes) :
1. rayon **128 px** (84 + 44), boîte 256 px, et 128 px tient dans la hauteur
   minimale de la fenêtre (donc pas de repli à 64 px) ;
2. dégradé **doux** — `closest-side`, pas de `box-shadow`/`blur`, positions
   strictement croissantes, saut d'opacité ≤ 20 points, dernier arrêt transparent
   à 66 % (jamais sur le disque) ;
3. boîte **absolue** dans un référentiel `relative`, plein écran `overflow:
   hidden`, largeur et marge de la saisie intactes ;
4. enveloppe **pilotée par la voix** (extension et alpha croissants, une seule
   pose et un seul retrait des deux variables, repli CSS **égal** à la valeur de
   repos du module — aucun chiffre orphelin) ;
5. phrase **au-dessus de la barre de saisie** (ordre du balisage, scène refermée
   avant elle — deux `</div>` —, une seule occurrence, `role="status"`,
   `aria-live="polite"`, sélecteur existant, `position: relative`, aucun fond,
   couleur neutre).

---

## 4. Documentation

`spec_modes_ecran_vocal.md` §2 et §4 mis à jour (place de la phrase, 128 px de
rayon, 44 px de débord, 66 % pour le bord du disque) et le bloc
`<!-- HELP:modes-ecran -->` de `help/overview.md` réécrit ; `help/handbook.md`
**régénéré** (`npm run build:handbook`), jamais édité à la main.

---

## 5. Vérification (résultats recomptés, aucun chiffre figé)

**Front-end** — `npx vitest run --reporter=json
--outputFile.json=docs/rapports/vitest-halo-rayon-et-etat.json` (fichier de sortie
**neuf**). Total **recompté depuis ce fichier** :

| Mesure | Valeur |
|---|---|
| fichiers de test | **226** |
| tests | **4181** |
| réussis | **4181** |
| échecs | **0** |
| suites en échec | **0** |

Le rapport JSON (≈ 1,5 Mo) reste un **artefact de vérification local**, non
versionné ; les chiffres ci-dessus en sont extraits, ils ne sont pas recopiés
d'une session précédente.

**Rust** — `cargo test --manifest-path src-tauri/Cargo.toml --lib` en tâche de
fond, sortie redirigée : `807 passed; 0 failed; 1 ignored` (exit 0).

**Aide intégrée** — `npm run build:handbook` régénéré après la mise à jour du
bloc `<!-- HELP:modes-ecran -->` (46 blocs).

---

## 6. Ce qui reste ouvert (dit, pas caché)

- Le seul cas limite est celui du §1.1 : saisie remplie jusqu'à son plafond
  (120 px) **dans la fenêtre minimale** (800 × 500). La couronne extérieure
  (alpha ≤ 34 %) peut alors effleurer le haut de la phrase d'état, qui reste
  **devant** la lueur et parfaitement lisible. Aucune fenêtre ne défile :
  `overflow: hidden` sur le plein écran, et la boîte du halo est **absolue**
  (hors flux). Si ce cas devait gêner à l'usage, la seule action à faire serait
  de réduire le plafond de la saisie en mode Vocal (120 → 80 px) — **non fait
  ici**, car ce n'était pas demandé.
- Le halo intérieur (votre voix) reste plafonné à 82 px, **dans** le disque : le
  porter à 128 px aurait recouvert l'objet lumineux, ce que la spécification
  interdit explicitement (« le halo ne sort pas du disque »).

