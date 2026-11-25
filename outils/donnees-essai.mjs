// Données des lieux d'essai pour la reconstruction (outils/essai-reconstruction.mjs) : nuage swissSURFACE3D (COPC)
// et emprises officielles, téléchargés une fois puis gardés dans un dossier de cache (binaire brut + JSON).
// Usage interne : import { donneesEssai } from "./donnees-essai.mjs".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import { emprisesOfficielles } from "../src/reconstruction/emprises.js";

export const LIEUX = {
  floreal: { nom: "Lausanne, av. Floréal 18", centre: [2537679, 1151560], tuile: "2537-1151", roofer: "roofer_floreal.json" },
  lutry: { nom: "Lutry", centre: [2542766, 1152300], tuile: "2542-1152", roofer: "roofer_lutry.json" },
};

async function lireNuage(url, boite, origine, espacement) {
  const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0], lazPerf = await createLazPerf();
  const profMax = espacement > 0 ? Math.max(0, Math.ceil(Math.log2(copc.info.spacing / espacement))) : 99;
  const touche = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d, x0 = cube[0] + x * s, y0 = cube[1] + y * s; return x0 < boite[2] && x0 + s > boite[0] && y0 < boite[3] && y0 + s > boite[1]; };
  const pages = [copc.info.rootHierarchyPage], noeuds = [];
  while (pages.length) {
    const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
    for (const [k, n] of Object.entries(nodes)) if (n && n.pointCount && +k.split("-")[0] <= profMax && touche(k)) noeuds.push(n);
    for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && touche(k)) pages.push(p);
  }
  const total = noeuds.reduce((s, n) => s + n.pointCount, 0);
  const X = new Float32Array(total), Y = new Float32Array(total), Z = new Float32Array(total), C = new Uint8Array(total);
  let n = 0;
  for (const noeud of noeuds) {
    const v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf, include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
    for (let i = 0; i < v.pointCount; i++) {
      const x = gx(i), y = gy(i);
      if (x < boite[0] || x >= boite[2] || y < boite[1] || y >= boite[3]) continue;
      X[n] = x - origine[0]; Y[n] = y - origine[1]; Z[n] = gz(i); C[n] = gc(i); n++;
    }
  }
  return { X: X.slice(0, n), Y: Y.slice(0, n), Z: Z.slice(0, n), C: C.slice(0, n), n };
}

/** Nuage (relatif au centre, Z absolu) et emprises (MN95) du lieu, sur une boîte de ±R m. */
export async function donneesEssai(nomLieu, { R = 150, espacement = 0.5, cache = process.env.CACHE_ESSAI || join(tmpdir(), "ombres-reconstruction") } = {}) {
  const lieu = LIEUX[nomLieu], [E0, N0] = lieu.centre, boite = [E0 - R, N0 - R, E0 + R, N0 + R];
  mkdirSync(cache, { recursive: true });
  const fN = join(cache, `${nomLieu}_${R}_${espacement}.bin`), fE = join(cache, `${nomLieu}_${R}_emprises.json`);
  let points;
  if (existsSync(fN)) {
    const b = readFileSync(fN), n = b.readUInt32LE(0), o = 4;
    const f32 = k => new Float32Array(b.buffer.slice(b.byteOffset + o + 4 * n * k, b.byteOffset + o + 4 * n * (k + 1)));
    points = { X: f32(0), Y: f32(1), Z: f32(2), C: new Uint8Array(b.buffer.slice(b.byteOffset + o + 12 * n, b.byteOffset + o + 13 * n)), n };
  } else {
    const url = `https://data.geo.admin.ch/ch.swisstopo.swisssurface3d/swisssurface3d_2025_${lieu.tuile}/swisssurface3d_2025_${lieu.tuile}_2056_5728.copc.laz`;
    points = await lireNuage(url, boite, [E0, N0], espacement);
    const h = Buffer.alloc(4); h.writeUInt32LE(points.n);
    writeFileSync(fN, Buffer.concat([h, Buffer.from(points.X.buffer), Buffer.from(points.Y.buffer), Buffer.from(points.Z.buffer), Buffer.from(points.C.buffer)]));
  }
  let emprises;
  if (existsSync(fE)) emprises = JSON.parse(readFileSync(fE, "utf8"));
  else { emprises = await emprisesOfficielles(boite); writeFileSync(fE, JSON.stringify(emprises)); }
  return { lieu, origine: [E0, N0], boite, points, emprises };
}
