# Rapport — Socle « répondre à partir de la documentation intégrée »

> Lot 1 de la disparition de l'écran Aide : **côté programme seulement**.
> Aucun outil visible par l'assistant n'est créé ici, rien n'est supprimé de l'écran.

## 1. Ce qui a été extrait

La brique existait déjà, mais **mêlée à l'écran** « ❓ Aide » : corpus embarqué
(`HANDBOOK`), construction du prompt, processus `pi` temporaire cadré. Elle est
désormais une **fonction publique** rendant un résultat **structuré**, dans
`src-tauri/src/help.rs` (fichier déjà en place, 859 lignes après ce lot) :

| Élément | Emplacement |
|---|---|
| Cœur de la brique — `answer_from_handbook(state, question)` | `src-tauri/src/help.rs:280` |
| Exécution + finition — `run_help_prompt(...)` | `src-tauri/src/help.rs:267` |
| Finition pure — `finish_help_answer` / `finish_help_answer_from_corpus` | `src-tauri/src/help.rs:215` / `:220` |
| Titres réels du corpus — `handbook_sections_of(corpus)` | `src-tauri/src/help.rs:92` |
| Sections citées — `cited_sections_in_corpus(corpus, answer)` | `src-tauri/src/help.rs:133` |
| Coupure propre — `cut_at_cap(text)` | `src-tauri/src/help.rs:175` |
| Détection du marqueur — `insufficient_marker_len(text)` | `src-tauri/src/help.rs:148` |
| Résolution du modèle — `resolve_help_doc_model(...)` | `src-tauri/src/help.rs:251` |
| Commande pour l'assistant — `ask_help_doc(question)` | `src-tauri/src/help.rs:313`, enregistrée dans `src-tauri/src/lib.rs:3712` |
| Écran Aide — `ask_help(question, history)` | `src-tauri/src/help.rs:325` — **simple emballage** |

`ask_help` garde exactement sa signature, son modèle (`config.help_model`), son
message d'erreur quand aucun modèle n'est choisi, et rend toujours une `String`
→ **l'écran Aide ne change pas de comportement** (ni bouton, ni onglet, ni
fichier d'interface, ni style touchés).

## 2. Forme du résultat

```rust
pub struct HandbookAnswer {
    pub answer: String,             // texte rendu (marqueur retiré, coupure dite dedans)
    pub cited_sections: Vec<String>,// titres de la doc réellement cités
    pub insufficient: bool,         // la doc ne dit rien (marqueur vu)
    pub truncated: bool,            // réponse coupée au plafond
}
```

Sérialisé pour l'interface (`Serialize`) ; c'est ce que rend `ask_help_doc`.

## 3. Marqueur d'insuffisance et plafond

- **Marqueur** : `DOCUMENTATION_INSUFFISANTE:` — texte fixe, en majuscules,
  terminé par deux-points, imposé **en tête de réponse** par le prompt
  (`build_help_prompt`). Le programme **retire** le marqueur et positionne
  `insufficient = true`. Tolérance limitée à l'habillage Markdown courant
  (`**`, `>`, `#`, `-`, backtick) et à un espace avant le deux-points ; un
  marqueur **au milieu** du texte n'est pas interprété (signal honnête).
  Déterministe → testable **sans appeler de modèle**.
- **Plafond** : `MAX_ANSWER_CHARS = 6000` caractères. Au-delà, la réponse est
  coupée **proprement** : dernière fin de phrase si elle tombe dans les 25 %
  supérieurs du plafond, sinon dernière fin de mot — **jamais au milieu d'un
  mot**. La coupure est **dite dans le texte renvoyé**
  (« _… Réponse tronquée à 6000 caractères …_ ») et `truncated = true`.
- **Sections citées** : calculées **par le programme**, jamais déclarées par le
  modèle — on recoupe les titres `##`/`###` du corpus embarqué avec le texte
  rendu, donc une section citée est toujours un titre qui **existe réellement**
  dans la documentation. Ce recoupement est **approximatif par construction**
  (il ne reconnaît qu'une citation littérale du titre) et ne doit jamais être
  présenté comme une « source exacte ».

## 4. Comment le modèle est choisi

Repli, sans dépendre du réglage de l'écran, en réutilisant la fonction de
résolution **déjà présente** dans le module de l'assistant
(`super_agent::resolve_super_agent_model`) :

1. modèle de l'**Assistant** (`super_agent_model`), s'il est encore installé ;
2. sinon réglage d'**aide** existant (`help_model`, conservé : la Revue s'en
   sert comme repli) ;
