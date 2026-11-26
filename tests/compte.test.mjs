// Logique client du compte (état, événements, mode muet) sans navigateur : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { brancherCompte } from "../src/compte.js";

const reponse = (status, corps = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => corps });
const avecFetch = f => { globalThis.fetch = f; };

test("API absente : module muet, exigerPro renvoie false", async () => {
  avecFetch(async () => { throw new TypeError("réseau"); });
  const c = brancherCompte({ api: "/api" });
  let evenements = 0;
  c.addEventListener("compte", () => evenements++);
  await c.pret;
  assert.equal(c.disponible(), false);
  assert.deepEqual(c.etat(), { connecte: false, email: null, pro: false });
  assert.equal(c.exigerPro("export"), false);
  assert.equal(evenements, 0);
});

test("404 (site statique) : muet aussi", async () => {
  avecFetch(async () => reponse(404));
  const c = brancherCompte({});
  await c.pret;
  assert.equal(c.disponible(), false);
});

test("déconnecté (401) puis connecté gratuit puis pro : un événement par changement", async () => {
  let moi = reponse(401, { erreur: "non_connecte" });
  const appels = [];
  avecFetch(async (url, o) => { appels.push([url, o.credentials]); return moi; });
  const c = brancherCompte({ api: "https://exemple.ch/api" });
  const recus = [];
  c.addEventListener("compte", e => recus.push(e.detail));
  await c.pret;
  assert.equal(c.disponible(), true);
  assert.deepEqual(recus, [{ connecte: false, email: null, pro: false }]);
  assert.deepEqual(appels[0], ["https://exemple.ch/api/moi.php", "include"]);

  moi = reponse(200, { email: "a@b.ch", pro: false });
  await c.relire();
  await c.relire(); // même état : pas de nouvel événement
  assert.equal(recus.length, 2);
  assert.deepEqual(c.etat(), { connecte: true, email: "a@b.ch", pro: false });

  moi = reponse(200, { email: "a@b.ch", pro: true });
  await c.relire();
  assert.equal(recus.length, 3);
  assert.equal(recus[2].pro, true);
  assert.equal(c.exigerPro("export"), true);

  // etat() renvoie une copie
  c.etat().pro = false;
  assert.equal(c.etat().pro, true);
});
