# Rapport — les cinq finitions du correctif « le texte de la tâche en cours »

Date : 2026-11-15 · Projet : `G:\IA_PL\pilot`
Demande du propriétaire : traiter **les cinq remarques de finition** laissées par la
revue du correctif qui affiche, dans la liste des tâches, le titre **réel** de la
mission en cours (commits `8a11949` puis `0c9dce5`, rapport
`docs/rapports/RAPPORT-libelle-tache-en-cours-en-haut-a-droite.md`).

**Cadrage honnête, d'abord** : le rapport de revue contenant les cinq remarques
n'est **pas sur le disque**. Le dossier `docs/rapports/` ne contient que le
rapport du correctif (qui reprend, en § 7, le seul point **bloquant** de cette
revue) et `docs/conceptions/` n'a aucun document de revue de ce correctif. Les
cinq points n'ont donc **pas** été recopiés d'un texte : ils ont été retrouvés
**dans le code et les tests livrés**, un par un, sans en inventer aucun (le
détail de la recherche est donné pour chaque point). Aucun des cinq n'a été
écarté : tous les cinq se retrouvent sur le disque.

La fonctionnalité elle-même n'a **pas** été retouchée : aucun changement de
comportement visible, aucune nouvelle fonctionnalité, aucun réglage, aucun
changement Rust.

---

## Point 1 — le drapeau devenu mort `refreshFetchedSupervision`

**Constat (vérifié)** : `grep -rn refreshFetchedSupervision src/ src-tauri/` ne
renvoyait qu'une déclaration et **deux écritures**, **aucune lecture** :
`let refreshFetchedSupervision = false;` (+ son commentaire « Le vol en cours
a-t-il lu la supervision COMPLÈTE ? »), `refreshFetchedSupervision = true` avant
l'`invoke` lourd, `refreshFetchedSupervision = false` dans le `.finally()`. La
garde de réentrance raisonne désormais sur des **instants**
(`refreshPendingForceAt` / `refreshReadStartedAt`), plus sur ce drapeau.

