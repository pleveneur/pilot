# Rapport — l'étiquette Telegram nomme le projet dont on PARLE, pas le projet ouvert

**Date** : 2026-11-11
**Nature** : correction d'un défaut constaté par le propriétaire (étiquette).
**Portée** : `src/js/super-agent.js` (frontend). **Aucun fichier Rust touché** →
`cargo test --workspace` **non concerné** (justification au § 6).
**Commit** : sur `main` en local, sans pousser, sans tag, sans changement de version.

---

## 1. Le défaut

Le propriétaire a constaté que, la conversation portant sur **Pilot**, les messages
Telegram de l'Assistant étaient préfixés **« MakeFilm »** — parce que MakeFilm était
le projet **ouvert à l'écran**.

Le libellé venait d'une fonction qui ne lisait **que** le projet ouvert :

```js
// src/js/super-agent.js, AVANT (ligne 572)
function assistantTelegramProject() {
  const active =
    typeof window !== "undefined" && window ? window._pilotProjectPath || "" : "";
  return projectShortName(active) || "Assistant";
}
```

Elle était appelée à deux endroits qui composent les messages Telegram de la
conversation :

| Site (avant) | Contexte |
|---|---|
| ligne **4179** | `appendSystemMessage` → `relayAssistantMessageToTelegram(trimmed, { project: assistantTelegramProject() })` quand Laya classe le message comme alerte |
| ligne **10080** | `agent_end` → `relayAssistantMessageToTelegram(respText, { project: assistantTelegramProject() })`, la réponse finale |

## 2. La cause

Deux notions étaient confondues : **le projet ouvert** (un état de la fenêtre) et
**le projet dont l'échange parle** (une information du tour). La règle qui tranche
entre les deux **existait déjà** — c'est celle des étiquettes de bulle
(`src/js/super-agent-project-label.js`, décision
`decideFinalBubbleProjectLabel`) — mais elle n'était **pas** appelée ici : le
message Telegram recalculait sa propre règle, réduite au seul état de la fenêtre.
C'est exactement le défaut « deuxième règle qui diverge de la première ».

## 3. Le correctif (une seule règle, aucune priorité recopiée)

`assistantTelegramProject(options)` **délègue** à la décision unique des étiquettes
de bulle, avec **les mêmes entrées** que la correction de fin de tour :

```js
const decision = decideFinalBubbleProjectLabel(base, baseSource, concerned, null);
return projectShortName(decision.main) || "Assistant";
```

- `base` / `baseSource` : le badge **figé** de la bulle et sa **provenance**
  (`PROJECT_LABEL_SOURCE`) — elle distingue un nom **prouvé** d'un simple **dernier
  recours**. Absent : le projet ouvert (`currentOpenProjectBadges()`), exactement
  comme à la création de la bulle.
- `concerned` : les projets **réellement visés** par l'échange (mission, délégation,
  agent relayé), par défaut ceux du tour en cours.
- **Un message Telegram = un projet** (règle de `telegram-messages.js`) : on retient
  `decision.main`, c'est-à-dire le **PREMIER** nom dans l'ordre **déjà appliqué**
  (explicite > nommé dans le texte > projet visé par le tour > projet ouvert en
  **dernier recours** > « Assistant »). Plusieurs projets concernés ⇒ seul le
  premier part, les autres ne sont pas perdus pour l'écran (la bulle les porte).
- Le libellé reste un **nom court** : `projectShortName` refuse un chemin, deux
  chemins distincts, une lettre de lecteur seule. Le repli **« Assistant »** est
  inchangé.

### 3.1 Comment l'information arrive au bon endroit (pas de lecture du DOM)

| Site (après) | Ce qui est transmis |
|---|---|
| `agent_end` (réponse finale) | `assistantTelegramProject({ concerned: respConcerned, frozen: respBase, frozenSource: respBaseSource })` — **exactement** les valeurs utilisées deux lignes plus bas par `extendResponseBubbleBadges` (même copie, prise avant `onEnd()`) |
| `appendSystemMessage` (alerte) | `const concernedForAlert = [...currentTurnConcernedBadges]` **copiée avant** le classement asynchrone de Laya, puis `assistantTelegramProject({ concerned: concernedForAlert })` — sans cette copie, la promesse se résoudrait après `onEnd()`, qui remet le tour à zéro |
| 3ᵉ appel (ligne 10130, `notifySuperAgentDone`, connexion perdue) | **inchangé** : il se produit **après** `onEnd()`, donc sans contexte d'échange. Il emprunte le même chemin **par défaut** (projet ouvert en dernier recours), ce qui est le comportement juste ici — aucune seconde règle n'est introduite |

Aucun appelant ne relit `window._pilotProjectPath`, ne lit le DOM ni ne recompose
l'ordre de priorité.

## 4. Preuve « rouge puis vert »

