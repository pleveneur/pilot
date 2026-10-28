# Rapport — mode « Assistant seul » : trois retouches demandées par le propriétaire

Date : 2026-10-28 · Projet : `G:\IA_PL\pilot` · Version en cours : 0.6.2 (aucun bump)
Périmètre : **uniquement** le mode « Assistant seul ». Écran Vocal, lecture à voix
haute et mode Détaillé **non touchés**.

---

## 1. État avant / après

### Point 1 — l'entrée « Travail » en haut à droite du mode

**Avant.** Le mécanisme de déplacement **existait déjà** (commit `5af237d`,
`immersiveActivityHome`) : `#agent-activity` était pris par
`document.getElementById` et inséré **devant** `.sa-immersive-agents`. Or ce
dernier porte `margin-left: auto` : tout ce qui est **avant** lui reste à
**gauche**. La barre affichait donc `titre · MODE · Travail ……… agents · ⚙` —
l'entrée était visible, mais collée au titre, **pas** en haut à droite. C'est
l'écart constaté par le propriétaire (son diagnostic « elle vit dans la rangée
d'onglets » ne correspondait plus au code, mais le symptôme de place, lui, était
réel).

**Après.** Même nœud, même méthode, **côté droit** : il est inséré **juste avant
le bouton ⚙** (`[data-imm="settings"]`), donc dans le groupe poussé à droite par
`margin-left: auto`. Ordre final de la barre :
`titre · MODE · (poussé à droite) agents · Travail · ⚙`.
- **Aucun** second bouton, **aucun** second panneau, **aucun** écouteur de clic
  dupliqué : le clic garde le comportement d'`agent-activity.js` (panneau à trois
  onglets, compteur « en cours / total »).
