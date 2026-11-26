// Export de la coupe A–B (mode pro) : DXF (qu'AutoCAD ouvre et enregistre en DWG) et SVG (Illustrator, mise en page).
// Dans le plan de la coupe : X = distance depuis A le long de A→B, Y = altitude réelle, en mètres.
// Calques : TERRAIN_COUPE, BATIMENTS_COUPES, ARBRES, NUAGE (points proches de la coupe), LIMITES_PARCELLE, COTES, CADRE.

import { t as tr, nombre } from "./i18n.js";

const alt = z => nombre(Math.round(z * 10) / 10, 1);
const ascii = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "-");
const COULEURS = { TERRAIN_COUPE: [7, "#1f2933"], BATIMENTS_COUPES: [8, "#3b4754"], ARBRES: [8, "#9aa0a6"], NUAGE: [8, "#7a7f8c"], LIMITES_PARCELLE: [1, "#e0262b"], COTES: [5, "#1d4f91"], CADRE: [9, "#66727f"] };

// points du nuage par catégorie (sol, végétation, bâtiment, autre) : couleur DXF (indice) et SVG
const POINTS = [[30, "#8a6d3b"], [3, "#3f8f3a"], [1, "#d9523a"], [8, "#7a7f8c"]];

function suites(a, k0, k1) {
  const r = [];
  let d = -1;
  for (let k = k0; k <= k1; k++) {
    if (!isNaN(a[k])) { if (d < 0) d = k; } else if (d >= 0) { r.push([d, k - 1]); d = -1; }
  }
  if (d >= 0) r.push([d, k1]);
  return r;
}

/**
 * Dessin de la coupe entre A et B, en mètres : liste de lignes { calque, pts: [x, y, …], ferme, plein } et de textes
 * { calque, x, y, h, texte, ancre }. Les cotes des bâtiments (bas, corniches, faîte, à 10 cm) sont celles du profil
 * affiché. `o` = { E0, N0, lieu, soleil ({ azimut, hauteur, visible, heure }), jour }.
 */
