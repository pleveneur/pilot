# Rapport — refus « lecture seule » : la cible doit être la SORTIE de l'ordre

**Date** : 2026-11-13 · **Module corrigé** : `src/js/deliverable-guard.js` ·
**Point de décision unique** : `detectExplicitWriteRequest` (appelé par
`readOnlyWriteRefusalMessage`, seul chemin de refus).

---

## 1. Symptôme rapporté

Une mission d'**analyse** destinée à un agent en **lecture seule** était
**refusée** (« la demande n'a PAS été lancée ») parce qu'elle contenait des
verbes comme « ajoute », « complète », « écris » ou « crée », alors qu'elle ne
demandait **aucune** écriture de fichier. Le propriétaire a reformulé la
mission, et elle a été **refusée une seconde fois** — d'où le diagnostic.

## 2. Reproduction exacte (deux refus successifs)

Mission 1 (refusée) :

```
Mission de LECTURE SEULE : relève les familles d'ouverture de fichiers utilisées par Pilot.
Ajoute les familles qui manquent à la demande du propriétaire (elle est dans le fichier .pilot/demande.md).
Ne crée AUCUN fichier, ne modifie rien.
```

Mission 2, reformulée (refusée aussi) :

```
Compare les familles citées par le propriétaire à celles du code.
Complète avec les familles que le propriétaire n'a pas citées (sa demande est dans le fichier .pilot/demande.md).
Réponds dans le message de fin, ne crée AUCUN fichier.
```

Dans les deux cas la **sortie attendue était la réponse de l'agent** ; le seul
nom de fichier présent désignait la **source à lire** (la demande du
propriétaire). Sonde sur le module avant correction : les deux textes
renvoyaient `explicit: true, via: "file-noun"`.

## 3. Diagnostic (sourcé)

Avant correction, `fileTargetIn(text, fromIndex)` (`src/js/deliverable-guard.js`)
cherchait un chemin **dans toute la proposition** — d'abord après le verbe, et
**à défaut n'importe où** (« `if (first) return { value: first, via: "file-path" }` »),
puis le simple **mot** « fichier » (`FILE_NOUN_RE` → `via: "file-noun"`).

Conséquence : dès qu'une proposition contenait (a) un ordre d'écriture et (b) le
mot « fichier » **ou** un chemin, **où qu'ils soient**, le refus se déclenchait.
Les quatre familles de faux positifs constatées :

| Formulation | Pourquoi c'était faux |
|---|---|
| « Ajoute les familles qui manquent, en te fondant sur **les fichiers du projet**. » | le mot « fichiers » désigne les **entrées** de lecture |
| « Analyse les fichiers du projet, puis ajoute les familles manquantes **à ta réponse**. » | la sortie est la **réponse**, pas un fichier |
| « … et complète avec celles qui manquent. **Ne crée AUCUN fichier.** » | le fichier cité est celui où **lire** la demande |
| « Complète ta réponse avec les familles oubliées. » | aucun fichier, mais « complète » + « réponse » suffisait dans une phrase voisine |

La règle de sécurité, elle, n'était pas fausse : elle était **trop large**.

## 4. Correction — un seul point, la portée de l'ordre

Tout reste dans `src/js/deliverable-guard.js` ; aucun second mécanisme n'est
créé, et `readOnlyWriteRefusalMessage` reste le **seul** producteur de refus
(les trois points d'appel de `src/js/super-agent.js` — `run_agents`,
`run_assistant_agents`, `delegate_to_coder` — sont inchangés).

1. **La cible est cherchée dans la PORTÉE de l'ordre** (`orderScopeEnd`,
   `src/js/deliverable-guard.js:439`) : après le verbe, jusqu'à la première
   frontière de clause — virgule, coordination (`puis`, `et`, `mais`…),
   subordonnée (`qui`, `que`…), gérondif (« en te fondant sur… »), renvoi à une
   source (« d'après », « à partir de », « sur la base de »). Une virgule qui
   **encadre** le complément (« Écris, dans docs/x.md, … ») ne la ferme pas.
2. **`fileTargetIn(scope)` ne regarde plus que ce complément**
   (`src/js/deliverable-guard.js:468`) : chemin avec extension connue, ou le mot
   « fichier ». Ce qui est mentionné ailleurs n'est plus une cible.
3. **Masquage à longueur constante** (`maskFileTargets`,
   `src/js/deliverable-guard.js:382`, et `maskQuoted`) : le verbe est cherché
   hors des chemins et des citations (un nom comme `corrige-guard.md` n'est pas
   un ordre) tandis que les **positions restent celles du segment réel**, ce qui
   permet de découper la portée sans décalage.
4. **Message de refus clarifié** (`readOnlyWriteRefusalMessage`) : il nomme
   maintenant la sortie attendue (« le fichier « … » (ordre « … ») », « un
   fichier du projet (ordre « … », sans nom de fichier précisé) », « le livrable
   déclaré « … » »), la raison (rôle en lecture seule), **et** la sortie de
   secours — « reformulez la demande comme une tâche de lecture : l'analyse se
   rend dans la réponse de l'agent ».

## 5. Ce qui reste refusé (protection stricte, vérifiée)

| Demande visant un agent `readonly` | Verdict |
|---|---|
| `expected_files: ["docs/familles.md"]` (livrable déclaré) | **refus** |
| « Crée docs/analyse.md avec les familles manquantes. » | **refus** |
| « Écris, dans docs/rapport.md, le compte rendu. » | **refus** (virgule encadrante) |
| « Complète le fichier docs/liste.md avec les familles. » | **refus** |
| « Ajoute au fichier README.md la ligne des familles. » | **refus** |
| « Relève les familles et ajoute-les dans le fichier docs/liste.md. » | **refus** |
| « Écris un fichier de synthèse. » | **refus** (`file-noun` dans la portée) |

Complément de sécurité inchangé : la **preuve du livrable** en fin de mission
(`agents-bus.js`, `verifyExpectedFiles`) continue d'échouer une tâche dont un
fichier déclaré est absent.

## 6. Tests

`src/js/garde-fou-refus-lecture-seule.test.js` — **39 tests** (25 avant) :

- **cas observé autorisé** : les deux missions réellement refusées + quatre
  variantes (« en te fondant sur… », « puis ajoute … à ta réponse », « … et
  complète avec celles qui manquent », fichier cité = entrée) ;
- **cas de sécurité toujours refusé** : les sept demandes du tableau §5 ;
- **cas limite refusé** : `expected_files` (livrable déclaré) + chemin ou mot
  « fichier » dans le complément de l'ordre, y compris après une virgule ;
- **verrou de source** : `readOnlyWriteRefusalMessage` doit appeler
  `detectExplicitWriteRequest` et le corps de la détection doit contenir
  `findWriteOrder(`, `orderScopeEnd(` et `stripNegations(`.

**Anti-régression prouvée par mutation** : en remplaçant `orderScopeEnd` par
l'ancien comportement (cible cherchée dans **toute** la proposition), **4 tests
échouent** sur 39 (les deux missions du rapport et le test de portée) ; la
version corrigée les fait tous passer.

Suites complètes : `npm test` → **5065 tests passés / 273 fichiers**.
`cargo test --manifest-path src-tauri/Cargo.toml --lib` : non requis (aucun
fichier Rust modifié).

## 7. Documentation

- `spec_gestion_agents.md` § 3.3 : `detectExplicitWriteRequest` décrit la
  recherche de la cible **dans la portée de l'ordre**, le masquage à longueur
  constante et le défaut réel corrigé ; section « Preuve » mise à jour.
- `spec_super_agent.md` § Garde-fou du livrable : règle « la cible est cherchée
  dans la PORTÉE de l'ordre », avec la liste de ce qui reste refusé.
- Bloc d'aide `<!-- HELP:super-agent-livrable -->` : nouvelle puce « **Un
  fichier cité n'est pas un fichier demandé** » (langage utilisateur).
- `help/handbook.md` régénéré (`npm run build:handbook`, 47 blocs).

## 8. Limites et doutes restants

- La portée s'arrête à la première frontière de clause : une demande très
  alambiquée du type « Écris en suivant le modèle docs/x.md » est classée
  **ambiguë** (demande lancée) plutôt que refusée. C'est le sens conservateur
  voulu (dans le doute, on ne bloque pas) ; la preuve du livrable reste le
  filet de sécurité côté sortie.
- La détection ne lit toujours **pas** un ordre indirect (« il serait bon que
  le fichier docs/x.md existe ») : comportement inchangé, hors périmètre.
- Aucun test de bout en bout n'invoque un agent `readonly` réel (les tests
  portent sur le module pur et sur le verrou de source des trois points
  d'appel) : c'est le niveau de preuve existant, non élargi ici.

## 9. Fichiers touchés

- `src/js/deliverable-guard.js` (correction, unique point de décision) ;
- `src/js/garde-fou-refus-lecture-seule.test.js` (+14 tests, cas observé,
  sécurité, cas limite, verrou de source) ;
- `spec_gestion_agents.md`, `spec_super_agent.md`, `help/handbook.md`
  (régénéré) ;
- ce rapport.

---

**VERDICT** : faux positif confirmé et corrigé à la source — la cible d'écriture
n'est plus cherchée n'importe où dans la phrase mais **dans le complément de
l'ordre**. Le cas observé (analyse en lecture seule citant son fichier d'entrée)
passe ; les demandes de production de fichier restent refusées (7 cas verrouillés,
dont `expected_files`) ; l'ancien comportement fait échouer 4 tests sur 39, preuve
que la reproduction est réelle. Un doute subsiste, assumé et documenté : une
formulation très imbriquée peut être classée ambiguë (lancée) plutôt que refusée.
