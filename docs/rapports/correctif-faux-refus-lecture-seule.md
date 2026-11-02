# Correctif — faux refus de lancement d'un agent en LECTURE SEULE

**Date** : 2026-11-14 · **Projet** : `G:\IA_PL\pilot` · **Module corrigé** :
`src/js/deliverable-guard.js` · **Point de décision unique** :
`detectExplicitWriteRequest` (seul producteur de refus via
`readOnlyWriteRefusalMessage`).

---

## 1. Symptôme

Un agent marqué **lecture seule** (`plan-maker`, `reviewer`, `documenteur`,
`auditeur-regles`) était **refusé au lancement** alors que la mission ne
demandait qu'à **lire et répondre** : il suffisait qu'un mot d'écriture
(« écris », « rédige », « complète »…) et le mot **« fichier »** se trouvent dans
la même proposition, ou qu'un **chemin de fichier** apparaisse après le verbe —
même quand la sortie attendue était explicitement **la réponse de l'agent**.

Exemples réels refusés avant ce correctif (vérifiés par exécution) :

| Mission de lecture seule | Verdict avant |
|---|---|
| « Écris ta réponse dans le chat : liste les fichiers concernés par le défaut. » | **REFUS** |
| « Rédige ton analyse des fichiers du projet dans ta réponse. » | **REFUS** |
| « Complète ton analyse avec les fichiers que tu as lus. » | **REFUS** |
| « Écris un compte rendu des fichiers lus, directement dans ta réponse. » | **REFUS** |
| « Écris tes remarques sur les fichiers de src/js dans ta réponse finale. » | **REFUS** |
| « Ajoute à ta réponse la liste des fichiers de src/js/main.js. » | **REFUS** |

## 2. Cause exacte (preuves fichier:ligne)

Le contrôle était déjà fondé sur un **ORDRE** et non sur un mot isolé
(`findWriteOrder`, `orderScopeEnd`, négations, étiquettes, citations — cf.
`docs/rapports/RAPPORT-refus-lecture-seule-cible-en-sortie.md`). Deux trous
subsistaient **dans la détermination de la cible**, tous deux dans la même
fonction de recherche de cible :

1. **Le NOM commun « fichier » valait cible n'importe où dans le complément.**
   `fileTargetIn(scope)` testait `FILE_NOUN_RE` (`/\bfichiers?\b|\bfiles?\b/`,
   `deliverable-guard.js:135`) sur **toute** la portée de l'ordre, sans exiger
   que ce nom soit le **complément direct** du verbe. « Complète **ton analyse
   avec les fichiers** que tu as lus » : le nom apparaissait après une
   préposition, donc en position d'**ENTRÉE de lecture**, et déclenchait quand
   même le refus. Idem « … liste les fichiers concernés ».

2. **Rien n'arrêtait la portée sur une destination « réponse ».**
   `orderScopeEnd` (`deliverable-guard.js:500`) ne connaissait que les
   frontières de clause (virgule, coordination, subordonnée, gérondif, renvoi à
   une source). Or « dans ta réponse », « dans le chat », « dans ta
   conversation », « dans ton message », « réponse finale » **sont** une
   destination : ce qui suit qualifie la **RÉPONSE**, pas un fichier. La portée
   continuait donc après, et le premier chemin rencontré
   (`src/js/main.js`) était pris pour une sortie attendue — alors que le fichier
   était précisément ce qu'on demandait de **lire**.