export function dessinCoupe(P, o) {
  const k0 = Math.max(0, Math.ceil((0 - P.s[0]) / P.pas)), k1 = Math.min(P.nb - 1, Math.floor((P.L - P.s[0]) / P.pas));
  const lignes = [], textes = [], L = P.s[k1] - P.s[k0];
  const ligne = (calque, pts, ferme = false, plein = false) => lignes.push({ calque, pts, ferme, plein });
  const texte = (calque, x, y, t, ancre = "start", h = 0.45) => textes.push({ calque, x, y, h, texte: t, ancre });
  let zmin = Infinity, zmax = -Infinity;
  for (let k = k0; k <= k1; k++) { zmin = Math.min(zmin, P.sol[k]); zmax = Math.max(zmax, P.sol[k], P.bat[k] || -Infinity, P.veg[k] || -Infinity); }
  const solA = s => P.sol[Math.max(k0, Math.min(k1, Math.round((s - P.s[0]) / P.pas)))];
  const profil = (a, b, v) => { const pts = []; for (let k = a; k <= b; k++) pts.push(P.s[k], v(k)); return pts; };
  const retour = (a, b, v) => { const pts = []; for (let k = b; k >= a; k--) pts.push(P.s[k], v(k)); return pts; };
  // arbres (silhouettes fermées), terrain coupé, bâtiments coupés (contours fermés)
  // arbres : contour fermé du sol jusqu'à la cime, comme la hachure du profil affiché
  for (const T of P.arbres || []) {
    const a = Math.max(T.a, k0), b = Math.min(T.b, k1);
    if (b <= a) continue;
    ligne("ARBRES", [...profil(a, b, k => T.haut[k - T.a]), ...retour(a, b, k => P.sol[k])], true);
  }
  ligne("TERRAIN_COUPE", profil(k0, k1, k => P.sol[k]));
  for (const [a, b] of suites(P.bat, k0, k1)) {
    if (b <= a) continue;
    ligne("BATIMENTS_COUPES", [...profil(a, b, k => P.bat[k]), ...retour(a, b, k => P.sol[k])], true, true);
    if (P.s[b] - P.s[a] < 3) continue;
    // cotes : corniches aux deux façades, faîte, point bas du terrain
    let kb = a, kf = a;
    for (let k = a; k <= b; k++) { if (P.sol[k] < P.sol[kb]) kb = k; if (P.bat[k] > P.bat[kf]) kf = k; }
    const cote = (k, z, t, ancre, dy) => {
      ligne("COTES", [P.s[k] - 0.4, z, P.s[k] + 0.4, z]);
      texte("COTES", P.s[k] + (ancre === "end" ? -0.6 : ancre === "start" ? 0.6 : 0), z + dy, t, ancre);
    };
    const za = P.bat[a], zb = P.bat[b];
    cote(a, za, tr("coupe.corniche", { z: alt(za) }), "end", 0.2);
    if (Math.abs(zb - za) >= 0.2) cote(b, zb, tr("coupe.corniche", { z: alt(zb) }), "start", 0.2);
    if (P.bat[kf] > Math.max(za, zb) + 0.3) cote(kf, P.bat[kf], tr("coupe.faite", { z: alt(P.bat[kf]) }), "middle", 0.5);
    cote(kb, P.sol[kb], tr("coupe.bas", { z: alt(P.sol[kb]) }), P.s[kb] - P.s[a] < P.s[b] - P.s[kb] ? "end" : "start", -0.9);
  }
  // limites : parcelle choisie (avec la mention), parcelles voisines (plus courtes), numéros des parcelles traversées
  for (const s of P.limites) if (s > P.s[k0] && s < P.s[k1]) {
    ligne("LIMITES_PARCELLE", [s, solA(s) - 1.5, s, solA(s) + 5]);
    texte("LIMITES_PARCELLE", s, solA(s) + 5.3, tr("coupeExport.limite"), "middle");
  }
  for (const s of P.voisines || []) if (s > P.s[k0] && s < P.s[k1]) ligne("LIMITES_PARCELLE", [s, solA(s) - 1, s, solA(s) + 2.5]);
  for (const p of P.parcelles || []) {
    const a = Math.max(p.s0, P.s[k0]), b = Math.min(p.s1, P.s[k1]);
    if (b - a >= 6) texte("LIMITES_PARCELLE", (a + b) / 2, solA((a + b) / 2) - 2.2, tr("coupeExport.parcelle", { n: p.numero }), "middle");
  }
  // cadre : niveau de référence, échelle graphique, extrémités A et B (MN95), soleil
  const bas = Math.floor(zmin - Math.max(4, L * 0.04)), haut = zmax + Math.max(4, L * 0.06), mn95 = ([x, y]) => `E ${(o.E0 + x).toFixed(1)}  N ${(o.N0 + y).toFixed(1)}`;
  ligne("CADRE", [0, bas, L, bas]);
  texte("COTES", -0.6, bas + 0.15, tr("coupeExport.niveau", { z: alt(bas) }), "end");
  const pas = [1, 2, 5, 10, 20, 50].find(v => L / v <= 12) || 100, nb = Math.min(5, Math.floor(L / pas)), ye = bas - 2.2;
  ligne("CADRE", [0, ye, nb * pas, ye]);
  for (let k = 0; k <= nb; k++) { ligne("CADRE", [k * pas, ye, k * pas, ye + 0.5]); texte("CADRE", k * pas, ye - 0.8, `${k * pas}${k === nb ? " m" : ""}`, "middle"); }
  for (const [nom, x, pt, ancre] of [[P.lettres?.[0] || "A", 0, P.A, "start"], [P.lettres?.[1] || "B", L, P.B, "end"]]) {
    ligne("CADRE", [x, bas, x, haut]);
    texte("CADRE", x + (ancre === "start" ? 0.5 : -0.5), haut - 1.2, nom, ancre, 0.9);
    texte("CADRE", x + (ancre === "start" ? 0.5 : -0.5), haut - 2.1, mn95(pt), ancre, 0.4);
  }
  texte("CADRE", 0, ye - 2.1, tr("coupeExport.cadre", { lieu: o.lieu, long: nombre(L, 1) }), "start", 0.4);
  const S = o.soleil;
  if (S?.visible) {
    // rayon du soleil vu dans le plan de coupe, depuis le milieu de la coupe
    const a = S.azimut * Math.PI / 180, h = S.hauteur * Math.PI / 180, ds = (Math.sin(a) * P.ux + Math.cos(a) * P.uy) * Math.cos(h), dz = Math.sin(h);
    const km = Math.round((k0 + k1) / 2), z0 = Math.max(P.sol[km], P.bat[km] || -Infinity), x0 = P.s[km], n = Math.hypot(ds, dz) || 1;
    let t = (haut - z0) / (dz / n);
    if (ds > 1e-6) t = Math.min(t, (L - x0) / (ds / n)); else if (ds < -1e-6) t = Math.min(t, -x0 / (ds / n));
    ligne("CADRE", [x0, z0, x0 + ds / n * t, z0 + dz / n * t]);
    texte("CADRE", 0, ye - 2.9, tr("coupeExport.soleil", { jour: o.jour, heure: S.heure, az: nombre(S.azimut, 0), h: nombre(S.hauteur, 1), angle: nombre(Math.atan2(dz, Math.abs(ds)) * 180 / Math.PI, 0) }), "start", 0.4);
  }
  // points du nuage proches de la coupe (s'ils sont affichés) : [x, y, catégorie, …]
  const points = [];
  if (P.points?.n) {
    const N = P.points;
    for (let k = 0; k < N.n; k++) if (N.s[k] >= P.s[k0] && N.s[k] <= P.s[k1]) points.push(N.s[k], N.z[k], N.c[k]);
    texte("CADRE", 0, ye - 3.7, tr("coupeExport.points", { d: nombre(N.distance, Number.isInteger(N.distance) ? 0 : String(N.distance).split(".")[1].length) }), "start", 0.4);
  }
  return { lignes, textes, points, L, bas: ye - (points.length ? 4.4 : 3.6), haut: haut + 0.5 };
}

