# Rapport — relances : 4ᵉ audit (dernière boucle avant publication)

> Mission : corriger **exactement** les trois points rendus « PAS ENCORE » par
> l'audit indépendant du commit `42d3015`, sans rien élargir.
> Base de départ : `42d3015`.

## État des trois points

| # | Point | État |
|---|---|---|
| 1 | Verrou « règle périmée » ordonné + occurrence vivante `super-agent-schedule.js:22-23` | ✅ corrigé |
| 2 | Inventaire des découpages : vert par construction (commentaires neutralisés avant les chaînes) | ✅ corrigé |
| 3 | Texte d'aide faux (relance seule non bornée) + compte d'omis inexact | ✅ corrigé |

## Mesures AVANT (relevées sur `42d3015`, avant toute modification)

Commande de mesure (script jetable hors dépôt) : nombre de fichiers de test dont
le texte neutralisé perd des **lignes** vs la source, et nombre de positions
d'injection d'un découpage non protégé qui échappent au détecteur.

```
fichiers de test : 162
fichiers qui PERDENT des lignes : 35
  (ex. src/js/gds-admin.test.js : 1177 ligne(s) perdue(s),
       src/js/relances-relecture.test.js : 570 ligne(s) perdue(s))

relances-relecture.test.js : 34 positions testées, 6 attrapées, 28 aveugles
  lignes aveugles : 81, 101, 121, … 621
```

Cause : `neutraliserSource` retirait les commentaires de ligne **avant** les
chaînes. Une chaîne contenant `//` faisait effacer la fin de la ligne ; les
guillemets se déséquilibraient, la « chaîne » suivante absorbait plusieurs lignes
(le remplacement `""` **supprime** les retours à la ligne) et ces lignes
devenaient invisibles au détecteur.

## Mesures APRÈS

### Point 2 — la neutralisation ne perd plus de lignes (mesure dans la suite de tests)

Deux verrous NOUVEAUX dans `src/js/source-slice.test.js` :

```
it la neutralisation conserve TOUTES les lignes (mesure : 0 fichier sur 162)
   AVANT : 35 fichiers perdants (ex. src/js/agent-activity.test.js : 85 lignes altérées)
   APRÈS : 0 fichier perdant

un découpage non protégé INJECTÉ est refusé PARTOUT dans le code des tests
   AVANT : 110 positions aveugles (sur 1 005 positions de code testées)
   APRÈS : 0 position aveugle

toutes les positions de relances-relecture.test.js sont couvertes
   AVANT : 37 lignes aveugles (81, 101, … 841) — fichier déjà allongé par les
           nouveaux tests, donc 42 positions échantillonnées ; sur le fichier
           d'origine (34 positions) c'était 28 aveugles
   APRÈS : 0 ligne aveugle (42 positions testées, 42 attrapées)
```

Mesure indépendante (script jetable hors dépôt, même règle d'échantillonnage,
comparaison module de `42d3015` vs module corrigé) :

```
AVANT : {"pos":1005,"blind":108,"perd":35,"total":162}
APRÈS : {"pos":1005,"blind":0,"perd":0,"total":162}
```

Cause corrigée : `neutraliserSource` est désormais un **balayage caractère par
caractère** à état (code / commentaire de bloc / commentaire de ligne / chaîne /
gabarit), avec gestion des échappements et arrêt à la fin de la ligne si un
guillemet n'est jamais refermé (une apostrophe isolée n'efface donc plus de
lignes). Les retours à la ligne sont toujours conservés.

### Point 2 bis — l'inventaire est désormais EXACT (plus un plafond)

Cinq relevés ont dû être recomptés, non par indulgence mais parce que le
détecteur était **aveugle** sur ces zones :

| Fichier | Avant | Après (mesuré) |
|---|---|---|
| `src/js/panneau-suivi-trois-onglets.test.js` | 8 | 9 |
| `src/js/taille-et-style-panneau.test.js` | 1 | 6 |
| `src/js/updater-attente-terrain.test.js` | 1 | 2 |
| `scripts/mcp-client-extension.test.js` | *(absent)* | 1 |
| `src/js/telegram-notify-setting.test.js` | *(absent)* | 1 |

L'assertion est passée de « ≤ plafond » à **égalité** : réparer un site oblige à
baisser le compte, en ajouter un fait échouer le test. Les deux fichiers réparés
au 3ᵉ audit (`read-aloud.test.js`, `relances-relecture.test.js`) restent tenus à
zéro par l'assertion explicite.

### Point 1 — verrou insensible à l'ordre, à synonymes, tolérant au commentaire

