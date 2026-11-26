// Langues de l'interface : français (source), allemand, italien, anglais. Sans dépendance.
// Choix de la langue : ?lang= dans l'adresse, sinon le dernier choix mémorisé, sinon la langue du navigateur, sinon fr.
// Textes : t("cle", { param }) ; dans index.html, attributs data-i18n (texte), data-i18n-html (texte avec balises),
// data-i18n-title, data-i18n-placeholder, data-i18n-aria-label.
import fr from "./langues/fr.js";
import de from "./langues/de.js";
import it from "./langues/it.js";
import en from "./langues/en.js";

const DICOS = { fr, de, it, en };
export const LANGUES = ["fr", "de", "it", "en"];
const LOCALES = { fr: "fr-CH", de: "de-CH", it: "it-CH", en: "en-GB" };
const CLE = "ombres.langue";

function detecter() {
  let u = null, m = null;
  try { u = new URLSearchParams(location.search).get("lang"); } catch { /* adresse illisible */ }
  if (LANGUES.includes(u)) {
    try { localStorage.setItem(CLE, u); } catch { /* stockage indisponible */ }
    return u;
  }
  try { m = localStorage.getItem(CLE); } catch { /* stockage indisponible */ }
  if (LANGUES.includes(m)) return m;
  for (const l of navigator.languages || [navigator.language || ""]) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (LANGUES.includes(c)) return c;
  }
  return "fr";
}

/** Langue active (fr, de, it, en) et locale correspondante pour Intl (fr-CH, de-CH, it-CH, en-GB). */
export const langue = detecter();
export const locale = LOCALES[langue];

/**
 * Texte traduit. Les valeurs du dictionnaire sont des chaînes avec {param}, ou des fonctions (params) => chaîne
 * pour les pluriels et les accords. Repli sur le français, puis sur la clé elle-même.
 */
export function t(cle, p = {}) {
  const v = DICOS[langue][cle] ?? fr[cle];
  if (v == null) { console.warn("i18n : clé manquante", cle); return cle; }
  if (typeof v === "function") return v(p);
  return v.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);
}

/** Nombre à `d` décimales, sans séparateur de milliers (virgule en français, point en de/it/en). */
export const nombre = (v, d = 1) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(v);
/** Nombre entier avec séparateur de milliers de la locale. */
export const entier = v => Math.round(v).toLocaleString(locale);
/** Date dans la locale active. */
export const date = (d, o) => d.toLocaleDateString(locale, o);

/** Applique les traductions aux éléments marqués de `racine`, plus lang, titre et description de la page. */
export function traduirePage(racine = document) {
  for (const el of racine.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of racine.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const [attr, nom] of [["title", "i18nTitle"], ["placeholder", "i18nPlaceholder"], ["aria-label", "i18nAriaLabel"]])
    for (const el of racine.querySelectorAll(`[data-${nom.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}]`)) el.setAttribute(attr, t(el.dataset[nom]));
  if (racine === document) {
    document.documentElement.lang = langue;
    document.title = t("meta.titre");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  }
}

/** Sélecteur « FR DE IT EN » : liens texte ; le choix est mémorisé et la page rechargée dans la nouvelle langue. */
export function brancherSelecteur(conteneur) {
  const bloc = document.createElement("span");
  bloc.className = "langues";
  bloc.append(" · ");
  for (const l of LANGUES) {
    const a = document.createElement("a");
    const u = new URL(location.href);
    u.searchParams.set("lang", l);
    a.href = u.pathname + u.search + u.hash;
    a.hreflang = a.lang = l;
    a.textContent = l.toUpperCase();
    a.title = DICOS[l]["langue.nom"];
    if (l === langue) { a.className = "actif"; a.setAttribute("aria-current", "true"); }
    a.addEventListener("click", e => {
      e.preventDefault();
      if (l === langue) return;
      try { localStorage.setItem(CLE, l); } catch { /* stockage indisponible */ }
      // ?lang= n'est gardé dans l'adresse que s'il y était déjà ; l'emplacement (#…) est conservé
      const v = new URL(location.href);
      if (v.searchParams.has("lang")) { v.searchParams.set("lang", l); location.href = v.href; }
      else location.reload();
    });
    bloc.append(a);
    if (l !== LANGUES.at(-1)) bloc.append(" ");
  }
  conteneur.append(bloc);
}