3. sinon **défaut** de la configuration (`model-switch.json`, via
   `super_agent::default_model_from_config`).

Aucun modèle disponible → **erreur explicite et lisible** (« Aucun modèle
disponible pour répondre à partir de la documentation : choisis un modèle dans
⚙️ → Assistant … »), jamais un échec silencieux. C'est la condition de survie :
sur une installation neuve, plus aucun écran n'écrira le réglage d'aide.

## 5. Tests ajoutés, et preuve qu'ils mordent

Quatre tests **purs** (aucun modèle, aucun réseau, aucune écriture) dans
`help::tests` : `src-tauri/src/help.rs:708`, `:736`, `:772`, `:804`.

| Test | Ce qu'il tient |
|---|---|
| `marqueur_dinsuffisance_leve_le_drapeau_et_quitte_le_texte` | (a) marqueur → `insufficient` **et** marqueur retiré ; habillage `**…:**` toléré ; marqueur au milieu non interprété ; réponse normale intacte |
| `reponse_trop_longue_est_coupee_proprement_et_la_coupure_est_dite` | (b) ~18 800 caractères → `truncated`, mention « tronquée » + plafond dans le texte, coupure sur fin de phrase ; sans ponctuation → coupure sur un blanc (fin de mot) |
| `les_sections_citees_existent_dans_le_corpus` | (c) une section réelle (« Terminal intégré ») est détectée, **toute** section citée appartient au corpus, un titre inventé n'est jamais cité |
| `le_modele_est_resolu_par_repli_avec_erreur_explicite_si_rien` | (d) assistant → aide → défaut ; modèle de l'assistant disparu du registre → repli ; rien disponible → `Err` contenant « Aucun modèle » |

**Preuve que les tests mordent** (mutations appliquées une à une puis annulées,
fichier restauré à l'identique ensuite) :

| Geste retiré | Résultat |
|---|---|
| Traitement du marqueur neutralisé | `marqueur_dinsuffisance…` **échoue** |
| Plafond neutralisé (`cut_at_cap` court-circuité) | `reponse_trop_longue…` **échoue** |
| Sections citées vidées | `les_sections_citees…` **échoue** |
| Repli de modèle retiré (réglage d'aide seul) | `le_modele_est_resolu…` **échoue** |

## 6. Compte de tests

```
Avant : cargo test --manifest-path src-tauri/Cargo.toml --lib
        750 passed; 0 failed; 1 ignored
Après : 754 passed; 0 failed; 1 ignored      (+4 tests, aucun supprimé)
```

Aucun test existant n'a été supprimé ; `integration_ask_pi_caged` reste le seul
test `#[ignore]` (il demande un modèle réel).

## 7. Documentation

`spec_help.md` : nouveau §4.4 « Socle réutilisable » (cœur, commande, marqueur,
plafond, sections citées approximatives, résolution du modèle, tests), statut
mis à jour, tableau des fichiers ajusté. **Aucun bloc `<!-- HELP:* -->` touché**
(pas d'aide utilisateur modifiée dans ce lot).

## 8. Ce qui reste à faire

1. **Lot suivant** : créer l'**outil visible par l'assistant** (extension
   `pilot-assistant-*` + relais) qui appelle `ask_help_doc` — et y poser le
   plafond d'**un seul appel** de l'outil par tour.
2. **Lot d'après** : supprimer l'écran Aide (bouton, onglet, fichier
   d'interface), **sans** toucher aux styles (partagés par la Revue et
   l'Historique) ni au réglage `help_model`.
3. Prise en main à la première ouverture expliquant que l'aide passe par
   l'assistant (lot séparé, décision du propriétaire).

VERDICT : le socle documentaire est extrait, testable sans modèle et exposé par
`ask_help_doc` ; l'écran Aide est un simple emballage, intact ; 754 tests Rust
passent (750 avant) et les quatre nouveaux tests échouent bien si l'on retire le
geste correspondant.
