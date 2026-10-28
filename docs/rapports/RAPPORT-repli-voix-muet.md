# Rapport — Le repli de voix n'est plus muet là où l'on écoute

> Micro-tâche : « Corrige un silence trompeur pendant la lecture à voix haute ».
> Aucune voix téléchargée, aucun modèle supprimé, aucun réglage ajouté, aucun
> changement de la voix par défaut ni de l'écran des Paramètres.

## 1. L'état trouvé (avant)

- `src/js/read-aloud.js:1081` (avant correction), dans le gestionnaire d'état du
  bouton « 🔊 Écouter » :
  `else if (state === "local-fallback") setState("speaking");`
  → le repli sur la voix du système était **réduit à « lecture en cours »**.
- L'explication complète existait bien, mais **seulement** dans la ligne d'état
  `#read-aloud-state` des Paramètres (`src/js/settings.js:967`,
  `readAloudStateLabel("local-fallback")` dans `read-aloud.js:452`) — fenêtre
  **fermée** pendant qu'on écoute une réponse.
- Le journal disque (`voix-locale.log`) gardait la trace, invisible pour
  l'utilisateur au moment de l'écoute.

Résultat : l'utilisateur entendait **une autre voix que celle qu'il avait
choisie**, sans savoir pourquoi.

## 2. Ce qui a été ajouté, et où exactement à l'écran

**Uniquement dans la rangée du bouton de lecture**, sous la réponse concernée
(`.agent-message-actions`, à côté du bouton « 🔊 Écouter ») :

- `src/js/read-aloud.js`
  - `readAloudFallbackNotice(cause)` (nouvelle fonction pure) → **une seule
    ligne**, par exemple :
    « Voix locale indisponible (moteur absent) : lecture avec la voix du
    système. »
  - `localVoiceMissingCause(status)` et `localFailureShortCause(reason)`
    (pures) : la raison **en quelques mots**, lue dans l'état réel du moteur,
    jamais inventée — « moteur absent », « modèle incomplet », « état du moteur
    inconnu », « la synthèse locale a échoué », « le son local n'a pas pu être
    joué ».
  - `speak()` transmet désormais la cause avec l'état :
    `handlers.onstate(state, cause)` (`local-fallback`, `cause`). L'évènement
    public `pilot-read-aloud-state` est **inchangé** (`{ state }`) : les
    Paramètres ne bougent pas.
  - `createReadAloudButton()` : un `span.agent-read-notice`
    (`role="status"`) est **inséré dans la rangée du bouton** au moment du
    repli, et **retiré du document** au démarrage de la lecture suivante (et sur
    les états `empty` / `no-voice`). L'élément n'occupe donc **aucun espace** en
    dehors du repli.
- `src/css/style.css` : `.agent-read-notice` — une ligne discrète (petite
  taille, italique, couleur secondaire). **Aucune fenêtre, aucun bandeau, aucune
  pastille.**

La mention est **conservée après la fin de la lecture** (l'utilisateur qui ne
l'a pas vue pendant qu'il écoutait la retrouve ensuite), et disparaît dès qu'une
nouvelle lecture démarre.

## 3. Les trois cas vérifiés

| Cas | Comportement observé |
|---|---|
| **Repli** (voix locale choisie, moteur/modèle absent ou synthèse en échec) | La lecture continue avec la voix du système **et** la ligne apparaît à côté du bouton : « Voix locale indisponible (moteur absent) : lecture avec la voix du système. » |
| **Voix locale qui fonctionne** | Aucune mention (le `span` n'existe pas dans la page), aucune voix du système prononcée. |
| **Aucune voix locale choisie** (« Automatique ») | Comportement inchangé : le moteur local n'est même pas interrogé (`tts_local_status` jamais appelé), aucune mention. |

## 4. Tests

Fichier nouveau : `src/js/repli-voix-muet.test.js` (8 contrôles) — il **verrouille
la règle** :

- la phrase est courte, dit « voix locale indisponible » + « voix du système » et
  porte la raison quand elle est connue ;
- les causes réelles sont traduites sans jargon (moteur absent / modèle incomplet
  / état inconnu / synthèse en échec), et un arrêt voulu ne produit **aucune**
  cause ;
- le lecteur transmet la cause avec `local-fallback` ;
- **CAS 1 repli** : la mention est **visible à côté du bouton**, dans la rangée ;
- **CAS 2 voix locale OK** : **aucune** mention ;
- **CAS 3 aucune voix locale choisie** : **aucune** mention, aucun appel au
  moteur local ;
- la mention d'un repli disparaît au démarrage de la lecture suivante.

Résultat : `npm test` → **192 fichiers, 3365 tests, tout vert** (dont les suites
existantes `read-aloud`, `voix-locale`, `voix-locale-choix`,
`apercu-voix-parametres`, `reglage-voix-onglet-assistant`).

Aide utilisateur : bloc `HELP:lire-reponses` de `help/overview.md` mis à jour,
puis `npm run build:handbook` (seul ce bloc change dans `help/handbook.md`).
`spec_read_aloud.md` § 4.6 (repli visible) et § 6 (couverture) mis à jour.

## 5. Désaccords / points signalés SANS les corriger

1. **Voix du système choisie puis disparue.** Il existe un second repli
   silencieux, de même nature mais **hors périmètre** : quand la voix du
   *système* mémorisée n'existe plus, `resolveVoiceForChoice` retombe sur la voix
   de la langue de l'interface **sans rien dire près du bouton** (le constat
   n'apparaît que dans les Paramètres, `voiceChoiceStatus` → `kind: "missing"`).
   La mission ne visait que la voix locale : non modifié. À trancher par le
   propriétaire.
2. **Mention conservée après la fin de lecture.** Choix assumé (voir § 2), mais
   c'est un arbitrage : si le propriétaire préfère qu'elle disparaisse à la fin,
   c'est une ligne à changer (`else` du gestionnaire d'état).
3. **Aperçu des voix dans les Paramètres.** Le repli y est déjà dit sur la
   rangée concernée (`settings.js:967`), avec la phrase longue : laissé tel quel
   (l'écran des Paramètres est hors périmètre).
