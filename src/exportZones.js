// Export PDF A4 (Pro) de la zone piscine : vue de dessus avec la carte des heures de soleil, mesures, heures par
// semaine, ensoleillement par mois (ciel clair contre réel), température de l'eau, chauffage, hypothèses et sources.
// jsPDF et svg2pdf sont chargés à la demande (comme coupePdf) ; police Inter (licence OFL, public/polices, sous-ensemble
// latin de ~23 Ko par graisse) pour garder les accents en français, allemand et italien.
import { t, nombre, entier, date } from "./i18n.js";
import { versWgs } from "./geo.js";
import { svgSemaines, svgMois, svgTemperature, imageZone } from "./graphiquesPiscine.js";

const ENCRE = "#26313b", DOUX = "#66727f";

async function base64(url) {
  const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function pdfPiscine({ z, r, reglages, S, lieu, G, chauffage }) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const [reg, gras] = await Promise.all([base64("/polices/Inter-Regular.ttf"), base64("/polices/Inter-Bold.ttf")]);
  pdf.addFileToVFS("Inter-Regular.ttf", reg); pdf.addFont("Inter-Regular.ttf", "Inter", "normal");
  pdf.addFileToVFS("Inter-Bold.ttf", gras); pdf.addFont("Inter-Bold.ttf", "Inter", "bold");
  const M = 15, L = 210 - 2 * M, duree = v => { const m = Math.round(v * 60); return t("duree", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }); };
  const police = (taille, style = "normal", couleur = ENCRE) => { pdf.setFont("Inter", style); pdf.setFontSize(taille); pdf.setTextColor(couleur); };
  const texte = (s, x, y, o = {}) => { const l = pdf.splitTextToSize(String(s), o.largeur || L); pdf.text(l, x, y, o.align ? { align: o.align } : undefined); return y + l.length * (o.interligne || 4.2); };
  const svg = async (s, x, y, w) => {
    const el = new DOMParser().parseFromString(s, "image/svg+xml").documentElement, vb = el.getAttribute("viewBox").split(" ").map(Number);
    const h = w * vb[3] / vb[2], hote = document.createElement("div");
    hote.style.cssText = "position:absolute;left:-99999px;top:0";
    hote.append(document.importNode(el, true));
    document.body.append(hote);
    try { await svg2pdf(hote.firstChild, pdf, { x, y, width: w, height: h }); } finally { hote.remove(); }
    return y + h;
  };
  const opts = { encre: ENCRE, police: "Inter", taille: 5.5 };
  const xs = z.anneaux[0].map(p => p[0]), ys = z.anneaux[0].map(p => p[1]);
  const E = xs.reduce((a, b) => a + b) / xs.length, N = ys.reduce((a, b) => a + b) / ys.length, [lon, lat] = versWgs(E, N);
  const sem = r.sem, part = sem.saison.possibles ? sem.saison.recues / sem.saison.possibles : 0, a = r.temp.analyse, st = r.temp.station;

  // ---------------------------------------------------------------- page 1 : la zone et l'ensoleillement
  police(9, "bold", DOUX); pdf.text("Topograph", M, M);
  police(16, "bold"); pdf.text(t("piscine.pdfTitre"), M, M + 8);
  police(10); let y = texte(`${z.nom} · ${lieu}`, M, M + 14);
  police(8, "normal", DOUX);
  y = texte(t("piscine.pdfCoord", { E: Math.round(E), N: Math.round(N), lat: lat.toFixed(5), lon: lon.toFixed(5), date: date(new Date(), { day: "numeric", month: "long", year: "numeric" }) }), M, y);
  y += 3;
  // vue de dessus : relief ombré, bâtiments, arbres et heures de soleil de chaque point (moyenne mai–septembre)
  const cv = imageZone(G, r.anneaux, r.xy, sem.parPointSaison, sem.saison.possibles, { px: 12 });
  const wI = 95, hI = Math.min(75, wI * cv.height / cv.width), wI2 = hI * cv.width / cv.height;
  pdf.addImage(cv.toDataURL("image/jpeg", 0.9), "JPEG", M, y, wI2, hI);
  police(7, "normal", DOUX); const yLegende = texte(t("piscine.pdfImage", { max: duree(sem.saison.possibles) }), M, y + hI + 4, { largeur: wI2, interligne: 3.2 });
  // mesures, à droite de l'image
  const xm = M + wI2 + 7, lm = 210 - M - xm;
  let ym = y + 3;
  const mesure = (nom, val) => { police(7.5, "normal", DOUX); pdf.text(nom, xm, ym); police(11, "bold"); pdf.text(val, xm, ym + 5); ym += 12; };
  mesure(t("piscine.saison"), duree(sem.saison.recues) + t("heures.parJour"));
  mesure(t("piscine.annee"), duree(sem.recues.reduce((s, v) => s + v, 0) / 52) + t("heures.parJour"));
  mesure(t("piscine.partSoleil"), `${nombre(part * 100, 0)} %`);
  mesure(t("piscine.pdfAire"), `${nombre(r.aire, 1)} m²`);
  mesure(t("piscine.pdfEau"), `${nombre(r.z0, 2)} m`);
  mesure(t("piscine.pdfCiel"), `${nombre(r.svf * 100, 0)} %`);
  police(7, "normal", DOUX); texte(t("piscine.pdfSource." + z.source), xm, ym, { largeur: lm, interligne: 3.2 });
  y = Math.max(yLegende + 5, ym + 8);
  police(10, "bold"); pdf.text(t("piscine.semainesTitre"), M, y);
  y = await svg(svgSemaines(sem.recues, sem.possibles, opts), M, y + 2, 165);
  police(7, "normal", DOUX); y = texte(`${t("piscine.legRecu")} · ${t("piscine.legPossible")}`, M, y + 2);
  y += 3;
  police(10, "bold"); pdf.text(t("piscine.moisTitre"), M, y);
  y = await svg(svgMois(r.temp.mois, opts), M, y + 2, 165);
  const sais = r.temp.mois.filter(m => m.m >= 4 && m.m <= 8), clair = sais.reduce((s, m) => s + m.clair, 0) / 5, reel = sais.reduce((s, m) => s + m.med, 0) / 5;
  police(7.5, "normal", DOUX);
  texte(`${t("piscine.moisResume", { clair: duree(clair), reel: duree(reel), p: nombre(reel / clair * 100, 0) })} ${t("piscine.pdfMoisMethode")}`, M, y + 3, { interligne: 3.4 });

  // ---------------------------------------------------------------- page 2 : l'eau et le chauffage
  pdf.addPage();
  y = M;
  police(12, "bold"); pdf.text(t("piscine.courbeTitre"), M, y + 4);
  police(8, "normal", DOUX);
  y = texte(t("piscine.station", { nom: st.nom, km: nombre(st.km, 1), alt: entier(st.alt), annees: `${a.annees[0]}–${a.annees[a.annees.length - 1]}`, n: a.annees.length }), M, y + 10);
  y = await svg(svgTemperature(a.semaines, reglages.seuil, opts), M, y + 1, L);
  police(7, "normal", DOUX); y = texte(`${t("piscine.legMediane")} · ${t("piscine.pdfBande")} · ${t("piscine.legSansOmbre")}`, M, y + 2);
  police(9); y = texte(t("piscine.pdfJours", { seuil: reglages.seuil, med: nombre(a.jours.med, 0), p10: nombre(a.jours.p10, 0), p90: nombre(a.jours.p90, 0), so: nombre(a.joursSansOmbre.med, 0) }), M, y + 3);
  y += 4;
  // chauffage
  police(12, "bold"); pdf.text(t("piscine.chauffTitre"), M, y + 2); y += 8;
  const cop = reglages.energie === "direct" ? 1 : Math.max(1, reglages.cop), chf = k => k / cop * reglages.prix;
  const col = [M, M + 40, M + 85, M + 130];
  police(8, "bold", DOUX);
  [t("piscine.pdfMois"), t("piscine.sansBache"), t("piscine.avecBache"), t("piscine.pdfPuissance")].forEach((s, k) => pdf.text(s, col[k], y));
  y += 5;
  police(9);
  chauffage.sans.mois.forEach((m, k) => {
    const b = chauffage.avec.mois[k];
    pdf.text(date(new Date(Date.UTC(2025, m.m, 15)), { month: "long" }), col[0], y);
    pdf.text(`${entier(m.kWh.med)} kWh`, col[1], y); pdf.text(`${entier(b.kWh.med)} kWh`, col[2], y);
    pdf.text(`${nombre(m.W.med / 1000, 1)} / ${nombre(b.W.med / 1000, 1)} kW`, col[3], y);
    y += 5;
  });
  pdf.setDrawColor(200); pdf.line(M, y - 3, 210 - M, y - 3);
  police(9, "bold");
  pdf.text(t("piscine.saisonTotal"), col[0], y + 1);
  pdf.text(`${entier(chauffage.sans.kWh.med)} kWh`, col[1], y + 1); pdf.text(`${entier(chauffage.avec.kWh.med)} kWh`, col[2], y + 1);
  y += 6;
  pdf.text(t("piscine.cout"), col[0], y);
  pdf.text(`CHF ${entier(chf(chauffage.sans.kWh.med))}`, col[1], y); pdf.text(`CHF ${entier(chf(chauffage.avec.kWh.med))}`, col[2], y);
  y += 5;
  police(7.5, "normal", DOUX);
  y = texte(t("piscine.noteChauffage", { consigne: chauffage.consigne, mise: entier(chauffage.sans.miseEnTemp.med), cop: nombre(cop, 1), prix: nombre(reglages.prix, 2) })
    + " " + t("piscine.pdfFourchette", { p10: entier(chauffage.sans.kWh.p10), p90: entier(chauffage.sans.kWh.p90) }), M, y, { interligne: 3.4 });
  y += 4;
  // hypothèses
  police(10, "bold"); pdf.text(t("piscine.pdfHypotheses"), M, y); y += 5;
  police(8);
  const hyp = [
    t("piscine.pdfHyp1", { prof: nombre(reglages.profondeur, 1), vol: entier(r.aire * reglages.profondeur), fond: t(reglages.fond === "fonce" ? "piscine.fondFonce" : "piscine.fondClair") }),
    t("piscine.pdfHyp2", { bache: t(reglages.bache === "nuit" ? "piscine.bacheNuit" : "piscine.bacheAucune"), vent: t({ abritee: "piscine.ventAbritee", normal: "piscine.ventNormal", exposee: "piscine.ventExposee" }[reglages.vent] || "piscine.ventNormal") }),
    t("piscine.pdfHyp3", { corr: nombre(r.temp.correctionT, 1) }),
    t("piscine.pdfHyp4"),
    t("piscine.pdfHyp5", { energie: t(reglages.energie === "direct" ? "piscine.direct" : "piscine.pac"), cop: nombre(cop, 1), prix: nombre(reglages.prix, 2) }),
  ];
  for (const l of hyp) y = texte(`• ${l}`, M, y, { interligne: 3.6 }) + 0.6;
  y += 2;
  police(8, "bold"); y = texte(t("piscine.pdfLimitesTitre"), M, y);
  police(7.5, "normal", DOUX); y = texte(t("piscine.pdfLimites"), M, y, { interligne: 3.4 });
  // pied de page
  const n = pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p);
    police(6.5, "normal", DOUX);
    texte(t("piscine.pdfSources"), M, 297 - 13, { interligne: 2.8, largeur: L - 20 });
    pdf.text(`${p} / ${n}`, 210 - M, 297 - 8, { align: "right" });
  }
  return pdf.output("blob");
}
