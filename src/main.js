import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
import { chercher, parcelleEn, tuilesNuage, tuilesGrille, urlOrthophoto, versWgs } from "./geo.js";
import { chargerNuage } from "./nuage.js";
import { depuisPoints, depuisRasters } from "./grille.js";
import { Scene3D } from "./scene.js";
import { positionSoleil, directionSoleil, dateA } from "./soleil.js";
import { profilHorizon, horizonA } from "./horizon.js";
import { dessinerDiagramme, soleilVisible } from "./diagramme.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const S = { jour: aujourdhui(), minutes: arrondi(new Date().getHours() * 60 + new Date().getMinutes()) };
const scene = new Scene3D($("#vue"));

function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function arrondi(m) { return Math.round(m / 5) * 5; }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* ------------------------------------------------------------------ recherche */
let ctrl, choix = [];
$("#q").addEventListener("input", () => {
  clearTimeout(ctrl?.t);
  const q = $("#q").value.trim();
  if (q.length < 2) { $("#suggestions").hidden = true; return; }
  ctrl?.abort?.();
  const c = ctrl = new AbortController();
  c.t = setTimeout(async () => {
    try {
      choix = await chercher(q, c.signal);
      $("#suggestions").innerHTML = choix.map((r, k) =>
        `<button type="button" class="list-group-item list-group-item-action" data-k="${k}"><span class="badge text-bg-light me-2">${r.type}</span>${echap(r.label)}</button>`).join("")
        || `<div class="list-group-item text-secondary">Aucun résultat</div>`;
      $("#suggestions").hidden = false;
    } catch (e) { if (e.name !== "AbortError") console.error(e); }
  }, 250);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Enter" && choix[0]) aller(choix[0]); if (e.key === "Escape") $("#suggestions").hidden = true; });
$("#suggestions").addEventListener("mousedown", e => { const b = e.target.closest("[data-k]"); if (b) aller(choix[+b.dataset.k]); });
$("#q").addEventListener("blur", () => setTimeout(() => $("#suggestions").hidden = true, 150));
const echap = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function aller(r) {
  $("#suggestions").hidden = true;
  $("#q").value = r.label;
  location.hash = `e=${Math.round(r.E)}&n=${Math.round(r.N)}&l=${encodeURIComponent(r.label)}&t=${r.type}`;
}
window.addEventListener("hashchange", depuisAdresse);

/* ------------------------------------------------------------------ chargement d'un lieu */
let tache = 0;
function etat(f, texte) {
  $("#etat").hidden = f >= 1;
  $("#etatTexte").textContent = texte;
  $("#etatBarre").style.width = `${Math.round(f * 100)}%`;
}

async function depuisAdresse() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get("e")) return;
  const E = +h.get("e"), N = +h.get("n"), id = ++tache;
  $("#accueil").hidden = true; $("#infos").hidden = false; $("#commandes").hidden = true; $("#heures").hidden = true;
  $("#lieu").textContent = h.get("l") || `${E}, ${N}`;
  $("#lieuType").textContent = h.get("t") || "";
  $("#source").textContent = "";
  try {
    etat(0.02, "Parcelle…");
    const parcelle = await parcelleEn(E, N);
    if (id !== tache) return;
    // centre et rayon : la parcelle et ~120 m autour (bâtiments voisins, arbres)
    let E0 = E, N0 = N, demi = 20;
    if (parcelle) {
      const xs = parcelle.anneaux.flat().map(p => p[0]), ys = parcelle.anneaux.flat().map(p => p[1]);
      E0 = (Math.min(...xs) + Math.max(...xs)) / 2; N0 = (Math.min(...ys) + Math.max(...ys)) / 2;
      demi = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      $("#lieuType").textContent = `Parcelle ${parcelle.numero} · ${parcelle.canton}${h.get("t") === "Adresse" ? " · " + h.get("l") : ""}`;
      $("#lieu").textContent = (h.get("l") || "").replace(/\s*\(CH.*\)$/, "");
    } else {
      $("#message").hidden = false; $("#message").textContent = "Pas de parcelle trouvée à cet endroit : analyse autour du point.";
    }
    E0 = Math.round(E0); N0 = Math.round(N0);
    const R = Math.min(300, Math.max(150, Math.ceil(demi + 120)));
    const boite = [E0 - R, N0 - R, E0 + R, N0 + R];
    const rel = parcelle ? { ...parcelle, anneauxRel: parcelle.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) } : { anneauxRel: [] };
    [S.lon, S.lat] = versWgs(E0, N0);
    S.E0 = E0; S.N0 = N0; S.parcelle = rel;

    etat(0.05, "Recherche du relevé laser…");
    let G, nuage = null;
    const copc = await tuilesNuage(boite);
    if (copc) {
      nuage = await chargerNuage(copc, boite, [E0, N0], 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t));
      if (id !== tache) return;
      etat(0.78, "Reconstruction du terrain, des bâtiments et des arbres…");
      await pause();
      G = depuisPoints(nuage, R);
      $("#source").textContent = `Nuage de points swissSURFACE3D ${[...new Set(copc.map(t => t.annee))].join(", ")} · ${nuage.n.toLocaleString("fr-CH")} points`;
    } else {
      const g = await tuilesGrille(boite);
      G = await depuisRasters(g, [E0, N0], R, 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t));
      if (id !== tache) return;
      $("#source").textContent = `Relevé laser récent pas encore publié ici : modèles en grille 0,5 m (terrain ${[...new Set(g.terrain.map(t => t.annee))].join(", ")}, surface ${[...new Set(g.surface.map(t => t.annee))].join(", ")}). Bâtiments et arbres séparés par la forme (toit lisse, arbre rugueux) : moins fiable.`;
    }
    S.G = G;
    etat(0.85, "Construction de la scène 3D…");
    await pause();
    scene.construire(G, nuage, rel, urlOrthophoto(boite));
    appliquerAffichage();
    $("#vArbres").disabled = !nuage && !G.veg.some(v => !isNaN(v)); $("#vPoints").disabled = !nuage;

    etat(0.9, "Relief lointain (montagnes)…");
    S.horizon = await profilHorizon(E0, N0, scene.zRef + 1.7, { rayonProche: R, onProgres: (f, t) => id === tache && etat(0.9 + 0.1 * f, t) });
    if (id !== tache) return;
    etat(1, "");
    $("#commandes").hidden = false; $("#diagramme").hidden = false;
    majSoleil();
  } catch (e) {
    console.error(e);
    etat(0, "Erreur : " + e.message);
    $("#etat").hidden = false;
  }
}
const pause = () => new Promise(r => setTimeout(r, 30));

