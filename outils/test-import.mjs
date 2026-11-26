// Tests de l'import de modèles (node outils/test-import.mjs) : lecture DXF / OBJ, recalage par la parcelle,
// unités, MN95, origine locale (aller-retour par le DXF de référence), coupes, et import complet three.js.
import assert from "node:assert/strict";
import { lireDxf, lireObj } from "../src/import/lecture.js";
import { placer } from "../src/import/placement.js";
import { apparier } from "../src/import/recalage.js";
import { dxfReference } from "../src/referenceParcelle.js";
import { importerModele } from "../src/importer.js";

let ok = 0, echecs = 0;
async function cas(nom, f) {
  try { await f(); ok++; console.log(`  ok    ${nom}`); } catch (e) { echecs++; console.log(`  ÉCHEC ${nom}\n        ${e.stack.split("\n").slice(0, 3).join("\n        ")}`); }
}
const pres = (a, b, tol, quoi) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tol, `${quoi} : ${a} ≠ ${b}`);

/* ------------------------------------------------------------------ site fictif */
const E0 = 2581000, N0 = 1150000, zRef = 452.3, Z0 = 452;
const solEn = (x, y) => 450 + 0.1 * x + 0.05 * y; // terrain en pente (altitude absolue)
// parcelle pentagonale irrégulière, coordonnées relatives (m), sens inverse des aiguilles d'une montre
const PARCELLE = [[-12, -9], [14, -11], [19, 6], [3, 17], [-15, 8]];
const contexte = { E0, N0, zRef, parcelle: [[...PARCELLE, PARCELLE[0]]], solEn };
// bâtiment : boîte 10 × 6 m, 7 m de haut, dans la parcelle
const BAT = [[-4, -3], [6, -3], [6, 3], [-4, 3]], HAUT = 7;
const COUPE = { A: [-10, 0], B: [12, 2] };

/* ------------------------------------------------------------------ écriture DXF de test */
const p = (k, [x, y, z = 0]) => `${10 + k}\n${x}\n${20 + k}\n${y}\n${30 + k}\n${z}\n`;
const face = (calque, a, b, c, d = c) => `0\n3DFACE\n8\n${calque}\n${p(0, a)}${p(1, b)}${p(2, c)}${p(3, d)}`;
const lwpoly = (calque, pts) => `0\nLWPOLYLINE\n8\n${calque}\n90\n${pts.length}\n70\n1\n` + pts.map(([x, y]) => `10\n${x}\n20\n${y}\n`).join("");
const ligne = (calque, a, b) => `0\nLINE\n8\n${calque}\n${p(0, a)}${p(1, b)}`;
const texte = (calque, a, s) => `0\nTEXT\n8\n${calque}\n${p(0, a)}40\n1\n1\n${s}\n`;
const dxf = (entites, insunits = null) => `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n${insunits != null ? `9\n$INSUNITS\n70\n${insunits}\n` : ""}0\nENDSEC\n`
  + `0\nSECTION\n2\nENTITIES\n${entites.join("")}0\nENDSEC\n0\nEOF\n`;

/** Faces d'une boîte (sol à z0, hauteur h) dont le plan est donné par `pts` déjà transformés. */
function boite(calque, pts, z0, h) {
  const r = [face(calque, ...pts.map(q => [...q, z0])), face(calque, ...pts.map(q => [...q, z0 + h]))];
  for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; r.push(face(calque, [...a, z0], [...b, z0], [...b, z0 + h], [...a, z0 + h])); }
  return r;
}

/** Repère quelconque : rotation de 37°, décalage (1234, −567) m, puis unité (1000 = mm). */
const repere = (deg, dx, dy, k) => ([x, y]) => {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  return [(c * x - s * y + dx) * k, (s * x + c * y + dy) * k];
};

