// Données d'un lieu quelconque pour l'évaluation de la reconstruction « Advanced » (outils/reconstruction/evaluer.mjs) :
// nuage swissSURFACE3D (COPC, toutes les tuiles de la boîte, année la plus récente), emprises officielles et vue
// aérienne SWISSIMAGE (WMS public de geo.admin.ch). Tout est gardé dans un dossier de cache.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import { emprisesOfficielles } from "../../src/reconstruction/emprises.js";
import { versWgs } from "../../src/geo.js";

const STAC = "https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d/items";
export const CACHE = process.env.CACHE_ESSAI || join(tmpdir(), "ombres-reconstruction");

/** Tuiles COPC (la plus récente par kilomètre) qui touchent la boîte ; null s'il en manque une. */
async function tuilesCopc([e0, n0, e1, n1]) {
  const [lo0, la0] = versWgs(e0, n0), [lo1, la1] = versWgs(e1, n1);
  const d = await (await fetch(`${STAC}?limit=100&bbox=${lo0},${la0},${lo1},${la1}`)).json();
  const T = new Map();
  for (const f of d.features || []) {
    const a = Object.values(f.assets).find(a => /copc/.test(a.type || a.href));
    if (!a) continue;
    const cle = f.id.split("_").pop(), annee = +f.id.split("_")[1];
    if (!T.has(cle) || annee > T.get(cle).annee) T.set(cle, { url: a.href, annee, cle });
  }
  const R = [];
  for (let e = Math.floor(e0 / 1000); e <= Math.floor((e1 - 1e-6) / 1000); e++)
    for (let n = Math.floor(n0 / 1000); n <= Math.floor((n1 - 1e-6) / 1000); n++) {
      const t = T.get(`${e}-${n}`);
      if (!t) return null;
      R.push(t);
    }
  return R;
}

async function lireTuile(url, boite, origine, espacement, lazPerf) {
  const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0];
  const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / espacement)));
  const touche = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d, x0 = cube[0] + x * s, y0 = cube[1] + y * s; return x0 < boite[2] && x0 + s > boite[0] && y0 < boite[3] && y0 + s > boite[1]; };
  const pages = [copc.info.rootHierarchyPage], noeuds = [];
  while (pages.length) {
    const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
    for (const [k, n] of Object.entries(nodes)) if (n && n.pointCount && +k.split("-")[0] <= profMax && touche(k)) noeuds.push(n);
    for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && touche(k)) pages.push(p);
  }
  const X = [], Y = [], Z = [], C = [];
  for (const noeud of noeuds) {
    const v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf, include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
    for (let i = 0; i < v.pointCount; i++) {
      const x = gx(i), y = gy(i);
      if (x < boite[0] || x >= boite[2] || y < boite[1] || y >= boite[3]) continue;
      X.push(x - origine[0]); Y.push(y - origine[1]); Z.push(gz(i)); C.push(gc(i));
    }
  }
  return { X, Y, Z, C };
}

/**
 * Nuage (relatif au centre, Z absolu), emprises (MN95) et chemin de la vue aérienne d'un lieu { id, E, N, R }.
 * @returns {{ origine, boite, points, emprises, annee, photo } | { erreur }}
 */
export async function donneesLieu({ id, E, N, R = 80 }, { espacement = 0.5, cache = CACHE, pxParM = 5 } = {}) {
  const boite = [E - R, N - R, E + R, N + R];
  mkdirSync(cache, { recursive: true });
  const fN = join(cache, `${id}_${R}_${espacement}.bin`), fE = join(cache, `${id}_${R}_emprises.json`), fP = join(cache, `${id}_${R}.jpg`), fI = join(cache, `${id}_${R}_info.json`);
  let points, info = existsSync(fI) ? JSON.parse(readFileSync(fI, "utf8")) : {};
  if (info.erreur) return info;
  if (existsSync(fN)) {
    const b = readFileSync(fN), n = b.readUInt32LE(0), o = 4;
    const f32 = k => new Float32Array(b.buffer.slice(b.byteOffset + o + 4 * n * k, b.byteOffset + o + 4 * n * (k + 1)));
    points = { X: f32(0), Y: f32(1), Z: f32(2), C: new Uint8Array(b.buffer.slice(b.byteOffset + o + 12 * n, b.byteOffset + o + 13 * n)), n };
  } else {
    const T = await tuilesCopc(boite);
    if (!T) { info = { erreur: "pas de nuage COPC" }; writeFileSync(fI, JSON.stringify(info)); return info; }
    const lazPerf = await createLazPerf(), P = [];
    for (const t of T) P.push(await lireTuile(t.url, boite, [E, N], espacement, lazPerf));
    const X = Float32Array.from(P.flatMap(p => p.X)), Y = Float32Array.from(P.flatMap(p => p.Y)), Z = Float32Array.from(P.flatMap(p => p.Z)), C = Uint8Array.from(P.flatMap(p => p.C));
    points = { X, Y, Z, C, n: X.length };
    const h = Buffer.alloc(4); h.writeUInt32LE(points.n);
    writeFileSync(fN, Buffer.concat([h, Buffer.from(X.buffer), Buffer.from(Y.buffer), Buffer.from(Z.buffer), Buffer.from(C.buffer)]));
    info = { annee: Math.max(...T.map(t => t.annee)) };
    writeFileSync(fI, JSON.stringify(info));
  }
  let emprises;
  if (existsSync(fE)) emprises = JSON.parse(readFileSync(fE, "utf8"));
  else { emprises = await emprisesOfficielles(boite); writeFileSync(fE, JSON.stringify(emprises)); }
  if (!emprises?.emprises?.length) return { erreur: "pas d'emprises officielles en accès libre" };
  if (!existsSync(fP)) {
    const px = Math.min(2400, Math.round(2 * R * pxParM));
    const u = `https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:2056&BBOX=${boite.join(",")}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/jpeg`;
    const r = await fetch(u);
    if (r.ok && /image/.test(r.headers.get("content-type") || "")) writeFileSync(fP, Buffer.from(await r.arrayBuffer()));
  }
  return { origine: [E, N], boite, points, emprises, annee: info.annee, photo: existsSync(fP) ? fP : null };
}
