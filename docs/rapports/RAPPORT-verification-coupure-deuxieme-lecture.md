# Rapport de vérification indépendante — coupure à la deuxième lecture

> Écrit par une session de vérification en **lecture seule** ; déposé tel quel sur
> disque par l'assistant (session de développement Pilot), qui n'a ajouté que
> cette ligne d'en-tête.

<!--
DÉPÔT — À LIRE AVANT LE CORPS
Le corps verbatim du rapport de la session de vérification n'a pas pu être
recopié ici : le texte fourni a été perdu par la compaction du contexte de la
session de développement chargée du dépôt. Il n'a donc PAS été reconstitué (un
rapport de vérification réécrit de mémoire ne serait plus une vérification).
Coller le corps verbatim ci-dessous, tel quel ; la ligne d'en-tête au-dessus
reste la seule ligne ajoutée.
-->

*(Corps verbatim à coller ici.)*

---

## Repères certains, non verbatim (à confronter au corps ci-dessus)

Ces deux éléments sont attestés par la demande de correction qui a suivi ce
rapport ; ils ne remplacent pas le corps :

- **Verdict** : READY pour l'essai du propriétaire.
- **Réserve chiffrée** : la fenêtre de mesure du son de Pilot s'ouvrait sur
  l'annonce de lecture et non sur le début réel du son ; le premier son pouvait
  arriver jusqu'à 1500 ms plus tard (`ensureVoices`) et, pour la voix locale,
  après une synthèse par processus — la référence valait alors 0, les seuils
  tombaient au plancher (0,05) et Pilot se coupait sur son propre son.

Le correctif correspondant, sa justification, les tests et la preuve par
neutralisation sont dans `docs/rapports/RAPPORT-coupure-attaque-du-son.md`.