const reel = v => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? r + ".0" : String(r); };

/** DXF (R12) de la coupe : polylignes 2D et textes, un calque par nature. Textes sans accent (le format ne les garantit pas). */
export function coupeDxf(D, infos) {
  const calques = Object.keys(COULEURS);
  let t = infos.map(l => `999\n${ascii(l)}\n`).join("")
    + `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$EXTMIN\n10\n-12.0\n20\n${reel(D.bas)}\n9\n$EXTMAX\n10\n${reel(D.L + 12)}\n20\n${reel(D.haut)}\n0\nENDSEC\n`
    + `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n`
    + `0\nTABLE\n2\nLAYER\n70\n${calques.length}\n` + calques.map(n => `0\nLAYER\n2\n${n}\n70\n0\n62\n${COULEURS[n][0]}\n6\nCONTINUOUS\n`).join("")
    + `0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`;
  for (const l of D.lignes) {
    if (l.pts.length === 4) { t += `0\nLINE\n8\n${l.calque}\n10\n${reel(l.pts[0])}\n20\n${reel(l.pts[1])}\n30\n0.0\n11\n${reel(l.pts[2])}\n21\n${reel(l.pts[3])}\n31\n0.0\n`; continue; }
    t += `0\nPOLYLINE\n8\n${l.calque}\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n${l.ferme ? 1 : 0}\n`;
    for (let k = 0; k < l.pts.length; k += 2) t += `0\nVERTEX\n8\n${l.calque}\n10\n${reel(l.pts[k])}\n20\n${reel(l.pts[k + 1])}\n30\n0.0\n`;
    t += `0\nSEQEND\n8\n${l.calque}\n`;
  }
  for (let k = 0; k < (D.points?.length || 0); k += 3)
    t += `0\nPOINT\n8\nNUAGE\n62\n${POINTS[D.points[k + 2]][0]}\n10\n${reel(D.points[k])}\n20\n${reel(D.points[k + 1])}\n30\n0.0\n`;
  for (const x of D.textes) {
    const j = x.ancre === "middle" ? 1 : x.ancre === "end" ? 2 : 0, p = k => `${10 + k}\n${reel(x.x)}\n${20 + k}\n${reel(x.y)}\n${30 + k}\n0.0\n`;
    // texte centré ou calé à droite : le point d'alignement (11) fait foi
    t += `0\nTEXT\n8\n${x.calque}\n${p(0)}40\n${reel(x.h)}\n1\n${ascii(x.texte)}\n${j ? `72\n${j}\n${p(1)}` : ""}`;
  }
  return t + "0\nENDSEC\n0\nEOF\n";
}

