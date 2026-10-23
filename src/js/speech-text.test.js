// Tests — nettoyage du texte destine a la SYNTHESE VOCALE (speech-text.js).
//
// Ces tests portent sur des CAS REELS : une reponse d'assistant telle qu'elle
// arrive dans le fil (titres, emojis, gras, puces, tableau, bloc de code, lien,
// italique). Ils verifient que ce que la voix recoit est une PHRASE NATURELLE,
// et que rien de lisible a l'ecran n'est perdu par erreur (accents, ponctuation,
// apostrophes, chiffres).
//
// Le seul point d'entree est `textForSpeech` (fonction PURE) ; `stripEmojis` et
// `cutTextAtBoundary` sont les deux rouages qu'il utilise et sont testes a part.

import { describe, expect, it } from "vitest";

import {
  CODE_BLOCK_NOTICE,
  cutTextAtBoundary,
  stripEmojis,
  textForSpeech,
} from "./speech-text.js";

/** Reponse d'assistant realiste, telle qu'elle arrive dans le fil. */
const REPONSE_REELLE = [
  "## ✅ Correction terminee 🎉",
  "",
  "**Fichier modifie** : `src/js/read-aloud.js`.",
  "",
  "- 🎯 Le nettoyage est centralise",
  "- ⚙️ 2 tests ajoutes",
  "",
  "| Avant | Apres |",
  "| --- | --- |",
  "| `**gras**` 😀 | gras |",
  "",
  "---",
  "",
  "```js",
  'const secret = "ne doit pas etre lu";',
  "```",
  "",
  "Voir [la documentation](https://exemple.test/doc) pour la suite. Le resultat est _meilleur_ !",
].join("\n");

describe("textForSpeech — une reponse reelle, cas par cas", () => {
  const lu = textForSpeech(REPONSE_REELLE);

  it("ne laisse AUCUN emoji ni pictogramme dans ce qui part vers la voix", () => {
    expect(lu).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/u);
    expect(lu).not.toContain("✅");
    expect(lu).not.toContain("🎉");
    expect(lu).not.toContain("😀");
    expect(lu).not.toContain("🎯");
    expect(lu).not.toContain("⚙");
  });

  it("ne laisse aucune marque de mise en forme", () => {
    for (const mark of ["**", "__", "`", "#", ">", "|", "---", "~~"]) {
      expect(lu, `marque ${mark} encore presente`).not.toContain(mark);
    }
    // Les puces et numeros de liste sont retires (le texte, lui, reste).
    expect(lu).toContain("Le nettoyage est centralise");
    expect(lu).toContain("2 tests ajoutes");
    expect(lu).not.toMatch(/^[ \t]*[-*+][ \t]/m);
  });

  it("ne lit JAMAIS le contenu d'un bloc de code, et l'annonce", () => {
    expect(lu).toContain(CODE_BLOCK_NOTICE);
    expect(lu).toContain("bloc de code");
    expect(lu).not.toContain("ne doit pas etre lu");
    expect(lu).not.toContain("const secret");
  });

  it("lit un tableau en texte courant (entetes + valeurs, sans barres)", () => {
    expect(lu).toContain("Avant");
    expect(lu).toContain("Apres");
    expect(lu).toContain("gras");
    expect(lu).not.toContain("|");
  });

  it("garde le libelle d'un lien et retire l'adresse", () => {
    expect(lu).toContain("la documentation");
    expect(lu).not.toContain("https://");
    expect(lu).not.toContain("exemple.test");
  });

  it("produit une phrase naturelle, sans ligne vide ni espace double", () => {
    expect(lu).not.toMatch(/ {2}/);
    expect(lu).not.toMatch(/\n{2}/);
    expect(lu.trim()).toBe(lu);
    // Aucun signe de balisage orphelin en debut de ligne.
    expect(lu).not.toMatch(/^[.,;:!?]/m);
  });

  it("garde accents, apostrophes, ponctuation et chiffres", () => {
    // La reponse d'origine est sans accents : on verifie sur un texte accentue.
    const texte = textForSpeech(
      "L'agent a terminé l'étape n°4 : « c'est prêt », 12 fichiers, 3 tests.",
    );
    expect(texte).toBe(
      "L'agent a terminé l'étape n°4 : « c'est prêt », 12 fichiers, 3 tests.",
    );
  });

  it("est IDEMPOTENTE (le chemin de la voix l'applique deux fois)", () => {
    expect(textForSpeech(lu)).toBe(lu);
    expect(textForSpeech(textForSpeech(REPONSE_REELLE))).toBe(lu);
  });
});

describe("stripEmojis — emojis et pictogrammes retires, chiffres gardes", () => {
  it("retire les pictogrammes courants", () => {
    expect(stripEmojis("Terminé ✅ pour de vrai")).toBe("Terminé  pour de vrai");
    expect(stripEmojis("Bravo 🎉🥳")).toBe("Bravo ");
  });

  it("retire les sequences composees (drapeau, ZWJ, carnation, selecteur)", () => {
    expect(stripEmojis("Drapeau 🏳️‍🌈 ici")).toBe("Drapeau  ici");
    expect(stripEmojis("Pouce 👍🏽 la")).toBe("Pouce  la");
    expect(stripEmojis("Attention ⚠️ la")).toBe("Attention  la");
  });

  it("garde les CHIFFRES, y compris ceux d'une touche encombree", () => {
    expect(stripEmojis("Étape 1️⃣ puis 2️⃣")).toBe("Étape 1 puis 2");
    expect(stripEmojis("Il y a 42 fichiers")).toBe("Il y a 42 fichiers");
    expect(stripEmojis("100 % des cas")).toBe("100 % des cas");
  });

  it("ne touche ni aux accents, ni aux apostrophes, ni a la ponctuation", () => {
    const texte = "L'été, c'est prêt : 3 sur 4 ! (vraiment)";
    expect(stripEmojis(texte)).toBe(texte);
  });
});