/** Vérifie bâtiment, coupe et écart d'un placement. */
function verifier(R, D, { tolBat = 0.05 } = {}) {
  const m = D.maillages.find(m => m.calque === "PROJET");
  const coins = [];
  for (let k = 0; k < m.tri.length; k += 3) coins.push(R.versSite(m.tri[k], m.tri[k + 1], m.tri[k + 2]));
  for (const b of BAT) assert.ok(coins.some(c => Math.hypot(c[0] - b[0], c[1] - b[1]) < tolBat), `coin ${b} non retrouvé`);
  assert.equal(R.coupes.length, 1, "une coupe attendue");
  pres(R.coupes[0].A, COUPE.A, 0.05, "coupe A"); pres(R.coupes[0].B, COUPE.B, 0.05, "coupe B");
  return coins;
}

console.log("Import de modèles");

await cas("recalage pur : pentagone tourné de 37°, décalé, en mm, sens inversé et départ décalé", () => {
  const T = repere(37, 1234, -567, 1000), src = PARCELLE.map(T).reverse();
  src.push(src.shift(), src.shift());
  const r = apparier(src, PARCELLE, null);
  assert.ok(Math.abs(r.echelle - 0.001) < 1e-6, `échelle ${r.echelle}`);
  assert.ok(Math.abs(r.rotation + 37) < 0.01, `rotation ${r.rotation}`);
  assert.ok(r.ecartMax < 0.001, `écart ${r.ecartMax}`);
  assert.ok(!r.ambigu, "pentagone irrégulier : pas d'ambiguïté");
});

await cas("contour redessiné : sommets intermédiaires et bruit de ±1 cm, toujours < 5 cm", () => {
  const T = repere(37, 1234, -567, 1000), dense = [];
  let graine = 7;
  const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02; // ±1 cm
  PARCELLE.forEach((a, k) => { const b = PARCELLE[(k + 1) % PARCELLE.length]; for (let i = 0; i < 4; i++) dense.push([a[0] + (b[0] - a[0]) * i / 4 + alea(), a[1] + (b[1] - a[1]) * i / 4 + alea()]); });
  const D = lireDxf(dxf([lwpoly("PARCELLE", dense.map(T)), ...boite("PROJET", BAT.map(T), 0, HAUT * 1000), ligne("SECTIONS", [...T(COUPE.A), 0], [...T(COUPE.B), 0])]));
  const debut = performance.now(), R = placer(D, contexte);
  assert.ok(R.placement.ecartMoyen < 0.02 && R.placement.ecartMax < 0.05, `écart ${R.placement.ecartMoyen} / ${R.placement.ecartMax}`);
  verifier(R, D);
  console.log(`        écart moyen ${(R.placement.ecartMoyen * 1000).toFixed(1)} mm, max ${(R.placement.ecartMax * 1000).toFixed(1)} mm, ${Math.round(performance.now() - debut)} ms`);
});

await cas("DXF en mm sans $INSUNITS, calque PARCELLE, 3DFACE, coupe nommée", () => {
  const T = repere(37, 1234, -567, 1000);
  const D = lireDxf(dxf([
    lwpoly("PARCELLE", PARCELLE.map(T)),
    ...boite("PROJET", BAT.map(T), 0, HAUT * 1000),
    ligne("SECTIONS", [...T(COUPE.A), 0], [...T(COUPE.B), 0]),
    texte("SECTIONS", [...T([COUPE.A[0] - 0.5, COUPE.A[1] + 0.5]), 0], "Coupe A-A"),
  ]));
  const R = placer(D, contexte);
  assert.equal(R.placement.methode, "parcelle");
  assert.equal(R.placement.unite, "mm");
  assert.ok(R.placement.ecartMoyen < 0.05 && R.placement.ecartMax < 0.05, `écart ${R.placement.ecartMoyen} / ${R.placement.ecartMax}`);
  assert.ok(Math.abs(R.placement.rotation + 37) < 0.01);
  const coins = verifier(R, D);
  assert.equal(R.coupes[0].nom, "Coupe A-A");
  // repère quelconque : le bas du bâtiment est posé sur le point le plus bas du terrain sous l'emprise
  const bas = Math.min(...coins.map(c => c[2])), terrain = Math.min(...BAT.map(([x, y]) => solEn(x, y)));
  assert.equal(R.placement.altitude, "terrain");
  assert.ok(Math.abs(bas - terrain) < 0.01, `bas ${bas} ≠ terrain ${terrain}`);
  assert.ok(Math.abs(Math.max(...coins.map(c => c[2])) - bas - HAUT) < 0.01, "hauteur conservée");
  console.log(`        écart moyen ${(R.placement.ecartMoyen * 1000).toFixed(2)} mm, max ${(R.placement.ecartMax * 1000).toFixed(2)} mm`);
});

