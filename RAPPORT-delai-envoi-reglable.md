# Rapport — le délai d'envoi du mode Vocal devient réglable

> Demande : *rendre réglable le délai d'envoi en mode Vocal* (aujourd'hui figé à
> deux secondes après le dernier mot transcrit), dans **Paramètres → onglet
> Assistant, à côté du réglage de la voix**, avec la **même mémorisation** que les
> réglages voisins, appliqué **sans redémarrage**.
> Contraintes tenues : **défaut inchangé (2 s)**, une **seule source** de décision,
> un **seul minuteur**, **aucun second envoi**, **aucun nouveau réglage ailleurs**,
> écran Vocal / module micro / seuils de parole / anti-écho **non touchés**.
> Protocole `quality-gate` appliqué (`.pi/skills/quality-gate/SKILL.md`).

---

## 1. Constat de départ (état réel du code avant modification)

| Élément | Avant |
|---|---|
| Le délai | `VOCAL_SILENCE_SEND_MS = 2000` (`src/js/vocal-conversation.js:135`), **constante figée** |
| La décision | `decideVocalSilenceSend(etats, moment)` renvoyait `delai: VOCAL_SILENCE_SEND_MS` |
| L'armement | `vocalNoteWord()` (`src/js/super-agent.js`), **seul** endroit qui arme `vocalSilenceTimer` |
| Le réglage | **aucun** : ni champ, ni interface, ni configuration — la spec le disait noir sur blanc (« Ni réglage, ni bouton, ni affichage : le délai ne se règle pas et ne se voit pas. ») |
| Le défaut | deux secondes |

La conséquence : pour allonger ou raccourcir le silence qui déclenche l'envoi, il
fallait **modifier le code et republier**. C'est exactement ce que la demande
corrige, **sans changer le comportement par défaut**.

---

## 2. Ce qui a changé

### 2.1 `src/js/vocal-conversation.js` — la source unique des décisions (pures)

- `VOCAL_SILENCE_SEND_MS = 2000` **reste**, mais devient la **VALEUR PAR DÉFAUT
  du réglage** (ligne 138) et le repli si la configuration est illisible. Ce
  n'est plus une constante figée : elle n'est plus **lue** par la décision.
- Trois constantes de bornage (lignes 141-145) :
  `VOCAL_SILENCE_SEND_MIN_MS = 1000`, `VOCAL_SILENCE_SEND_MAX_MS = 5000`,
  `VOCAL_SILENCE_SEND_STEP_MS = 500`.
- **`normalizeVocalSilenceSendMs(value)`** (ligne 156) : **seul** endroit qui
  décide ce qu'une valeur *vaut*. Non-fini, ≤ 0 ou illisible ⇒ **2 000** ;
  en dessous de 1 s ⇒ **1 000** ; au-dessus de 5 s ⇒ **5 000** ; toute valeur hors
  pas est **alignée sur le pas de 500 ms** (et re-bornée après arrondi). Les
  valeurs du curseur sont idempotentes.
- **`vocalSilenceSendLabel(value)`** (ligne 168) : **seul** formatage lisible —
  « 1 seconde », « 2,5 secondes », « 5 secondes » (virgule décimale, singulier à
  une seconde). Jamais un nombre nu à l'écran.
- `decideVocalSilenceSend` (ligne 444) : `delai: normalizeVocalSilenceSendMs(etats.delaiMs)`
  — le délai **arrive avec l'état**, il n'est **plus lu** d'une constante. La
  règle reste **pure** (aucun `invoke`, aucune configuration, aucun `setTimeout`).

### 2.2 `src/js/super-agent.js` — le seul point qui arme le minuteur

- Nouvelle variable d'état `vocalSilenceSendMs = 0` (ligne 3397), documentée :
  `0` = « pas encore relue », et c'est la **normalisation du module pur** qui
  donne alors les 2 s — donc **la constante n'est jamais recopiée** dans l'écran.
- `vocalSilenceState()` fournit **`delaiMs: vocalSilenceSendMs`** (ligne 4441),
  c'est-à-dire **la seule** transmission de la valeur vers la décision.
- **`refreshVocalSilenceSendMs()`** (ligne 4457) : relit `get_config` et applique
  `normalizeVocalSilenceSendMs(cfg.vocal_silence_send_ms)` ; **fail-open**
  (`catch` ⇒ valeur par défaut). Elle ne contient **ni `clearTimeout` ni
  `setTimeout`** : elle ne peut donc pas toucher au minuteur en vol.