/** SVG de la coupe : un groupe par calque, unités en mètres (viewBox), dimensions en millimètres à l'échelle 1:200. */
export function coupeSvg(D, infos, echelle = 200) {
  const x0 = -12, w = D.L + 24, h = D.haut - D.bas, mm = 1000 / echelle, f = v => (Math.round(v * 1000) / 1000).toString();
  const xml = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  let t = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${infos.map(xml).join(" | ").replace(/--/g, "-")} -->\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * mm)}mm" height="${f(h * mm)}mm" viewBox="${f(x0)} ${f(-D.haut)} ${f(w)} ${f(h)}" font-family="Helvetica, Arial, sans-serif">\n`
    + `<title>${xml(tr("coupeExport.titreSvg", { echelle }))}</title>\n`;
  for (const [calque, [, couleur]] of Object.entries(COULEURS)) {
    t += `<g id="${calque}" fill="none" stroke="${couleur}" stroke-width="${calque === "TERRAIN_COUPE" ? 0.12 : calque === "BATIMENTS_COUPES" ? 0.08 : 0.04}" stroke-linejoin="round">\n`;
    for (const l of D.lignes) {
      if (l.calque !== calque) continue;
      let d = "";
      for (let k = 0; k < l.pts.length; k += 2) d += `${k ? "L" : "M"}${f(l.pts[k])},${f(-l.pts[k + 1])}`;
      t += `<path d="${d}${l.ferme ? "Z" : ""}"${l.plein ? ` fill="${couleur}" fill-opacity="0.25"` : calque === "ARBRES" ? ` fill="${couleur}" fill-opacity="0.3" stroke="none"` : ""}/>\n`;
    }
    if (calque === "NUAGE") for (let k = 0; k < (D.points?.length || 0); k += 3)
      t += `<circle cx="${f(D.points[k])}" cy="${f(-D.points[k + 1])}" r="0.04" fill="${POINTS[D.points[k + 2]][1]}" stroke="none"/>\n`;
    for (const x of D.textes) if (x.calque === calque)
      t += `<text x="${f(x.x)}" y="${f(-x.y)}" font-size="${f(x.h * 1.25)}" text-anchor="${x.ancre}" fill="${couleur}" stroke="none">${xml(x.texte)}</text>\n`;
    t += `</g>\n`;
  }
  return t + `</svg>\n`;
}

/**
 * PDF vectoriel de la coupe, à l'échelle du SVG (1:200 par défaut) : la page fait la taille du dessin, plus une marge,
 * un titre et les informations (lieu, points A et B, sources). jsPDF et svg2pdf ne sont chargés qu'à la demande.
 */
export async function coupePdf(svgTexte, infos, titre) {
  const [{ jsPDF }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const svg = new DOMParser().parseFromString(svgTexte, "image/svg+xml").documentElement;
  const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height")), m = 12;
  const W = Math.max(w + 2 * m, 210), H = Math.max(h + 2 * m + 22, 148);
  const pdf = new jsPDF({ unit: "mm", format: [W, H], orientation: W > H ? "landscape" : "portrait" });
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.text(ascii(titre), m, m);
  // svg2pdf a besoin de l'élément dans le document pour mesurer les textes
  const hote = document.createElement("div");
  hote.style.cssText = "position:absolute;left:-99999px;top:0";
  hote.append(document.importNode(svg, true));
  document.body.append(hote);
  try { await pdf.svg(hote.firstChild, { x: m, y: m + 6, width: w, height: h }); } finally { document.body.removeChild(hote); }
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(100);
  infos.forEach((l, i) => pdf.text(ascii(l), m, H - m + 2 - (infos.length - 1 - i) * 3.2));
  return pdf.output("blob");
}