await cas("$INSUNITS faux (m) pour un dessin en mm : unité corrigée par le contour", () => {
  const T = repere(-112, 40, 25, 1000);
  const D = lireDxf(dxf([lwpoly("Parcelle", PARCELLE.map(T)), ...boite("PROJET", BAT.map(T), 0, HAUT * 1000),
    ligne("A-COUPES", [...T(COUPE.A), 0], [...T(COUPE.B), 0])], 6));
  const R = placer(D, contexte);
  assert.equal(R.placement.methode, "parcelle");
  assert.equal(R.placement.unite, "mm");
  assert.ok(R.placement.ecartMax < 0.05);
  verifier(R, D);
  assert.equal(R.coupes[0].nom, "A–B");
  assert.ok(R.avertissements.some(a => a.cle === "import.uniteCorrigee"));
});

await cas("contour trouvé par sa forme (calque 0) parmi d'autres polylignes fermées, en cm", () => {
  const T = repere(200, -80, 310, 100);
  const D = lireDxf(dxf([
    lwpoly("0", [[0, 0], [100, 0], [100, 50], [0, 50]].map(T)), // distracteur : rectangle
    lwpoly("MURS", BAT.map(T)), // distracteur : emprise du bâtiment
    lwpoly("0", PARCELLE.map(T)),
    ...boite("PROJET", BAT.map(T), 0, HAUT * 100),
    ligne("Schnitte", [...T(COUPE.A), 0], [...T(COUPE.B), 0]),
  ]));
  const R = placer(D, contexte);
  assert.equal(R.placement.methode, "parcelle");
  assert.equal(R.placement.unite, "cm");
  assert.ok(R.placement.ecartMax < 0.05, `écart ${R.placement.ecartMax}`);
  verifier(R, D);
});

await cas("MN95 complètes : placement direct, altitudes gardées", () => {
  const T = ([x, y]) => [x + E0, y + N0], z0 = solEn(-4, -3) - 0.2;
  const D = lireDxf(dxf([...boite("PROJET", BAT.map(T), z0, HAUT), ligne("SECTIONS", [...T(COUPE.A), 0], [...T(COUPE.B), 0])], 6));
  const R = placer(D, contexte);
  assert.equal(R.placement.methode, "mn95");
  const coins = verifier(R, D, { tolBat: 1e-6 });
  assert.equal(R.placement.altitude, "fichier");
  assert.ok(Math.abs(Math.min(...coins.map(c => c[2])) - z0) < 1e-6);
});

await cas("aller-retour par le DXF de référence (origine locale, altitudes relatives à Z0)", () => {
  const ref = dxfReference({ ...contexte, batiments: [[[20, 20], [26, 20], [26, 25], [20, 25]]] });
  assert.match(ref.nom, /E2581000_N1150000_Z452/);
  assert.ok(ref.texte.includes("SECTIONS") && ref.texte.includes("PARCELLE"));
  // l'architecte dessine par-dessus : bâtiment à z = 1,5 (altitude 453,5) et une coupe
  const ajout = [...boite("PROJET", BAT, 1.5, HAUT), ligne("SECTIONS", [...COUPE.A, 0], [...COUPE.B, 0]), texte("SECTIONS", [COUPE.A[0], COUPE.A[1] - 1, 0], "B")].join("");
  const D = lireDxf(ref.texte.replace("0\nENDSEC\n0\nEOF", ajout + "0\nENDSEC\n0\nEOF"));
  const R = placer(D, contexte, { nomFichier: "projet.dxf" });
  assert.equal(R.placement.methode, "parcelle");
  assert.ok(R.placement.ecartMax < 1e-3 && Math.abs(R.placement.rotation) < 1e-4);
  assert.equal(R.placement.altitude, "fichier");
  const coins = verifier(R, D, { tolBat: 1e-3 });
  assert.ok(Math.abs(Math.min(...coins.map(c => c[2])) - (Z0 + 1.5)) < 1e-6);
  assert.equal(R.coupes[0].nom, "B");
  // VOISINS, ORIGINE : lignes de référence, pas de faces ajoutées
  assert.deepEqual(R.calquesModele, ["PROJET"]);
});

