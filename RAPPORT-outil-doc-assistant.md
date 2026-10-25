# RAPPORT — Lot intermédiaire « l'assistant peut répondre sur la documentation »

Projet : `G:\IA_PL\pilot` — commit de départ `ad4878a` (lot socle : `8a4e4bd`).

## 1. Ce qui était demandé, ce que j'ai trouvé sur le disque

Demandé : rendre l'**assistant** (onglet 🧭) capable **d'appeler** la réponse sur
la documentation intégrée, **sans rien retirer** encore de l'écran « ❓ Aide ».

**Écart constaté (dit franchement)** : la demande fait référence à un document de
conception déjà écrit pour cet outil. **Je ne l'ai trouvé nulle part** dans le
dépôt (recherches : « outil doc », « répondre_documentation », `doc_pilot`,
`spec_doc*`, `RAPPORT-*doc*`). Ce qui existe réellement et qui fait référence :

| Source trouvée | Ce qu'elle fixe |
|---|---|
| `spec_help.md` § 4.4 | Le **socle** : `help::answer_from_handbook`, `HandbookAnswer` (`answer`, `cited_sections`, `insufficient`, `truncated`), `ask_help_doc(question)` déjà enregistrée dans `lib.rs` |
| `RAPPORT-outil-doc-socle.md` | Le lot précédent : brique extraite, tests purs, aucune duplication |

J'ai donc **adapté** au lieu d'inventer une conception parallèle : l'outil ne fait
que **brancher** ce qui existe. Le nom retenu, `answer_from_documentation`, suit
la convention réelle des outils de l'assistant (tous en anglais : `create_task`,
`db_query`, `open_project`, `delegate_to_coder`…).

## 2. Éléments recomptés (avant → après)

| Élément | Avant | Après |
|---|---|---|
| Extensions écrites pour la session de l'assistant (`vec!` de `write_assistant_extensions`) | 13 | **14** |
| Occurrences `include_str!("../extensions/…")` dans `agent_service.rs` (les **deux** listes) | 37 | **39** (= +1 fichier × 2 listes) |
| Sentinels d'outils reconnus par `super-agent.js` | 22 | **23** |
| Outils déclarés (`pi.registerTool`) dans les extensions de l'assistant | 49 | **50** |
| Tests Vitest | 2957 | **2969** (+12) |
| Tests Rust `--lib` | 754 (1 ignoré) | **754 (1 ignoré)** — aucun test Rust ajouté, aucun cassé |

## 3. Ce qui a été créé — un outil, une entrée

**`src-tauri/extensions/pilot-assistant-doc.ts`** (nouveau) déclare **un seul**
outil :

- `answer_from_documentation(question)` — **une seule entrée**, et c'est la
  question. **Aucun** chemin de projet, **aucun** fichier, **aucun** historique,
  **aucune** notion de session : c'est l'inverse exact des outils de lecture de
  projet. **Lecture seule** : il n'écrit rien, ne modifie rien.

## 4. Aucune duplication — la brique déjà livrée est réutilisée

