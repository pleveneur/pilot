# RAPPORT — La barre du bas de l'écran Vocal ne s'efface pas

> Statut : **TERMINÉ**.
> Décision appliquée telle quelle : celle du propriétaire du **2026-11-13** —
> « la barre s'efface après 2,5 s de repos **quoi qu'il arrive** ; seules deux
> raisons la retiennent : **du texte dans le champ**, **le pointeur sur la zone
> du bas** ; elle revient au geste **ou à la parole** ».
>
> Note de lecture : comme le reste des rapports du dépôt, le corps de ce
> document évite les accents hors citations de l'interface (les phrases de
> l'application, elles, sont reproduites exactement).

## 0. Constat de départ — état du disque (reprise après un échec)

Commande : `git status --short` + `git log --oneline -3`.

- Tête : `2d893bd fix: personnage actif — desactivation complete et mise a jour sans redemarrage`
- **Aucun fichier suivi n'était modifié** : la tentative précédente n'avait donc
  rien écrit ni dans `src/js/vocal-chrome.js`, ni dans `src/js/super-agent.js`.
  Seuls des fichiers **non suivis** (documents et rapports anciens) étaient
  présents, comme avant la mission.
- Le présent rapport n'existait pas : il est créé ici, en **premier geste**,
  avant toute correction et avant tout test.

Conclusion : rien à reprendre ni à défaire ; la correction part d'un disque propre.

## 1. Le mécanisme n'était pas cassé — c'est la DÉCISION qui était fausse

Vérifié avant de toucher une ligne : **un seul minuteur**
(`vocalChromeTimer`), **un seul point d'écriture** de `.vocal-chrome-hidden`
(`vocalSyncChrome`, `src/js/super-agent.js:5927`), **2 500 ms**
(`VOCAL_CHROME_IDLE_MS`), **4 px** (`VOCAL_CHROME_MOVE_PX`), quatre écouteurs
(pointeur, appui, molette, touches sauf `Échap`). Rien de tout cela n'a été
touché.

Ce qui empêchait le masquage : la fonction pure de décision
`vocalChromeVisible` (`src/js/vocal-chrome.js:78`) comptait **cinq** règles, et
deux d'entre elles retenaient le bas pour des raisons qui n'en sont pas.

### Cause 1 — « écoute » et « parole » retenaient le bas

Règle 3 (ancienne) : *l'état est « écoute » ou « parole » ⇒ le bas reste*.
Alimentée par `etat: vocalEtatQuiRetientLeBas({...})` dans les faits de
`vocalSyncChrome`. Deux dégâts :

- **« écoute » est une MESURE, pas un fait d'usage.** Depuis le lot 3
  (`9a8c2cf`), cet état signifie « le micro **capte** ». La mesure est ouverte à
  l'entrée du mode et **jamais refermée**, sa descente d'hystérésis (`0,03`) est
  **sous** le plancher de voix du projet (`0,05`) et le micro demande
  `autoGainControl` : dans une pièce silencieuse, le plancher de bruit dépasse
  le seuil de sortie, l'état **ne revient jamais au repos**, et la règle 3
  interdisait le masquage **pendant toute la session**. Un premier correctif
  (2026-11-03) avait remplacé la mesure par un fait d'usage, ce qui réglait
  « écoute » mais **laissait « parole »**.
- **« Pilot parle » est le cas nominal et LONG** : chaque lecture de réponse
  rallumait la barre et la maintenait tout le temps de la lecture. C'est le
  symptôme exact rapporté — « la barre ne s'efface pas quand elle devrait ».

### Cause 2 — le champ retenait le bas par simple FOCUS

Règle 2 (ancienne) : *le champ contient du texte, **ou il a le focus***.
Le fait était transmis ainsi :

```js
saisie: texte.trim() !== "" || document.activeElement === champ,
```

Or le champ **garde** le curseur : après un envoi (`inputEl.value = ""`), après
une dictée, après l'arrivée d'une question (`vocal-question-utilisable.js` le
place même volontairement sur le champ). Un champ **vide** mais focalisé
retenait donc le bas jusqu'à la fin de la session : le décompte sonnait, et ne
servait à rien.

## 2. Ce qui a changé (et rien de plus)

