# Rapport — « la barre du bas ne s'efface plus après avoir parlé »

> Symptôme rapporté par le propriétaire après le correctif `79c6358` (un résultat
> de dictée **vide** ne réveille plus le bas) : *la barre du bas s'efface bien au
> repos, mais dès qu'il prononce une phrase, la barre réapparaît et ne s'efface
> plus ensuite — même en arrêtant de parler et sans rien toucher.*
>
> Ce document a été écrit **avant toute modification de code**. Aucun fichier
> n'avait été touché au moment de la rédaction (`git status --short` vide).

---

## 1. Le trajet réel du minuteur, de la fin d'une prise de parole au repos

Ce qui existe (relevé sur le disque, pas de mémoire) :

| Pièce | Fichier:ligne | Rôle |
|---|---|---|
| le minuteur **unique** | `src/js/super-agent.js:4516` (`vocalChromeTimer`) | une seule variable, jamais deux minuteries |
| le **seul** poseur du décompte | `src/js/super-agent.js:5905` `vocalRestartChromeTimer()` | `clearVocalChromeTimer()` puis `setTimeout(…, VOCAL_CHROME_IDLE_MS)` — 10 000 ms |
| le **seul** réveil | `src/js/super-agent.js:6068` `vocalWakeChrome()` | `vocalRestartChromeTimer(); vocalSyncChrome();` — rien d'autre |
| le **seul** juge | `src/js/super-agent.js:5974` `vocalSyncChrome(state)` | lit le DOM, appelle la décision pure, applique la classe |
| le **seul** point d'écriture de la classe | `src/js/super-agent.js:6020` | `vocalOverlay.classList.toggle(VOCAL_CHROME_HIDDEN_CLASS, classe !== "")` |
| la décision pure | `src/js/vocal-chrome.js:95` `vocalChromeVisible(faits)` | quatre règles, dans l'ordre |
| le dernier appel d'`applyVocalState` | `src/js/super-agent.js:5886` | `vocalSyncChrome(state)` — après `vocalSyncConversation()` (5876) et `vocalSyncRestartButton` |
| les faits transmis | `src/js/super-agent.js:5994-6002` | `question`, **`saisie: texte.trim() !== ""`** (6000), `micFerme` (6001), `pointeurActif`, `pointeurGeste` |

Le trajet nominal d'une prise de parole, jusqu'au repos :

1. l'utilisateur parle → `vocalBargeIn` réveille le bas (`super-agent.js:6662`),
   soit un décompte de 10 000 ms qui repart de zéro ;
2. le moteur transcrit → `rec.onresult` (`super-agent.js:4966`) écrit le texte
   dans la zone, puis `if (transcript.trim()) vocalWakeChrome();` (`5006`) ;
3. à l'échéance du silence, la dictée est refermée (`decideVocalSilenceSend`,
   `src/js/vocal-conversation.js:563`, règle 7) → `rec.onend` (`5036`) →
   `applyVoiceEnd` → `send()` ;
4. le décompte du bas arrive à son terme (`super-agent.js:5907`) →
   `vocalChromeTimer = 0` → `vocalSyncChrome()` (`5914`) → la décision reprend
   la main : **le bas s'efface si et seulement si les quatre règles le
   permettent**.

Le point de bascule est donc l'étape 4 : le minuteur fonctionne (le propriétaire
le voit : la barre s'efface bien au repos), mais **à l'échéance, une des quatre
règles retient encore le bas**. Le symptôme n'est pas « le minuteur ne repart
pas », c'est **« une règle retient en permanence »** — et la seule des quatre
qu'une prise de parole peut laisser vraie pour toujours est la règle 2, *le
champ contient du texte*.

---

## 2. La cause exacte : le texte pris en file **reste dans le champ**

### 2.1 Ce que le code promet (deux fois)

`super-agent.js:7248-7250` (commentaire de `enfilerDemande`) :

> *« Le texte n'est PAS conservé dans la zone de saisie : il est déjà pris, il ne
> peut donc pas être perdu — et la zone reste libre pour la demande suivante. »*

`super-agent.js:7299-7301` (commentaire de `flushDemandesEnAttente`) :

> *« `send` vide la zone de façon synchrone (avant son premier `await`) : le
> brouillon éventuel de l'utilisateur est donc restitué aussitôt, sans écraser ce
> qu'il écrit. »*

### 2.2 Ce que le code fait

`super-agent.js:7251-7262` — le corps de `enfilerDemande` :

```js
function enfilerDemande(text) {
  demandesEnAttente = [...demandesEnAttente, text];
  tourEnCoursVu = false;
  busyNotified = true;
  statusEl.textContent = "🕓 Demande en attente";
  setBusyHint(true);
  appendSystemMessage(messagesEl, MESSAGE_DEMANDE_ACCUSEE);
  applyVocalState();
}
```