L'outil **n'exécute aucun prompt lui-même** et **ne lit aucun fichier** : il envoie
la question et Pilot exécute la commande du socle **`ask_help_doc`**
(`help::answer_from_handbook`). Le relais renvoie le `HandbookAnswer` **JSON**
tel quel ; l'outil le met en forme. Un seul mécanisme, un seul prompt, un seul
modèle (celui de l'assistant, avec le repli déjà écrit dans le socle).

## 5. Un seul point de câblage côté interface

`src/js/super-agent.js` — là où **tous** les autres outils de l'assistant sont
relayés :

- nouvelle constante `DOC_SENTINEL = "PILOT_ASSISTANT_DOC::"` (à côté des autres) ;
- un bloc `if (title.startsWith(DOC_SENTINEL))` → `invoke("ask_help_doc", { question })`
  → `respondSuperAgent(id, JSON.stringify(answer), false)` ;
- erreur de Pilot → `{ error }` renvoyé honnêtement (pas de silence) ;
- **additif** : l'empreinte anti-boucle (`accumulateSuperLoopToolResponse`)
  reconnaît aussi ce sentinel (deux questions identiques dans un tour = motif de
  boucle). Ce n'est pas un second mécanisme, c'est la même porte.

Déclaration disque : le fichier est ajouté aux **deux** listes de
`src-tauri/src/agent_service.rs` (`write_assistant_extensions` **et**
`spawn_superagent_session`). **Sans les deux, l'outil n'existe pas** pour la
session réelle de l'assistant.

## 6. Plafond : un seul appel par tour

- `DOC_MAX_CALLS_PER_TURN = 1` ; décision **pure** `docCapDecision(calls)`.
- 2ᵉ appel du même tour → **refus** avec un message qui dit **pourquoi**
  (chaque appel renvoie toute la documentation au modèle), **quoi faire**
  (répondre avec ce qui est déjà obtenu) et **interdit d'inventer**. Le refus
  **n'atteint pas** Pilot : aucun coût.
- Remise à zéro **au début de chaque tour** via le hook `before_agent_start`
  (un seul point de remise à zéro). Une question vide ne consomme pas le tour.

## 7. Sortie utile et honnête

`formatDocAnswer` (**pure**) rend, dans cet ordre :

1. le **texte de la réponse** ;
2. les **sections de documentation qui recoupent** la réponse — dites
   explicitement comme un **recoupement approximatif par titre**, jamais comme
   une citation exacte ;
3. l'avertissement **« ⚠️ LA DOCUMENTATION NE DIT RIEN sur ce point »** quand
   `insufficient` est levé, avec la consigne de le dire à l'utilisateur **au lieu
   d'inventer** ;
4. la mention de **coupure** quand `truncated` ;
5. une **erreur** de Pilot → « RECHERCHE DOCUMENTAIRE IMPOSSIBLE : … » (jamais
   masquée) ; une sortie non-JSON est rendue telle quelle (rien n'est inventé ni
   perdu).

Garde-fou anti-blocage : `ctx.ui.input` est borné (`timeout: 180000`) **au-dessus**
du plafond interne de la brique (120 s), pour que le modèle voie l'erreur réelle
de Pilot plutôt qu'un silence.

## 8. Tests ajoutés — `src/js/assistant-outil-doc.test.js` (12 tests)

- **Test de câblage** (échoue si **l'un des deux côtés** manque) :
  - l'extension déclare l'outil, avec **une seule** entrée `question` et aucune
    trace de `projectPath`/fichier dans les paramètres ;
  - le fichier d'extension est écrit dans les **deux** listes (occurrences = 2) ;
  - `super-agent.js` déclare **exactement** `const DOC_SENTINEL = "<valeur de
    l'extension>"` (les deux sentinels ne peuvent pas diverger en silence) ;
  - le relais appelle `invoke("ask_help_doc", { question })` et répond à pi.
- **Test du plafond** : décision pure (1ᵉʳ passe, 2ᵉ refusé avec le message) ;
  comportement réel (2ᵉ appel refusé, **aucun** appel à Pilot) ; remise à zéro au
  tour suivant ; question vide.
- **Sortie honnête** : texte + sections, drapeau d'insuffisance, erreur, non-JSON.

### Preuve que les tests mordent (mutations jouées, puis fichier restauré)

| Mutation | Résultat |
|---|---|
| Outil renommé (déclaration cassée) | **7 tests en échec** |
| Plafond neutralisé (toujours autorisé) | **3 en échec** |
| Hook `before_agent_start` retiré | **1 en échec** |
| Bloc de relais supprimé de `super-agent.js` | **1 en échec** |
| Une seule des deux déclarations `include_str!` | **1 en échec** |
| Sentinel divergent côté interface | **1ᵉʳ essai : le test SURVIVAIT** (le littéral existait ailleurs dans le fichier) → **test durci** (déclaration exacte de la constante) → **1 en échec** |

Le dernier point est un vrai défaut trouvé **par** la mutation : il est corrigé, pas
contourné. Fichiers restaurés après chaque mutation (sommes de contrôle vérifiées).

## 9. Documentation mise à jour

- `spec_help.md` : nouvelle **§ 4.5** (outil, brique réutilisée, relais unique,
  plafond, sortie honnête, déclaration ×2, tests) + tableau § 8 (extension, relais,
  test).
- `spec_super_agent.md` : **§ 8 Garde-fous** (entrée « Répondre sur la
  documentation »), **§ 10** (extension `pilot-assistant-doc.ts`, commande
  `ask_help_doc`).
- **`npm run build:handbook` non lancé** : aucun bloc `<!-- HELP:* -->` n'a été
  modifié (vérifié : aucune ligne ajoutée ne tombe entre deux marqueurs HELP ;
  `help/handbook.md` reste intact dans `git status`). Le contenu de la
  documentation n'a **pas** été touché — donc rien à régénérer.

## 10. Ce qui n'a pas été touché (exigences)

- L'**écran « ❓ Aide »** : intact (`help.js`, `index.html`, styles, commande
  `ask_help`) — rien retiré, comme demandé pour ce lot.
- Le **réglage de modèle d'aide** (`help_model`) : intact.
- L'onglet **Revue** : pas touché.
- Le **contenu de la documentation** : pas une ligne.
- Aucun outil existant retiré (49 → 50 outils).
- **`list_agent_sessions` n'a jamais été appelé** (ni aucun outil de liste de
  sessions).

## 11. Points ouverts pour les lots suivants

1. L'écran Aide peut maintenant être retiré sans perte de capacité : l'assistant
   sait répondre — reste à décider du **moment** et du **message** de bascule.
2. Le plafond est **par tour** ; si un usage réel montre qu'une seule question par
   tour est trop serré, la valeur est **une constante** (`DOC_MAX_CALLS_PER_TURN`),
   pas une règle diffuse.
3. Les sections citées restent un **recoupement approximatif** : le socle ne sait
   pas (encore) citer un passage exact.

## 12. Vérifications à relancer

```bash
npx vitest run                                            # 2969 passés, 0 échec
cargo test --manifest-path src-tauri/Cargo.toml --lib       # 754 passés, 1 ignoré
```

---

VERDICT : l'assistant dispose désormais d'un outil **`answer_from_documentation`** (une seule entrée, la question ; lecture seule, sans projet), qui **réutilise la brique déjà livrée** (`ask_help_doc` du socle) via **un point de relais unique** dans `super-agent.js`, borné à **un appel par tour** avec refus clair et remise à zéro au tour suivant, et dont la sortie **dit honnêtement** quand la documentation ne dit rien ; les 12 tests ajoutés (câblage + plafond + sortie), éprouvés par 6 mutations, passent, Vitest 2957 → 2969 et Rust 754/754 sans régression, l'écran Aide, le réglage `help_model`, la Revue et le contenu de la documentation sont intacts — le lot est **livrable**.
