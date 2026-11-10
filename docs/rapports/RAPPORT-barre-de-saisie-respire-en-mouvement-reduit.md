# La barre de saisie de l'Assistant respire de nouveau en mouvement réduit

**Date** : 2026-11-17 · **Portée** : `src/css/style.css` (un bloc) + un test de
verrou + une phrase de `spec_super_agent.md`. **Aucun** fichier JavaScript de
l'état de travail n'est touché, aucun réglage nouveau, aucune dépendance.

---

## 1. Ce qui était cassé (rappel, non re-diagnostiqué)

Le 2026-11-02, le bloc `@media (prefers-reduced-motion: reduce)` de
`src/css/style.css` avait été complété par la respiration de la barre de saisie,
rangée dans la liste des indicateurs mis à `animation: none`. Ce bloc est la
**dernière** règle du fichier : à spécificité égale, il gagnait toujours sur la
respiration normale (`.agent-chat-input-bar.superagent-input-reflecting
.agent-input { animation: assistant-input-breathe 1s … }`).

Sur le poste du propriétaire, les effets d'animation Windows sont désactivés :
`prefers-reduced-motion: reduce` est donc **permanent**, et la barre ne respirait
**plus jamais**, alors que le JavaScript était intact (`agent_start` →
`superSetReflecting(true)`).

## 2. Le changement (minimal, un seul bloc)

Dans `src/css/style.css`, en fin de fichier :

- le sélecteur de la barre de saisie est **retiré** de la liste `animation: none`
  — les **huit** autres indicateurs d'activité (pastille de session, point du
  suivi, statut « en train de répondre », point de mission, outil en cours,
  compteur du tableau de bord, `superagent.breathing`, point immersif) gardent
  exactement la même règle, inchangée ;
- une règle du **même sélecteur**, placée **après** dans le bloc, applique une
  version **ralentie** : `assistant-input-breathe-reduced` **2,8 s** en boucle
  (au lieu de 1 s) ;
- les images du dégradé (`@keyframes` **dans** le bloc, donc actives seulement en
  mouvement réduit) ne font varier que l'**intensité** : `background-image` de
  4 %/2 % à 18 %/9 % de l'accent. La `background-size` est **fixe** (80 % 80 %)
  dans la règle : **aucune** taille, **aucune** position, aucun mouvement de
  mise en page ne bouge — donc aucun risque de gêne visuelle, ce que le
  propriétaire voulait éviter en réduisant les animations.

Hors mouvement réduit, **rien ne change** : c'est toujours
`assistant-input-breathe 1s ease-in-out infinite` qui s'applique.

## 3. Preuve de la cascade, et le verrou

`src/js/barre-de-saisie-respire-toujours.test.js` (entrée n° 1 du futur registre
des comportements valides) ne cherche pas un texte dans le fichier : il **lit**
`style.css`, neutralise les commentaires, extrait les règles dans l'**ordre de
source**, écarte celles qui vivent dans le bloc de mouvement réduit quand le
média ne s'applique pas, et rend **la règle qui gagne** pour le sélecteur de la
barre.

| Cas du verrou | Attendu |
|---|---|
| Témoin : l'ancien extincteur (`sélecteur` dans la liste `animation: none`) | verdict **« arrêtée »** — le test n'est pas vide |
| Fichier réel, mouvement réduit | respiration **ralentie**, 2 500 ≤ durée ≤ 3 000 ms, `infinite`, pas la version 1 s |
| Fichier réel, mouvement normal | **exactement** `assistant-input-breathe 1s ease-in-out infinite` |
| Image de la version ralentie | aucune propriété de taille / position / marge / transformation / opacité animée |
| Les autres indicateurs (mouvement réduit) | les **huit** gardent `animation: none`, la barre n'y figure pas |

**Preuve par mutation, exécutée** : avec `style.css` remis dans son état d'avant
le correctif (`git show HEAD:src/css/style.css`), ce fichier de test **échoue**
(code de sortie 1) ; avec le correctif, il passe. Le verrou ne peut donc pas
rester vert si l'extincteur revient, où qu'il soit placé dans le fichier.

## 4. Seconde piste du commit `f230b02` — ÉCARTÉE, avec preuve

Piste : `appliquerObservationTravail` (`src/js/super-agent.js:8851`) appellerait
`setReflecting(false)` au repos observé **pendant** un tour et éteindrait donc la
barre malgré le CSS.

Preuve par lecture, dans l'ordre :

1. La branche du repos observé (`super-agent.js:8873-8885`) n'est atteinte que si
   `obs.working` **et** `obs.starting` sont faux (`assistantWorkState`).
2. `obs.working` reflète `busy` côté moteur, posé **uniquement** sur l'évènement
   `agent_start` (`src-tauri/src/anomaly.rs:212` et `:283`), effacé sur
   `agent_end` / `agent_settled`. Pendant un tour, il est **vrai** : la sonde de
   2 s voit donc le travail et la branche n'est pas prise.
3. La latence qui suit un envoi (le temps que le moteur émette `agent_start`) est
   couverte par `obs.starting` : `send()` demande la relecture lourde juste après
   `send_super_agent_prompt` (`super-agent.js:8657`,
   `refreshAgentMissionDisplay`), la vue porte alors le prompt envoyé et
   `trackMissionStarting` la classe « en démarrage » (borne
   `MISSION_START_MAX_MS = 30 s`, `agent-activity.js:494`). La branche « en
   démarrage » **ne touche ni au statut ni à la barre** — c'est exactement le cas
   verrouillé par `assistant-une-seule-verite-du-travail.test.js` (section 3).
4. Même si une sonde tombait dans un interstice (relecture lourde pas encore
   revenue, ou **même texte renvoyé deux fois** — la signature de mission est
   alors identique et `starting` peut être faux), l'extinction ne dure pas : le
   handler `agent_start` du canal RPC rappelle `superSetReflecting(true)`
   (`super-agent.js:9708` → `:9719`), **au moment même** où le travail commence.

Conclusion : ce chemin peut produire, au pire, un **clignotement de la latence
de lancement** (borné par l'évènement `agent_start`, pas par un délai), **jamais**
une barre éteinte pendant le tour. Il n'est donc pas la cause du défaut observé
(barre éteinte **en permanence**, y compris pendant des tours entiers) : cette
cause-là est bien la cascade CSS du § 1. Aucune mesure d'exécution de
l'application n'est nécessaire pour trancher cela ; en revanche, la **fréquence**
exacte du clignotement de latence, elle, ne se mesure qu'en exécutant Pilot — elle
n'a pas été mesurée, et elle ne change pas la décision (le signal reste affiché
pendant tout le tour).

## 5. Tests lancés

```bash
npx vitest run                                                    # 314 fichiers, 5 822 tests, 0 échec
npx vitest run src/js/barre-de-saisie-respire-toujours.test.js     # 5 tests, 0 échec
# mutation : git show HEAD:src/css/style.css > src/css/style.css
npx vitest run src/js/barre-de-saisie-respire-toujours.test.js     # ÉCHOUE (attendu)
```

Aucun test existant n'a été assoupli ; `au-repos-ce-n-est-pas-du-travail.test.js`
n'a pas été modifié.

## 6. Ce que le propriétaire voit

Il écrit une demande à l'Assistant : la barre de saisie **se met à respirer**,
lentement (environ trois secondes par cycle), un voile discret qui s'intensifie
et s'atténue sans que la barre change de taille ni de place, et elle s'arrête dès
que la réponse est terminée.