Autrement dit : la cible était détectée par sa **présence** au lieu de sa
**fonction** (produit de l'ordre).

## 3. Correction appliquée (minimum nécessaire)

Tout reste dans `src/js/deliverable-guard.js` ; aucun second mécanisme, aucun
changement de `readOnlyWriteRefusalMessage`, qui reste le **seul** producteur de
refus.

1. **Tête de complément obligatoire pour le nom « fichier »**
   (`FILE_NOUN_HEAD_RE`, `deliverable-guard.js:201`, utilisé à
   `deliverable-guard.js:538`) : le nom ne compte comme sortie que s'il est le
   **complément direct** de l'ordre, précédé au plus de déterminants ou
   quantifiants (« écris **un fichier** de synthèse », « crée **le nouveau
   fichier** de config »). Après une préposition ou un autre nom, c'est une
   **entrée de lecture** : aucun refus. Les **chemins** (`file-path`) gardent la
   règle antérieure, inchangée (« Relève les familles et ajoute-les **dans le
   fichier docs/liste.md** » reste refusé).

2. **Destination « réponse » = fin de portée** (`RESPONSE_TARGET_RE`,
   `deliverable-guard.js:434`, ajouté aux frontières de `orderScopeEnd`,
   `deliverable-guard.js:488`) : `dans ta réponse`, `à ta réponse`, `dans la
   réponse`, `réponse finale`, `dans ton message`, `message de fin`, `dans ta
   conversation`, `dans la conversation`, `dans le chat`. Bornage par
   `WORD_START` et non `\b` : « **à** ta réponse » commence par une voyelle
   accentuée, devant laquelle `\b` ne fonctionne pas (piège déjà documenté dans
   le module).

Accents tolérés (`accentTolerant`) comme partout ailleurs dans le module.

## 4. Ce qui reste REFUSÉ (protection non affaiblie)

Vérifié par exécution après correctif — aucune régression :

- **livrable déclaré** (`expected_files`) : refus inchangé, message inchangé ;
- **chemin de fichier** dans le complément de l'ordre : « Modifie
  src/js/deliverable-guard.js… », « Écris le fichier docs/rapport.md. »,
  « Génère le rapport docs/rapport.md. », « Ajoute au fichier README.md la
  ligne… », « Écris, dans docs/rapport.md, le compte rendu… », « Crée
  docs/analyse.md avec les familles manquantes. » ;
- **nom « fichier » complément direct** : « Écris un fichier de synthèse. »,
  « Crée un fichier de test pour le verrou. », « Crée un nouveau fichier de
  config. » ;
- **ordres gouvernés** : « Il faut écrire le rapport docs/rapport.md. »,
  « Merci de créer le fichier docs/rapport.md. », « N'oublie pas de créer
  docs/rapport.md. », « - modifier src/js/main.js » ;
- **anglais** : « Write the file report.md at the root. » ;
- **mission mixte** (au moins un agent qui écrit) : jamais refusée.

Dans le doute, rien ne change : un ordre **sans cible de sortie**
(« écris un plan », « complète ta réponse ») reste **ambigu** ⇒ la demande part.

## 5. Cas couverts par les tests

`src/js/garde-fou-refus-lecture-seule.test.js` :

- nouveau bloc **« la SORTIE est la réponse, pas un fichier (faux refus corrigé
  n° 2) »** : les six formulations réelles ci-dessus sont **acceptées** (aucun
  refus) + preuve que le nom « fichier » n'est retenu qu'en **complément
  direct** + preuve que `orderScopeEnd` s'arrête sur la destination « réponse » ;
- le **verrou de source** existant est renforcé (et non assoupli) : il exige en
  plus `fileTargetIn(`, `FILE_NOUN_HEAD_RE.test(` et `RESPONSE_TARGET_RE` ;
- les blocs de **protection** existants (vraies demandes d'écriture, livrable
  déclaré, message de refus, mission mixte) sont **inchangés** et toujours
  verts.

Aucun test existant n'a été supprimé, neutralisé ni assoupli.

## 6. Vérifications exécutées

```bash
npx vitest run src/js/garde-fou-refus-lecture-seule.test.js   # 48 tests verts
npx vitest run src/js/garde-fou-livrable.test.js              # 17 tests verts
npx vitest run                                                # 5 074 tests verts, 0 échec
```

## 7. Documentation mise à jour

- `spec_gestion_agents.md` § 3.3 : les deux règles de détermination de la cible
  (nom en complément direct, destination « réponse » fermant la portée).
- Bloc `<!-- HELP:agents -->` (section « Écrire un fichier : il faut un agent qui
  écrit ») : ce qu'un ordre doit désigner comme **produit**, et le fait qu'une
  réponse dans la conversation n'est pas un fichier ; `help/handbook.md`
  régénéré par `npm run build:handbook`.

## 8. Hors périmètre (non touché)

Aucune publication, aucun tag, aucun changement de version ; aucun autre
comportement d'agent modifié ; `G:\IA_PL\Presences` non touché.
