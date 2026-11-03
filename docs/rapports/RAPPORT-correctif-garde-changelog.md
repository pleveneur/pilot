# Rapport — correctif de la garde du changelog (publication débloquée)

Correctif : la porte du changelog ne réclame plus un nom de fichier qui
n'existe pas. Elle cherche **le fichier de la convention réelle du dépôt**
(`release-notes/vX.Y.Z.md`), sans perdre son intention : **un changelog reste
obligatoire**, et une publication sans note lisible par l'utilisateur est
toujours refusée.

- Date : 2026-11-16
- Verrou : `scripts/release-gates.test.js` (dont deux tests neufs, la
  convention du dépôt et l'exactitude du nom réclamé)
- Décision pure : `scripts/release-gates.js` (`notesPathForTag`)

---

## 1. Ce qui était cassé, et pourquoi

`notesPathForTag(tag)` retirait le `v` du tag avant de composer le chemin :

```js
return `release-notes/${String(tag || "").replace(/^v/, "")}.md`;
```

Pour l'étiquette `v0.6.12`, la porte cherchait donc `release-notes/0.6.12.md`.
Or **aucun fichier de ce dossier ne porte un nom sans `v`** : la convention
écrite dans `AGENTS.md` (« Rédiger le changelog utilisateur
`release-notes/vX.Y.Z.md` ») et suivie par tous les fichiers déjà commités
impose le `v`. Le fichier `release-notes/v0.6.12.md` existait, commité, et
n'était jamais lu.

Conséquence : la porte était **infalsifiablement rouge**. Elle refusait
*toutes* les versions, y compris celles dont le changelog existait, avec un
message qui désignait un fichier que personne ne crée. La publication de la
0.6.12 s'est arrêtée là : aucune Release, aucun artefact distribué.

Un test figeait ce défaut :

```js
expect(notesPathForTag("v1.2.3")).toBe("release-notes/1.2.3.md");
```

---

## 2. Le correctif

Une seule fonction calcule ce chemin (les deux scripts de publication
l'importent, ils ne le recopient pas) :

```js
export function notesPathForTag(tag) {
  const version = String(tag || "").trim().replace(/^v/i, "");
  return `release-notes/v${version}.md`;
}
```

- le `v` est **ajouté** s'il manque, **jamais doublé** : `v1.2.3`, `1.2.3`,
  `V1.2.3` et ` v1.2.3 ` désignent tous `release-notes/v1.2.3.md` ;
- rien d'autre ne change : `create-release.js` et `gen-latest-json.js`
  continuent d'appeler la même fonction, la décision reste pure, la sortie de
  secours explicite `ALLOW_MISSING_RELEASE_NOTES=1` reste la seule façon de
  publier sans changelog (et reste tracée en `::warning::`) ;
- dans `gen-latest-json.js`, les deux candidats (`tag` et `VERSION`) désignent
  désormais le même fichier quand les deux concordent : la lecture est
  dédoublonnée par un `Set`, aucun fichier n'est lu deux fois.

---

## 3. Le test retourné (et non supprimé)

L'assertion qui figeait le défaut est **retournée** :

```js
expect(notesPathForTag("v1.2.3")).toBe("release-notes/v1.2.3.md");
expect(notesPathForTag("1.2.3")).toBe("release-notes/v1.2.3.md");
expect(notesPathForTag("V1.2.3")).toBe("release-notes/v1.2.3.md");
expect(notesPathForTag("v1.2.3")).not.toContain("vv");
```

L'intention d'origine reste vérifiée, et même renforcée :

| Intention d'origine | Où elle est vérifiée maintenant |
|---|---|
| un titre seul n'est pas un changelog | `hasReadableNotes` (inchangé) |
| **sans note lisible, la publication est refusée** | `evaluateReleaseNotes({ tag })` → `ok: false` |
| **le refus nomme le fichier attendu** | le refus contient `notesPathForTag(tag)`, donc `release-notes/v1.2.3.md` |
| le refus ne nomme **jamais un chemin voisin** | le refus ne contient **pas** `release-notes/1.2.3.md` (nouveau test) |
| l'acceptation explicite reste possible mais **tracée** | `ALLOW_MISSING_RELEASE_NOTES` (inchangé) |
| le chemin n'est écrit qu'à un seul endroit | `create-release.js` et `gen-latest-json.js` importent `notesPathForTag`, aucun ne recopie `release-notes/${…}` (inchangé) |

Deux tests neufs :

1. **« le refus nomme EXACTEMENT le fichier attendu, jamais un chemin
   voisin »** — quatre écritures du tag, une seule réponse attendue ; un refus
   qui nommerait un autre fichier que celui que la porte lit enverrait
   l'utilisateur écrire un changelog… que la porte ignorerait. C'est
   précisément le défaut corrigé.
2. **« chaque changelog de `release-notes/` est atteint par la porte »** — le
   test lit le dossier et vérifie, pour **chaque** fichier `vX.Y.Z.md` présent,
   que `notesPathForTag` désigne **ce** fichier. Ce n'est plus une chaîne
   inventée dans le test : c'est la vérité du dépôt. Ce test échouera si un
   jour la convention change sans que le calcul suive.

---

## 4. Preuve par mutation (faite, rouge puis vert)

1. **Mutation** : l'ancien calcul est remis tel quel dans `release-gates.js`
   (`return \`release-notes/${String(tag || "").replace(/^v/, "")}.md\`;`) →
   la suite du verrou **échoue** (quatre tests rouges), notamment :

   - `sans note lisible, la publication est REFUSEE et dit ou ecrire` :
     `expected 'Aucun changelog lisible pour v1.2.3 :…' to contain 'release-notes/v1.2.3.md'` ;
   - `le refus nomme EXACTEMENT le fichier attendu, jamais un chemin voisin` ;
   - `chaque changelog de release-notes/ est atteint par la porte` :
     `v0.2.14 -> release-notes/0.2.14.md introuvable` ;
   - `le chemin du changelog n'est ecrit qu'a un seul endroit` :
     `expected 'release-notes/1.2.3.md' to be 'release-notes/v1.2.3.md'`.

2. **La porte ne trouve plus le fichier existant** (mutation toujours en
   place, étiquette réelle `v0.6.12` — c'est la reproduction exacte de
   l'incident) :

   ```json
   {
     "cheminCalcule": "release-notes/0.6.12.md",
     "fichierReel(v0.6.12.md)": true,
     "trouveParLaPorte": false,
     "decision": "REFUSE",
     "raison": "Aucun changelog lisible pour v0.6.12 : release-notes/0.6.12.md est OBLIGATOIRE …"
   }
   ```

3. **Rétablissement** (le fichier est restauré à l'identique, `git diff` ne
   montre que le correctif) → la suite repasse **entièrement au vert**.

---

## 5. Contrôle concret, local, sans réseau et sans rien publier

Sur l'étiquette `v0.6.12`, avec le correctif en place :

```json
{
  "tag": "v0.6.12",
  "cheminCalcule": "release-notes/v0.6.12.md",
  "trouveParLaPorte": true,
  "decision": "AUTORISE",
  "raison": "changelog fourni pour v0.6.12"
}
```

Et **l'absence de changelog est toujours refusée**, avec le bon fichier
nommé :

```json
{
  "ok": false,
  "accepted": false,
  "reason": "Aucun changelog lisible pour v9.9.9 : release-notes/v9.9.9.md est OBLIGATOIRE pour qu'une mise à jour soit compréhensible par l'utilisateur."
}
```

Aucun appel réseau, aucune Release créée, aucun tag touché, aucune version
bumpée : seules des fonctions pures et le disque local ont été lus.

---

## 6. Suites de tests

- Tests du front (`npm test`, Vitest) : **toutes vertes**.
- Tests Rust du bureau (`cargo test --manifest-path src-tauri/Cargo.toml
  --lib`) : **aucun échec** (même bilan que l'état antérieur, un test ignoré
  restant ignoré).
- Documentation intégrée : `npm run build:handbook` régénéré → `help/handbook.md`
  **inchangé** (aucun bloc `<!-- HELP:* -->` ne décrit ce chemin), donc aucune
  retouche de la doc embarquée.

*Les nombres de tests ne sont volontairement pas figés ici : ils changent à
chaque évolution et figeraient une information fausse.*

---

## 7. Fichiers touchés

- `scripts/release-gates.js` — `notesPathForTag` corrigé (calcul unique),
  commentaire d'en-tête mis à jour ;
- `scripts/release-gates.test.js` — assertion **retournée**, deux tests neufs
  (nom exact réclamé, chaque changelog du dépôt atteint) ;
- `scripts/create-release.js`, `scripts/gen-latest-json.js` — commentaires
  alignés sur le nom réel, lecture dédoublonnée des candidats ;
- `spec_pilot.md` (§ Mises à jour) — le nom exact exigé par la porte et son
  caractère obligatoire sont désormais écrits ;
- ce rapport.

---

## 8. Ce qui n'a PAS été fait (et ne devait pas l'être)

- **aucune publication, aucun tag, aucun push, aucun bump de version** : le tag
  `v0.6.12` existe déjà et n'a été ni déplacé ni recréé ; la publication
  suivante se fera en `0.6.13`, par un autre agent ;
- le **caractère obligatoire** du changelog n'a été ni supprimé ni assoupli :
  seule la façon de trouver le fichier a changé ;
- les **autres verrous du lot B** (livraison incomplète, tag déjà publié) et la
  **topologie de la chaîne d'intégration** n'ont pas été touchés ;
- aucun outil de suivi de sessions d'agents n'a été appelé.

VERDICT : la porte du changelog lit désormais le fichier que le dépôt écrit
réellement (`release-notes/vX.Y.Z.md`), ce qui débloque la publication sans
rien relâcher — le refus sans changelog reste actif et nomme le bon fichier.
Preuve dans les deux sens : ancien calcul → quatre tests rouges et le fichier
`v0.6.12.md` introuvable pour l'étiquette `v0.6.12` ; calcul corrigé → suite
verte et fichier trouvé.
