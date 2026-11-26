// Thèmes : chaque variante règle à la fois l'interface (variables CSS dans style.css, attribut data-theme)
// et la scène 3D (ciel, bâtiments, terrain ton sur ton, parcelle, arbres, carte des heures, coupe).
// Le terrain et le plan cadastral reteinté restent dans la gamme des bâtiments : ce sont les ombres et
// l'occlusion ambiante qui donnent le relief, comme sur une maquette.

export const THEMES = {
  maquette: {
    nom: "Maquette", resume: "Blanc cassé, ciel doux, panneau classique", sombre: false,
    pastilles: ["#f4f0e9", "#1f3b6b", "#bcd6ee"],
    ciel: { zenith: "#8fb8e0", horizon: "#e4eef6", nuitZenith: "#1c2738", nuitHorizon: "#4a586c" },
    lumiere: { ciel: "#f3f7ff", sol: "#a39c8c", soleil: "#fff3dc", exposition: 1.0, brume: 0.00055 },
    mur: "#f6f2eb", toit: "#ece6db", sol: "#e6e0d5", socle: "#cfc8ba",
    plan: { sol: "#e6e0d5", route: "#dcd5c8", bati: "#d8d0c2", foret: "#d9dcc6", eau: "#cfdbe2", trait: "#8f8778", force: 0.75 },
    parcelle: "#e0262b", arbres: ["#2f5d2a", "#7fae4b", "#b9c45a"],
    heures: ["#264dbf", "#69a8e0", "#f2e533", "#f59324", "#e02c1a"],
    coupe: { trait: "#1f2933", bati: "#3b4754", terrain: "#b8ae9b" },
  },
  nuit: {
    nom: "Nuit bleue", resume: "Mode sombre, panneau compact à droite", sombre: true,
    pastilles: ["#c9d3e3", "#9db8e8", "#16233b"],
    ciel: { zenith: "#0f1a2e", horizon: "#3a5078", nuitZenith: "#070c16", nuitHorizon: "#1b2740" },
    lumiere: { ciel: "#cfdcf5", sol: "#6f7a90", soleil: "#ffe9c4", exposition: 0.95, brume: 0.0008 },
    mur: "#d5deec", toit: "#c3cee0", sol: "#b9c4d6", socle: "#8f9bb0",
    plan: { sol: "#b9c4d6", route: "#adb9cc", bati: "#a8b4c8", foret: "#a9bcc0", eau: "#9db6d6", trait: "#56637a", force: 0.8 },
    parcelle: "#ffb84d", arbres: ["#1d5560", "#4fa39a", "#9bd0a8"],
    heures: ["#1b1044", "#6a1f7d", "#c43c6c", "#f5874f", "#fce68a"],
    coupe: { trait: "#9db8e8", bati: "#22304a", terrain: "#77839a" },
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
