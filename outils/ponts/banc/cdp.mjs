// Pilote minimal de Chromium sans interface (protocole DevTools) : charge un lieu, évalue du JS, enregistre des captures.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
import { SORTIE } from "./sites.mjs";
const CHROME = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
export const BASE = "http://localhost:5174/?lang=fr";

export async function ouvrir({ largeur = 1280, hauteur = 800 } = {}) {
  const profil = join(SORTIE, "profil-chromium");
  mkdirSync(profil, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profil}`, `--window-size=${largeur},${hauteur}`,
    "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const ws = await new Promise((ok, ko) => {
    let buf = "";
    proc.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
    setTimeout(() => ko(new Error("Chromium ne démarre pas : " + buf.slice(0, 400))), 15000);
  });
  const port = ws.match(/:(\d+)\//)[1];
  const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = cibles.find(c => c.type === "page");
  const s = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => s.addEventListener("open", r));
  let id = 0;
  const attente = new Map(), journal = [];
  s.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) { const [ok, ko] = attente.get(m.id); attente.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
    else if (m.method === "Runtime.exceptionThrown") journal.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) journal.push(m.params.type + " " + m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 300));
  });
  const cmd = (method, params = {}) => new Promise((ok, ko) => { attente.set(++id, [ok, ko]); s.send(JSON.stringify({ id, method, params })); });
  await cmd("Page.enable"); await cmd("Runtime.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: false });
  const P = {
    journal,
    async js(code) {
      const r = await cmd("Runtime.evaluate", { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    /** Charge un lieu (hash sans #) avec un rayon ; attend la maquette construite ; installe les aides (aides.js). */
    async lieu(hash, rayon = 200, avant = "") {
      await cmd("Page.navigate", { url: "about:blank" });
      await cmd("Page.navigate", { url: BASE });
      await new Promise(r => setTimeout(r, 1500));
      await P.js(`localStorage.setItem("ombres.rayonZone", "${rayon}"); ${avant}`);
      await cmd("Page.navigate", { url: "about:blank" });
      await cmd("Page.navigate", { url: `${BASE}#${hash}` });
      const t0 = Date.now();
      let dejaPret = false;
      for (;;) {
        await new Promise(r => setTimeout(r, 1000));
        // prête : la scène du lieu demandé (pas le décor de l'accueil), deux fois de suite
        const m = hash.match(/e=(\d+)&n=(\d+)/);
        const pret = await P.js(`const s = window.__scene; return !!(s && s.G && s.couches && s.couches.terrain && s.lieuPonts && Math.hypot(s.lieuPonts.E - ${m[1]}, s.lieuPonts.N - ${m[2]}) < 1500 && !s.chargementPts)`).catch(() => false);
        if (pret && dejaPret) break;
        dejaPret = pret;
        if (Date.now() - t0 > 240000) throw new Error("maquette non construite : " + journal.slice(-5).join(" | "));
      }
      await new Promise(r => setTimeout(r, 6000)); // animations de construction, fond de plan
      await P.js(readFileSync(join(ICI, "aides.js"), "utf8"));
    },
    async capture(fichier) {
      await P.js(`window.__scene.rendre(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));`);
      const r = await cmd("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      mkdirSync(dirname(fichier), { recursive: true });
      writeFileSync(fichier, Buffer.from(r.data, "base64"));
    },
    fermer() { s.close(); proc.kill(); },
  };
  return P;
}