/* ------------------------------------------------------------------ soleil */
function majSoleil() {
  $("#jour").value = S.jour;
  $("#heure").value = S.minutes;
  $("#heureTexte").textContent = hhmm(S.minutes);
  if (S.lat == null) return;
  const p = positionSoleil(dateA(S.jour, S.minutes), S.lat, S.lon);
  const hz = S.horizon ? horizonA(S.horizon, p.azimut) : 0;
  const visible = p.hauteur > 0 && p.hauteur > hz;
  scene.placerSoleil(directionSoleil(p), visible);
  const etatSoleil = p.hauteur <= 0 ? "couché" : visible ? "visible" : `caché par le relief lointain (horizon à ${hz.toFixed(1)}°)`;
  $("#soleilTexte").innerHTML = `Azimut ${p.azimut.toFixed(0)}° · hauteur ${p.hauteur.toFixed(1)}° · <b>${etatSoleil}</b>`;
  if (S.horizon) {
    dessinerDiagramme($("#svgSoleil"), { horizon: S.horizon, jour: S.jour, minutes: S.minutes, lat: S.lat, lon: S.lon });
    const v = soleilVisible(S.jour, S.lat, S.lon, S.horizon);
    $("#horizonTexte").textContent = v.debut == null ? "· soleil caché toute la journée"
      : `· au-dessus des montagnes de ${hhmm(v.debut)} à ${hhmm(v.fin)} (${Math.floor(v.minutes / 60)} h ${String(v.minutes % 60).padStart(2, "0")})`;
  }
}
$("#jour").addEventListener("change", e => { if (e.target.value) { S.jour = e.target.value; majSoleil(); } });
$("#heure").addEventListener("input", e => { S.minutes = +e.target.value; majSoleil(); });
$$("[data-jour]").forEach(b => b.onclick = () => {
  S.jour = b.dataset.jour === "auj" ? aujourdhui() : `${S.jour.slice(0, 4)}-${b.dataset.jour}`;
  majSoleil();
});
let lecture = null;
$("#btnLecture").onclick = () => {
  if (lecture) { clearInterval(lecture); lecture = null; $("#btnLecture").textContent = "▶"; return; }
  $("#btnLecture").textContent = "❚❚";
  lecture = setInterval(() => { S.minutes = (S.minutes + 5) % 1440; majSoleil(); }, 60);
};

