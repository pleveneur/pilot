# Rapport — le bouton « tout masquer » effaçait le portrait

Date : 2026-10-31 (soir) · Projet : `G:\IA_PL\pilot` · Écran Vocal, état nu (§4ter)
Signalement du propriétaire : « il efface tout, y compris le portrait ».
Règle du propriétaire, inchangée depuis le 2026-10-29 : **un seul bouton discret,
qui masque tout SAUF le portrait**. Le portrait ne doit **jamais** être masqué ni
déplacé par ce bouton.

---

## 1. Ce que le bouton masque aujourd'hui — la preuve exacte

Le masquage n'est **pas** une liste de choses à garder : c'est une **liste de
nœuds à éteindre**, écrite en CSS. Tout ce qui est *dans* un nœud nommé s'éteint
avec lui, sans qu'aucune règle ne le nomme (`opacity: 0` sur un ancêtre ne peut pas
être annulé par un descendant).

`src/css/style.css`, bloc d'effacement (état nu) :

```
.pilot-vocal.vocal-bare .vocal-orb,
.pilot-vocal.vocal-bare .vocal-mic-fix,
.pilot-vocal.vocal-bare .vocal-status,
.pilot-vocal.vocal-bare .vocal-side-discussion,
.pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-tasks-title,
.pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-side-body {
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity var(--transition), visibility 0s linear 180ms;
}
```

Plus `.pilot-vocal.vocal-bare .vocal-input` (barre de saisie) et
`.pilot-vocal.vocal-bare .vocal-top` (fond et filet de la bande du haut), avec
l'exception `.vocal-top .vocal-display-toggle` qui rallume le bouton.

### Pourquoi le portrait disparaissait

Deux causes, mesurées, toutes deux réelles — la première est **datée**, la seconde
est **atteignable dans le code actuel**.

