# Rapport — la voix imitée (VoiceStudio) est enfin expliquée à l'utilisateur

Date : 2026-11-14 · Chantier : réglages de la lecture des réponses
(`Paramètres → Assistant → Lecture des réponses à voix haute`)
Statut : **livré**, tests verts, commit sur `main`. Aucune publication, aucun bump.

---

## 1. Le problème, dit sans détour

Pilot sait lire les réponses avec **votre voix imitée**, produite par un service
local séparé, **VoiceStudio** (`http://127.0.0.1:3900`). Tout le mécanisme
existait et fonctionnait (choix mémorisé, repli sur Piper puis sur la voix du
système, préchauffage sur geste, journal).

Ce qui manquait n'était pas du code, c'était **une phrase** : à l'écran,
l'utilisateur voyait une entrée « Ma voix imitée — <nom> (VoiceStudio) » sans
jamais comprendre que **VoiceStudio est un autre logiciel**, qu'il doit
l'**installer lui-même**, le **lancer**, sur **le même ordinateur**, et qu'il ne
le trouvera **pas** dans Pilot.

Conséquence constatée en usage : le choix paraît « cassé » alors qu'il attend un
logiciel absent.

---

## 2. Ce qui a été fait

| Fichier | Rôle |
|---|---|
| `src/js/voicestudio-explication.js` (**neuf**) | **Source unique** de la phrase : `VOICESTUDIO_EXPLAIN_TEXT` + `fillVoiceStudioExplanation(nœud)`. Module **pur** : ni DOM global, ni Tauri, ni réseau, ni état ; il n'écrit que dans le nœud qu'on lui passe. |
| `index.html` | Une ligne de plus dans la section « Lecture des réponses à voix haute » : `<span id="read-aloud-voicestudio-note" role="note">`, avec une **copie de repli lisible** (si le script n'a pas encore tourné). |
| `src/js/settings.js` | Déclaration du nœud + appel `fillVoiceStudioExplanation(readAloudVoiceStudioNote)` **dans `renderReadAloudVoice`**, avant toute sortie anticipée : la phrase est donc écrite à chaque ouverture des réglages, à chaque vérification et à chaque choix. |
| `src/js/voicestudio-explique-dans-les-reglages.test.js` (**neuf**) | Le **verrou** (voir § 5). |
| `spec_read_aloud.md` | § 4 quater, **point 12** : l'exigence est écrite, avec le manque connu. § 6 : la couverture nomme le verrou. |
| `help/overview.md` + `help/handbook.md` | Deux puces d'aide utilisateur (« Ce logiciel n'est pas dans Pilot », « L'explication reste affichée même quand le service manque ») ; `npm run build:handbook` relancé (47 blocs). |

---

## 3. Le texte affiché (mot pour mot)

> Ma voix imitée fonctionne avec VoiceStudio, un logiciel séparé : il s'installe
> sur cet ordinateur, comme n'importe quel autre logiciel, et Pilot ne l'installe
> pas, ne le lance pas et ne le télécharge pas. Il doit être lancé et rester
> ouvert pendant la lecture, c'est lui qui fabrique le son de votre voix. Absent
> ou éteint, la lecture ne s'arrête pas : elle continue avec la voix française
> locale, puis avec la voix du système, et une ligne l'annonce à côté du bouton
> « Écouter ». Où le récupérer : Pilot ne fournit pas ce logiciel et ne donne
> aucune adresse de téléchargement ; installez-le depuis la source dont vous
> disposez déjà, puis cliquez sur « Vérifier à nouveau » dans cette section.

Phrases courtes, aucun jargon (ni « endpoint », ni « processus », ni « binaire »,
ni « port 3900 » — un test le refuse). Il répond aux trois demandes : logiciel
**séparé** (a), **à lancer** (b), **où le prendre** (c).

### Deux décisions assumées

1. **La phrase est toujours affichée**, pas seulement quand le service tourne.
   Conditionner l'affichage au cas « service présent » la cacherait précisément à
   celui qui ne connaît pas le logiciel — c'est-à-dire à celui pour qui elle est
   écrite. Elle n'ajoute aucun réglage et ne masque rien.
2. **Aucun lien n'a été inventé.** Voir § 4.

---

## 4. Ce qui MANQUE, et qui n'est pas à moi de décider

**L'adresse de téléchargement de VoiceStudio n'existe nulle part dans le
dépôt.** Vérifié avant d'écrire : `spec_read_aloud.md`, `docs/rapports/`,
`help/`, `src/js/voicestudio-voice.js`, `src-tauri/src/tts_voicestudio.rs`,
`release-notes/`, `README.md`. On y trouve le nom du service, sa version
(0.5.7), son adresse **locale** et son API — jamais une provenance.

Conséquence, choix tenu : le texte **le dit franchement** (« Pilot ne fournit pas
ce logiciel et ne donne aucune adresse de téléchargement ; installez-le depuis la
source dont vous disposez déjà »), et un test **refuse** toute URL, tout domaine,
tout nom de paquet et toute commande d'installation dans ce texte.

**Décision du propriétaire à prendre** : fournir l'adresse réelle (site, dépôt,
page de release…). Le jour où elle existe, **un seul endroit** la portera :
`src/js/voicestudio-explication.js`. Il faudra alors assouplir — volontairement et
en le documentant — le contrôle « aucune adresse » du verrou, pas le contourner.