| Fichier | Changement |
|---|---|
| `src/js/vocal-chrome.js` | **Règle 3 supprimée** (le tableau de la spec passe de cinq à quatre lignes, les suivantes sont renumérotées) ; la fonction `vocalEtatQuiRetientLeBas` est **supprimée** (elle n'existait que pour cette règle) ; la règle 2 devient « le champ **contient du texte** » ; la doc de tête dit que la parole **n'est plus une raison** et qu'elle **réveille** |
| `src/js/super-agent.js` | `vocalSyncChrome` **ne transmet plus aucun état** à la décision (le fait `etat:` disparaît, ainsi que son import) ; `saisie` devient `texte.trim() !== ""` (plus de `document.activeElement`) ; `vocalBargeIn` (prise de parole détectée par la garde du micro) appelle le réveil **existant** `vocalWakeChrome()` |
| `spec_modes_ecran_vocal.md` | §4bis : tableau des retenues (4 lignes, ordre = spec), paragraphe du geste (la parole réveille), paragraphe de correctif daté, cas particulier de la dictée armée ; §3ter/`HELP` + ligne du tableau des fichiers |
| `help/overview.md` + `help/handbook.md` | texte utilisateur aligné (deux raisons, la parole réveille) puis `npm run build:handbook` |

Ce qui n'a **pas** bougé, et qui est verrouillé par des tests : 2 500 ms, 4 px,
la classe `.vocal-chrome-hidden`, le nombre d'écouteurs, le point d'écriture
unique, le cercle, le portrait, `vocal-mic.js`, la conversation.

Les deux autres lignes du tableau ne sont **pas** des états de conversation et
restent : **micro fermé** (le bouton « Autoriser le micro » est le seul recours)
et **question en attente** (la rangée de boutons vit dans le bas ; l'effacer
rendrait la question invisible et bloquerait le travail sans un mot).

## 3. Les verrous (et la preuve qu'ils mordent)

### 3.1 Nouveau fichier — `src/js/vocal-barre-effacee-pendant-la-parole.test.js` (11 tests)

Écrit **avant** la correction, puis lancé sur le code d'origine : **3 tests
passaient, 8 échouaient** — exactement les trois défauts décrits en §1 (règle 3
sur « écoute », règle 3 sur « parole », focus qui retient). Le fichier couvre :

1. **la parole de Pilot ne retient pas** le bas (décision pure, `speaking`) ;
2. **la parole de l'utilisateur et l'écoute du micro ne le retiennent pas**
   (`listening`), et **verrou de source** : la décision ne lit plus `.etat`,
   `"listening"` ni `"speaking"`, et `vocalSyncChrome` n'a plus de fait `etat:` ;
3. **seuls le TEXTE du champ et le GESTE du pointeur retiennent** — un champ
   vide **focalisé** ne retient plus (assertions sur `saisie: texte.trim() !== ""`
   et sur l'absence de `document.activeElement`) ;
4. **la parole RÉVEILLE le bas** : `vocalBargeIn` appelle `vocalWakeChrome()`,
   un **seul** minuteur (2 500 ms) et **deux** appels à
   `vocalRestartChromeTimer()` — aucun second mécanisme.

### 3.2 Fichiers existants — renforcés, jamais affaiblis

- `src/js/vocal-chrome-masque.test.js` (23 tests) : le cas « règle 3 » attend
  désormais `false` pour `listening`/`speaking` (assertion **renversée dans le
  bon sens**, pas supprimée) ; le cas « focus retient » est retiré au profit du
  cas « champ vide focalisé ne retient pas » ; l'ordre testé est celui des
  **quatre** règles ; le corps de `vocalSyncChrome` est vérifié
  (`not.toMatch(/\betat:/)`, pas de `document.activeElement`).
- `src/js/vocal-saisie-declenchement.test.js` : « les autres circonstances
  passent AVANT » attend `false` pour `listening`/`speaking`, `true` pour micro
  fermé / champ rempli / question.
- `src/js/vocal-barre-s-efface-au-repos.test.js` : son §1 testait le fait
  d'usage disparu ; il vérifie maintenant que **ni une mesure ni un état de
  conversation ne peuvent retenir le bas**, que `vocalEtatQuiRetientLeBas`
  n'existe plus, et que `vocalSyncChrome` ne transmet aucun état. Ses verrous
  d'origine (minuteur unique, point d'écriture unique, bornes, absence de
  `localStorage` et de réglage) sont conservés tels quels.

Aucun test n'a été supprimé ; aucune assertion n'a été affaiblie.

## 4. Résultats réels

```
# suites ciblées (5 fichiers)
npx vitest run src/js/vocal-chrome-masque.test.js \
  src/js/vocal-barre-s-efface-au-repos.test.js \
  src/js/vocal-saisie-declenchement.test.js \
  src/js/ecran-vocal-question-visible.test.js \
  src/js/vocal-barre-effacee-pendant-la-parole.test.js
PASS (81) FAIL (0)

# suite complète
npx vitest run
PASS (4978) FAIL (0)
```

Les 8 échecs initiaux du nouveau verrou sont la preuve de morsure : ils sont
tous devenus verts par la correction, sans qu'aucune assertion ait été retirée.

## 5. Doute restant, dit franchement

Le comportement est vérifié **par la décision pure et par la source**, pas dans
une WebView réelle : je n'ai pas pu observer le masquage à l'écran avec un vrai
micro et une vraie lecture. Le point qui mérite un essai manuel est celui-ci :
pendant une lecture de réponse, la barre doit disparaître au bout de 2,5 s et
**revenir dès que l'on parle par-dessus** (le réveil est alors celui de
`vocalBargeIn`). Si un cas résistait, la trace `[vocal] prise de parole :
residu=… seuil=… motif=…` de la console dira si la garde du micro a bien vu la
voix.

## 6. Fichiers touchés

- `src/js/vocal-chrome.js`, `src/js/super-agent.js` (la correction) ;
- `src/js/vocal-barre-effacee-pendant-la-parole.test.js` (nouveau verrou) ;
- `src/js/vocal-chrome-masque.test.js`, `src/js/vocal-saisie-declenchement.test.js`,
  `src/js/vocal-barre-s-efface-au-repos.test.js`, `src/js/ecran-vocal-question-visible.test.js`,
  `src/js/ecran-vocal-question-utilisable.test.js` (numérotation des règles) ;
- `src/css/style.css` (un commentaire : la question est la règle **4**) ;
- `spec_modes_ecran_vocal.md`, `help/overview.md`, `help/handbook.md` (régénéré) ;
- ce rapport.

VERDICT : la barre du bas s'efface de nouveau après **2 500 ms** de repos dans
tous les cas de conversation (Pilot parle, l'utilisateur parle, le micro
écoute) ; elle n'est retenue que par **du texte dans le champ** et par le
**geste du pointeur** sur la zone du bas (plus les deux cas de sûreté : panne du
micro, question en attente), et elle **revient** au geste comme à la parole.
