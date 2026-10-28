# RAPPORT — Repli des menus du bas, LOT 1 (survol)

> Mission : appliquer le **LOT 1** de `RAPPORT-conception-repli-menus-bas.md` § 6
> (le survol), avec les décisions du propriétaire du 2026-10-26 (Q1, Q2, Q3).
> Date : 2026-10-26.

---

## 1. État trouvé sur le disque (avant toute écriture)

**Le LOT 1 était déjà livré**, et déjà vérifié, par deux commits antérieurs de la
même journée :

| Commit | Message |
|---|---|
| `de9b869` | `feat(colonne): lot 1 insecable -- 7 lignes de 32 px, plafond 60 %` |
| `c760a8d` | `feat(colonne): lot 1 du repli au survol des menus du bas` |
| `9306f26` | `docs(colonne): aide a jour sur le repli des menus du bas + 2 cas de verrou` |

Le rapport `RAPPORT-colonne-repli-lot1.md` documentait cette livraison. **Je n'ai
donc pas réécrit le LOT 1** : je l'ai contrôlé point par point contre la
conception, puis j'ai traité ce qui manquait encore.

### 1.1. Contrôle point par point du LOT 1 (conception § 2.4, § 2.5, § 6)

Jeu de vérifications exécutées sur le disque (déclarations CSS réelles, pas des
commentaires — voir § 3) :

| Attendu (conception) | Constaté | Verdict |
|---|---|---|
| Ancre = bas du cadre, la ligne du bas ne bouge jamais (`justify-content: flex-end`) | présent dans `#project-footer` | conforme |
| `overflow: visible` conservé dans la règle de base (le menu sort par le haut) | présent | conforme |
| Rognage porté par la seule règle d'état `#project-footer.pj-replie` (`overflow: clip`, jamais `hidden`) | présent | conforme |
| Hauteur repliée **50 px** (2 bordures + 2 × 8 padding + 1 ligne de 32) | `height: 50px` | conforme |
| `.pj-panel` en `flex: 0 0 auto` | présent | conforme |
| Colonne **toujours ajustable** (280 → 600 px), non gelée | aucune largeur ajoutée | conforme |
| Une seule ligne visible : la **dernière**, même libellé, même icône, même identifiant | `class="pj-replie"` sur `#project-footer` dans `index.html`, ligne d'ancrage = `#btn-more-screens` | conforme |
| Déploiement au survol après **100 ms** | `OUVERTURE_MS = 100` (`src/js/sidebar-footer-fold.js`) | conforme |
| Repli après **300 ms** de sursis, si souris sortie **et** focus sorti **et** menu fermé | `GRACE_MS = 300`, trois conditions | conforme |
| 180 ms d'animation **seulement** pour la hauteur | `transition: height var(--transition)` + Q3 ci-dessous | conforme |
| Aucun nœud, aucun bouton, aucun réglage ajouté | `index.html` : 7 lignes avant / 7 lignes après | conforme |
| Branchement unique | `src/js/sidebar-footer-fold.js` importé par `sidebar.js` | conforme |
| Documentation (LOT 1) | `spec_pilot.md` § C + `docs/proposition-presentation-ui.md` § 3.3 | conforme |

### 1.2. Décisions du propriétaire — état à l'arrivée

| Question | Décision (2026-10-26) | État trouvé |
|---|---|---|
| **Q1** — tactile | premier appui **déploie sans agir** (deux appuis pour agir) | **non traité** — c'est le **LOT 3**, hors de cette mission ; rien de contraire au LOT 1 |
| **Q2** — libellé | la ligne garde « Autres écrans », **seule** une info-bulle enrichie est ajoutée | **MANQUANT** : `title="Autres écrans"` brut → **traité ici** (§ 2) |
| **Q3** — mouvement réduit | garder 100 ms et 300 ms, retirer seulement l'animation de 180 ms | conforme : les deux délais sont conservés (`OUVERTURE_MS`, `GRACE_MS`), rien de neuf |

Seul **Q2** demandait du travail : c'est le périmètre réel de cette passe.

---

## 2. Ce que j'ai fait

### 2.1. L'info-bulle enrichie de la ligne visible (Q2, conception § 3.2 point 4)

`index.html`, `#btn-more-screens` — **un seul attribut** change :

```
title="Autres écrans"                     (avant)
title="Autres écrans — le bloc s'ouvre au survol : Brouillon, Options,
       Assistant, Dossier du projet, Terminal, Commandes du projet"   (après)
```

Pourquoi c'est le bon endroit et la bonne forme :