describe("textForSpeech — balisage HTML et Markdown", () => {
  it("traite le rendu HTML (balises retirees, entites decodees)", () => {
    const texte = textForSpeech(
      '<h2>Titre</h2><p>Une phrase <strong>forte</strong>.</p><ul><li>Un point</li></ul>',
    );
    expect(texte).not.toContain("<");
    expect(texte).not.toContain("strong");
    expect(texte).toContain("Titre");
    expect(texte).toContain("Une phrase forte.");
    expect(texte).toContain("Un point");
  });

  it("decode les entites HTML (dont numeriques et emoji numerique)", () => {
    expect(textForSpeech("A&nbsp;B &amp; C")).toContain("A B & C");
    expect(textForSpeech("&#128512; Bonjour")).toContain("Bonjour");
    expect(textForSpeech("&lt;balise&gt;")).not.toContain("<balise>");
  });

  it("garde le texte entre accents graves, sans les accents graves", () => {
    const texte = textForSpeech("Ouvre `src/js/read-aloud.js` puis relance.");
    expect(texte).toContain("src/js/read-aloud.js");
    expect(texte).not.toContain("`");
  });

  it("retire les adresses nues et les autoliens", () => {
    expect(textForSpeech("Voir https://exemple.test/a pour la suite.")).not.toContain(
      "https://",
    );
    expect(textForSpeech("Voir <https://exemple.test/a> pour la suite.")).not.toContain(
      "exemple.test",
    );
  });

  it("retire les images en gardant leur texte de remplacement", () => {
    const texte = textForSpeech("![capture du diff](images/diff.png)");
    expect(texte).toContain("capture du diff");
    expect(texte).not.toContain("images/diff.png");
  });

  it("retire les titres, citations, puces, numeros et traits de separation", () => {
    const md = [
      "### Titre",
      "> une citation",
      "- une puce",
      "1. un numero",
      "___",
      "**gras** et *italique* et _souligne_ et ~~raye~~",
    ].join("\n");
    const texte = textForSpeech(md);
    for (const symbole of ["#", ">", "- ", "1.", "___", "**", "*", "_", "~~"]) {
      expect(texte, `symbole ${symbole}`).not.toContain(symbole);
    }
    expect(texte).toContain("Titre");
    expect(texte).toContain("une citation");
    expect(texte).toContain("une puce");
    expect(texte).toContain("un numero");
    expect(texte).toContain("gras et italique et souligne et raye");
  });

  it("conserve un identifiant a underscores (snake_case) lisible", () => {
    expect(textForSpeech("Le fichier `read_aloud.js` est pret.")).toContain(
      "read_aloud.js",
    );
  });

  it("reduit espaces et lignes vides doubles", () => {
    expect(textForSpeech("Une phrase.\n\n\n\nUne autre.   Ici  aussi.")).toBe(
      "Une phrase.\nUne autre. Ici aussi.",
    );
  });

  it("renvoie une chaine vide pour une entree vide", () => {
    expect(textForSpeech("")).toBe("");
    expect(textForSpeech("   \n ")).toBe("");
    expect(textForSpeech(null)).toBe("");
    expect(textForSpeech(undefined)).toBe("");
  });
});

describe("cutTextAtBoundary — coupure sur une frontiere, jamais dans un mot", () => {
  it("coupe sur une fin de phrase quand il y en a une dans la limite", () => {
    const [head, tail] = cutTextAtBoundary(
      "Bonjour à tous. Voici la suite du message.",
      30,
    );
    expect(head).toBe("Bonjour à tous.");
    expect(tail).toBe("Voici la suite du message.");
  });

  it("coupe sur une fin de mot quand la phrase est trop longue", () => {
    const [head, tail] = cutTextAtBoundary("Le cheminement administratif est long.", 20);
    expect(head).toBe("Le cheminement");
    // Aucun mot n'est coupe en deux.
    expect(head.endsWith("cheminement")).toBe(true);
    expect(tail.startsWith("administratif")).toBe(true);
    expect(head.length).toBeLessThanOrEqual(20);
  });

  it("ne perd aucun caractere et ne depasse pas la limite", () => {
    const texte = "Un deux trois quatre cinq six sept huit neuf dix onze douze.";
    let rest = texte;
    const morceaux = [];
    while (rest.length > 12) {
      const [head, tail] = cutTextAtBoundary(rest, 12);
      morceaux.push(head);
      expect(head.length).toBeLessThanOrEqual(12);
      rest = tail;
    }
    morceaux.push(rest);
    expect(morceaux.join(" ").replace(/\s+/g, " ")).toBe(
      texte.replace(/\s+/g, " "),
    );
  });

  it("renvoie le texte intact s'il tient dans la limite", () => {
    expect(cutTextAtBoundary("Court.", 40)).toEqual(["Court.", ""]);
  });

  it("en dernier recours (mot insecable) coupe a la limite, sans rien perdre", () => {
    const [head, tail] = cutTextAtBoundary("abcdefghij", 4);
    expect(head).toBe("abcd");
    expect(tail).toBe("efghij");
  });
});
