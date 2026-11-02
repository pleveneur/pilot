# Constat — quelle version du serveur MCP « avatar » (Présences) Pilot utilise réellement

**Date du constat** : 2026-10-30, ~14 h 17 (poste du propriétaire, Windows).
**Nature** : mission de constat. Aucun fichier de `G:\IA_PL\Presences` ni de
`C:\Users\pldistance\.presences` n'a été modifié, aucun build lancé, aucun
serveur démarré ou redémarré, aucune configuration changée, aucun commit.

Question d'origine : « pour l'avatar, as-tu pu intégrer la nouvelle version à
Pilot ? » — il s'agit du serveur MCP du projet **Présences** (personnages,
portrait, carnet), pas du moteur PLh.

---

## 1. Ce que Pilot utilise réellement

**Configuration** — `%APPDATA%\com.pilot.editor\mcp.json` (daté 2026-10-28 17:35) :

| Champ | Valeur |
|---|---|
| `id` / `name` | `mcp-4` / `Presences` |
| `enabled` | **`true`** (les trois autres serveurs `mcp-1`, `mcp-2`, `mcp-3` sont `false`) |
| `transport` | `stdio` |
| `command` / `args` | `node` / `G:\IA_PL\Presences\dist\cli\serveur.js` |
| `env` | `{}` (aucune surcharge : le serveur prend ses dossiers par défaut) |

- **Ce n'est pas un paquet publié, ni une copie** : la config pointe directement le
  dossier de build du projet. `G:\IA_PL\Presences\package.json` porte
  `"private": true`, aucun champ `bin`, aucune `dependency` de Pilot ne le référence.
- **Un seul serveur branché par session** : Presences étant le seul `enabled`, c'est
  lui qui est lancé (règle `select_session_server`, `src-tauri/src/mcp_config.rs:206-217` ;
  côté extension `src-tauri/extensions/mcp-client.src.ts:177-183`).

**Identité annoncée par le serveur** : nom `presences`, version **`0.1.0`**,
protocole MCP `2024-11-05`
(`G:\IA_PL\Presences\dist\serveur.js:49` et `:51` ; source `src/serveur.ts:108` et `:111`,
commentaire : « kept in sync with package.json by hand »).

**Preuve d'exécution réelle** (`Get-CimInstance Win32_Process`, lecture seule) :

```
PID 24004  création 2026-10-30 14:10:36  node G:\IA_PL\Presences\dist\cli\serveur.js
PID 23724  création 2026-10-30 14:10:33  … pi --mode rpc … --extension
                                        C:\…\com.pilot.editor\extensions\pilot-mcp-client.ts
```

Le process du serveur est l'enfant de la session de l'Assistant : **c'est bien Pilot
qui le lance, et il l'a chargé depuis le `dist\` reconstruit le 2026-10-29 à 15:41:25**
(le process est postérieur au build de 22 h 29).

**Empreintes du build utilisé** (sha256) :

```
1540c56f0d0860a4a8e6262bc0d87767db9027353a757b6af56522489b57d806  dist\cli\serveur.js   (316 o)
538eac513c9b4fabe47ebbbcfc7921aaade0bd4db7b77a6dfe9d9705e4e92a79  dist\serveur.js       (78 708 o)
```

---

## 2. Ce qui existe dans `G:\IA_PL\Presences`

- **Version déclarée** : `package.json` → `"version": "0.1.0"` (fichier non modifié depuis
  le 2026-10-28 15:49), alignée à la main avec `VERSION_SERVEUR` (`src/serveur.ts:111`).
  Sans historique git, je ne peux pas *prouver* qu'elle n'a jamais changé : elle vaut
  `0.1.0` dans les fichiers présents, c'est tout ce qui est vérifiable.
- **Dernier commit : inexistant.** `G:\IA_PL\Presences` n'est **pas** un dépôt git
  (`git rev-parse --show-toplevel` → *fatal: not a git repository*), et `G:\IA_PL` ne
  l'est pas davantage. Il n'y a donc **ni historique, ni tag, ni numéro de version qui
  avance** pour dater « la nouvelle version ».
- **Build présent** : `dist\` complet (24 fichiers, dont `dist\cli\`), tous datés du
  **2026-10-29 15:41:25** (de 15:41:25.332 à 15:41:25.451 — une seule compilation).
- **Source** : dernier fichier modifié de `src\` = `src\serveur.ts`, **2026-10-28 19:10:05**
  (max sur tout `src/`).
- **Rien n'a bougé après le build** :

```
find . -path ./node_modules -prune -o -path ./.vitest -prune -o -path ./dist -prune \
     -o -type f -newermt "2026-10-29 15:41:26" -print