- **Q2 interdit un libellé nouveau** : le texte du bouton
  (`<span class="pj-btn-label">Autres écrans</span>`) n'est **pas** touché d'un
  caractère (le verrou du lot 3 le tient déjà, je l'ai réutilisé).
- **Q2 demande « seulement une info-bulle enrichie »** : un `title` est le seul
  ajout possible, sans nœud, sans bouton, sans réglage.
- **Le texte nomme les six autres lignes**, dans leur ordre réel d'affichage,
  pour qu'aucune fonction ne soit **cachée sans être nommée** — c'est la crainte
  explicite du § 3.2 point 4.
- Aucun attribut ARIA, aucun identifiant, aucune classe n'est modifié ; le
  commentaire HTML ajouté au-dessus (ASCII) dit d'où vient la décision.

### 2.2. Renforcement du verrou (trouvé par la contre-épreuve, pas par la lecture)

Le verrou `src/js/repli-menus-bas.test.js` lisait les **blocs CSS bruts**,
commentaires compris. Or le bloc `#project-footer` **cite lui-même**
`justify-content: flex-end` dans un commentaire explicatif. Conséquence mesurée :
en retirant la **vraie** déclaration, la suite **restait verte** — le test était
satisfait par la prose. C'est exactement ce qu'une contre-épreuve doit révéler.

Correctif (dans le test uniquement, aucun code de production touché) : les
commentaires `/* … */` sont retirés **avant** toute lecture de déclaration
(`sansCommentaires`), de sorte que le verrou tient la **déclaration**, jamais son
commentaire. Les 41 cas restent verts sur le code réel.

### 2.3. Trois cas de verrou ajoutés (aucun cas existant retiré ni modifié)

`describe("LOT 1 (l) — l'infobulle de la ligne visible nomme les six autres lignes (Q2)")` :

1. le `title` **nomme les six lignes** et dit **comment** le bloc s'ouvre ;
2. le **libellé affiché reste « Autres écrans »** (aucun libellé nouveau) ;
3. l'info-bulle **n'ajoute ni bouton, ni réglage, ni nœud** : le bloc garde
   **sept** lignes et la balise garde ses trois attributs ARIA.

### 2.4. Documentation mise à jour (non supprimée)

- `spec_pilot.md` § C : le paragraphe du repli précise que la ligne repliée garde
  son libellé et que **son info-bulle est enrichie et nomme les six autres
  lignes** (décision Q2).
- `docs/proposition-presentation-ui.md` § 3.3 : même précision, avec le texte
  exact de l'info-bulle.

`help/overview.md` n'est **pas** touché : rien de ce qu'il affirme ne devient
faux (il ne décrit pas l'info-bulle), et le LOT 5 est le lot de la documentation.

---

## 3. Vérification

### 3.1. Fichiers touchés (et rien d'autre)

```
index.html                       (+8 −1)   l'attribut `title` + son commentaire
src/js/repli-menus-bas.test.js   (+69 −2)  sansCommentaires + 3 cas de verrou
spec_pilot.md                    (+1 −1)   doc du repli
RAPPORT-repli-menus-bas-lot1.md  (nouveau) ce rapport
```

Un fichier de plus est **modifié sur le disque mais volontairement hors du
commit** : `docs/proposition-presentation-ui.md` (+1 −1, la même précision sur
l'info-bulle). Ce document de conception **n'est pas suivi par git** dans ce
dépôt (état antérieur à ma passe) : l'embarquer reviendrait à faire entrer sous
mon commit le livrable d'une autre mission. Sa modification reste donc sur le
disque, prête, et **c'est au propriétaire de décider** si les documents de
conception doivent être versionnés.

### 3.2. Tests et build

| Commande | Avant ma passe | Après ma passe |
|---|---|---|
| `npx vitest run` (suite complète) | **PASS 3409 / FAIL 0** | **PASS 3412 / FAIL 0** (+3) |
| `npx vitest run src/js/repli-menus-bas.test.js src/js/lot3-colonne-bas.test.js` | 38 + 20 cas (déduit du total 3409) | **PASS 61 / FAIL 0** (41 + 20) |
| `npm run build` | — | **✓ built in 13.03 s** (seuls les avertissements de découpage préexistants) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | — | **786 passed / 0 failed / 1 ignored** |

Aucun fichier Rust n'est touché par cette passe ; la suite Rust a quand même été
lancée et est verte.

### 3.3. Contre-épreuves (remettre l'ancien comportement → un test doit rougir)

**Contre-épreuve 1 — l'ancre du bas (`justify-content: flex-end`)**

- retrait de la seule **déclaration** du bloc `#project-footer` →
  `PASS (40) FAIL (1)` :
  `AssertionError: expected ' flex-shrink: 0; margin: 0 8px 8px; …' to contain 'justify-content: flex-end'`
- fichier restauré depuis une copie de référence : `git status --short src/css/style.css`
  ne renvoie **rien**, et la suite repasse à `PASS (41) FAIL (0)`.

> Détail instructif : une **première** tentative visait la première occurrence du
> fichier, qui appartenait à `#sidebar-engine-row` — la suite est restée verte,
> ce qui confirme au passage que le verrou est **précis au sélecteur**. Puis, en
> visant le bon bloc, la suite est **encore** restée verte : c'est le trou décrit
> au § 2.2, corrigé depuis.

**Contre-épreuve 2 — l'info-bulle (Q2)**

- retour à `title="Autres écrans"` →
  `PASS (40) FAIL (1)` :
  `AssertionError: ligne non nommee dans l'infobulle : Brouillon: expected 'Autres écrans' to contain 'Brouillon'`
- info-bulle enrichie restaurée **à l'identique** : `PASS (61) FAIL (0)` sur les
  deux fichiers de verrou, `PASS (3412) FAIL (0)` sur la suite complète.

### 3.4. Ce que je n'ai PAS pu vérifier

- **Rien à l'écran.** Aucune fenêtre Pilot n'a été ouverte et je n'ai pas
  d'automate de navigateur dans cet environnement : le comportement de survol, la
  fente qui monte et le débordement du bloc **ne sont pas constatés visuellement**,
  seulement lus dans le CSS et tenus par les tests (DOM simulé, pas de jsdom
  installé). C'est le même constat que le rapport précédent.
- **Le cas « fenêtre à 500 px de haut »** (plafond `max-height: 60%` = 300 px,
  marge de 22 px) n'a pas été mesuré sur écran ; il n'est tenu que par
  l'arithmétique des 7 × 32 + 6 × 6 + 16 + 2 = 278 px.
- **Le tactile (Q1)** n'est pas exercé : il relève du LOT 3, non traité ici.
- **La durée de l'animation** n'est pas chronométrée ; seules les constantes
  (100 ms / 300 ms) et l'absence de durée en dur sont verrouillées.

---

## 4. Conflits signalés (missions voisines)

| Élément | État sur le disque | Effet sur cette mission |
|---|---|---|
| Mission « nom du moteur, un seul endroit » (`7758ba5`, livrée) | `#project-engine` vit dans le **bandeau du haut** (`index.html` ligne 50) ; `#sidebar-engine-row` (dernier élément de la colonne, **sous** le cadre accentué) ne porte plus que le badge « Distant » | **aucun** : hors du cadre repliable, et la suite complète est verte |
| Mission « compteur Travail » (livrée) | dans la **rangée d'onglets** | **aucun** |
| Badge « Distant » | dans `#sidebar-engine-row`, **sous** le cadre | **aucun** ; ni hauteur, ni largeur, ni position touchées |
| Bandeau (hauteur 48 px, logo 24 px), thèmes, trois onglets du panneau, barre des boutons système | inchangés | **aucun** |
| `src-tauri/src/agents.rs` **modifié et non commité** par une autre mission (porte du verrou par projet) | présent dans `git status` **avant** mon arrivée | **aucun** ; je ne l'ai **ni touché, ni commité** |

Aucun désaccord disque / conception rencontré sur le périmètre du LOT 1 : tout ce
que la conception décrit était réalisable tel quel, et l'a été.

---

## 5. Ce qui reste à faire (hors de cette mission)

- **LOT 2 — clavier** : déjà présent dans le module du LOT 1 (overlap assumé par
  la passe précédente) ; à confirmer en revue plutôt qu'à refaire.
- **LOT 3 — tactile (Q1)** : premier appui déploie sans agir, deux appuis pour
  agir. **Rien n'est fait** ; c'est le prochain lot logique.
- **LOT 4 — mouvement réduit (Q3)** : les délais sont conservés, mais la classe
  `no-motion` **n'est pas appliquée** en CSS (la décision est prise en JS
  seulement). À traiter dans le LOT 4 pour que l'absence d'animation soit aussi
  tenue par les feuilles de style.
- **LOT 5 — documentation** : `docs/proposition-presentation-ui.md` § 3.3 et
  `spec_pilot.md` § C sont à jour ; `help/overview.md` est à relire quand le
  tactile sera livré.

---

## 6. Commit

Un seul commit local, sur `index.html`, `src/js/repli-menus-bas.test.js`,
`spec_pilot.md` et ce rapport (le document de conception non suivi reste hors du
commit, cf. § 3.1). Aucun `push`, aucun tag, aucun changement de version, aucune
suppression, aucune commande de nettoyage Git, et le `src-tauri/src/agents.rs`
modifié par une autre mission n'est ni indexé ni commité.

DONE: LOT 1 confirmé conforme sur le disque (déjà livré par `c760a8d`), complété
par la seule décision ouverte (Q2 : info-bulle enrichie nommant les six autres
lignes), verrou renforcé (une déclaration ne peut plus être satisfaite par un
commentaire) + 3 cas ajoutés ; suite complète 3412/0, Rust 786/0, build OK, deux
contre-épreuves rouges puis restaurées à l'identique. Non vérifié à l'écran.