**Fait** : déclaration, commentaire et les deux affectations supprimés
(`src/js/agent-activity.js`). Le docstring de `activityRefresh` qui citait ce
drapeau a été reformulé (« savoir qu'une lecture a eu lieu ne dit pas qu'elle a
eu lieu **après** l'écriture du prompt »), et la mention historique du test
(« `refreshFetchedSupervision` suffisait à l'absorber ») est passée au passé
(« l'ancien drapeau … retiré ») : plus aucune référence à un symbole absent.

**Preuve** : `grep -rn refreshFetchedSupervision src/` → **0 occurrence**.
`node --check src/js/agent-activity.js` OK, `npm test` vert (voir plus bas).
Comportement observable inchangé : la ligne supprimée n'était jamais lue.

## Point 2 — le cas « demande SAUTÉE puis REJOUÉE » n'était pas verrouillé

**Constat (vérifié)** : dans `activityRefresh`, la décision est
`const replay = refreshPendingForce && pendingAt >= readStartedAt;`. Le verrou
existait **pour la seule branche « rejouée »** (demande tombée pendant la
lecture) ; la branche **« sautée »** — une demande arrivée pendant un vol mais
**avant** le début de la lecture lourde, donc légitimement satisfaite par cette
lecture, **sans aucune lecture inutile** — n'était couverte par aucun test : on
pouvait remplacer la condition par `const replay = refreshPendingForce;` et la
suite restait verte.

**Fait** : nouvel it « une demande SAUTÉE (la lecture commence après elle) puis
une demande REJOUÉE » dans
`src/js/libelle-tache-en-cours-mission-reelle.test.js`. Il rejoue le **store
réel** (`subscribeAgentActivity`) avec `invoke` simulé et deux portes :

1. le vol est retenu sur sa **sonde légère** (`lightGate`), la demande forcée est
   déposée, le prompt de la mission B est écrit, puis la sonde est libérée : la
   lecture lourde commence **après** la demande et lit le bon texte ⇒
   **2 lectures lourdes** en tout (aucun rejeu) et la colonne affiche B ;
2. la même demande, mais tombant **pendant** la lecture lourde (`gate`) ⇒ elle est
   **rejouée une seule fois** : **4 lectures** au total et la colonne affiche C
   (`MISSION_C`).

**Preuve (test rouge sans la protection)** : en remplaçant temporairement la
condition par `const replay = refreshPendingForce;`, le fichier échoue sur
`expect(heavyCalls).toBe(2)` → **`expected 3 to be 2`** (la demande sautée était
rejouée pour rien). Condition restaurée : `PASS (11) FAIL (0)`.

## Point 3 — la formulation fautive du commentaire « des l'envoi »

**Constat (vérifié)** : la seule formulation fautive autour de « l'envoi » dans le
code du correctif est `src/js/agent-activity.js:328` :
« Le prompt est pourtant enregistre par le coeur **des l'envoi** et publie »
(phrase incompréhensible : il fallait « dès l'envoi »). `grep -rn "des l'envoi"
src/` ne renvoyait qu'elle. Aucun texte **visible** (interface, handbook, bloc
`<!-- HELP:* -->`, message d'état, infobulle) ne contient de tournure fautive :
le seul autre « l'envoi » du fichier est correct (« bloque jamais l'envoi »).

**Fait** : phrase corrigée en « est pourtant enregistre par le coeur **dès
l'envoi** et publie ». Aucun test ne dépend du texte d'un commentaire (`grep`
des assertions sur cette phrase : aucune) : rien d'autre n'a bougé, et aucune doc
n'a eu à changer.

**Ce qui est volontairement laissé** : le reste du commentaire (orthographe sans
accents, style télégraphique) appartient au fichier tel qu'il est depuis des
mois ; le retoucher sortirait du périmètre (« on nettoie et on verrouille, on ne
refait pas »).

## Point 4 — la limite mal gérée quand une lecture échoue

**Constat (vérifié)** : quand `get_agent_supervision` **rejetait**, l'instant de
début de la lecture restait posé (`refreshReadStartedAt`) et la lecture comptait
donc comme « commencée après la demande » ⇒ une demande forcée arrivée pendant ce
vol était **absorbée** (`replay = false`) alors que **rien** n'avait été lu :
libellé figé sur la mission précédente, sans aucun mécanisme pour le rattraper
(la signature n'est pourtant pas mémorisée en cas d'échec, donc la sonde
suivante, elle, retente). Aucun test ne couvrait ce cas.

**Fait** (`src/js/agent-activity.js`, `runActivityRefresh`) : la lecture lourde
est isolée dans un `try`, et **en cas d'échec son instant de début est remis à
zéro** (`if (refreshReadStartedAt === readStartedAt) refreshReadStartedAt = 0;`)
puis `return` — le vol n'a **rien** lu, il ne satisfait donc **aucune** demande :
la demande forcée arrivée pendant le vol est rejouée. L'affichage connu est
conservé (aucune publication), aucune exception ne remonte (fail-open
inchangé), la signature n'est pas mémorisée (la prochaine sonde retente).

**Preuve (test rouge sans la correction)** : nouvel it « une lecture lourde qui
ÉCHOUE ne satisfait aucune demande : la relecture est REJOUÉE » (même harnais :
le vol est retenu sur la sonde légère, la demande est déposée, puis la lecture
lourde échoue — `heavyFail`). Attendu : **3 lectures** (initiale, échouée,
rejouée) et la colonne affiche B. En retireant la remise à zéro, le fichier
échoue sur **`expected 2 to be 3`** (demande absorbée, texte resté sur A).
Correction restaurée : `PASS (11) FAIL (0)`.

## Point 5 — l'assertion dupliquée

**Constat (vérifié)** : la fin du cas « lecture lourde EN VOL … » répétait deux
fois mot pour mot
`expect(texteEnCours(published.at(-1))).not.toContain("barre du bas");`.

**Fait** : la seconde occurrence est supprimée. La couverture réelle ne perd rien
(l'assertion restante est identique, et la ligne suivante vérifie déjà le **bon**
texte de la mission B, ce qui est plus fort qu'une absence).

**Preuve** : `grep -c "not.toContain(\"barre du bas\")" ` sur le fichier → une
seule occurrence dans ce cas ; `PASS (11) FAIL (0)`.

---

## Ce qui n'a PAS bougé (voulu)

- la fonctionnalité du titre de tâche : point d'entrée unique
  `refreshAgentMissionDisplay()`, ses deux seuls appels (`agents-bus.js`,
  `super-agent.js`, tous deux `void`), la sonde de 2 s restée **légère** ;
- la composition de la file et le rang → mission (`project-queue-view.js`,
  `project-task-queue.js`), la barre du bas (`enfilerDemande`), les réglages de
  lecture à voix haute / VoiceStudio ;
- **aucune** ligne Rust (`src-tauri/` non touché) ; aucun test existant
  assoupli ni supprimé (seule l'assertion strictement dupliquée du point 5 a été
  retirée) ;
- aucun changement de comportement **visible** ⇒ ni `README.md` ni bloc
  `<!-- HELP:* -->` à régénérer. `spec_modes_ecran_vocal.md` § 3ter a seulement
  été remis en accord avec le code : le drapeau cité est dit **retiré**, la règle
  d'ordre est énoncée telle qu'elle est, le cas « lecture échouée » est ajouté et
  le verrou annonce ses trois branches.

## Vérifications exécutées

| Vérification | Résultat |
|---|---|
| `npx vitest run src/js/libelle-tache-en-cours-mission-reelle.test.js` | **PASS (11) / FAIL (0)** (9 avant, 2 ajoutés) |
| le même fichier **sans** la règle d'ordre (`replay = refreshPendingForce`) | 1 échec — `expected 3 to be 2` (cas « sautée ») |
| le même fichier **sans** la remise à zéro sur échec | 1 échec — `expected 2 to be 3` (cas « lecture échouée ») |
| `npm test` (suite complète) | **282 fichiers, 5 209 tests, 0 échec** |
| `node --check` sur les deux fichiers JS touchés | OK |
| `grep -rn refreshFetchedSupervision src/` | 0 occurrence |
| `cargo` / `src-tauri` | **non touché** |

VERDICT : les cinq finitions sont traitées et **chacune est vérifiable** — le
drapeau mort est supprimé (0 occurrence), les deux branches jusque-là non tenues
de la règle de fraîcheur ont un test qui **échoue** quand on retire la protection
(`3 to be 2` pour la demande sautée, `2 to be 3` pour la lecture échouée), la
formulation fautive « des l'envoi » est corrigée, et l'assertion dupliquée est
supprimée sans perte de couverture. Aucune fonctionnalité retouchée, aucun test
assoupli, rien de publié.