await cas("origine locale sans contour : origine du nom de fichier (autre site voisin)", () => {
  const D = lireDxf(dxf([...boite("PROJET", BAT.map(([x, y]) => [x - 100, y + 50]), 3, HAUT)]));
  const R = placer(D, contexte, { nomFichier: `ombres_x_E${E0 + 100}_N${N0 - 50}_Z450.dxf` });
  assert.equal(R.placement.methode, "origine");
  const m = D.maillages[0], c = R.versSite(m.tri[0], m.tri[1], m.tri[2]);
  pres(c, BAT[0], 1e-9, "coin");
  assert.ok(Math.abs(c[2] - 453) < 1e-9);
});

await cas("OBJ en Y vers le haut, polyface et blocs DXF", () => {
  const D = lireObj("o PROJET\nv 0 0 0\nv 1 0 0\nv 1 2 -3\nf 1 2 3\nl 1 2\n", "y");
  assert.deepEqual(D.maillages[0].tri.slice(6), [1, 3, 2]);
  // polyface (2 faces) dans un bloc inséré à (10, 20) tourné de 90°
  const bloc = `0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n8\n0\n2\nB1\n${p(0, [0, 0, 0])}`
    + `0\nPOLYLINE\n8\n0\n66\n1\n70\n64\n71\n4\n72\n2\n`
    + [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map(v => `0\nVERTEX\n8\n0\n${p(0, v)}70\n192\n`).join("")
    + `0\nVERTEX\n8\n0\n${p(0, [0, 0, 0])}70\n128\n71\n1\n72\n2\n73\n3\n0\nVERTEX\n8\n0\n${p(0, [0, 0, 0])}70\n128\n71\n1\n72\n3\n73\n4\n0\nSEQEND\n`
    + `0\nENDBLK\n0\nENDSEC\n`;
  const t = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n${bloc}0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\nTOIT\n2\nB1\n${p(0, [10, 20, 0])}50\n90\n0\nENDSEC\n0\nEOF\n`;
  const B = lireDxf(t);
  assert.equal(B.maillages[0].calque, "TOIT");
  assert.equal(B.maillages[0].tri.length, 18);
  assert.deepEqual(B.maillages[0].tri.slice(3, 5).map(Math.round), [10, 21]); // (1, 0) tourné de 90° → (0, 1)
});

await cas("importerModele (three.js) : groupe en coordonnées de scène", async () => {
  const T = repere(37, 1234, -567, 1000);
  const texteDxf = dxf([lwpoly("PARCELLE", PARCELLE.map(T)), ...boite("PROJET", BAT.map(T), 0, HAUT * 1000), ligne("SECTIONS", [...T(COUPE.A), 0], [...T(COUPE.B), 0])]);
  const r = await importerModele(new File([texteDxf], "projet.dxf"), contexte);
  assert.equal(r.objet.children.length, 1);
  const pos = r.objet.children[0].geometry.attributes.position;
  let ymin = Infinity;
  for (let i = 0; i < pos.count; i++) ymin = Math.min(ymin, pos.getY(i));
  const terrain = Math.min(...BAT.map(([x, y]) => solEn(x, y)));
  assert.ok(Math.abs(ymin - (terrain - zRef)) < 0.01, `y bas ${ymin}`);
  // coin (6, 3) relatif → scène (6, …, −3)
  let trouve = false;
  for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) - 6, pos.getZ(i) + 3) < 0.05) trouve = true;
  assert.ok(trouve, "coin (6, 3) absent en scène");
  assert.equal(r.coupes.length, 1);
  assert.ok(Array.isArray(r.avertissements));
});

await cas("DWG refusé avec un message clair", async () => {
  await assert.rejects(importerModele(new File([new Uint8Array([65, 67, 49, 48, 51, 50, 0, 0])], "plan.dwg"), contexte), e => e.cle === "import.dwg");
});

console.log(`${ok} réussi(s), ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
