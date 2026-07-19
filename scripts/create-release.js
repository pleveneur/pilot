// create-release.js — Crée la GitHub Release pour le tag donné, de manière
// idempotente. Si la release existe déjà (re-run du workflow), ne fait rien.
// Sinon, la crée (draft=false, prerelease=false) avec un body fixe qui sera
// ensuite mis à jour avec le changelog par gen-latest-json.js.
//
// Ce script doit tourner AVANT les jobs de build (matrice) pour éviter la
// condition de course "already_exists" : chaque tauri-action tenterait de
// créer la release en parallèle, la 1re réussit, les autres échouent. En
// créant la release ici une fois, les builds la trouvent via GET (par tag)
// et ne tentent plus de la créer.
//
// Usage :
//   node scripts/create-release.js <tag> <repo> [commitish]
//
//   tag       : nom du tag (ex: v0.2.9)
//   repo      : "OWNER/REPO"
//   commitish: SHA/branche cible du tag (défaut: GITHUB_SHA)
//
// Nécessite GITHUB_TOKEN (permissions "contents: write").

const TAG = process.argv[2];
const REPO = process.argv[3];
const COMMITISH = process.argv[4] || process.env.GITHUB_SHA;
const TOKEN = process.env.GITHUB_TOKEN;

if (!TAG || !REPO || !TOKEN) {
  console.error("Usage: node create-release.js <tag> <OWNER/REPO> [commitish]");
  console.error("GITHUB_TOKEN must be set.");
  process.exit(1);
}

const RELEASE_BODY =
  "Téléchargez et installez le binaire correspondant à votre plateforme. La mise à jour automatique est active pour les versions suivantes.";

(async () => {
  // GET /releases/tags/{tag} : si la release existe déjà, on ne fait rien.
  const get = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (get.status === 200) {
    const rel = await get.json();
    console.log(`✓ Release ${TAG} existe déjà (id ${rel.id}), rien à créer.`);
    return;
  }
  if (get.status !== 404) {
    throw new Error(`GET release ${get.status}: ${await get.text()}`);
  }

  // Crée la release.
  const body = {
    tag_name: TAG,
    name: `Pilot ${TAG}`,
    body: RELEASE_BODY,
    target_commitish: COMMITISH,
    draft: false,
    prerelease: false,
  };
  const post = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST",
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!post.ok) {
    // Au cas où une autre exécution parallèle aurait créé la release entre
    // le GET et le POST, on ne plante pas si c'est une 422 already_exists.
    const txt = await post.text();
    if (post.status === 422 && txt.includes("already_exists")) {
      console.log(`✓ Release ${TAG} créée concurremment, rien à faire.`);
      return;
    }
    throw new Error(`POST release ${post.status}: ${txt}`);
  }
  const rel = await post.json();
  console.log(`✓ Release ${TAG} créée (id ${rel.id}).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});