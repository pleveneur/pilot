# Rapport — La documentation utilisateur dit « Options » (plus « Paramètres »)

Lot unique, **texte de documentation seulement** : le panneau ⚙ s'appelle « Options »
à l'écran, dans les infobulles et dans l'aide intégrée ; deux documents lisaient encore
l'ancien nom et envoyaient donc vers un bouton qui n'existe plus sous ce nom :

- `README.md` (présentation du projet à la racine, dont un **titre de section**) ;
- `spec_read_aloud.md` (spec de la lecture des réponses à voix haute).

Tous les comptages ci-dessous ont été **refaits sur le disque** après ouverture des
fichiers ; aucun chiffre n'est recopié d'une demande.

---

## 1. Ce qui a été corrigé

### 1.1 `README.md` — 5 endroits

| Ligne | Avant | Après |
|---|---|---|
| 112 | `⚙️ **Paramètres → onglet « Assistant »**` | `⚙️ **Options → onglet « Assistant »**` |
| 152 | titre `### Paramètres (onglet ⚙️)` | titre `### Options (onglet ⚙️)` |
| 230 | `ouvrir les **Paramètres** ⚙️ → section « Accès distant »` | `ouvrir les **Options** ⚙️ → section « Accès distant »` |
| 249 | `dans les Paramètres.` | `dans les Options.` |
| 253 | `affiché dans les Paramètres` | `affiché dans les Options` |

### 1.2 `spec_read_aloud.md` — 9 occurrences sur 8 lignes

| Ligne | Avant | Après |
|---|---|---|
| 45 | `⚙️ **Paramètres → onglet « Assistant »**` | `⚙️ **Options → onglet « Assistant »**` |
| 89 | `**quitter les Paramètres** (Annuler **et** Enregistrer)` | `**quitter les Options** (…)` |
| 106 | `l'écran des Paramètres reste utilisable.` | `l'écran des Options reste utilisable.` |
| 116 | `Paramètres (ou afficher l'onglet « Assistant ») **suffit**` | `Options (ou afficher l'onglet « Assistant ») **suffit**` |
| 136 | `une fois par ouverture des Paramètres.` | `une fois par ouverture des Options.` |
| 214 | `**affiché dans les Paramètres**` | `**affiché dans les Options**` |
| 215 | `**téléchargé depuis les Paramètres**` | `**téléchargé depuis les Options**` |
| 241 | `à l'ouverture des Paramètres` | `à l'ouverture des Options` |
| 297 | `arrêt à la fermeture des Paramètres` | `arrêt à la fermeture des Options` |

---

## 2. Tournures : aucune n'a eu besoin d'être remaniée

