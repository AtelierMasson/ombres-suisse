// Petit récepteur local pour enregistrer sur le disque les rendus faits dans le navigateur (calage photo / maquette).
//   node outils/ponts/recepteur.mjs <dossier> [port = 5391]
// Le navigateur envoie : fetch("http://localhost:5391/nom.jpg", { method: "POST", body: dataURL }) ; seul localhost écoute.
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const [dossier, port = 5391] = process.argv.slice(2);
mkdirSync(dossier, { recursive: true });
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Headers", "*"); res.end(); return; }
  if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
  const morceaux = [];
  req.on("data", c => morceaux.push(c));
  req.on("end", () => {
    const texte = Buffer.concat(morceaux).toString();
    const nom = basename(decodeURIComponent(req.url.slice(1))) || "rendu.jpg";
    const b64 = texte.replace(/^data:[^,]*,/, "");
    writeFileSync(join(dossier, nom), Buffer.from(b64, "base64"));
    res.end("ok");
    console.log("enregistré", nom);
  });
}).listen(+port, "127.0.0.1", () => console.log(`récepteur sur http://localhost:${port} → ${dossier}`));
