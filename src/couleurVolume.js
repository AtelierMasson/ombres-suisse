// Fenêtre de couleur d'un volume (onglet Projet) : petite fenêtre flottante ancrée à la pastille de couleur, avec les
// couleurs de base, les curseurs teinte / saturation / luminosité, un champ hexadécimal et la transparence (opacité).
// Chaque réglage est appliqué aussitôt (aperçu en direct sur la maquette) ; la fenêtre se ferme au clic dehors, avec
// Échap ou par un second clic sur la pastille. Une seule fenêtre ouverte à la fois.
import { t } from "./i18n.js";

/** Couleurs de base : teintes sobres de matériaux (les dix premières sont celles des projets déjà enregistrés). */
export const COULEURS = [
  { c: "#fbf7ee", cle: "couleur.platre" }, { c: "#eadfca", cle: "couleur.calcaire" }, { c: "#d9c09b", cle: "couleur.sable" },
  { c: "#c99a78", cle: "couleur.terre" }, { c: "#b07a62", cle: "couleur.brique" }, { c: "#8e8379", cle: "couleur.bois" },
  { c: "#a9b49c", cle: "couleur.sauge" }, { c: "#7f9083", cle: "couleur.cuivre" }, { c: "#93a2ad", cle: "couleur.zinc" },
  { c: "#b6a9bb", cle: "couleur.lilas" }, { c: "#c2c0ba", cle: "couleur.beton" }, { c: "#4b4f54", cle: "couleur.anthracite" },
];
export const COULEUR_DEFAUT = COULEURS[0].c;