- Appelée **deux fois, pas plus** : au **montage de l'onglet** (ligne 2994, une
  première lecture est nécessaire, sinon le défaut s'appliquerait jusqu'au
  premier enregistrement) et dans le handler **déjà existant**
  `onConfigChanged` de `pilot-config-changed` (ligne 2974) → application
  **immédiate**, sans redémarrage et **sans second écouteur** (pas de fuite à la
  recréation d'onglet, issue #12 ; le listener est toujours retiré par `unlisten`).
- `vocalNoteWord()` est **inchangé** dans sa logique : il arme
  `vocalSilenceTimer` avec `decision.delai`, réévalue à l'échéance
  (`"echeance"`), et referme la dictée par `vocalCloseForSend()` — donc par
  `rec.stop()` → `applyVoiceEnd` → `send`, **le même envoi qu'avant**.

### 2.3 Le réglage : un seul endroit, le style des réglages voisins

- `index.html` (ligne 1394) : nouvelle section
  `<div class="settings-section" id="settings-section-vocal-delay">` intitulée
  **« Mode Vocal »**, **juste après** `#settings-section-read-aloud` (le réglage de
  la voix) et **avant** la section « Clients ».
  Contenu : `<label for="setting-vocal-silence-send">Délai d'envoi :</label>`,
  `<input type="range" min="1000" max="5000" step="500" value="2000">`,
  `<span id="vocal-silence-send-label">2 secondes</span>` (valeur courante en
  toutes lettres), et une note `role="note"` reliée par `aria-describedby`.
  **Même style de contrôle** que le réglage voisin du volume du son (une
  `setting-row` : libellé, curseur, valeur à droite).
- `src/js/settings.js` :
  - imports de `normalizeVocalSilenceSendMs` et `vocalSilenceSendLabel` (aucun
    nombre recopié) ;
  - `refreshVocalSilenceSend(value)` : remplit le curseur **et** le libellé,
    toujours via la source unique ;
  - remplissage au chargement : `refreshVocalSilenceSend(currentConfig &&
    currentConfig.vocal_silence_send_ms)` ;
  - enregistrement : `vocal_silence_send_ms: normalizeVocalSilenceSendMs(parseInt(...))`
    — **une valeur aberrante ne peut donc jamais être écrite** ;
  - listener `input` : le libellé suit le glissement (même modèle que le volume).
- `src-tauri/src/lib.rs` : champ `vocal_silence_send_ms: u32` (ligne 711) avec
  `#[serde(default = "default_vocal_silence_send_ms")]` (ligne 710),
  `fn default_vocal_silence_send_ms() -> u32 { 2000 }` (ligne 1002) et
  l'initialisation dans `Default` (ligne 1233). **Aucune migration** : un fichier
  de configuration ancien (sans le champ) prend le défaut 2 000 ms.

### 2.4 Changement de réglage **pendant** une dictée

Règle appliquée, et c'est le comportement naturel du branchement retenu : **la
valeur est lue au moment d'armer**, elle n'est pas surveillée ensuite. Donc un
réglage modifié **en pleine dictée** ne touche **jamais** le minuteur déjà lancé
(on ne coupe pas une parole en bougeant un curseur) : il s'applique au
**prochain armement** — le mot suivant, ou la dictée suivante. `refreshVocalSilenceSendMs`
ne fait que remplacer la valeur connue (aucun `clearTimeout`/`setTimeout`), et
c'est vérifié par le banc temporel du nouveau test.

---

## 3. Ce qui n'a **pas** changé (interdits respectés)

- **Défaut : deux secondes**, inchangé (constante non modifiée, valeur de départ
  du curseur = 2 000 ms, défaut Rust = 2 000 ms).
- **Écran Vocal** : aucun élément ajouté, aucun texte, aucun bouton, aucune
  couleur (les quatre états, l'objet, le trait de niveau sont intouchés).
- **`vocal-mic.js`** (micro, seuils de parole, anti-écho, `bargeIn`) : **aucune
  ligne modifiée**.
- **Un seul minuteur** (`vocalSilenceTimer`) et **une seule affectation** de ce
  minuteur dans tout `super-agent.js` (compté par test).
- **Un seul envoi** : la fermeture passe toujours par `rec.stop()` →
  `applyVoiceEnd` → `send` ; aucun second chemin, aucun second moteur.
- **Aucun autre réglage** ajouté, ni déplacé : le seul nouveau champ est
  `vocal_silence_send_ms`.
- **Brièveté des réponses** (`vocal-brevity.js`) et **chemin d'envoi** : non
  touchés.
- **Aucun `console.*`**, aucun affichage de débogage, aucune valeur écrite en dur
  hors du module pur (bornes, pas, défaut et libellé vivent tous dans
  `vocal-conversation.js`).

---

## 4. Documentation mise à jour

| Fichier | Ce qui est dit maintenant |
|---|---|
| `spec_modes_ecran_vocal.md` § 6bis.1 | « deux secondes **par défaut, réglable** » : le réglage, son emplacement unique, les bornes 1–5 s / pas de 0,5 s, la normalisation, et **l'application au prochain armement** |
| `spec_voice_input.md` § 5quater | même règle, vue dictée : défaut inchangé, réglage unique, non-modification du minuteur en vol, preuves mises à jour |
| `spec_read_aloud.md` § 2 | la section voisine `#settings-section-vocal-delay` est nommée (voisine, **pas** mélangée avec le réglage de la voix) |
| `help/overview.md` — bloc `HELP:modes-ecran` | la règle utilisateur : « après votre dernier mot », puis **« Ce délai se règle »** avec le chemin exact (Options → Assistant → Mode Vocal), 1 à 5 s, 2 s au départ, valeur affichée en toutes lettres |
| `help/overview.md` — bloc `HELP:lire-reponses` | la ligne **« Délai d'envoi »** de la section « Mode Vocal », juste sous le réglage de la voix |
| `spec_voice_input.md` — bloc `HELP:dictee-vocale` | « après votre dernier mot », délai réglable (1 à 5 s) à l'endroit indiqué |
| `help/handbook.md` | **régénéré** (`npm run build:handbook` — 46 blocs) : l'aide embarquée contient bien les nouvelles phrases |

---

## 5. Preuves (tests)

Nouveau fichier `src/js/vocal-delai-envoi-reglable.test.js` (**34 cas**), qui
verrouille :

1. **le défaut** : 2 000 ms, une seule déclaration, pas de recopie dans l'écran
   ni dans les Paramètres ;
2. **la normalisation** : absent / nul / illisible / négatif ⇒ 2 s ; < 1 s ⇒ 1 s ;
   > 5 s ⇒ 5 s ; hors pas ⇒ aligné ; valeurs du curseur idempotentes ;
3. **le libellé** : « 2 secondes », « 1 seconde », « 2,5 secondes », « 5 secondes »
   (jamais un nombre nu) ;
4. **la décision reçoit le délai** : sans valeur ⇒ 2 s ; 1 s / 3 s / 5 s honorés ;
   valeur aberrante bornée ; **les gardes passent avant le délai** (Pilot parle,
   reprise en main, hors mode ⇒ annulation quel que soit le réglage) ;
5. **le temps** (horloges simulées) : rien avant l'échéance, envoi à l'échéance,
   pour **1 s (min)**, **3 s**, **5 s (max)** ; chaque mot **repousse** ;
   **changer le réglage pendant une dictée ne modifie pas le minuteur déjà lancé**
   (un seul minuteur en vol, échéance d'origine respectée) et la nouvelle valeur
   s'applique **au prochain armement** (mot suivant, puis dictée suivante) ; une
   garde qui refuse **annule** le minuteur (aucun envoi tardif) ;
6. **le branchement** : une seule variable de valeur, une seule transmission
   (`delaiMs: vocalSilenceSendMs`), relecture par `get_config` + bornage,
   **aucun `setTimeout`/`clearTimeout` dans la relecture**, deux appels exactement
   (montage + changement de réglage), **aucun nouvel écouteur**, **un seul
   minuteur**, **un seul `applyVoiceEnd`** ;
7. **l'interface** : un seul `id="setting-vocal-silence-send"`, dans l'onglet
   Assistant, **section voisine** de celle de la voix, `type="range"` 1 000–5 000 /
   pas 500 / valeur 2 000, libellé relié, note reliée, valeur affichée en clair,
   mémorisation et bornage côté `settings.js`, champ `u32` à défaut 2 000 côté
   Rust ;
8. **la documentation** : les trois specs disent le réglage, le défaut de deux
   secondes et l'application au prochain armement ; l'aide embarquée (bloc source
   **et** `handbook.md` généré) nomme « Délai d'envoi ».

Test existant ajusté : `src/js/vocal-repondre-deux-secondes.test.js` — le cas
« aucun réglage, aucun bouton, aucun affichage » est devenu
« aucune valeur en dur ni trace de débogage **dans le module pur** » (l'ancienne
affirmation « le délai n'est pas réglable » est devenue fausse), et le nom
correct `decideVocalSilenceSend` remplace une graphie accentuée qui n'existait
nulle part dans le code. **Tous les autres cas de ce fichier passent tel quel.**

Vérifiés aussi, sans modification : `reglage-voix-onglet-assistant`,
`apercu-voix-parametres`, `voix-locale`, `voix-locale-choix`,
`voix-locales-chargement-automatique`, `libelle-options-ecran`,
`ecran-vocal-lot2` / `lot3` / `lot4a`,
`vocal-parler-declenche-une-demande`, `envoi-auto-fin-dictee`,
`envoi-auto-dictee-web-distant`.

---

## 6. Limites connues (dites, pas cachées)

- **Le web distant n'a pas ce réglage** : il ne touche pas à l'écran Vocal (qui
  n'existe pas en mode web) ; le champ reste dans la configuration du poste.
- **Un changement pendant une dictée attend le prochain armement** : c'est un
  choix (ne jamais couper une parole), documenté dans la spec et l'aide.
- **La latence réelle du moteur de reconnaissance** n'est toujours pas mesurée
  (elle n'a plus d'importance pour l'envoi) — inchangé par rapport à avant.