/* ------------------------------------------------------------------ affichage */
function appliquerAffichage() {
  const c = scene.couches || {};
  const mat = c.terrain?.material;
  if (mat) { mat.userData.map ??= null; if (mat.map) mat.userData.map = mat.map; mat.map = $("#vOrtho").checked ? mat.userData.map : null; mat.color.set(mat.map ? "#ffffff" : "#d9d6c8"); mat.needsUpdate = true; }
  if (c.bati) c.bati.visible = $("#vBati").checked;
  if (c.arbres) c.arbres.visible = $("#vArbres").checked;
  if (c.canopee) c.canopee.visible = $("#vArbres").checked || !c.arbres;
  if (c.tous) c.tous.visible = $("#vPoints").checked;
  if (c.heures) c.heures.visible = $("#vHeures").checked;
}
["#vOrtho", "#vBati", "#vArbres", "#vPoints", "#vHeures"].forEach(s => $(s).addEventListener("change", appliquerAffichage));
$("#vPieton").addEventListener("change", e => scene.vuePieton(e.target.checked));
$("#btnPartager").onclick = async () => { await navigator.clipboard.writeText(location.href); $("#btnPartager").textContent = "Copié"; setTimeout(() => $("#btnPartager").textContent = "Lien", 1500); };

/* ------------------------------------------------------------------ heures d'ensoleillement */
$("#btnHeures").onclick = () => {
  const G = S.G;
  if (!G || !S.horizon) return;
  const pts = S.parcelle.anneauxRel.flat();
  const marge = 10, xs = pts.length ? pts.map(p => p[0]) : [-30, 30], ys = pts.length ? pts.map(p => p[1]) : [-30, 30];
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const i0 = cl(Math.floor((Math.min(...xs) - marge - G.x0) / G.c), 0, G.n), i1 = cl(Math.ceil((Math.max(...xs) + marge - G.x0) / G.c), 0, G.n);
  const j0 = cl(Math.floor((Math.min(...ys) - marge - G.x0) / G.c), 0, G.n), j1 = cl(Math.ceil((Math.max(...ys) + marge - G.x0) / G.c), 0, G.n);
  const soleils = [];
  for (let t = 0; t < 1440; t += 10) soleils.push({ ...positionSoleil(dateA(S.jour, t + 5), S.lat, S.lon), duree: 10 / 60 });
  $("#btnHeures").disabled = true;
  const w = new Worker(new URL("./ensoleillement.worker.js", import.meta.url), { type: "module" });
  w.onmessage = ({ data }) => {
    if (data.progres != null) { etat(data.progres * 0.99, "Heures de soleil…"); $("#etat").hidden = false; return; }
    w.terminate(); etat(1, ""); $("#btnHeures").disabled = false;
    const max = Math.max(0.5, dureeMax(soleils));
    scene.afficherHeures(data, [i0, j0], max);
    // statistiques sur les cellules de la parcelle
    let s = 0, k = 0, mn = Infinity, mx = 0;
    for (let j = 0; j < data.h; j++) for (let i = 0; i < data.w; i++) {
      const x = G.x0 + (i0 + i + 0.5) * G.c, y = G.x0 + (j0 + j + 0.5) * G.c;
      if (pts.length && !dans(x, y, S.parcelle.anneauxRel)) continue;
      const v = data.heures[j * data.w + i]; s += v; k++; mn = Math.min(mn, v); mx = Math.max(mx, v);
    }
    const f = v => { const m = Math.round(v * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
    $("#heures").hidden = false;
    $("#heuresMax").textContent = f(max);
    $("#heuresStats").innerHTML = k ? `Parcelle : moyenne <b>${f(s / k)}</b> · min ${f(mn)} · max ${f(mx)}<br><span class="text-secondary">Le ${new Date(S.jour).toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}, soleil au-dessus du relief : ${f(max)}</span>` : "";
    $("#vHeures").checked = true;
    appliquerAffichage();
  };
  w.postMessage({ surface: G.surface, base: G.base, n: G.n, c: G.c, rect: [i0, j0, i1, j1], soleils, horizon: S.horizon });
};
// durée maximale possible (soleil au-dessus du relief lointain)
const dureeMax = soleils => soleils.filter(s => s.hauteur > 0.5 && s.hauteur > horizonA(S.horizon, s.azimut)).reduce((a, s) => a + s.duree, 0);
function dans(x, y, anneaux) {
  let ok = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

majSoleil();
depuisAdresse();