**A. Le portrait était rangé dans un nœud nommé.** Le 2026-10-31 au matin, la
mission « écran Vocal » du 2026-10-30 (aujourd'hui **annulée**) avait transporté le
personnage **au centre du disque** (commit `afef214`). `.vocal-orb` était déjà
nommé par le bloc : le portrait s'éteignait donc avec l'anneau, et son nom aussi.
Ce n'est pas une règle « portrait » qui le touchait, c'est son **emplacement**.

Preuve calculée (mini-moteur de sélecteurs appliqué aux deux arbres, script de
vérification exécuté sur les sources) :

```
ARBRE au 2026-10-31 matin (afef214)
  pilot-vocal.vocal-bare > vocal-stage > vocal-orb > vocal-portrait
  sélecteurs qui l'éteignent : .vocal-orb      <-- LE DÉFAUT (image ET nom)

ARBRE actuel (HEAD)
  pilot-vocal.vocal-bare > vocal-stage > vocal-side-tasks > vocal-portrait
  sélecteurs qui l'éteignent : (aucun)         <-- ni lui, ni son nom
  contre-épreuve : .vocal-side-tasks > .vocal-side-body  atteint bien la liste
```

**B. Le portrait pouvait ne pas être en mémoire.** `enterVocal()` **appliquait**
le personnage déjà connu (`applyVocalPortrait(vocalOverlay)`) mais ne le
**demandait** jamais. Or le personnage n'est lu qu'à l'ouverture de l'onglet 🧭 et
au retour de focus de la fenêtre. Quand Pilot démarre **directement en mode
Vocal** (le mode est mémorisé) sans que l'onglet 🧭 ait été ouvert, la mémoire est
vide, l'image reste `hidden` — et l'état nu ne garde alors **rien du tout** :
l'écran paraît entièrement effacé, portrait compris. C'est exactement la
description du propriétaire. Le plein écran de l'Assistant avait déjà cette garde
(`if (getAssistantPortrait() === "") refreshAssistantPersonaAndApply()`), l'écran
Vocal ne l'avait pas.

## 2. Ce qui change

**Fichier touché : `src/js/super-agent.js`, une seule ligne ajoutée (10 lignes avec
son commentaire), dans `enterVocal()`**, juste après
`applyVocalPortrait(vocalOverlay)` :

```js
if (getAssistantPortrait() === "") refreshAssistantPersonaAndApply().catch(() => {});
```

- C'est **le mécanisme existant**, celui du plein écran de l'Assistant : aucun
  nouveau réglage, aucune persistance, aucun appel réseau, aucune exception levée
  (fail-open : une lecture impossible laisse l'écran tel quel).
- Il ne part **que** si la mémoire est vide, et **une seule fois** (l'image est une
  URL `data:` de plusieurs mégaoctets).
- L'ordre est celui qui était déjà verrouillé : portrait → état → largeur des
  colonnes.

**Ce qui NE change pas** — volontairement :

| Point | État |
|---|---|
| Forme, place, taille, libellés du bouton | **inchangés** (`190 × 28 px`, texte + icône) |
| Ensemble masqué | **inchangé** : disque, ligne d'état, saisie, colonne de gauche, titre + liste de la colonne de droite, bande du haut |
| Portrait et son nom | **jamais nommés** par le bloc d'effacement — et désormais vérifié par calcul |
| Zone d'image (fenêtre du visage) | **non nommée**, comme avant : elle est inerte et réserve une place (décision documentée §7bis) |
| `vocal-bare.js` | inchangé (toujours pur, aucune écriture DOM) |
| `vocalSyncBare()` | toujours **le seul** point d'écriture de l'état |

## 3. Le verrou ajouté

Nouveau fichier `src/js/ecran-vocal-masquage-garde-le-portrait.test.js` (16 tests).
Il ne se contente pas de chercher le mot « portrait » (le verrou existant, vrai à
chaque instant et pourtant insuffisant) : il **reconstruit l'arbre** de l'écran à
partir du modèle de `buildVocalOverlay()` et fait tourner un mini-moteur de
sélecteurs (descendant, enfant) sur **tous** les sélecteurs du masque.

1. **Aucun sélecteur n'atteint le portrait ni son nom, ancêtres compris** — et le
   **contrôle inverse** prouve que le vérificateur n'est pas complaisant (le
   disque, la ligne d'état, la colonne de gauche, le titre, la liste et la saisie
   sont bien atteints). Un troisième test applique le **même calcul à l'arbre du
   matin** et exige qu'il désigne `.vocal-orb` : si le portrait retournait dans le
   disque, le test du dessus échoue.
2. **L'endroit** : enfant direct de la colonne de droite ; jamais dans `.vocal-orb`
   ; jamais dans `.vocal-side-body` (dont le contenu est réécrit par
   `liste.innerHTML` toutes les 900 ms — là, il serait **détruit**, pas masqué).
3. **L'aller-retour** : deux clics rendent classe, libellé, icône et `aria-pressed`
   identiques ; le corps de `vocalSyncBare` ne touche **qu'une** classe et **trois**
   attributs de son propre bouton (aucun `hidden`, aucun `style`, aucun
   `innerHTML`, aucun nœud créé/retiré) ; le bloc d'effacement ne contient **aucune**
   règle de dimension, de marge, de position ni de `display` — rien ne saute, donc
   le retour est identique par construction.
4. **Le bouton dans les deux états** : hors d'atteinte du masque (il vit dans la
   barre, qui n'est pas nommée) et rallumé explicitement par l'exception nommée
   (fond et ombre compris).
5. **La garde d'entrée** : présente, unique dans `enterVocal`, **identique** à celle
   du plein écran de l'Assistant, fail-open, et placée après le portrait et avant
   l'état.

### Sensibilité vérifiée par mutation

| Mutation appliquée | Résultat |
|---|---|
| portrait remis **dans** `.vocal-orb` (arbre du matin) | **4 tests échouent** |
| `.vocal-portrait-name` ajouté au bloc d'effacement | **2 tests échouent** (dont le verrou existant) |
| garde d'entrée retirée de `enterVocal` | **2 tests échouent** |
| sources restaurées | **16 / 16 passent** |

## 4. Tests — comptes exacts, avant / après

| Moment | Commande | Résultat |
|---|---|---|
| **Avant** (HEAD `10d43d0`, arbre propre) | `npx vitest run` | **4757 passés, 0 échec** |
| **Après** | `npx vitest run` | **4773 passés, 0 échec** |

Écart = **+16**, exactement les 16 tests du nouveau fichier. **Aucun test existant
n'a été modifié, affaibli ni supprimé** (`git status` : seul `src/js/super-agent.js`
est modifié parmi les fichiers suivis ; le nouveau fichier de test est ajouté).

## 5. Ce qui reste incertain

- **Ce que le propriétaire a réellement vu.** La cause A est corrigée dans le
  source depuis le commit `7769b64` (2026-10-31, onze minutes après `afef214`).
  S'il a testé une version **installée**, l'écran qu'il a vu est celui de
  `afef214` : le portrait y était bien dans le disque. Je n'ai pas pu le vérifier
  sur sa machine. La cause B, elle, est présente dans le code actuel et suffit à
  produire le symptôme ; c'est elle que je corrige.
- **La zone d'image (fenêtre du visage) reste allumée** dans l'état nu : elle n'est
  pas nommée par le bloc. C'est une décision écrite (§7bis) — la nommer ferait
  disparaître la place réservée — et elle est inerte (ni image, ni cadre, ni
  texte). Je ne l'ai pas changée ; si le propriétaire veut qu'elle s'éteigne
  aussi, c'est une ligne de CSS et un test, mais la place réservée sauterait.
- **Pas de vérification visuelle** : aucun navigateur headless n'est disponible ici
  (`jsdom` / `happy-dom` absents de `node_modules`). Les tests sont des
  vérifications de **source** et de **géométrie d'arbre**, pas de rendu. La
  vérification à l'œil des deux clics reste à faire par le propriétaire.
- **Aucun changement de version, aucune publication, aucun envoi, aucun tag** :
  un seul commit local.
