# Corrections locales : lot 5

# Lot 5 : garde des écritures de l'Assistant

Les deux sous-points sont confirmés par un ROUGE réel, puis corrigés. La suite JS complète est verte et le build passe. AST-01 reste **partiellement non résolu** : ce lot ne règle ni Bash ni les autres points hors périmètre.

## Sous-points

**1. Le garde autorisait par défaut. Confirmé et corrigé.**
- **ROUGE** (3 échecs sur 6) :
  - un chemin manquant était autorisé ;
  - un chemin avec octet nul était autorisé, parce que l'échec de `mkdirSync` était ignoré ;
  - sans `ctx.ui`, le hook échouait avec `TypeError: Cannot read properties of undefined`, donc pi aurait planté.
- **Correction** : seuls `write` et `edit` sont concernés. Pour ces deux outils, tout doute ou toute erreur entraîne maintenant un refus : chemin manquant, vide, non textuel ou avec octet nul, erreur interne, échec de création des dossiers. La notification est faite par `safeNotify`, qui ne fait rien si l'interface manque et ignore ses propres exceptions. Les autres outils (`read`, `grep`, `bash`…) passent comme avant.
- **VERT** : 6 sur 6.

**2. Les liens symboliques n'étaient pas résolus. Confirmé et corrigé.**
- **ROUGE** (5 échecs sur 13) : lien de dossier sortant, lien de dossier placé en profondeur, lien de fichier sortant, lien pendant dont la cible n'existe pas encore, et `..` placé après un lien.
- **Correction** (`checkRealPath`, API `node:fs` natives uniquement) :
  - on part du chemin réel de la racine (`realpathSync`) et on avance élément par élément ;
  - un dossier intermédiaire existant doit avoir un chemin réel dans la racine et être un vrai dossier ;
  - un dossier intermédiaire absent est créé seul, sans `recursive`, et seulement dans un parent déjà vérifié. Plus rien n'est créé hors de l'espace ;
  - un lien final est suivi. S'il est pendant ou s'il sort de l'espace, l'écriture est refusée ;
  - toute erreur autre que « fichier absent » (EACCES par exemple) entraîne un refus.
- **Décision fonctionnelle à valider** : tout chemin contenant un segment `..` est refusé. Le système résout le `..` après avoir suivi les liens, alors que `resolve()` l'efface avant. Une écriture légitime reste possible avec un chemin direct.
- Un lien qui reste dans l'espace est accepté. Si `~/.pilot/assistant` est lui-même un lien, sa cible réelle est acceptée comme racine.
- **Faux ROUGE corrigé** : le premier test `..` passait par `path.join`, qui supprimait déjà le `..`. Il échouait donc pour une mauvaise raison. Je l'ai réécrit avec une chaîne brute. J'ai ensuite neutralisé temporairement le contrôle pour vérifier que ce test passe bien au ROUGE (ligne 191), puis je l'ai rétabli.
- **VERT** : 14 sur 14, avec le test de droits EACCES ajouté.

## Fichiers modifiés
- `src-tauri/extensions/pilot-assistant-files.ts`
- `src/js/assistant-files-garde.test.js` (nouveau)
- `spec_super_agent.md` : quatre passages (vers les lignes 888, 2835, 3028 et 3286). J'ai remplacé « garantie technique, ne peut jamais écrire » et « lecture seule stricte (technique) » par « garde partielle », en indiquant explicitement que Bash n'est pas couvert et que le risque de course demeure. La spec promet donc moins qu'avant.

Aucun autre fichier n'est touché, aucun commit n'a été fait, HEAD est toujours `6d57ddd`.

## Tests
- **Mise en place** : le test importe la vraie extension `.ts` et enregistre son vrai callback `tool_call` avec un faux pi. `node:os.homedir` est remplacé par une version qui **lève une erreur si le faux dossier personnel n'est pas défini**, donc le vrai HOME n'est jamais utilisé. Les fichiers et liens temporaires sont créés dans `src/js/.tmp-assistant-files-garde-*` à l'intérieur du bac, puis supprimés à la fin.
- **Cas vérifiés** :
  - refus hors de la racine ;
  - chemin manquant ou invalide ;
  - erreur interne avec ou sans `ui`, et avec un `notify` qui lève une erreur ;
  - EACCES ;
  - lien de dossier sortant (direct et en profondeur), avec contrôle qu'aucun dossier n'est créé dehors ;
  - lien de fichier sortant, avec contrôle que le fichier visé n'est pas modifié ;
  - lien pendant, avec contrôle que la cible n'est pas créée ;
  - `..` après un lien ;
  - élément intermédiaire qui est un fichier ;
  - création normale de sous-dossiers client/projet, en chemin absolu et relatif ;
  - lien interne à l'espace accepté ;
  - `read`, `grep` et `bash` non bloqués.
- **Suite complète** (`check.py` sans option) : JS 6014 réussis (6000 + 14), 0 échec, 1 en attente ; build OK.
- **Rust** : non exécuté (« cargo absent »). Aucun changement Rust dans ce lot.

## Limites explicites
- **AST-01 reste partiellement non résolu.** Restent hors périmètre :
  - Bash, qui peut toujours écrire dans les projets ;
  - les autres outils intégrés de pi ;
  - les sessions lancées sans extension ;
  - le mode discussion seule ;
  - la confirmation MCP et les délégations.
- **Risque de course** : un lien remplacé entre la vérification et l'écriture n'est pas exclu. Une protection complète demanderait un autre modèle d'exécution, par exemple une écriture faite par l'extension elle-même avec `O_NOFOLLOW`. Je le reporte.
- **Liens physiques** (hard links) : non détectés. Il faudrait Bash pour en créer un, et Bash est hors périmètre. Je le reporte.
- **Non validé** : Windows (jonctions, casse des chemins), macOS, vrai pi et application Tauri. Le TypeScript n'a pas été contrôlé par `tsc` : Vitest retire les types sans les vérifier, et `NodeJS.ErrnoException` suppose `@types/node`.
- **Test EACCES** : il exige de tourner sans droits root et échoue explicitement sinon. Dans le bac, il passe.

✅ Contrôles faits : extension relue après correction ; les imports utilisés existent ; le seul `pi.on("tool_call")` est conservé ; aucun export ajouté ni supprimé ; périmètre git conforme aux trois fichiers autorisés.