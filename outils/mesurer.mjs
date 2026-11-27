// Mesure du chargement de lieux (temps, octets reçus, mémoire) dans Chromium, avec le serveur de développement.
//   node outils/mesurer.mjs [--url http://localhost:5199/] [--rayon 150] [--sortie fichier.json] [lieux…]
// Sans --url : lance `vite` sur le port 5199. Lieux : clés ci-dessous ou « e,n » MN95 ; ils sont ouverts l'un après
// l'autre dans la même page (comme un utilisateur : la mémoire d'un lieu à l'autre compte). Pour chaque lieu :
//  - temps jusqu'à la maquette (S.G nouveau), jusqu'à l'horizon (S.horizon), puis jusqu'au calme du réseau (2 s) ;
//  - marques de window.__scene.tempsVol quand elles existent (main.js et vol.js) ;
//  - octets reçus par hôte, tas JS après ramasse-miettes, géométries et textures (renderer.info).
// Ne dépend pas des marques : la même mesure tourne sur une version plus ancienne (comparaison avant / après).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
// Playwright : celui du projet s'il est installé, sinon celui de la machine (require suit NODE_PATH)
const { chromium } = createRequire(import.meta.url)("playwright");

const LIEUX = {
  gruyeres: "e=2572794&n=1159319&l=Gruyeres&t=Adresse",
  gruyeres2: "e=2572600&n=1159100&l=Gruyeres-voisin&t=Adresse", // ~280 m plus loin : mêmes tuiles km
  lutry: "e=2542330&n=1150480&l=Lutry&t=Adresse",
  zurich: "e=2683250&n=1247760&l=Zurich&t=Adresse",
  vol: "vol=gruyeres",
  monde: "vol=gruyeres&monde=1",
};
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
let base = opt("--url", null), serveur = null;
const rayon = +opt("--rayon", 150), sortie = opt("--sortie", null), largeur = +opt("--largeur", 800);
const lieux = (args.length ? args : ["gruyeres", "gruyeres2", "lutry"]).map(k => [k, LIEUX[k] || `e=${k.split(",")[0]}&n=${k.split(",")[1]}&t=Adresse`]);

if (!base) {
  serveur = spawn("npx", ["vite", "--port", "5199", "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(ok => serveur.stdout.on("data", d => /Local/.test(d) && ok()));
  base = "http://localhost:5199/";
}

const navigateur = await chromium.launch({ args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });
// chauffe : le serveur de développement prépare ses dépendances (et recharge la page) à la première visite
{
  const p = await navigateur.newPage();
  await p.goto(base + "#" + lieux[0][1]).catch(() => {});
  await p.waitForTimeout(15000);
  await p.close();
}
// contexte neuf : rien en cache HTTP
const page = await (await navigateur.newContext()).newPage({ viewport: { width: largeur, height: Math.round(largeur * 0.6) } });
await page.addInitScript(r => { try { localStorage.setItem("ombres.rayonZone", String(r)); } catch { /* */ } }, rayon);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
const hotes = new Map();
let octets = {}, enVol = new Set(), dernier = Date.now();
cdp.on("Network.requestWillBeSent", e => { if (!/^https?:/.test(e.request.url) || /localhost/.test(e.request.url)) return; enVol.add(e.requestId); dernier = Date.now(); });
cdp.on("Network.responseReceived", e => hotes.set(e.requestId, new URL(e.response.url).host));
const fini = e => { enVol.delete(e.requestId); dernier = Date.now(); };
cdp.on("Network.loadingFinished", e => { const h = hotes.get(e.requestId) || "?"; octets[h] = (octets[h] || 0) + e.encodedDataLength; fini(e); });
cdp.on("Network.loadingFailed", fini);
const erreurs = [];
page.on("pageerror", e => erreurs.push(e.message));

const resultats = [];
for (const [k, [nom, hash]] of lieux.entries()) {
  // le premier lieu : lien direct (page neuve, comme un lien partagé) ; les suivants : changement d'adresse dans la page
  octets = {}; erreurs.length = 0;
  const t0 = Date.now();
  if (k === 0) { await page.goto(base + "#" + hash); await page.waitForFunction(() => window.ombres?.S, null, { timeout: 60000 }); }
  else { await page.evaluate(() => { window.__avantG = window.ombres.S.G; }); await page.evaluate(h => { location.hash = h; }, hash); }
  const attendre = (f, ms) => page.waitForFunction(f, null, { timeout: ms, polling: 200 }).then(() => Date.now() - t0, () => null);
  const vol = hash.startsWith("vol=");
  const tMaquette = vol ? await attendre(() => window.__scene?.tempsVol?.maquette != null, 180000)
    : await attendre(() => window.ombres?.S?.G && window.ombres.S.G !== window.__avantG, 300000);
  const tHorizon = vol ? await attendre(() => window.__scene?.tempsVol?.tuiles != null, 120000) : await attendre(() => !!window.ombres?.S?.horizon, 120000);
  // calme du réseau (services extérieurs) : 3 s sans requête en cours, au plus 60 s après l'horizon
  const limite = Date.now() + 60000;
  while (Date.now() < limite && (enVol.size > 0 || Date.now() - dernier < 3000)) await page.waitForTimeout(250);
  const tCalme = Date.now() - t0;
  const m = await page.evaluate(() => {
    window.gc?.();
    const s = window.__scene || window.ombres?.scene, i = s?.renderer?.info;
    return { temps: { ...(s?.tempsVol || {}) }, tasMo: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      gpu: i ? { geometries: i.memory.geometries, textures: i.memory.textures } : null, paysage: !!s?.loin?.maille, anneau: !!s?.couches?.anneau };
  });
  const total = Object.values(octets).reduce((a, b) => a + b, 0);
  resultats.push({ nom, hash, rayon, tMaquette, tHorizon, tCalme, ...m, octetsMo: +(total / 1e6).toFixed(1),
    parHote: Object.fromEntries(Object.entries(octets).sort((a, b) => b[1] - a[1]).map(([h, o]) => [h, +(o / 1e6).toFixed(2)])), erreurs: [...erreurs] });
  console.log(`${nom.padEnd(10)} maquette ${String(tMaquette ?? "–").padStart(6)} ms  horizon ${String(tHorizon ?? "–").padStart(6)} ms  calme ${String(tCalme).padStart(6)} ms | ${String(+(total / 1e6).toFixed(1)).padStart(5)} Mo reçus | tas ${m.tasMo} Mo | géom. ${m.gpu?.geometries} tex. ${m.gpu?.textures}`);
  console.log(`           ${Object.entries(resultats.at(-1).parHote).slice(0, 5).map(([h, o]) => `${h} ${o}`).join(", ")}`);
  if (Object.keys(m.temps).length > 1) console.log(`           marques ${JSON.stringify(m.temps)}`);
  if (erreurs.length) console.log("           erreurs :", erreurs.slice(0, 3).join(" ; "));
}
await navigateur.close();
serveur?.kill();
if (sortie) { writeFileSync(sortie, JSON.stringify(resultats, null, 1)); console.log("détail :", sortie); }
