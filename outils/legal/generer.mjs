// Pages légales autonomes (adresse propre, lisibles sans l'application) : topograph.ch/confidentialite/,
// /conditions/, /mentions/. Générées à partir des textes de l'interface (src/langues/*.js, clés legal.page*), dans
// les 4 langues sur une même page. À relancer quand ces textes changent :
//   node outils/legal/generer.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const LANGUES = ["fr", "de", "it", "en"];
const NOMS = { fr: "Français", de: "Deutsch", it: "Italiano", en: "English" };
const PAGES = { confidentialite: "legal.pageConfidentialite", conditions: "legal.pageConditions", mentions: "legal.pageMentions" };
const textes = {};
for (const l of LANGUES) textes[l] = (await import(`../../src/langues/${l}.js`)).default;

for (const [page, cle] of Object.entries(PAGES)) {
  const sections = LANGUES.map(l => {
    const v = textes[l][cle];
    const html = typeof v === "function" ? v({}) : v;
    return html ? `<section lang="${l}" id="${l}">${html}</section>` : "";
  }).filter(Boolean).join("\n<hr>\n");
  const titre = (textes.fr[cle] || "").match(/<h2>(.*?)<\/h2>/)?.[1] || page;
  const doc = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} — Topograph</title>
<link rel="icon" href="data:,">
<style>
  body { margin: 0; background: #f4f2ee; color: #1f2933; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
  header a.marque { font-weight: 650; font-size: 1.15rem; color: #1f2933; text-decoration: none; }
  nav a { margin-left: 12px; color: #861f31; }
  h2 { font-size: 1.4rem; margin: 0 0 12px; }
  hr { border: 0; border-top: 1px solid #ddd6cc; margin: 40px 0; }
  a { color: #861f31; }
</style>
</head>
<body>
<main>
<header><a class="marque" href="/">Topograph</a><nav>${LANGUES.map(l => `<a href="#${l}">${NOMS[l]}</a>`).join("")}</nav></header>
${sections}
</main>
</body>
</html>
`;
  mkdirSync(`public/${page}`, { recursive: true });
  writeFileSync(`public/${page}/index.html`, doc);
  console.log(`public/${page}/index.html`);
}
