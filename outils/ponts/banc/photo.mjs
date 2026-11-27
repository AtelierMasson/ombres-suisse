// node photo.mjs <site> <x> <y> <demi> <sortie.jpg> [px = 800] : orthophoto SWISSIMAGE (WMS public) autour d'un point relatif au centre du site
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CACHE } from "./sites.mjs";
const [site, xs, ys, ds, sortie, ps] = process.argv.slice(2), meta = JSON.parse(readFileSync(`${CACHE}/${site}.json`, "utf8"));
const E = meta.E0 + +xs, N = meta.N0 + +ys, d = +ds, px = +(ps || 800);
const u = `https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:2056&BBOX=${E - d},${N - d},${E + d},${N + d}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/jpeg`;
const r = await fetch(u);
if (!r.ok) throw new Error("WMS " + r.status);
mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, Buffer.from(await r.arrayBuffer()));
console.log(sortie, r.headers.get("content-type"));
