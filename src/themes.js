// Thèmes : chaque variante règle à la fois l'interface (variables CSS dans style.css, attribut data-theme)
// et la scène 3D (ciel, bâtiments, terrain ton sur ton, parcelle, arbres, carte des heures, coupe).
// Le terrain et le plan cadastral reteinté restent dans la gamme des bâtiments : ce sont les ombres et
// l'occlusion ambiante qui donnent le relief, comme sur une maquette.

export const THEMES = {
  maquette: {
    nom: "Maquette", resume: "Blanc cassé, ciel doux, panneau classique", sombre: false,
    pastilles: ["#f4f0e9", "#e8890c", "#bcd6ee"],
    ciel: { zenith: "#8fb8e0", horizon: "#e4eef6", nuitZenith: "#1c2738", nuitHorizon: "#4a586c" },
    lumiere: { ciel: "#f3f7ff", sol: "#a39c8c", soleil: "#fff3dc", exposition: 1.0, brume: 0.00055 },
    mur: "#f6f2eb", toit: "#ece6db", sol: "#e6e0d5", socle: "#cfc8ba",
    plan: { sol: "#e6e0d5", route: "#dcd5c8", bati: "#d8d0c2", foret: "#d9dcc6", eau: "#cfdbe2", trait: "#8f8778", force: 0.75 },
    parcelle: "#e0262b", arbres: ["#2f5d2a", "#7fae4b", "#b9c45a"], facades: "#a89f8f",
    heures: ["#264dbf", "#69a8e0", "#f2e533", "#f59324", "#e02c1a"],
    coupe: { trait: "#1f2933", bati: "#3b4754", terrain: "#b8ae9b" },
  },
  alpage: {
    nom: "Alpage", resume: "Sable et vert sapin, cartes flottantes arrondies", sombre: false,
    pastilles: ["#efe6d2", "#2f6b4f", "#cfe6dc"],
    ciel: { zenith: "#86c0c9", horizon: "#eaf3ea", nuitZenith: "#17302f", nuitHorizon: "#45605a" },
    lumiere: { ciel: "#f2fbf6", sol: "#a59a78", soleil: "#fff1d2", exposition: 1.0, brume: 0.0007 },
    mur: "#f3ead7", toit: "#e6d9bf", sol: "#e0d5ba", socle: "#c2b594",
    plan: { sol: "#e0d5ba", route: "#d6caad", bati: "#d2c5a6", foret: "#cfd4ab", eau: "#c5d6d2", trait: "#857a5c", force: 0.75 },
    parcelle: "#d9480f", arbres: ["#1f4d3a", "#5f9e58", "#a8c256"], facades: "#a2946f",
    heures: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
    coupe: { trait: "#1f3b2f", bati: "#2f5d49", terrain: "#b3a47f" },
  },
  nuit: {
    nom: "Nuit bleue", resume: "Mode sombre, panneau compact à droite", sombre: true,
    pastilles: ["#c9d3e3", "#ffb84d", "#16233b"],
    ciel: { zenith: "#0f1a2e", horizon: "#3a5078", nuitZenith: "#070c16", nuitHorizon: "#1b2740" },
    lumiere: { ciel: "#cfdcf5", sol: "#6f7a90", soleil: "#ffe9c4", exposition: 0.95, brume: 0.0008 },
    mur: "#d5deec", toit: "#c3cee0", sol: "#b9c4d6", socle: "#8f9bb0",
    plan: { sol: "#b9c4d6", route: "#adb9cc", bati: "#a8b4c8", foret: "#a9bcc0", eau: "#9db6d6", trait: "#56637a", force: 0.8 },
    parcelle: "#ffb84d", arbres: ["#1d5560", "#4fa39a", "#9bd0a8"], facades: "#7d8aa3",
    heures: ["#1b1044", "#6a1f7d", "#c43c6c", "#f5874f", "#fce68a"],
    coupe: { trait: "#ffb84d", bati: "#22304a", terrain: "#77839a" },
  },
  atelier: {
    nom: "Terre cuite", resume: "Argile claire, panneau fixe, barre du temps au-dessus de la vue", sombre: false,
    pastilles: ["#ecd9cb", "#b5533c", "#f3dfc8"],
    ciel: { zenith: "#c9b7b0", horizon: "#f7ecdf", nuitZenith: "#2a1f22", nuitHorizon: "#5c4a48" },
    lumiere: { ciel: "#fff6ee", sol: "#b08f7c", soleil: "#ffeed6", exposition: 1.0, brume: 0.0006 },
    mur: "#f1e0d3", toit: "#e2c8b7", sol: "#e1cdbd", socle: "#c4a995",
    plan: { sol: "#e1cdbd", route: "#d8c2b1", bati: "#d3bba9", foret: "#d3caae", eau: "#c9cfd0", trait: "#8c6c5c", force: 0.75 },
    parcelle: "#0b7285", arbres: ["#4a5a2c", "#8a9a4a", "#c9b458"], facades: "#a68572",
    heures: ["#1d6f8a", "#7fb7b0", "#f3e9c9", "#e39a5d", "#c8442b"],
    coupe: { trait: "#3a2420", bati: "#7c3a2b", terrain: "#b89a85" },
  },
};

const CLE = "ombres.theme";

/** Thème de départ : `?theme=` dans l'adresse, sinon le dernier choisi, sinon « maquette ». */
export function themeInitial() {
  const u = new URLSearchParams(location.search).get("theme");
  if (THEMES[u]) return u;
  let m = null;
  try { m = localStorage.getItem(CLE); } catch { /* stockage indisponible */ }
  return THEMES[m] ? m : "maquette";
}

/** Applique un thème à l'interface et le mémorise. */
export function appliquerTheme(id) {
  const T = THEMES[id];
  document.body.dataset.theme = id;
  document.documentElement.dataset.bsTheme = T.sombre ? "dark" : "light";
  document.documentElement.style.setProperty("--degrade-heures", `linear-gradient(90deg, ${T.heures.join(", ")})`);
  try { localStorage.setItem(CLE, id); } catch { /* stockage indisponible */ }
  // l'adresse ne garde ?theme= que s'il y était déjà (lien de comparaison)
  const u = new URL(location.href);
  if (u.searchParams.has("theme") && u.searchParams.get("theme") !== id) { u.searchParams.set("theme", id); history.replaceState(null, "", u); }
  return T;
}

/** Couleur de l'échelle des heures (t de 0 à 1) dans `c` (THREE.Color). */
export function couleurEchelle(etapes, t, c) {
  const f = Math.max(0, Math.min(1, t)) * (etapes.length - 1), i = Math.min(etapes.length - 2, Math.floor(f));
  return c.copy(etapes[i]).lerp(etapes[i + 1], f - i);
}
