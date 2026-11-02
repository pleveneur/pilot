# Fiche de correction — coupure de parole du mode Vocal (Pilot)

Rédigée par Magnus le 02-10-2026, à partir de deux bancs d'essai en conditions réelles.
À transmettre à l'agent de code du projet Pilot. **Aucune modification n'a été faite.**

## Symptôme observé (utilisateur)

- La coupure de parole (parler par-dessus Pilot pour l'arrêter) **fonctionne**, mais pas dès le départ.
- Après avoir cliqué **une fois** sur le bouton d'envoi de la conversation (même sans texte), la coupure se met à marcher **parfaitement et durablement**.
- Avant ce clic : parfois la coupure ne vient jamais (il faut arrêter à la main), parfois elle est un peu tardive en début de lecture.

## Diagnostic (validé sur deux bancs d'essai)

Le mécanisme de détection **n'est pas cassé** : c'est son **état** qui se fige jusqu'à ce qu'un geste de l'utilisateur le réveille.
Autrement dit : la garde anti-écho (`bargeInArmed`) est décidée une seule fois au début d'une lecture (période de calibration, ~600 ms) puis **jamais réévaluée** pour la lecture suivante. Tant que rien ne la réarme, la détection reste désarmée.

## Correctif attendu

Réarmer la détection **sans dépendre d'un geste utilisateur** :

1. À **chaque nouvelle lecture** qui commence (changement d'état de la lecture à voix haute).
2. À **chaque changement d'état de la voix** (fin de lecture, nouvelle réponse, arrêt manuel).

Contraintes :
- Ne pas ajouter de nouveau réglage utilisateur.
- Ne pas toucher au confort de la garde anti-écho : elle doit continuer à empêcher Pilot de se couper lui-même.
- Ne pas ouvrir le micro ailleurs que dans le module prévu (verrouillé par test).

## Zones de code concernées

- `src/js/vocal-mic.js` : garde anti-écho, calibration, `bargeInArmed`, `stepSpeechGate`, seuils.
- `src/js/super-agent.js` : `vocalSyncMicSpeaking`, l'état de lecture à voix haute (`READ_ALOUD_STATE_EVENT`) comme seule source qui arme la garde.

## Vérifications attendues

- Tests existants au vert : `ecran-vocal-lot3.test.js` et `ecran-vocal-lot4a.test.js`.
- Vérifier qu'aucune API micro n'est apparue dans `super-agent.js` (test de verrouillage).
- Mise à jour de la documentation si le comportement décrit change (`spec_modes_ecran_vocal.md`, bloc d'aide intégrée).

## Ce qu'il ne faut pas faire

- Ne pas relâcher la garde anti-écho au point de laisser Pilot se couper lui-même.
- Ne pas modifier les seuils « au hasard » sans mesure : le correctif porte sur le **réarmement**, pas sur les valeurs.
- Ne pas lancer de test en conditions réelles à la place de l'utilisateur : c'est lui qui valide à l'oral.

## Constat complémentaire du 02-10 : réponse prononcée deux fois

- **Symptôme observé** : lors d'un échange en mode vocal, la même réponse a été prononcée deux fois de suite, à l'identique, sans nouvelle demande de l'utilisateur.
- **Circonstances** : écran Vocal, réponses courtes d'une phrase, plusieurs demandes enchaînées ; le défaut est apparu sur l'une d'elles, pas de façon systématique.
- **Ce qui n'est PAS établi** : la cause. Aucun diagnostic n'a été fait ; aucun mécanisme ni fichier responsable n'est affirmé ici.
- **Piste à vérifier** (hypothèse seulement, à confirmer par reproduction) : la lecture à voix haute d'une même réponse pourrait être déclenchée deux fois (deux appels de lecture pour un seul message), ou le message pourrait être émis deux fois vers la lecture.
- **Ce qu'il faut faire avant de corriger** : reproduire le défaut de façon reproductible et instrumenter (compter les déclenchements de lecture par message), puis corriger sur preuve.
