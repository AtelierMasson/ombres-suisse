// Export PDF A4 (Pro) des panneaux solaires d'un toit : vue de dessus (carte de chaleur, modules), pans, production par
// mois, coûts, rétribution unique, autoconsommation, temps de retour, hypothèses et sources. Même mise en page que
// l'export de la piscine (exportZones.js : jsPDF et svg2pdf chargés à la demande, police Inter).
import { t, nombre, entier, date } from "./i18n.js";
import { versWgs } from "./geo.js";
import { base64 } from "./exportZones.js";
import { MODULE } from "./solairePV.js";
import { svgProductionMois, imageToit, ECHELLE } from "./graphiquesSolaire.js";

const ENCRE = "#26313b", DOUX = "#66727f";
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const direction = az => t(`sol.dir.${DIRECTIONS[Math.round(((az % 360) + 360) % 360 / 45) % 8]}`);

export async function pdfSolaire({ r, R, S, G, lieu, volume }) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const [reg, gras] = await Promise.all([base64("/polices/Inter-Regular.ttf"), base64("/polices/Inter-Bold.ttf")]);
  pdf.addFileToVFS("Inter-Regular.ttf", reg); pdf.addFont("Inter-Regular.ttf", "Inter", "normal");
  pdf.addFileToVFS("Inter-Bold.ttf", gras); pdf.addFont("Inter-Bold.ttf", "Inter", "bold");
  const M = 15, L = 210 - 2 * M;
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
  const xs = r.xy.map(p => p[0]), ys = r.xy.map(p => p[1]);
  const E = S.E0 + (Math.min(...xs) + Math.max(...xs)) / 2, N = S.N0 + (Math.min(...ys) + Math.max(...ys)) / 2, [lon, lat] = versWgs(E, N);
  const P = r.prod, Ec = r.eco, actifs = r.pans.filter(p => p.actif && p.nModules);

  // ---------------------------------------------------------------- page 1 : le toit et la production
  police(9, "bold", DOUX); pdf.text("Topograph", M, M);
  police(16, "bold"); pdf.text(t("sol.pdfTitre"), M, M + 8);
  police(10); let y = texte(lieu, M, M + 14);
  police(8, "normal", DOUX);
  y = texte(t("piscine.pdfCoord", { E: Math.round(E), N: Math.round(N), lat: lat.toFixed(5), lon: lon.toFixed(5), date: date(new Date(), { day: "numeric", month: "long", year: "numeric" }) }), M, y);
  y += 3;
  const cv = imageToit(G, r.pans, r.xy.map(([x, yy], q) => ({ x, y: yy, v: r.valeurs[q], pan: r.panDe[q] })), actifs.flatMap(p => p.modules), { px: 12, pas: r.pas });
  const hI = Math.min(70, 95 * cv.height / cv.width), wI = hI * cv.width / cv.height;
  pdf.addImage(cv.toDataURL("image/jpeg", 0.9), "JPEG", M, y, wI, hI);
  police(7, "normal", DOUX); const yLeg = texte(t("sol.pdfImage", { min: entier(ECHELLE[0]), max: entier(ECHELLE[1]) }), M, y + hI + 4, { largeur: wI, interligne: 3.2 });
  const xm = M + wI + 7;
  let ym = y + 3;
  const mesure = (nom, val) => { police(7.5, "normal", DOUX); pdf.text(nom, xm, ym); police(11, "bold"); pdf.text(val, xm, ym + 5); ym += 12; };
  mesure(t("sol.production"), `${entier(P.kWh.med)} kWh`);
  mesure(t("sol.puissance"), `${nombre(r.kWc, 1)} kWc`);
  mesure(t("sol.specifique"), `${entier(P.kWh.med / r.kWc)} kWh/kWc`);
  mesure(t("sol.pdfModules"), `${r.nModules} × ${R.Wc} Wc`);
  if (Ec) mesure(t("sol.retour"), Ec.retour != null ? t("sol.ans", { n: nombre(Ec.retour, 1) }) : t("sol.jamais", { n: R.duree }));
  y = Math.max(yLeg + 4, ym + 4);
  // pans
  police(10, "bold"); pdf.text(t("sol.pdfPans"), M, y); y += 5;
  const col = [M, M + 38, M + 58, M + 80, M + 100, M + 125, M + 152];
  police(7.5, "bold", DOUX);
  [t("sol.colPan"), t("sol.colPente"), t("sol.colSurface"), t("sol.colModules"), "kWc", t("sol.colSpec"), "kWh"].forEach((s, k) => pdf.text(s, col[k], y));
  y += 4.5; police(8.5);
  for (const p of r.pans) {
    if (y > 250) break;
    pdf.setTextColor(p.actif && p.nModules ? ENCRE : DOUX);
    pdf.text(`${direction(p.azimut)}${p.inclinaison < 5 ? "" : ` (${entier(p.azimut)}°)`}`, col[0], y);
    pdf.text(p.inclinaison < 5 ? t("sol.plat") : `${entier(p.inclinaison)}°`, col[1], y);
    pdf.text(`${nombre(p.aire, 0)} m²`, col[2], y);
    pdf.text(String(p.actif ? p.nModules : 0), col[3], y);
    pdf.text(nombre(p.actif ? p.kWc : 0, 1), col[4], y);
    pdf.text(entier(p.specifique), col[5], y);
    pdf.text(entier(p.actif ? p.kWh : 0), col[6], y);
    y += 4.5;
  }
  y += 3;
  police(10, "bold"); pdf.text(t("sol.moisTitre"), M, y);
  y = await svg(svgProductionMois(P.mois, { encre: ENCRE, police: "Inter", taille: 5.5 }), M, y + 2, 165);
  police(7.5, "normal", DOUX);
  const source = r.meteo
    ? t("sol.sourceMeteo", { nom: r.meteo.station.nom, km: nombre(r.meteo.station.km, 1), n: P.annees.length }) + " " + t("sol.fourchette", { p10: entier(P.kWh.p10), p90: entier(P.kWh.p90), annees: `${P.annees[0]}–${P.annees[P.annees.length - 1]}` })
    : t("sol.sourceNormale", { nom: r.normale.nom });
  texte(source, M, y + 3, { interligne: 3.4 });

  // ---------------------------------------------------------------- page 2 : économie, hypothèses
  pdf.addPage();
  y = M;
  police(12, "bold"); pdf.text(t("sol.ecoTitre"), M, y + 4); y += 11;
  if (Ec) {
    const ligne = (k, v, gras = false) => { police(9, gras ? "bold" : "normal"); pdf.text(k, M, y); pdf.text(v, M + 120, y, { align: "right" }); y += 5.2; };
    ligne(t("sol.coutBrut", { kwc: nombre(r.kWc, 1) }), `CHF ${entier(Ec.brut)}`);
    ligne(t("sol.ru"), `− CHF ${entier(Ec.ru)}`);
    if (Ec.impot) ligne(t("sol.impot"), `− CHF ${entier(Ec.impot)}`);
    pdf.setDrawColor(200); pdf.line(M, y - 3.5, M + 120, y - 3.5);
    ligne(t("sol.net"), `CHF ${entier(Ec.net)}`, true);
    y += 2;
    ligne(t("sol.production"), `${entier(P.kWh.med)} kWh`);
    ligne(t("sol.autoconso"), `${entier(Ec.auto)} kWh (${nombre(Ec.partAuto * 100, 0)} %)`);
    ligne(t("sol.injecte"), `${entier(Ec.injecte)} kWh`);
    ligne(t("sol.gainAn"), `CHF ${entier(Ec.gain1)}`);
    ligne(t("sol.retour"), Ec.retour != null ? t("sol.ans", { n: nombre(Ec.retour, 1) }) : t("sol.jamais", { n: R.duree }), true);
    ligne(t("sol.bilan", { n: R.duree }), `CHF ${entier(Ec.bilan)}`);
    ligne(t("sol.lcoe"), `${nombre(Ec.lcoe * 100, 1)} ct/kWh`);
    y += 4;
  }
  police(10, "bold"); pdf.text(t("sol.pdfHypotheses"), M, y); y += 5;
  police(8);
  const hyp = [
    t("sol.pdfHyp1", { wc: R.Wc, L: nombre(MODULE.L, 2), l: nombre(MODULE.l, 2), marge: nombre(R.marge, 1), plat: t(R.plat === "eo" ? "sol.platEO" : "sol.platSud") }),
    t("sol.pdfHyp2"),
    t("sol.pdfHyp3", { conso: entier(R.consommation), achat: nombre(R.achat, 2), reprise: nombre(R.reprise, 2) }),
    t("sol.pdfHyp4", { prix: R.prixKWc ? t("sol.pdfPrixImpose", { p: entier(R.prixKWc) }) : t("sol.pdfPrixRegression"), pose: t(R.integree ? "sol.integree" : "sol.ajoutee"), fiscal: nombre(R.fiscal * 100, 0) }),
    t("sol.pdfHyp5", { duree: R.duree, degr: nombre(R.degradation * 100, 1), expl: nombre(R.exploitation * 100, 1) }),
  ];
  for (const l of hyp) y = texte(`• ${l}`, M, y, { interligne: 3.6 }) + 0.6;
  y += 2;
  police(8, "bold"); y = texte(t("piscine.pdfLimitesTitre"), M, y);
  police(7.5, "normal", DOUX); y = texte(t(volume ? "sol.pdfLimitesVolume" : "sol.pdfLimites"), M, y, { interligne: 3.4 });
  const n = pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p);
    police(6.5, "normal", DOUX);
    texte(t("sol.pdfSources"), M, 297 - 15, { interligne: 2.8, largeur: L - 20 });
    pdf.text(`${p} / ${n}`, 210 - M, 297 - 8, { align: "right" });
  }
  return pdf.output("blob");
}
