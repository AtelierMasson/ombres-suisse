// node captures.mjs <étiquette> [site[@rayon]…] : captures des ponts de chaque site dans le navigateur (serveur de dev),
// aux mêmes points de vue pour toutes les étiquettes (tirés des mesures « avant »).
import { ouvrir } from "./cdp.mjs";
import { readFileSync, existsSync } from "node:fs";
import { SITES, CACHE, MESURES, REFERENCE, CAPTURES } from "./sites.mjs";
const SORTIE = CAPTURES, mes = f => [MESURES, REFERENCE].map(d => `${d}/${f}`).find(p => existsSync(p)) || `${REFERENCE}/${f}`;
const [etiq, ...noms] = process.argv.slice(2);
const HASH = { lutry: "&l=Lutry%203947&t=Parcelle" };
// vues ajoutées à la main : [nom, x, y, z (null = lu dans la scène), azimut, élévation, distance, { sansSocle }]
const PLUS = {};
const PLUS725 = {
  // Lutry, rayon 725 : pont coupé par le cercle fin (300 m) et ponts swissTLM3D de l'anneau (viaducs de l'A9)
  lutry: [["cercle-biais", -59.5, -299.3, null, 250, 30, 70], ["cercle-haut", -59.5, -299.3, null, 200, 60, 90], ["cercle-long", -59.5, -299.3, null, 20, 12, 60], ["anneau-viaducs", 200, -430, null, 150, 30, 420], ["anneau-viaducs-pres", 228, -393, null, 120, 25, 160]],
};
const MODES = ["cadastre", "uni", "photo", "degrade"];
const P = await ouvrir();
const attendre = ms => new Promise(r => setTimeout(r, ms));
const mode = m => P.js(`const set = (id, v) => { const e = document.getElementById(id); if (e && e.checked !== v) { e.checked = v; e.dispatchEvent(new Event("change", { bubbles: true })); } };
  set("vDegrade", ${m === "degrade"}); set("vReel", ${m === "photo"}); set("vCadastre", ${m === "cadastre"}); await new Promise(r => setTimeout(r, ${m === "photo" ? 9000 : 2500}));`);
const voir = (arbres, socle) => P.js(`const s = __scene; for (const k of ["arbres", "canopee", "releveAnneau"]) if (s.couches[k]) s.couches[k].visible = ${arbres}; if (s.mat.pointsAnneau) s.mat.pointsAnneau.visible = ${arbres}; for (const k of ["socle", "socleAnneau"]) if (s.couches[k]) s.couches[k].visible = ${socle} && (k === "socleAnneau" || !s.couches.socleAnneau); s.ombres(); s.rendre();`);
const zEn = (x, y) => P.js(`const s = __scene, G = s.G, i = Math.floor((${x} - G.x0) / G.c), j = Math.floor((${y} - G.x0) / G.c), v = i >= 0 && j >= 0 && i < G.n && j < G.n ? G.pont?.[j * G.n + i] : NaN;
  if (!isNaN(v)) return v - s.zRef; if (Math.hypot(${x}, ${y}) > (G.rayonZone || G.R) - 1 && s.altAnneau) return s.altAnneau(${x}, ${y}) - s.zRef; return __d.sol(${x}, ${y}) - s.zRef;`);