`src/js/super-agent-schedule.js:22-23` : l'occurrence vivante
(« une / // relance par passe = un prompt système complet ») est **réécrite** :
elle dit maintenant la raison (« chaque relance coûtait un prompt système
complet, donc un tour complet de l'assistant ») sans énoncer la règle remplacée.

`src/js/relances-relecture.test.js` : le verrou ne cherche plus des phrases
ordonnées mais des **motifs** :

- `QTE` (un seul / au plus une / qu'une / jamais deux / 1 …) × `CIBLE`
  (relance / rappel / déclenchement / fire / exécution), reliés à `PASSE`
  (passe / tick / planification) dans **les deux ordres** ;
- préfixe de commentaire et retour à la ligne tolérés entre les mots
  (`ENTRE_MOTS`, `[\s/*#>|~_-]*`), ce qui attrape l'occurrence multiligne ;
- forme « livrée par passe » et forme « 1 fire/tick » conservées.

Deux tolérances, nommées dans le code :

1. une **citation** de l'ancienne règle (entre guillemets français « … », ou
   précédée de « et non ») est admise — sinon la spec ne pourrait plus expliquer
   ce qu'elle a remplacé. La spec a été mise en forme pour que ce cas soit
   explicite : « … se contredisait en posant à la fois « un déclenchement unique
   par tick » et un plafond de livraison sans dire lequel prime » ;
2. une occurrence qui parle d'« un seul **ENVOI** par passe » (règle appliquée :
   l'unité limitée est le nombre d'envois, pas le nombre de relances) n'est pas
   comptée.

Preuve en trois temps :

```
les 9 formulations (4 déjà attrapées + les 5 inédites de l'audit) : attrapées
   « Chaque passe ne livre qu'une relance. »
   « Règle : un seul rappel déclenché par passe. »
   « Le ticker ne traite qu'un rappel à chaque passe. »
   « On n'envoie jamais deux relances dans la même passe. »
   « 1 déclenchement de relance par tick. »

chacune des 5, insérée dans spec_super_agent.md (le vrai périmètre) :
   exit=1, « règle périmée posée comme appliquée » (5 fois sur 5)

ancien commentaire de super-agent-schedule.js restauré :
   exit=1, « src/js/super-agent-schedule.js : règle périmée posée comme
   appliquée → « une // relance par passe » » ; restauré ensuite : PASS (34)
```

### Point 3 — borne par relance sur le chemin « relance seule » + compte d'omis exact

`src/js/super-agent-schedule.js` :

- `renderReminderItemWithin` (lot) et la branche « une seule relance » partagent
  désormais un seul rendu borné (`renderReminderWithin`) : la relance **seule**
  est bornée à `REMINDER_ITEM_MAX_CHARS` (450) elle aussi, préfixe
  `[⏰ Rappel programmé] ` compris ; `capReminderMessage` (plafond global 4000)
  reste en ceinture et bretelles mais n'a plus rien à couper ;
- le nombre de caractères **omis** est calculé sur le texte **réellement rendu**
  (`total.length - Array.from(coupe).length`) et non sur la longueur visée
  (`keep`), donc l'avis est exact.

Mesure du défaut de l'audit, puis du correctif (module `42d3015` vs module
corrigé, même entrée) :

```
relance SEULE de 20 000 caractères
  AVANT : message = 4 000 car., delivered = 1, avis « lot tronqué : 12197 omis »
  APRÈS : message =   447 car., delivered = 1, avis « relance tronquée : 15685 omis »

compte d'omis, lot de 4 relances tronquées
  AVANT : annoncé 471, réel 473 (2 caractères d'écart)
  APRÈS : annoncé 473, réel 473
```

Deux verrous nouveaux (`src/js/relances-relecture.test.js`) :

- « une relance SEULE très longue est bornée PAR RELANCE, comme dans un lot »
  (message ≤ 450, aucun avis « lot tronqué », avis « relance tronquée » présent,
  préfixe historique conservé, relance courte intacte) ;
- « l'avis de troncature annonce les caractères RÉELLEMENT omis » : le nombre
  annoncé est confronté au texte réellement rendu, sur 4 tailles et sur un lot
  de 4 relances (chaque avis colle à SA relance).

Neutralisation/restauration : avec l'ancien chemin seul restauré,
`exit=1` sur `AssertionError: expected 4000 to be less than or equal to 450` et
`aucun avis pour 451` ; restauré ensuite : PASS (34).

### Documentation

- `spec_super_agent.md` § point 5 : la borne par relance est dite valable **aussi
  pour la relance livrée seule**, et le compte d'omis est dit **exact** (calculé
  sur le texte rendu).
- `help/handbook.md` régénéré (`npm run build:handbook`) dans le même commit.

## Verifications finales (chiffres réels)

```
npm test
  Test Files  162 passed (162)
       Tests  2813 passed (2813)

cargo test --manifest-path src-tauri/Cargo.toml --lib
  cargo test: 722 passed, 1 ignored
```

## Commit

Un seul commit local, au-dessus de `42d3015` : `0ad7815` —
`fix(relances): 4e audit — les trois points rendus « pas encore »`
(6 fichiers : `src/js/source-slice.js`, `src/js/source-slice.test.js`,
`src/js/super-agent-schedule.js`, `src/js/relances-relecture.test.js`,
`spec_super_agent.md`, `help/handbook.md` régénéré).

Ce rapport reste **non suivi** (comme les autres `RAPPORT-*.md`), aucun bump de
version, aucun tag, aucune publication, l'application n'a pas été lancée.
