// Moyennes mensuelles 2020–2025 (global horizontal, part diffuse, température) des stations SwissMetNet, pour
// solairePV.js NORMALES. Source : MétéoSuisse (Open Government Data, CC BY).
// Préparer un dossier avec meta.csv (ogd-smn_meta_stations.csv) et un fichier <abr>.csv par station
// (ogd-smn_<abr>_h_historical_2020-2029.csv, sur data.geo.admin.ch/ch.meteoschweiz.ogd-smn/<abr>/), puis :
//   node outils/solaire/normales.mjs <dossier>
import fs from "fs";
const dir = process.argv[2];
const meta = new TextDecoder("latin1").decode(fs.readFileSync(dir + "/meta.csv")).trim().split(/\r?\n/);
const mh = meta[0].split(";"), mi = n => mh.indexOf(n);
const M = Object.fromEntries(meta.slice(1).map(l => l.split(";")).map(v => [v[mi("station_abbr")].toLowerCase(), v]));
const out = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".csv") && f !== "meta.csv")) {
  const s = f.slice(0, -4), L = fs.readFileSync(dir + "/" + f, "latin1").split("\n"), h = L[0].split(";");
  const iT = h.indexOf("reference_timestamp"), iG = h.indexOf("gre000h0"), iD = h.indexOf("ods000h0"), iTa = h.indexOf("tre200h0");
  const acc = {};
  for (const l of L.slice(1)) {
    const v = l.split(";"); if (v.length < 5) continue;
    const ts = v[iT], an = +ts.slice(6, 10), m = +ts.slice(3, 5) - 1; const k = an * 12 + m;
    const a = acc[k] ||= [0, 0, 0, 0, 0, 0, 0];
    const G = v[iG] === "" ? NaN : +v[iG], D = v[iD] === "" ? NaN : +v[iD], T = v[iTa] === "" ? NaN : +v[iTa];
    a[6]++;
    if (!isNaN(G)) { a[0] += G; a[5]++; if (!isNaN(D)) { a[1] += D; a[2] += G; } }
    if (!isNaN(T)) { a[3] += T; a[4]++; }
  }
  const G = Array(12).fill(0), Dp = Array(12).fill(0), T = Array(12).fill(0), n = Array(12).fill(0), nd = Array(12).fill(0);
  for (const [k, a] of Object.entries(acc)) {
    const an = Math.floor(k / 12), m = k % 12; if (an < 2020 || an > 2025) continue;
    const jours = new Date(Date.UTC(an, m + 1, 0)).getUTCDate();
    if (a[5] < 0.9 * jours * 24) continue;
    G[m] += a[0] / a[5] * 24 * jours / 1000; T[m] += a[3] / a[4]; n[m]++;
    if (a[2] > 0) { Dp[m] += a[1] / a[2]; nd[m]++; }
  }
  const v = M[s];
  out.push({ abr: s.toUpperCase(), nom: v[mi("station_name")], E: +v[mi("station_coordinates_lv95_east")], N: +v[mi("station_coordinates_lv95_north")], alt: +v[mi("station_height_masl")],
    G: G.map((x, m) => Math.round(x / n[m] * 10) / 10), fd: Dp.map((x, m) => nd[m] ? Math.round(x / nd[m] * 100) / 100 : null), T: T.map((x, m) => Math.round(x / n[m] * 10) / 10), annees: Math.min(...n) });
}
for (const o of out) console.log(JSON.stringify(o) + ", // " + Math.round(o.G.reduce((a, b) => a + b)) + " kWh/m2");