const prise = async (fichier, x, y, z, az, el, dist) => {
  if (!(await P.js(`return !!window.__d`).catch(() => false))) throw new Error("page rechargée");
  await P.js(`__d.vue(${x}, ${y}, ${z}, ${az}, ${el}, ${dist})`);
  await P.capture(`${SORTIE}${fichier}.jpg`);
};
const tuilesFinies = async () => { for (let k = 0; k < 40; k++) { await attendre(1500); const n = await P.js(`const s = __scene.swiss; __scene.rendre(); let n = 0; for (const t of [s?.tuiles, s?.ponts, s?.arbres]) if (t?.stats) n += t.stats.downloading + t.stats.parsing + (t.stats.queued || 0); return n;`).catch(() => 0); if (!n) return; } };
try {
  const liste = (noms.length ? noms : Object.keys(SITES)).map(a => { const [nom, r] = a.split("@"); return [nom, r ? +r : SITES[nom].rayons[0]]; });
  for (const [nom, rayon] of liste) {
    const site = SITES[nom], R = Math.min(rayon, 300), suf = rayon > 300 ? `${nom}${rayon}` : nom;
    for (let essai = 1; essai <= 3; essai++) {
      try {
        const t0 = Date.now();
        await P.lieu(`e=${site.e}&n=${site.n}${HASH[nom] || ""}`, rayon);
        const lieu = await P.js(`return { E: __scene.lieuPonts?.E, N: __scene.lieuPonts?.N, Rz: __scene.G.rayonZone, ext: __scene.rayonExt }`), meta = JSON.parse(readFileSync(`${CACHE}/${nom}.json`, "utf8"));
        if (lieu.E !== meta.E0 || lieu.N !== meta.N0) console.log(`!! ${nom} : centre ${lieu.E}, ${lieu.N} ≠ cache ${meta.E0}, ${meta.N0}`);
        console.log(`== ${suf} chargé en ${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(lieu));
        await mode("cadastre"); await voir(false, true);
        const M = JSON.parse(readFileSync(mes(`avant-${nom}-${R}.json`), "utf8")), refs = existsSync(mes(`avant-${nom}-${R}.ref.json`)) ? JSON.parse(readFileSync(mes(`avant-${nom}-${R}.ref.json`), "utf8")) : [];
        if (rayon <= 300) {
          const ponts = [...M.ponts].sort((a, b) => b.aire - a.aire).slice(0, +process.env.NB || 3);
          let k = 0;
          for (const p of ponts) {
            k++;
            const ref = refs.find(r => Math.hypot(r.x - p.x, r.y - p.y) < 30 && r.bouts);
            let az = p.az, L = p.ext;
            if (ref) { const [A, B] = ref.bouts; az = 90 - Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI; L = Math.hypot(B[0] - A[0], B[1] - A[1]); }
            const d = Math.max(35, Math.min(260, L * 1.1)), z = p.z;
            await prise(`${etiq}-${suf}-p${k}-biais`, p.x, p.y, z, az + 60, 28, d);
            await prise(`${etiq}-${suf}-p${k}-long`, p.x, p.y, z, az + 12, 10, d * 0.7);
            await prise(`${etiq}-${suf}-p${k}-dessus`, p.x, p.y, z, az, 89, d);
            await voir(false, false); await prise(`${etiq}-${suf}-p${k}-dessous`, p.x, p.y, z, az + 70, -22, d); await voir(false, true);
            if (ref) for (const b of [0, 1]) {
              if (ref.libre[b]) continue;
              const [x, y] = ref.bouts[b], zb = await zEn(x, y);
              await prise(`${etiq}-${suf}-p${k}-raccord${"AB"[b]}`, x, y, zb, b ? az - 35 : az + 180 + 35, 32, 26);
              await prise(`${etiq}-${suf}-p${k}-raccord${"AB"[b]}-ras`, x, y, zb, b ? az - 80 : az + 180 + 80, 8, 22);
            }
            if (k === 1) {
              await voir(true, true); await prise(`${etiq}-${suf}-p${k}-biais-arbres`, p.x, p.y, z, az + 60, 28, d); await voir(false, true);
              for (const m of MODES.slice(1)) {
                await mode(m);
                await prise(`${etiq}-${suf}-p${k}-biais-${m}`, p.x, p.y, z, az + 60, 28, d);
                await prise(`${etiq}-${suf}-p${k}-dessous-${m}`, p.x, p.y, z, az + 70, -12, d * 0.8);
                if (ref && !ref.libre[0]) { const [x, y] = ref.bouts[0]; await prise(`${etiq}-${suf}-p${k}-raccordA-${m}`, x, y, await zEn(x, y), az + 180 + 35, 32, 26); }
              }
              await mode("cadastre");
            }
          }
        }
        // ponts modélisés à la main : partie de l'axe dans le cercle, et chaque passage du cercle
        const vuesModeles = [];
        if (rayon <= 300) {
          const axes = await P.js(`const s = __scene; return (s.pontsModeles || []).map(P => P.axe.map(a => [a[0] - s.lieuPonts.E, a[1] - s.lieuPonts.N, a[2] - s.zRef]))`);
          let q = 0;
          for (const A of axes) {
            q++;
            const dedans = [], passages = [];
            for (let i = 0; i < A.length - 1; i++) for (let u = 0; u <= 1; u += 0.02) {
              const pt = [0, 1, 2].map(k => A[i][k] + (A[i + 1][k] - A[i][k]) * u), r = Math.hypot(pt[0], pt[1]);
              if (r < R - 1) dedans.push(pt);
              const avant = dedans.length && dedans.at(-1) === pt;
              if (passages.at(-1)?.dedans !== avant) passages.push({ dedans: avant, pt, dir: [A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]] });
            }
            if (dedans.length < 2) continue;
            const m = dedans[dedans.length >> 1], a0 = dedans[0], a1 = dedans.at(-1), az = 90 - Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) * 180 / Math.PI, L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), d = Math.max(60, Math.min(260, L * 1.1));
            vuesModeles.push([`m${q}-biais`, m[0], m[1], m[2], az + 60, 28, d], [`m${q}-long`, m[0], m[1], m[2], az + 12, 10, d * 0.7, { modes: ["cadastre"] }], [`m${q}-dessus`, m[0], m[1], m[2], az, 89, d, { modes: ["cadastre", "photo"] }], [`m${q}-dessous`, m[0], m[1], m[2], az + 70, -20, d * 0.9, { sansSocle: true, modes: ["cadastre", "degrade"] }]);
            let c = 0;
            for (const Pa of passages.slice(1)) { c++; const azc = 90 - Math.atan2(Pa.pt[1], Pa.pt[0]) * 180 / Math.PI; vuesModeles.push([`m${q}-cercle${c}`, Pa.pt[0], Pa.pt[1], Pa.pt[2], azc + 35, 25, 60, { modes: ["cadastre", "photo"] }], [`m${q}-cercle${c}-dessous`, Pa.pt[0], Pa.pt[1], Pa.pt[2], azc + 20, -10, 60, { sansSocle: true, modes: ["cadastre"] }]); }
          }
        }
        for (const [n2, x, y, z, az, el, dist, o] of [...((rayon > 300 ? PLUS725[nom] : PLUS[nom]) || []), ...vuesModeles]) {
          const zz = z ?? await zEn(x, y);
          await P.js(`__d.vue(${x}, ${y}, ${zz}, ${az}, ${el}, ${dist})`); await tuilesFinies();
          if (o?.sansSocle) await voir(false, false);
          for (const m of o?.modes || MODES) { await mode(m); await tuilesFinies(); await prise(`${etiq}-${suf}-${n2}-${m}`, x, y, zz, az, el, dist); }
          await mode("cadastre"); await voir(false, true);
        }
        if (P.journal.length) console.log("journal:", [...new Set(P.journal)].slice(-4).join(" | "));
        P.journal.length = 0;
        break;
      } catch (e) { console.log(`!! ${suf} essai ${essai} : ${e.message}`); if (essai === 3) console.log(`!! ${suf} abandonné`); }
    }
  }
} finally { P.fermer(); }