→ ./docs/RAPPORT-portrait-sylvie-depose.md   (2026-10-29 15:42, documentation seule)
```

---

## 3. L'écart

**Il n'y a pas de nouvelle version non intégrée.**

- Le build consommé par Pilot (`2026-10-29 15:41:25`) est **postérieur de ~20 h à la
  dernière modification de code** (`2026-10-28 19:10:05`), et **aucun fichier source
  n'a été touché depuis ce build**. Il n'y a donc rien en attente de compilation.
- L'identité annoncée est `0.1.0` des deux côtés (source et build) : pas de décalage
  de version déclarée.
- **Le serveur configuré ne pointe pas sur une copie figée** : le chemin de `mcp.json`
  est celui du projet lui-même ; le `dist\` a été reconstruit le 29/10 à 15:41 et le
  serveur qui tourne aujourd'hui (30/10 14:10) est ce build-là. Il n'y a **aucune
  copie intermédiaire à rafraîchir** dans Pilot.
- Ce que je ne peux pas affirmer : « de combien de versions » il y aurait un retard.
  Sans dépôt git ni changelog versionné, le seul critère disponible est temporel
  (date des fichiers), et il est à jour. Je ne comble pas ce trou par une valeur
  plausible.
- Seule réserve réelle : le serveur est lancé **une fois par session d'agent**. Un
  rebuild fait pendant une session ouverte n'est pas rechargé par cette session.

---

## 4. Ce que coûterait une intégration (décrit, non exécuté)

**Nature du geste, si `Presences` évoluait :**

1. `npm run build` dans `G:\IA_PL\Presences` (`tsc -p tsconfig.build.json` → `dist\`).
   C'est *tout* le geste d'intégration : rien à installer, aucune dépendance Pilot à
   mettre à jour, aucun numéro de version à propager, `mcp.json` inchangé tant que le
   chemin ne bouge pas.
2. Ouvrir une **nouvelle session d'agent** dans Pilot (fermer/rouvrir l'onglet
   Assistant, ou relancer Pilot) pour que le serveur soit relancé sur le nouveau build.

**Fichiers concernés** : `G:\IA_PL\Presences\dist\**` (écrits par le build) ;
`%APPDATA%\com.pilot.editor\mcp.json` **seulement** si le chemin du serveur changeait
(ce n'est pas le cas aujourd'hui).

**Risques connus, observés :**

1. **Aucune isolation de version.** Pilot consomme le build vivant du projet : un
   build cassé dans Presences casse les outils de l'avatar au prochain lancement, sans
   filet (pas de copie figée, pas de version épinglée, pas de retour arrière possible
   autrement qu'en corrigeant la source).
2. **Un seul serveur MCP par session.** Activer un autre serveur (GitHub, écran…) coupe
   Presences, et donc tous les outils de l'avatar, à la session suivante — l'activation
   exclusive les nomme, mais l'effet n'est pris qu'à la session suivante.
3. **Dépôt du portrait** — écrit par le serveur **au moment de l'activation**. État
   actuel, vérifié : `C:\Users\pldistance\.pilot\portrait\nom.txt` = « Sylvie » et
   `portrait.png` (1 684 940 o), datés **2026-10-29 15:41:42** ; `~\.presences\actif.json`
   → `{"identifiant": "sylvie", "active_le": "2026-10-29T08:54:34Z"}`. Un portrait absent
   n'est **pas** une panne : Pilot garde le nom réglé et l'icône 🧭 (repli silencieux de
   `src-tauri/src/persona.rs`).
4. **Deux dépôts de portrait coexistent** : `~\.pilot\portrait\` (lu **en premier**,
   frais : 29/10 15:41:42) et `%APPDATA%\com.pilot.editor\.pilot\portrait\` (repli,
   plus ancien : 29/10 15:32:38). Pilot lit le premier ; le second est un reste qui peut
   tromper un diagnostic.
5. **`mcp.json` n'a pas bougé depuis le 2026-10-28 17:35** : si le dossier de build était
   renommé ou déplacé, c'est ce fichier (ou l'écran des serveurs MCP) qu'il faudrait
   éditer.

---

## Conclusion

Pilot utilise aujourd'hui le serveur MCP **« presences » 0.1.0**, lancé en `node` depuis
`G:\IA_PL\Presences\dist\cli\serveur.js` (process PID 24004, démarré le 30/10 à 14:10,
chargé depuis le build du 29/10 à 15:41). Le projet de l'avatar est à la même version
déclarée (0.1.0), n'a **pas** de dépôt git, et son build du 29/10 15:41 est postérieur à
la dernière modification de source (28/10 19:10) : **il n'y a aucun écart à intégrer**.
Le geste d'intégration, s'il y avait une évolution, se limiterait à `npm run build` dans
Presences puis à une nouvelle session d'agent dans Pilot — sans rien changer côté Pilot.