C'était le point de vigilance annoncé (« depuis les Paramètres ⚙️ », « Paramètres
(onglet ⚙️) »). Vérification faite, **toutes** les occurrences des deux documents
étaient déjà construites avec l'article défini pluriel **les** (« les Paramètres »,
« des Paramètres », « dans les Paramètres », « l'ouverture des Paramètres »). Ce
déterminant se transpose tel quel (« les Options », « des Options », « dans les
Options », « l'ouverture des Options ») : le français reste correct sans retouche.
Le seul cas où le mot n'était pas précédé de « les » est :

- le **titre** `### Paramètres (onglet ⚙️)` → `### Options (onglet ⚙️)` (changement du
  seul mot, la parenthèse reste juste puisque le panneau est bien un onglet) ;
- la forme fléchée « **Paramètres → onglet « Assistant »** » (sans article, comme dans
  l'aide intégrée corrigée au lot précédent) → « **Options → onglet « Assistant »** »,
  identique à la phrase de l'aide : la divergence entre l'aide et ces deux documents
  disparaît.

Aucun paragraphe n'a été réécrit : seuls des mots ont été remplacés, à l'identique
du reste du texte (mêmes gras, mêmes émojis, mêmes retours à la ligne).

---

## 3. Ce que je n'ai pas touché, et pourquoi

### 3.1 Blocs d'aide balisés — **aucun**

Aucun des deux fichiers ne contient de bloc `<!-- HELP:… -->` (vérifié :
`grep -n "<!-- HELP" README.md spec_read_aloud.md` → aucune occurrence).
`spec_read_aloud.md` **cite** seulement le nom du bloc (`HELP:lire-reponses`, l. 344),
sans en être un : le bloc vit dans `help/overview.md`, corrigé au lot précédent.
Donc **aucun texte d'aide n'a été modifié, et `handbook.md` n'a pas été régénéré** —
c'était demandé, et c'est cohérent : rien à régénérer.

### 3.2 Faux amis — laissés (conformément à la consigne)

- **Réglages du système** : `README.md` conserve « Settings → HTTPS certificates » et
  « Settings → Tailscale Serve / Funnel » (l. 227-228) : ce sont les réglages **de
  Tailscale**, dans sa console d'administration, pas le panneau de Pilot.
- **Réglages avancés du service de classification, de la mémoire, identifiants** :
  hors de ces deux fichiers ici ; voir § 3.4.
- « modale » et « fenêtre » : voir le point signalé ci-dessous, ce n'est pas le nom.

### 3.3 Point **signalé**, non corrigé (hors du mot demandé)

`spec_read_aloud.md` dit encore trois fois **« la modale »** (l. 63, 90, 160) alors que
le panneau est depuis longtemps un **onglet**. Ce n'est pas le nom du panneau : la
consigne « change le mot, ne réécris pas les paragraphes » impose de ne pas y toucher.
À trancher dans un lot dédié si le propriétaire le souhaite.

### 3.4 Restes ailleurs dans le dépôt — **hors périmètre, signalés**

`grep` sur tout le dépôt (hors `node_modules`, `target`, `.pilot`, `RAPPORT-*`/`rapport-*`
et `help/handbook.md`) : il reste des « Paramètres » dans **d'autres documents**, qui
ne font pas partie de ce lot :

- **corps des specs de développement** (`spec_web_remote.md` 13, `spec_telegram.md` 10,
  `spec_orchestration.md` 6, `spec_pilot.md` 4, `spec_rpc.md` 4, etc.) : documentation
  de développement, non lue par l'utilisateur ;
- **`AGENTS.md`** (2) : ce sont des **descriptions de fichiers du projet** (« lit le
  réglage dans Paramètres → Assistant »), donc de la documentation d'assistant ;
- **`release-notes/*.md`** : changelogs **historiques** déjà publiés — on ne réécrit
  pas l'histoire d'une version livrée ;
- **`docs/proposition-*.md`, `refonte_graphique.md`, `plan_*.md`, `idees_evolutions.md`,
  `Bugs et Evolutions.md`, `docs/architecture-conversation-vocale-interruptible.md`,
  `docs/gds-*.md`** : documents de conception / plans / notes, dont certains décrivent
  volontairement l'ancien état (« la modale Paramètres ») pour expliquer une décision.

Aucun de ces fichiers n'est un texte que l'utilisateur lit pour trouver le bouton ⚙.

---

## 4. Une entorse minimale et assumée : 2 assertions de test

La consigne disait « ne touche à aucun fichier de code ». Deux **assertions de test de
documentation** verrouillaient l'ancien nom et sont donc devenues rouges **dès** que
les deux documents ont été corrigés :

| Fichier | Ligne | Avant → Après |
|---|---|---|
| `src/js/reglage-voix-onglet-assistant.test.js` | 334 | `expect(readme).toMatch(/Paramètres → onglet « Assistant »/)` → `… /Options → onglet « Assistant »/` |
| `src/js/reglage-voix-onglet-assistant.test.js` | 342 | `expect(spec).toMatch(/Paramètres → onglet « Assistant »/)` → `… /Options → onglet « Assistant »/` |

**Pourquoi** : (a) le quality-gate interdit de committer une suite rouge ; (b) le
rapport du lot précédent (`RAPPORT-aide-options.md`, § 5.2) désignait explicitement ces
deux assertions comme le verrou à lever dans « un lot README + spec_read_aloud » ;
(c) le changement porte sur **un seul mot dans une expression régulière** : aucune
logique, aucun comportement, aucun test supprimé ni affaibli (le test continue
d'exiger un chemin exact, il exige seulement le **nom réel** du panneau).

Aucun autre fichier de code n'a été touché (`git status` ne montre que `README.md`,
`spec_read_aloud.md`, ce fichier de test et le présent rapport).

---

## 5. Preuve : recherche finale

Commande lancée (exactement) :

```bash
grep -n "Paramètres" README.md spec_read_aloud.md
```

Résultat :

```
0 matches for 'Paramètres'
(code retour 1 = aucune ligne trouvée)
```

Contrôle complémentaire sur le nom réellement présent :

```bash
grep -n "Options" README.md spec_read_aloud.md
```

→ README.md l. 112, 152, 230, 249, 253 et `spec_read_aloud.md` l. 45, 89, 106, 116,
136, 214, 215, 241, 297 : les 14 emplacements portent bien « Options ».

---

## 6. Tests : compte avant et après

| Moment | `npx vitest run` |
|---|---|
| **Avant** toute modification | `PASS (3167) FAIL (0)` |
| Pendant (doc corrigée, assertions pas encore alignées) | `PASS (3165) FAIL (2)` — exactement les 2 tests du § 4, aucun autre |
| **Après** | `PASS (3167) FAIL (0)` |

Aucun test n'a été ajouté ni supprimé : le nombre total est **identique** avant et
après, et le seul état intermédiaire rouge était celui attendu (les deux verrous de
l'ancien nom). C'est la preuve qu'aucune fonctionnalité n'a été cassée par ce lot.

---

VERDICT : les deux derniers documents utilisateur qui parlaient encore de « Paramètres » disent désormais « Options » — 14 emplacements alignés (5 dans `README.md`, dont le titre de section, et 9 dans `spec_read_aloud.md`), aucune tournure à remanier puisque l'article « les » se transpose tel quel, aucun bloc d'aide balisé touché et aucune régénération du handbook, faux amis (réglages de Tailscale, réglages du système, corps des specs, changelogs historiques, plans et documents de conception) laissés et signalés ; la recherche finale `grep -n "Paramètres" README.md spec_read_aloud.md` ne renvoie **aucune** occurrence, et `npx vitest run` donne **PASS (3167) FAIL (0)** avant comme après (avec un passage rouge intermédiaire de 2 assertions de documentation, alignées d'un seul mot — seule entorse, justifiée et signalée) ; reste signalé, hors lot, le mot « modale » employé trois fois pour un panneau qui est un onglet.
