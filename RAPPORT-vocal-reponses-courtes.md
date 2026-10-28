# RAPPORT — En mode Vocal, Pilot parle court

Demande du propriétaire : *« le texte que l'assistant prononce dans ce mode vocal,
il faudrait que ce soit plus court pour une conversation plus fluide, et qu'on
entre dans les détails si l'utilisateur le demande dans la conversation ».*

## 1. Le point unique où la demande du mode Vocal est composée

L'écran Vocal est un overlay de l'onglet 🧭 Assistant : sa **barre de saisie est
le même nœud**, seulement déplacé dans l'overlay. Toutes les demandes de cet
écran — au clavier comme à la voix — passent donc par **une seule fonction** :

| Élément | Emplacement |
|---|---|
| Point de composition (unique) | `send()` dans `src/js/super-agent.js` (`const messageAgent = composeVocalPrompt(text, { modeVocal: vocalOverlay !== null });`) |
| Consigne + assemblage (source unique) | `src/js/vocal-brevity.js` — `VOCAL_BREVITY_INSTRUCTION`, `composeVocalPrompt(text, { modeVocal })` |

Aucun second chemin de prompt n'a été créé : un seul `invoke("send_super_agent_prompt", …)`
existe dans tout le fichier, et il reçoit désormais `messageAgent`.
La provenance est l'écran **réel** (`vocalOverlay !== null`), pas un drapeau
parallèle : la consigne ne peut pas fuir ailleurs.

## 2. Le texte exact de la consigne

```
## Mode vocal — parler court
Cette demande vient de l'écran Vocal de Pilot : la conversation n'y est pas affichée et ta réponse va être LUE À VOIX HAUTE.
Règle de conversation parlée : réponds en DEUX OU TROIS PHRASES AU PLUS, comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.
Si l'utilisateur demande explicitement de développer (« détaille », « explique », « pourquoi », « comment »), alors développe : donne le détail demandé, en restant compréhensible à l'oreille (des phrases, jamais de tableau ni de code).
Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que trois phrases. Ne cache jamais une information utile pour rester court.
```

Elle est ajoutée **en fin** de demande, après une ligne vide. La demande de
l'utilisateur reste **mot pour mot** en tête du message : rien n'est reformulé.

## 3. Comment le mode écrit reste intact

- Hors du mode Vocal, `composeVocalPrompt` **rend le texte inchangé** : le chat
  écrit (onglet π) et l'onglet 🧭 Assistant gardent exactement leurs réponses
  actuelles.
- Le prompt système de l'assistant (`src-tauri/src/super_agent.rs`) **n'est pas
  touché** : la consigne n'y apparaît pas (donc jamais pour l'assistant ni pour
  le web distant).
- La **bulle de la demande** et les **badges projet** gardent le texte de
  l'utilisateur tel qu'il l'a dit (`appendMessage(messagesEl, "user", text)`,
  `collectBubbleBadgeProjects(text)`).
- **Aucune troncature** : la brièveté vient de la consigne. Le module ne contient
  ni `slice`, ni `substring`, ni limite de caractères ; la réponse déjà produite
  n'est jamais coupée après coup.
- **Aucun réglage, aucun bouton, aucune phrase d'interface** ajoutés ; ni écran,
  ni seuil du vocal, ni texte de réponse déjà produite modifiés.

## 4. Les tests

Nouveau fichier : `src/js/vocal-reponses-courtes.test.js` (17 tests).

- **Contenu de la consigne** : deux ou trois phrases au plus ; pas de listes,
  titres, tableaux, noms de fichiers, code ; « utile à dire à voix haute » ;
  développement seulement si l'utilisateur le demande (« détaille », « explique »,
  « pourquoi », « comment ») et compréhensible à l'oreille.
- **Cas de sécurité exclus explicitement** : panne, refus, erreur, micro, demande
  de confirmation dits **entièrement** (exception placée **avant** la brièveté).
- **Composition** : en mode Vocal, message = demande + consigne (une seule
  consigne, demande intacte en tête) ; hors mode Vocal, texte **inchangé** (faux,
  absent, `null`, `{}`) ; demande vide ⇒ aucune consigne orpheline.
- **Aucune coupe** : 4 000 mots ⇒ longueur totale exacte (demande + séparateur +
  consigne), préfixe identique, aucune primitive de troncature dans le module.
- **Câblage** : la consigne est **importée** (jamais recopiée), **un seul appel**
  dans toute l'application, `send()` envoie `messageAgent` et non `text`, la
  bulle garde `text`, la provenance est `vocalOverlay !== null`, un seul
  `invoke` d'envoi, aucun des modules du vocal (`vocal-conversation.js`,
  `vocal-mic.js`, `voice-auto-send.js`) ne compose de message.
- **Documentation** : la spec du mode Vocal nomme la règle, `src/js/vocal-brevity.js`
  et `composeVocalPrompt` ; l'aide utilisateur source **et** le handbook généré
  disent la règle en clair.

Aucun test existant supprimé ni modifié pour faire passer ce lot.

## 5. Vérifications exécutées

```
npm test        → 209 fichiers, 3 810 tests, tous verts
npm run build:handbook → handbook régénéré (46 blocs)
npm run build   → ✓ built in 12.48s (aucune erreur)
```

La spec `spec_modes_ecran_vocal.md` a une nouvelle section **§6bis.2 « Pilot
parle court »** (+ ligne dans le tableau §10, + verrou cité, + §11) et le bloc
`<!-- HELP:modes-ecran -->` de `help/overview.md` porte la règle en langage
utilisateur.