- Restitution **exacte** à la sortie : même mécanisme qu'avant
  (`immersiveActivityHome` = parent + voisin suivant, restauré **avant** le
  retrait de l'overlay).
- Le bouton **unique des trois modes** garde sa place (juste après le titre) :
  son ancre n'est plus l'entrée « Travail » (qui a changé de camp) mais
  `.sa-immersive-agents`, premier élément du groupe de droite.

### Point 2 — bouton ⛶ de la barre d'outils de l'onglet 🧭 supprimé

**Avant.** `super-agent.js` (barre `super-agent-toolbar`) portait
`<button data-action="immersive" title="Mode assistant seul…">⛶</button>`, et le
gestionnaire de clic de la barre avait une branche `if (action === "immersive")
enterImmersive();`.

**Après.** Bouton **et** branche supprimés. Le bouton unique des trois modes est
la **seule** entrée du mode.

**Vérifié : `Ctrl+Shift+A` continue de fonctionner.** L'écouteur `document`
`onImmersiveKeydown` appelle `enterImmersive()` / `exitImmersive()` /
`exitVocal()` **directement** : il ne dépendait d'aucun bouton, rien n'a été
rebranché (et surtout, aucun second mécanisme n'a été créé).

### Point 3 — bouton de retour du calque supprimé

**Avant.** `buildImmersiveOverlay()` produisait
`<button class="agent-btn sa-immersive-back" data-imm="back" title="Revenir au
mode standard">` + son écouteur `addEventListener("click", exitImmersive)`.

**Après.** Bouton **et** écouteur supprimés ; la règle CSS `.sa-immersive-back`
(qui n'avait que `flex-shrink: 0`) est retirée, remplacée par un commentaire qui
dit pourquoi. Sortie du mode : le **bouton unique des trois modes** (présent dans
la barre) ou **`Ctrl+Shift+A`**.

**Vérifié : Échap ne sortait pas du mode « Assistant seul »** — il n'existe
qu'un écouteur Échap, `onVocalKeydown`, qui sort **du mode Vocal** uniquement.
Rien n'a donc été ajouté (conformément à la consigne).

---

## 2. Fichiers touchés

| Fichier | Ce qui a changé |
|---|---|
| `src/js/super-agent.js` | barre du calque : plus de bouton retour (+ commentaire) ; `#agent-activity` inséré **avant ⚙** (côté droit) et ancre du bouton des modes = `.sa-immersive-agents` ; barre d'outils de l'onglet 🧭 : bouton `data-action="immersive"` et sa branche retirés |
| `src/css/style.css` | règle morte `.sa-immersive-back` retirée (commentaire explicatif à la place) |
| `src/js/barre-fenetre-assistant-seul.test.js` | ordre de la barre sans `sa-immersive-back` (+ contrôle qu'il ne revient pas) ; insertion de « Travail » vérifiée **devant le ⚙** |
| `src/js/suivi-multi-projets-dashboard.test.js` | la barre d'outils doit **ne plus** contenir `data-action="immersive"` (les 7 autres boutons restent vérifiés) |
| `src/js/compteur-taches-travail.test.js` | le déplacement vérifié est celui de la nouvelle ancre (côté droit) |
| `src/js/trois-modes-ecran.test.js` | ancre du bouton des modes = `agentsHost` (l'entrée « Travail » n'est plus l'ancre) |
| `spec_super_agent.md` (bloc `HELP:super-agent`) | une seule entrée (bouton des modes ou `Ctrl+Shift+A`), plus de ⛶ dans l'onglet, plus de flèche retour, « Travail » côté droit, sorties du mode |
| `spec_modes_ecran_vocal.md` (§ 2) | entrer/sortir du mode « Assistant seul » ; Échap ne sort pas de ce mode |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (jamais édité à la main) |

Aucun autre fichier de code n'a été modifié. Aucun fichier supprimé.

---

## 3. Vérifications

- Protocole `quality-gate` appliqué : fichiers lus en entier (super-agent.js sur
  les zones concernées et les tests), points de connexion cartographiés
  (`enterImmersive`, `exitImmersive`, `onImmersiveKeydown`, `onScreenModeApply`,
  gestionnaire de clic de la barre, CSS de la barre), puis relecture des zones
  modifiées.
- `npx vitest run` sur les 6 fichiers de tests concernés (avant/après) :
  **206 tests passés, 0 échec**.
- `npm test` (suite complète) : **200 fichiers de tests passés, 3611 tests
  passés, 0 échec** (durée 11,18 s).
- `npm run build` (Vite) : **4134 modules transformés, « built in 12.24s »,
  aucune erreur** (uniquement des avertissements préexistants de découpage de
  chunks).
- `npm run build:handbook` : handbook régénéré (46 blocs), diff cohérent avec
  les trois textes modifiés.

---

## 4. Ce qui reste à faire

1. **Vérification à l'œil** (non testable en Vitest) : onglet 🧭 ouvert →
   bouton des trois modes → « Assistant seul ». Attendu : en haut à droite,
   `agents · Travail 2/5 · ⚙`, le clic sur « Travail » ouvre **le** panneau à
   trois onglets, et un retour en mode Détaillé remet le compteur **exactement**
   dans la rangée d'onglets (à sa place d'origine).
2. Aucune autre action : pas de bump de version, pas de tag, pas de publication.
   Le commit reste **local** (aucun envoi vers un dépôt distant).

---

## 5. Point de désaccord / d'interprétation (rien corrigé « à ma façon »)

- Le diagnostic du point 1 (« elle disparaît parce qu'elle vit dans la rangée
  d'onglets ») **ne correspondait pas au code livré en 0.6.2** : le déplacement
  existait déjà. La seule différence réelle était sa **place** (à gauche, avant
  le bloc poussé à droite). J'ai donc appliqué la consigne telle qu'écrite
  (« côté droit ») sans réintroduire un second mécanisme — et **sans** toucher au
  panneau lui-même (onglets, compteur, écouteur inchangés).
- La consigne de commit se contredit (méthode : « message clair en français » /
  mission : « message conventionnel en anglais »). J'ai retenu le **format
  conventionnel en anglais**, conforme à l'historique du dépôt.