---

## 5. Le verrou (test neuf) — et la preuve qu'il mord

`src/js/voicestudio-explique-dans-les-reglages.test.js` (11 contrôles) exige :

1. la phrase est **courte** (phrases ≤ 220 caractères) et sans jargon ;
2. elle dit **logiciel séparé**, **s'installe sur cet ordinateur**, « Pilot ne
   l'installe pas / ne le lance pas », **doit être lancé et rester ouvert** ;
3. elle dit le **repli** : « la lecture ne s'arrête pas », « voix française
   locale », « voix du système », « à côté du bouton « Écouter » » ;
4. elle dit **où le récupérer** sans **aucune** adresse inventée (URL, `www.`,
   domaine, `git clone`, `npm i`, `docker`, `winget`, `brew` interdits) ;
5. le module est **pur** (pas de `document.`, pas de `window.`, pas de
   `@tauri-apps`, pas de `fetch(`) et `fillVoiceStudioExplanation` écrit dans le
   nœud passé, sans exception sur un nœud absent ;
6. le nœud est **dans la section** « Lecture des réponses à voix haute »
   (`sliceSource` entre l'ouverture de la section et la section « Mode Vocal ») ;
7. la copie de `index.html` est **identique au caractère près** au texte du module
   (espaces normalisés) — deux versions divergentes feraient échouer la suite ;
8. la ligne n'est **ni `display:none`, ni `hidden`** ;
9. `settings.js` déclare le nœud par son identifiant, importe le module, et son
   appel est **dans `renderReadAloudVoice`**, **avant** le `return` de la liste
   non encore prête ; le rendu est bien atteint à l'ouverture
   (`refreshReadAloudVoice` → `renderReadAloudVoice(wanted, known)`) ;
10. le nœud n'est **jamais** réécrit ailleurs (exactement deux occurrences :
    déclaration + appel ; ni `.style`, ni `.hidden`, ni `.dataset`) ;
11. **aucun réglage nouveau** : `read_aloud_voice:` apparaît **une seule fois**,
    et `read_aloud_voicestudio` n'existe ni dans `settings.js` ni dans
    `index.html`.

**Preuves par neutralisation, faites avant les tests longs :**

- appel `fillVoiceStudioExplanation(readAloudVoiceStudioNote)` retiré de
  `renderReadAloudVoice` → **2 contrôles échouent** (test 9 et test 10) ;
- texte de repli de `index.html` altéré (« Ma voix imitée : VoiceStudio ») →
  **1 contrôle échoue** (test 7).

Fichiers restaurés ensuite à l'identique (`git diff` contrôlé).

---

## 6. Ce que ça ne casse pas

- **Un seul réglage de voix** : `read_aloud_voice`, inchangé, avec ses valeurs
  `""` (système/automatique), `local:piper`, `local:piper:<modèle>`,
  `local:voicestudio:<profil>`. Aucune nouvelle clé de configuration.
- **Service absent** : comportement **exactement** celui d'avant — repli visible
  sur Piper puis sur la voix du système, choix mémorisé jamais réécrit, aucune
  erreur bloquante. La nouvelle phrase ne fait que l'expliquer.
- **Aucune couche Rust touchée**, aucun module frère de la voix locale modifié,
  aucun réglage du mode Vocal (ni réveil, ni effacement de la barre du bas),
  rien touché dans Présences ni dans un autre projet.
- **Aucun test existant** modifié ni assoupli.

---

## 7. Tests lancés

- Verrou neuf, seul : **11/11 vert**, puis **rouge** dans les deux neutralisations
  décrites au § 5 (preuve qu'il mord).
- Suite complète `npm test` : **279 fichiers, 5157 tests, 5157 passés, 0 échec**
  (durée ≈ 15 s).
- `npm run build:handbook` : vert, `help/handbook.md` régénéré (47 blocs).

---

## 8. Ce que le propriétaire doit vérifier lui-même

1. **Ouvrir les réglages** (⚙️ Options → onglet « Assistant » → « Lecture des
   réponses à voix haute ») et lire la phrase : elle doit se comprendre **en une
   lecture**, sans connaître le sujet.
2. **Lire la question qui reste ouverte** (§ 4) : fournir, ou non, une adresse de
   téléchargement. Tant qu'il n'y en a pas, l'écran le dit honnêtement.
3. **Service éteint**, choisir la voix imitée : la lecture doit continuer avec la
   voix française locale et l'annoncer à côté du bouton « Écouter » — la phrase
   d'explication ne doit **rien** changer à ce comportement.