**La zone de saisie n'est pas vidée.** Le seul vidage du chemin d'envoi est
`super-agent.js:7386-7387` (`inputEl.value = ""; inputEl.style.height = "auto";`),
et il se trouve **après** la décision d'enfilage — la branche
`super-agent.js:7359-7361` :

```js
if (decisionDemande.action === DEMANDE_ENFILER) {
  enfilerDemande(text);
  return;                       // ← sortie AVANT le vidage de la zone
}
```

Sortie immédiate, avant les lignes 7386-7387. **Le texte de la dictée reste donc
écrit dans le champ.**

### 2.3 Pourquoi la barre ne s'efface plus ensuite (chaîne complète, cinq maillons)

1. `occupe: isStreaming || backendBusy` (`super-agent.js:7353`) → la demande est
   **enfilée** (`decideDemandePendantLeTour`, `src/js/demande-pendant-le-tour.js:98`).
   Ce cas **n'est pas théorique** : la dictée est **armée pendant que l'Assistant
   travaille** (règle 8 de `decideVocalDictation`,
   `src/js/vocal-conversation.js:454-465`, décision du propriétaire de 2026-11,
   « le tour en cours ne ferme plus l'oreille »). Parler pendant un travail en
   cours est donc un cas **explicitement prévu** par l'écran — c'est même la
   raison d'être de la file.
2. `enfilerDemande` appelle `applyVocalState()` (7259) → `vocalSyncChrome` (5886)
   → les faits sont relus (6000) : `saisie: texte.trim() !== ""` vaut **vrai**.
3. `vocalChromeVisible` (`src/js/vocal-chrome.js:100`) : `if (f.saisie === true)
   return true;` → **le bas est retenu**. Pour toujours : la règle est une
   propriété du champ, elle n'a aucune échéance.
4. la dictée se réarme ensuite (règle 8) avec `preText = inputEl.value` — donc
   **le texte resté dans le champ** : chaque nouvelle dictée le reprend et
   **ajoute** sa transcription ; le champ ne peut plus être vide.
5. à la fin du tour, `flushDemandesEnAttente` (`super-agent.js:7294-7310`) remet
   volontairement le « brouillon » en place :

   ```js
   const brouillon = inputEl.value;      // ← le texte resté dans le champ
   inputEl.value = texte;
   void send();
   if (inputEl.value === "") { inputEl.value = brouillon; }   // ← il revient
   ```

   Le texte laissé par la branche d'enfilage devient donc le « brouillon » et
   **est réinjecté** dans la zone : même après l'envoi de la demande en attente,
   le champ n'est jamais vide.

Conclusion : après une phrase prise en file, **le champ contient du texte en
permanence**, donc la règle 2 interdit le masquage **en permanence**. Le seul
geste qui rendrait l'effacement possible est de **vider le champ à la main** —
exactement ce que le propriétaire dit ne pas faire (« sans rien toucher »). Le
minuteur, lui, n'y est pour rien : il sonne toutes les 10 s et se fait refuser
par la règle 2.

---

## 3. Ce qui a été examiné et **écarté** (pour ne pas se tromper de cause)

| Hypothèse | Verdict | Raison |
|---|---|---|
| le minuteur n'est plus reposé après la parole | **écartée** | `vocalWakeChrome` est bien appelé par la prise de parole (`6662`) et par le texte (`5006`) ; et un réveil absent ne pourrait pas rendre la barre *visible pour toujours*, seulement trop tôt. |
| des résultats intermédiaires **non vides** repoussent le décompte en boucle (`5006`) | **écartée comme cause de ce symptôme** | il faudrait que la session de dictée reste ouverte : or elle se referme 2 s après le dernier nouveau mot (échéance du silence, `vocal-conversation.js:563`), donc les réveils s'arrêtent. C'est une faiblesse **latente** (le texte s'accumule, donc tout résultat ultérieur est « non vide »), pas la cause : elle ne produit qu'un **retard**, jamais une retenue définitive. Consignée ici, **non modifiée** (elle toucherait au verrou du 2026-11-15). |
| le micro ferme (`reportVoiceFailure`) retient le bas | **écartée** | `vocalDictationMessage` (`src/js/vocal-conversation.js`) rend une chaîne **vide** pour `aborted`, `no-speech` et `question-en-attente` : ces fins ne posent aucune panne. Une vraie panne serait **lue à l'écran** (ligne d'état + bouton « Autoriser le micro »), ce que le rapport ne décrit pas. |
| une question de l'assistant retient le bas (règle 4) | **écartée** | elle serait **visible** (la rangée est dans `.vocal-input`) et l'écran l'annonce ; le propriétaire n'en parle pas. |
| répondre à une question laisserait la réponse dans le champ (même défaut, autre chemin) | **écartée** | ce chemin-là **libère** bien la zone : `send()` (`super-agent.js:7338-7341`) lit le champ pour valider la note, puis `finishPendingQuestion` appelle `clearPendingInput()` (`super-agent.js:3294`) — **uniquement en cas de succès**, après l'`await` ; et `pendingInputEl` **est** `inputEl` (`super-agent.js:3098`). Le champ n'est conservé que sur échec, comme le dit le commentaire (7338). |
| le focus du champ retient le bas | **déjà corrigé** le 2026-11-13 | `saisie` ne dit plus que « du texte », jamais « le curseur » (`vocal-chrome.js:100`, spec §4bis). |

Les deux seuls chemins qui **prennent** le texte de la zone sont donc désormais
symétriques : la validation d'une question libère le champ via
`clearPendingInput()` (succès seulement), et l'enfilage d'une demande le libère
désormais de la même façon. La seule retenue volontaire qui subsiste est celle
du **refus** (file pleine, et moteur non vérifié — message qui dit explicitement
« Votre message est conservé dans le champ ») : le texte y est bel et bien
encore à envoyer.

---

## 4. Correctif (au plus près du branchement, sans toucher aux quatre règles)

**Aucune des quatre règles de `vocalChromeVisible` n'est modifiée** — la règle 2
reste exactement « le champ contient du texte, et un champ rempli ne s'efface
jamais » (décision du propriétaire). Ce qui est corrigé, c'est **le fait qu'on
lui donne un champ rempli alors que le texte est déjà pris**.

Le texte mis en file **est déjà pris** : il vit dans `demandesEnAttente`, il ne
peut plus être perdu. La zone doit donc être libérée **au moment exact où le
texte est pris**, à l'endroit que le commentaire du module désigne déjà, avec
**les deux lignes déjà utilisées** par le chemin normal (`7386-7387`) — aucun
second mécanisme, aucun minuteur, aucun réglage :

```js
function enfilerDemande(text) {
  demandesEnAttente = [...demandesEnAttente, text];
  inputEl.value = "";                 // le texte est PRIS : la zone est libre
  inputEl.style.height = "auto";
  …
  applyVocalState();                  // la décision voit un champ vide
}
```

Effets, tous déjà couverts par des mécanismes existants :

- la règle 2 redevient **fausse** dès que la demande est prise → le décompte en
  cours, à son échéance, **efface** le bas (aucun réveil n'est ajouté) ;
- `preText` de la dictée suivante est vide : plus d'accumulation ;
- le « brouillon » restitué par `flushDemandesEnAttente` (7294-7310) redevient ce
  qu'il doit être — ce que l'utilisateur avait **réellement** tapé — et non le
  texte déjà envoyé. La restitution conditionnelle `if (inputEl.value === "")`
  fonctionne de nouveau, comme son commentaire l'annonce.

La branche **refus** (`file pleine`, `7362-7371`) est **laissée telle quelle** :
là, rien n'est pris, et le texte doit rester dans la zone (c'est écrit, testé et
documenté).

---

## 5. Verrou

`src/js/barre-du-bas-apres-la-prise-de-parole.test.js` :

1. **BRANCHEMENT** — dans `enfilerDemande`, l'ordre est : *empiler* le texte,
   **puis** vider la zone (`inputEl.value = ""`), **puis** `applyVocalState()`
   (pour que la décision voie le champ vide) ; aucune sortie anticipée ne peut
   laisser le champ rempli ;
2. **NON-DUPLICATION** — le vidage emploie exactement les deux lignes du chemin
   normal, et `enfilerDemande` ne contient ni `setTimeout`, ni `setInterval`, ni
   `localStorage`, ni `get_config` ;
3. **CONSÉQUENCE** — avec un champ vidé, l'échéance du décompte **autorise**
   l'effacement ; avec le texte resté dedans, elle l'**interdit** (la règle 2 est
   intacte, c'est bien elle qui retenait) ;
4. **BOUT EN BOUT** — la séquence réelle (parole → texte écrit → demande prise →
   zone libérée → décompte écoulé) se termine par *effacé* ; la même séquence
   **sans** le vidage se termine par *visible pour toujours* : c'est la
   reproduction du défaut, et elle échoue sans le correctif.

---

## 6. Doute réservé (dit sans détour)

Le flux d'évènements du moteur de reconnaissance réel (WebView2) n'est pas
simulable ici : la démonstration ci-dessus est **statique** (chaîne de lignes
citées), doublée d'un test de décision pur. Si le propriétaire observait encore
le symptôme **sans qu'aucune demande n'ait jamais été mise en file** (aucun
accusé « Demande reçue » à l'écran), alors la cause restante serait la faiblesse
latente du § 3 (ligne 2 du tableau), qui exigerait une décision écrite séparée
puisqu'elle touche au verrou du 2026-11-15.

Observation annexe, **non corrigée** (hors périmètre) :
`src/js/envoi-auto-fin-dictee.test.js:414` modélise encore un `send()` qui
**refuse** quand l'Assistant est occupé (`if (state.busy) return;`) ; le `send()`
réel **enfile** depuis la décision de 2026-11. Ce harnais est une image, pas le
code : il reste vert, mais il ne décrit plus le comportement réel.
