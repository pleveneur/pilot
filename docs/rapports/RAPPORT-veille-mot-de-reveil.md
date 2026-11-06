# Rapport — la veille au bout de 20 secondes de silence, et « arrête d'écouter »

## 1. Ce qui change, en une phrase
Avant : dès l'entrée dans l'écran Vocal, il fallait dire le nom pour que quoi
que ce soit se passe. Maintenant : on parle normalement, **sans nom**, et c'est
**seulement après 20 secondes de silence** que l'écran se met en veille et
exige le nom. Et l'on peut dire à voix haute « arrête d'écouter » pour la
mettre en veille soi-même, tout de suite.

## 2. La décision du propriétaire

> « Dès qu'on arrive en mode vocal, l'assistant écoute ce qu'on dit. Au bout
> d'un moment donné (20 s) sans parler, le wakeword se met en place : on est
> obligé d'appeler l'assistant ou le personnage par son nom pour le réveiller. »
> Puis : « je veux aussi pouvoir dire à l'assistant d'arrêter d'écouter, donc il
> doit pouvoir lui-même se mettre en mode attente du wakeword. »

> **Travail déjà commencé sur le disque** : le rapport de diagnostic
> `docs/rapports/RAPPORT-diagnostic-mot-de-reveil.md` (écrit lors d'une mission
> précédente, laissé intact) décrivait huit comportements possibles sans en
> recommander aucun. Celui qui est mis en œuvre ici est son **comportement D**
> (« garde ouverte pour la conversation en cours, réarmée après un long
> silence »), avec la durée fixée par le propriétaire (**20 s**) et un arrêt
> demandé à la voix qui n'y figurait pas. Aucun de ces deux fichiers n'a été
> déplacé.

## 3. Le cycle complet, tel qu'il est codé

| Moment | Ce qui se passe | Ligne d'état |
|---|---|---|
| Entrée dans l'écran Vocal | **écoute libre** : aucun nom exigé, le compte de 20 s démarre | « Je vous écoute… » |
| Une phrase quelconque est dictée | elle **part**, comme toujours (même envoi `send()`) | inchangée |
| Une parole est détectée (même non transcrite) | le compte **repart de 20 s** | inchangée |
| 20 s de silence **sans une seule parole** | la veille s'arme : la garde du nom s'applique | « Dites « Nom » pour me parler. » |
| Le nom (ou un mot de réveil réglé) est entendu | la veille tombe, **le compte des 20 s repart** | « Je vous écoute… » |
| « Arrête d'écouter » est entendu | la veille s'arme **immédiatement** | « Je me mets en veille — dites « Nom » pour me parler. » |
| La formule est répétée en veille | **rien** : aucun message, aucun envoi | inchangée |
| Sortie du mode (logo, Échap, fermeture) | minuteur annulé, veille défaite | — |

Points de branchement, tous EXISTANTS (`src/js/super-agent.js`) :