/** « #abc », « abc » ou « aabbcc » → « #aabbcc » ; null si ce n'est pas une couleur hexadécimale. */
export function normaliserHex(x) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(x ?? "").trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? [...h].map(c => c + c).join("") : h);
}
/** « #rrggbb » → { h (0–360), s (0–100), l (0–100) }. */
export function hexVersHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = 60 * (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
/** Teinte (0–360), saturation et luminosité (0–100) → « #rrggbb ». */
export function hslVersHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

let courante = null; // fenêtre ouverte : { ancre, fermer }

/** Ferme la fenêtre de couleur ouverte (s'il y en a une). */
export function fermerApparence() { courante?.fermer(); }

/**
 * Ouvre la fenêtre de couleur sous `ancre` (la pastille) ; un second appel sur la même ancre la referme.
 * `o.lire()` → { couleur, opacite } de l'objet réglé (null : il n'existe plus, la fenêtre se ferme) ;
 * `o.changer({ couleur, opacite }, final)` : final = false pendant le réglage (aperçu), true une fois le réglage posé.
 */
export function ouvrirApparence(ancre, o) {
  const meme = courante?.ancre === ancre;
  fermerApparence();
  const depart = !meme && o.lire();
  if (!depart) return null;

  let couleur = normaliserHex(depart.couleur) || COULEUR_DEFAUT, opacite = Math.round(Math.max(0.1, Math.min(1, depart.opacite ?? 1)) * 100);
  let { h, s, l } = hexVersHsl(couleur), sale = false;
  const el = document.createElement("dialog");
  el.className = "fenetre-couleur"; el.tabIndex = -1;
  el.setAttribute("aria-label", t("fv.apparenceTitre"));
  const curseur = (c, cle, min, max, pas, unite) => `<label class="fc-ligne"><span>${t(cle)}</span><input type="range" data-c="${c}" min="${min}" max="${max}" step="${pas}"><output data-o="${c}" data-unite="${unite}"></output></label>`;
  el.innerHTML = `
    <div class="fc-tete"><span class="fc-apercu"><i></i></span><b>${t("fv.apparence")}</b>
      <button type="button" class="btn-close fc-fermer" title="${t("couleur.fermer")}" aria-label="${t("couleur.fermer")}"></button></div>
    <div class="fc-titre">${t("couleur.base")}</div>
    <div class="fc-palette">${COULEURS.map(x => `<button type="button" data-c="${x.c}" style="background:${x.c}" title="${t(x.cle)}" aria-label="${t(x.cle)}"></button>`).join("")}</div>
    <div class="fc-titre">${t("couleur.hsl")}</div>
    ${curseur("h", "couleur.teinte", 0, 360, 1, "°")}
    ${curseur("s", "couleur.saturation", 0, 100, 1, " %")}
    ${curseur("l", "couleur.luminosite", 0, 100, 1, " %")}
    <label class="fc-ligne fc-hex"><span>${t("couleur.hex")}</span><input type="text" class="form-control form-control-sm" data-c="hex" maxlength="7" spellcheck="false" autocomplete="off"></label>
    <div class="fc-titre">${t("couleur.transparence")}</div>
    ${curseur("o", "volume.opacite", 10, 100, 5, " %")}`;
  const $ = q => el.querySelector(q);

  /** Curseurs, champ et aperçu d'après l'état (sauf le champ en cours de saisie). */
  function peindre() {
    const val = { h, s, l, o: opacite };
    for (const i of el.querySelectorAll("input[type=range]")) i.value = val[i.dataset.c];
    for (const x of el.querySelectorAll("output")) x.textContent = `${val[x.dataset.o]}${x.dataset.unite}`;
    if (document.activeElement !== $("[data-c=hex]")) $("[data-c=hex]").value = couleur.toUpperCase();
    for (const b of el.querySelectorAll(".fc-palette button")) b.setAttribute("aria-pressed", String(b.dataset.c === couleur));
    el.style.setProperty("--fc-h", h); el.style.setProperty("--fc-s", `${s}%`); el.style.setProperty("--fc-l", `${l}%`);
    el.style.setProperty("--fc-couleur", couleur); el.style.setProperty("--fc-opacite", opacite / 100);
  }
  function emettre(final) {
    if (!o.lire()) return fermer(false);
    sale = !final;
    o.changer({ couleur, opacite: opacite / 100 }, final);
    peindre();
  }
  function regler(i, final) {
    const c = i.dataset.c;
    if (c === "hex") {
      const x = normaliserHex(i.value);
      if (!x) { i.classList.toggle("is-invalid", i.value.trim() !== ""); return; }
      i.classList.remove("is-invalid");
      if (x !== couleur) { couleur = x; ({ h, s, l } = hexVersHsl(x)); }
    } else if (c === "o") opacite = Math.max(10, Math.min(100, +i.value));
    else {
      if (c === "h") h = +i.value; else if (c === "s") s = +i.value; else l = +i.value;
      couleur = hslVersHex(h, s, l);
    }
    emettre(final);
  }
  for (const i of el.querySelectorAll("input")) {
    i.addEventListener("input", () => regler(i, false));
    i.addEventListener("change", () => regler(i, true));
  }
  $(".fc-palette").addEventListener("click", e => {
    const c = e.target.closest("[data-c]")?.dataset.c;
    if (!c) return;
    couleur = c; ({ h, s, l } = hexVersHsl(c));
    emettre(true);
  });
  $(".fc-fermer").onclick = () => fermer();

  /** Sous la pastille, bord droit aligné sur elle ; au-dessus s'il n'y a pas la place ; toujours dans la fenêtre. */
  function placer() {
    if (!ancre.isConnected || !ancre.getClientRects().length) return fermer(false);
    const r = ancre.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight, m = 8;
    if (r.bottom < 0 || r.top > innerHeight) return fermer(false);
    const x = Math.max(m, Math.min(r.right - w, innerWidth - w - m));
    let y = r.bottom + 6;
    if (y + ht > innerHeight - m) y = r.top - 6 - ht >= m ? r.top - 6 - ht : Math.max(m, innerHeight - ht - m);
    el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
  }
  const dehors = e => { if (!el.contains(e.target) && !ancre.contains(e.target)) fermer(false); };
  // les touches restent dans la fenêtre (Suppr ou Retour arrière retireraient le volume choisi)
  el.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); fermer(); } });
  function fermer(foyer = true) {
    if (courante?.ancre !== ancre) return;
    courante = null;
    document.removeEventListener("pointerdown", dehors, true);
    removeEventListener("resize", placer); document.removeEventListener("scroll", placer, true);
    el.remove();
    ancre.setAttribute("aria-expanded", "false");
    if (sale && o.lire()) o.changer({ couleur, opacite: opacite / 100 }, true); // réglage en cours : posé
    if (foyer && ancre.isConnected) ancre.focus({ preventScroll: true });
  }

  document.body.append(el);
  el.show();
  courante = { ancre, fermer };
  ancre.setAttribute("aria-expanded", "true");
  peindre(); placer();
  el.focus({ preventScroll: true });
  document.addEventListener("pointerdown", dehors, true);
  addEventListener("resize", placer); document.addEventListener("scroll", placer, true);
  return courante;
}
