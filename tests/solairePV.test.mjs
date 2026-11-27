// Production PV et économie (solairePV.js) sans navigateur : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { orientationPlan, pansMaillage, implanter } from "../src/pansSolaires.js";
import { positionsHoraires, anneeType, normaleProche, productionPV, vueCielInclinee, coutHT, retributionUnique, rentabilite, autoconsommation, profilConsommation } from "../src/solairePV.js";

const lat = 46.5, lon = 6.68; // Lutry
const pos = positionsHoraires(lat, lon);
const st = normaleProche(2543000, 1150000, 500);
const serie = anneeType(st, pos);
const specifique = (inclinaison, azimut) => productionPV(serie, [{ kWc: 1, inclinaison, azimut }], pos).kWh.med;

test("station de référence la plus proche de Lutry : Pully", () => assert.equal(st.abr, "PUY"));

test("rendement spécifique dégagé : ordres de grandeur PVGIS pour le bassin lémanique", () => {
  const sud30 = specifique(30, 180), plat = specifique(0, 180), nord30 = specifique(30, 0), est30 = specifique(30, 90), facade = specifique(90, 180);
  console.log({ sud30, plat, nord30, est30, facade });
  assert.ok(sud30 > 1100 && sud30 < 1400, `sud 30° : ${sud30}`);
  assert.ok(plat < sud30 && plat > 0.8 * sud30);
  assert.ok(est30 < sud30 && est30 > 0.75 * sud30);
  assert.ok(nord30 < 0.75 * sud30 && nord30 > 0.4 * sud30);
  assert.ok(facade < 0.8 * sud30);
});

test("ombre totale : seul le diffus reste", () => {
  const f = new Float32Array(365 * 24);
  const r = productionPV(serie, [{ kWc: 1, inclinaison: 30, azimut: 180, f }], pos).kWh.med;
  assert.ok(r < 0.55 * specifique(30, 180));
});

test("vue du ciel inclinée sans masque = (1 + cos b) / 2", () => {
  const m = new Float32Array(720);
  assert.ok(Math.abs(vueCielInclinee(m, 1, 30, 180) - (1 + Math.cos(Math.PI / 6)) / 2) < 0.02);
  assert.ok(Math.abs(vueCielInclinee(m, 1, 0, 180) - 1) < 0.01);
});

test("coût, rétribution unique, retour", () => {
  assert.equal(Math.round(coutHT(10)), 21558);
  assert.equal(retributionUnique(10), 3600);
  assert.equal(retributionUnique(40), 30 * 360 + 10 * 300);
  assert.equal(retributionUnique(1.5), 0);
  const r = rentabilite(10, 11000, 3500);
  assert.ok(r.retour > 5 && r.retour < 25, `retour ${r.retour}`);
  assert.ok(Math.abs(r.net - (r.brut - r.ru)) < 1e-6);
});

test("profil de consommation : total exact, autoconsommation bornée", () => {
  const c = profilConsommation(4500);
  assert.ok(Math.abs(c.reduce((a, b) => a + b, 0) - 4500) < 1e-3);
  const h = productionPV(serie, [{ kWc: 10, inclinaison: 30, azimut: 180 }], pos).horaire;
  const a = autoconsommation(h, 4500);
  assert.ok(a.auto > 0.15 * a.prod && a.auto < 0.5 * a.prod, `${a.auto} / ${a.prod}`);
});

test("orientation d'un plan : pente vers le sud à 30°", () => {
  const t = Math.tan(Math.PI / 6), o = orientationPlan(0, t); // monte vers le nord
  assert.ok(Math.abs(o.inclinaison - 30) < 1e-6 && Math.abs(o.azimut - 180) < 1e-6);
  assert.ok(Math.abs(orientationPlan(t, 0).azimut - 270) < 1e-6); // monte vers l'est : regarde l'ouest
});

test("toit à deux pans 12 × 8 m : deux pans, modules en rangées", () => {
  const G = { n: 200, c: 0.5, x0: -50 }, t = Math.tan(30 * Math.PI / 180), z = y => 500 + 4 * t - Math.abs(y) * t;
  const P = (x, y) => [x, y, z(y)], tri = [];
  for (const [ya, yb] of [[-4, 0], [0, 4]]) tri.push(...P(-6, ya), ...P(6, ya), ...P(6, yb), ...P(-6, ya), ...P(6, yb), ...P(-6, yb));
  const pans = pansMaillage(G, tri);
  assert.equal(pans.length, 2);
  const sud = pans.find(p => Math.abs(p.azimut - 180) < 1);
  assert.ok(sud && Math.abs(sud.inclinaison - 30) < 0.5 && Math.abs(sud.aire - 48 / Math.cos(Math.PI / 6)) < 3);
  const { modules } = implanter(G, sud, { marge: 0.3 });
  assert.ok(modules.length >= 12 && modules.length <= 24, `${modules.length}`);
  const plat = pansMaillage(G, [...P(-6, -4).slice(0, 2), 500, 6, -4, 500, 6, 4, 500, -6, -4, 500, 6, 4, 500, -6, 4, 500])[0];
  assert.ok(plat.inclinaison < 1);
  const s = implanter(G, plat, { marge: 0.5, plat: "sud" }).modules.length, eo = implanter(G, plat, { marge: 0.5, plat: "eo" }).modules.length;
  assert.ok(eo > s && s > 0, `sud ${s}, est-ouest ${eo}`);
});