- `enterVocal()` — la veille repart à faux, le compte démarre (une seule fois) ;
- `vocalNoteWord()` — chaque texte reçu repart le compte ;
- `vocalSetLevel()` — chaque **parole mesurée** repart le compte (le cas d'un
  moteur qui n'a pas encore transcrit) ;
- `rec.onresult` — la formule d'arrêt est reconnue **avant** l'écriture dans la
  zone, et la garde reçoit `ecouteLibre` ;
- `rec.onend` — la formule est reconnue **avant** la garde du nom (sinon un
  moteur qui ne rend le texte qu'à la fermeture l'enverrait comme une demande) ;
- `vocalStatusLine()` — l'accusé, sur la ligne d'état unique ;
- `exitVocal()` — tout meurt avec l'écran.

**Décision tranchée et documentée** : l'arrêt de l'**écoute** n'est pas l'arrêt
d'une **tâche**. Une veille ne prétend jamais avoir interrompu le travail : si
une mission tourne, elle continue et l'écran le montre comme avant. La veille ne
ferme pas le micro et ne coupe pas la lecture.

Aucun réglage nouveau. Un mot de réveil déjà réglé continue de marcher, **en
plus** du nom (jamais à sa place). La saisie **clavier** n'est jamais filtrée.

## 4. La liste exacte des formules d'arrêt

Une seule liste, une seule constante : `VOCAL_STOP_FORMULAS`
(`src/js/vocal-nom-garde.js`, douze formules) :

1. `arrête d'écouter`
2. `arrête l'écoute`
3. `arrête d'écouter s'il te plaît`
4. `stoppe l'écoute`
5. `stop l'écoute`
6. `n'écoute plus`
7. `tais-toi`
8. `silence`
9. `au repos`
10. `tu peux te reposer`
11. `mets-toi en veille`
12. `mode veille`

**La reconnaissance est stricte** : la phrase normalisée (casse, accents,
apostrophes, ponctuation et espaces ignorés) doit être **entièrement égale** à
une formule. « Silence, le dossier est vide », « mets le projet au repos » ou
« arrête d'écouter la radio » **ne coupent pas** l'écoute — dans le doute, on
continue d'écouter.

## 5. Les tests ajoutés

Fichier neuf : **`src/js/veille-mot-de-reveil.test.js`** (24 tests).

| Test demandé | Où il est | Ce qu'il prouve |
|---|---|---|
| (a) arrivée en mode vocal, phrase sans nom acceptée | §1 « justement après l'entrée… » + « le même texte, une fois le compte échu, est jeté » | `ecouteLibre` laisse passer, la garde reste désarmée |
| (b) 20 s de silence ⇒ la garde s'arme | §1 « au bout de 20 s de silence » | `VOCAL_ECOUTE_LIBRE_MS = 20000`, armement à l'échéance exacte |
| (c) le nom lève la garde et le compte repart | §1 « le nom lève la garde… » + §3 `vocalExitVeille()` | raison `nom-entendu`, relance du minuteur |
| (d) une parole régulière empêche l'armement | §1 « une parole régulière empêche l'armement » + §3 `vocalNoteWord` / `vocalSetLevel` | le compte repart sur un mot ET sur un niveau mesuré |
| (e) « arrête d'écouter » ⇒ attente du mot de réveil | §2 + §3 « reconnue AVANT d'écrire, et n'écrit rien » | les 12 formules, aucune écriture ni envoi |
| (f) une phrase ordinaire ne coupe pas l'écoute | §2 « comparaison STRICTE » + « une phrase ordinaire ne coupe JAMAIS » | six phrases pièges, dont trois contenant les mots |
| (g) en attente, la formule répétée ne dit rien | §2 « en attente, la formule répétée ne produit RIEN » | `deja-en-veille` → `VOCAL_STOP_RIEN`, et la phrase est jetée |

Plus les verrous de **branchement** (§3) : une seule constante de 20 s, une
seule liste de formules (aucune recopiée dans l'écran), le compte armé à
l'entrée et défait à la sortie, la phrase d'arrêt reconnue avant la garde, un
seul `applyVoiceEnd`, une seule composition de l'accusé, et le module qui reste
pur. Et §4 : hors de l'écran Vocal, rien ne change (agent π, web distant).

### Preuve que ces tests mordent (mutations réelles, une par une)

Chaque mutation a été appliquée au code, la suite du fichier relancée, puis le
code restauré (nombre de tests en échec) :

| Mutation | Échecs |
|---|---|
| `VOCAL_ECOUTE_LIBRE_MS` 20000 → 0 | **3** |
| règle « écoute libre » retirée de la garde | **1** |
| formule comparée par sous-chaîne au lieu de la phrase entière | **1** |
| veille qui ne s'arme jamais (`armer: false`) | **1** |
| formule d'arrêt sans effet en veille (message répété) | **1** |
| `ecouteLibre` non transmis à la garde | **1** |
| phrase d'arrêt non reconnue à la dictée | **2** |
| compte non relancé sur un mot | **1** |
| veille non défaite à la sortie du mode | **1** |
| accusé jamais affiché | **1** |
| phrase d'arrêt placée **après** la garde en fin d'écoute | **1** |
| bloc d'arrêt absent en fin d'écoute | **1** |

Sur l'ancien code (avant cette évolution), les tests (a), (b), (c), (d), (e),
(f) et (g) n'auraient pas pu exister : ni `decideVocalVeille`, ni
`decideVocalStopListening`, ni `VOCAL_ECOUTE_LIBRE_MS` n'existaient.

## 6. Résultat réel de la suite complète

```
npx vitest run      →  PASS (5801)  FAIL (0)
```

Aucun test affaibli, ignoré, désactivé ni supprimé. Trois fichiers existants
touchés pour rester en accord avec la nouvelle règle :

- `src/js/vocal-nom-garde.test.js` §5 : la ligne d'état est désormais dite quand
  `vocalVeilleArmee === true` (et non plus « réveillé pour une phrase ») ;
- `src/js/super-agent.js` : ligne d'état, garde, compte à rebours, arrêt ;
- `src/js/vocal-nom-garde.js` : décisions pures (sept règles ordonnées),
  constantes, phrases.

## 7. Vérifications manuelles en mode dev (`npm run tauri dev`)

1. Entrer en Vocal (logo) et **parler sans dire le nom** : la phrase part.
2. Ne plus rien dire **20 s** : la ligne passe à « Dites « Nom » pour me
   parler. » — puis une phrase **sans** le nom ne part plus.
3. Dire le nom : la ligne revient à « Je vous écoute… » et une phrase
   ordinaire repart aussitôt.
4. Rétablir la veille (20 s de silence) puis dire **« arrête d'écouter »** :
   la ligne affiche une seule fois « Je me mets en veille — dites « Nom » pour
   me parler. », **rien n'est envoyé**.
5. Répéter « arrête d'écouter » : **aucun** nouveau message.
6. Dire « Silence, le dossier est vide » : la phrase part normalement (elle
   n'est pas une formule d'arrêt).
7. Vérifier que le clavier n'est jamais filtré, et que le bouton « Réveiller »
   fonctionne toujours pour une phrase.
