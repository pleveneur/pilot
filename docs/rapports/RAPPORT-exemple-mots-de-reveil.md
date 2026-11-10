# Rapport — l'exemple du champ « Mots de réveil » était trompeur

Date : 2026-11-16 · Projet : `G:\IA_PL\pilot` · Micro-tâche : corriger le TEXTE
d'un exemple affiché dans les Paramètres (aucune modification de la logique de
détection).

---

## 1. Où l'exemple est affiché

| Élément | Emplacement | Rôle |
|---|---|---|
| `placeholder` du champ | `index.html` (section « Mode Vocal », `#setting-vocal-wake-words`) | l'exemple visible quand le champ est **vide** (c'est-à-dire au départ) |
| `title` du libellé | `index.html` (même bloc) | bulle d'aide, recopiait le même exemple |
| `#vocal-wake-words-note` | `index.html` (note sous le champ) | explication, recopiait le même exemple |
| Défaut réel de la clé | `src-tauri/src/lib.rs` — `vocal_wake_words: String` + `#[serde(default)]` ⇒ `""` | **vide**, et il doit le rester : vide = le nom seul |

L'exemple n'est donc **pas généré** à partir du défaut (le défaut est la chaîne
vide, exigée par la spec § 6quater.1). Il est écrit en dur dans le HTML : c'est
bien ce texte qu'il fallait corriger.

## 2. Ce qui implémente réellement la reconnaissance

`src/js/vocal-nom-garde.js` — **source unique** :

- `VOCAL_WAKE_SEPARATORS = /[,;\n]+/` : la virgule (ou `;`, ou le retour à la
  ligne) sépare deux mots de réveil ;
- `wakeWordsFrom` : **un mot de réveil PEUT contenir des espaces**
  (« hey bonjour » est **UNE** entrée, pas deux) ;
- `mentionsWakeWord` → `mentionsAssistantName` : la phrase passe si la suite de
  mots repliés de l'entrée apparaît **telle quelle** (casse, accents,
  ponctuation et espaces ignorés, plus les seules variantes `ph/f`, `qu/k`,
  `y/i`, consonne finale muette).

## 3. L'écart, dit précisément

L'ancien exemple était `hey bonjour, allô`. Recopié tel quel, il produit **deux**
mots de réveil : `"hey bonjour"` (deux mots, **insécables**) et `"allô"`.

| Phrase prononcée | Verdict réel |
|---|---|
| « hey range le projet » | **refusée** |
| « bonjour, range le projet » | **refusée** |
| « hey bonjour range le projet » | acceptée |
| « allô tu m'entends » | acceptée |

La note disait « une phrase qui en contient **un seul** part toute seule » : vrai
pour le *mot de réveil*, faux dans la lecture qu'en fait l'utilisateur, qui croit
avoir réglé `hey` **et** `bonjour`. Quelqu'un qui recopiait l'exemple obtenait
donc un réglage qui ne se déclenchait **presque jamais** — exactement le piège
déjà documenté dans `docs/rapports/RAPPORT-diagnostic-mot-de-reveil.md` § 7.3.

Le code, lui, est **correct** : il fait ce que la spec § 6quater.1 décrit (une
entrée peut compter plusieurs mots). **Rien n'a donc été changé dans la logique
de détection** ; c'est l'exemple qui avait tort.

## 4. Ce qui a été changé

1. `index.html` (3 endroits, même valeur) : l'exemple devient **`allô, salut`** —
   deux mots de réveil d'**un seul mot** chacun, donc exactement ce que la
   comparaison accepte. La note dit désormais, en plus, qu'une entrée de
   plusieurs mots doit être dite **en entier** (« avec `hey bonjour`, une phrase
   qui ne dit que `bonjour` ne part pas »).
2. `src/js/mots-de-reveil.test.js` : le verrou qui se contentait de
   `expect(section).toContain("hey bonjour")` **valide maintenant l'exemple
   affiché** — il est **lu dans `index.html`**, doit valoir `allô, salut`, chaque
   entrée doit tenir en **un seul mot**, **chaque** mot de l'exemple doit ouvrir
   réellement la phrase par `decideVocalNameGate` (raison `mot-reveil`), et
   l'ancien piège est verrouillé dans l'autre sens : `mentionsWakeWord("bonjour,
   range le projet", "hey bonjour, allô") === false`. Le test existant n'a pas
   été assoupli : il a été **remplacé par un contrôle plus fort**.
3. Documentation remise en cohérence : `spec_modes_ecran_vocal.md` (§ 6quater.1 +
   bloc `<!-- HELP:vocal-garde-du-nom -->`), `help/handbook.md` régénéré
   (`npm run build:handbook`), `README.md`, et le commentaire de
   `AppConfig.vocal_wake_words` (`src-tauri/src/lib.rs`).

Aucune dépendance, aucun fichier de configuration, aucun second réglage.

## 5. Tests

```bash
npm test        # Vitest, suite complète
```

Résultat : **313 fichiers de tests verts / 313**, **5817 tests verts**, **0
échec** (durée ≈ 17 s).

Contrôle ciblé : `npx vitest run src/js/mots-de-reveil.test.js` → **25 verts, 0
échec** (dont le nouveau verrou de l'exemple).

## 6. Commit

Commit local unique `fix(paramètres): exemple exact pour les mots de réveil de
l'écran Vocal` (aucun push).