Verrou : `src/js/etiquette-telegram-projet-reel.test.js` (10 tests). Le `window`
minimal du test pose **MakeFilm comme projet ouvert**, et le tour vise **pilot**.

**Rouge** — correctif retiré (l'ancien corps, seulement exporté pour que le test
puisse l'appeler) :

| Test | Message d'échec |
|---|---|
| VERROU : MakeFilm ouvert, travail réel sur Pilot → « pilot » | `expected 'MakeFilm' to be 'pilot'` |
| le message Telegram réellement produit est préfixé du projet concerné | `expected 'MakeFilm : j'ai terminé la mission s…' to match /^pilot : /i` |
| un nom PROUVÉ (badge figé) passe avant le projet ouvert | `expected 'MakeFilm' to be 'pilot'` |
| plusieurs projets concernés → UN SEUL : le premier | `expected 'MakeFilm' to be 'pilot'` |
| le libellé reste un NOM COURT : jamais un chemin | `expected 'MakeFilm' to be 'pilot'` |
| l'étiquette Telegram DÉLÈGUE à la décision unique | `expected 'export function assistantTelegramProj…' to contain 'decideFinalBubbleProjectLabel('` |

⇒ **6 rouges / 10**. Le premier reproduit mot pour mot le défaut constaté.

**Vert** — correctif restauré : `PASS (10) FAIL (0)`.

Le test vérifie aussi ce qui ne doit **pas** changer : sans aucun projet concerné le
message retombe sur le projet ouvert (« MakeFilm ») — comportement d'avant **conservé**
—, et sans aucun projet il dit « Assistant ».

## 5. Non-régression (suite complète)

```
npm test        (npx vitest run)
 Test Files  320 passed (320)
      Tests  5905 passed (5905)
   Duration  16.10s          EXIT=0
```

Après les deux dernières retouches documentaires (spec + registre), re-vérification
ciblée : `registre-comportements-valides.test.js` + `etiquette-telegram-projet-reel.test.js`
⇒ `PASS (20) FAIL (0)`.

Les seules sorties parasites du nouveau fichier sont les avertissements de
bibliothèques que tous les tests de `super-agent.js` produisent déjà (« KaTeX doesn't
work in quirks mode », « Please use the `legacy` build ») : elles ne sont pas des
échecs.

## 6. Rust

**Aucun fichier Rust n'a été touché** (le correctif est entièrement dans
`src/js/super-agent.js`) ⇒ `cargo test --workspace` **n'est pas concerné** par ce
changement.

## 7. Documentation mise à jour

| Fichier | Ce qui a été ajouté |
|---|---|
| `spec_telegram.md` § 13.1 bis | la règle, l'ordre appliqué, ce que chaque site transmet, la limite connue, le verrou |
| `spec_telegram.md` (bloc `<!-- HELP:telegram -->`) | phrase utilisateur : « le nom en tête est celui du projet dont il est QUESTION » |
| `help/handbook.md` | régénéré par `npm run build:handbook` (4 lignes ajoutées, rien d'autre) |
| `spec_registre_comportements_valides.md` | entrée **28** : le message Telegram nomme le projet dont on parle, avec son test |

## 8. Limite connue, à dire au propriétaire

Quand **aucun projet n'est visé** par le tour et que la réponse ne fait que
**citer** un projet, la détection des projets cités est **asynchrone** (elle
interroge la liste des projets ouverts) : l'envoi Telegram ne l'attend pas et
retombe alors sur le projet ouvert. La **bulle**, elle, est corrigée juste après
(`extendResponseBubbleBadges`). Fermer cet écart demanderait de rendre l'envoi
Telegram dépendant d'un `await`, ce qui changerait l'ordre du filet anti-doublon
(`flushRawTelegramAvis`) : hors du périmètre de cette correction, et sans défaut
constaté. C'est le seul cas où les deux étiquettes peuvent encore diverger.

## 9. Ce qui reste à vérifier par le propriétaire (essai Telegram réel)

Aucun bot réel n'est engagé dans les tests : le verrou prouve la **décision** et le
**branchement**, pas la livraison chez Telegram.

1. Activer la communication Telegram (Options → Assistant → « Notifications Telegram »),
   bot configuré.
2. **Ouvrir MakeFilm**, puis, dans l'onglet 🧭, demander quelque chose **sur Pilot**
   (ex. « corrige le libellé du bouton d'export dans Pilot »).
3. Vérifier sur le téléphone que le message arrive sous la forme
   **« Pilot : … »** — et **non** « MakeFilm : … ».
4. Contre-épreuve du dernier recours : poser une question **sans projet** (ex.
   « bonjour, comment vas-tu ? ») écran sur MakeFilm ⇒ le message doit dire
   **« MakeFilm »**. Aucun projet ouvert ⇒ **« Assistant »**.

Si l'étape 3 dit encore « MakeFilm », l'information manquante est le relevé des
projets visés par le tour : c'est le point à instrumenter (`respConcerned`), pas
la règle d'étiquette.
