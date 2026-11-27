// Interface autour de la scène : onglets de la colonne (Soleil, Coupe, Affichage, Pro), titre du lieu, puce de
// chargement (anneau), puce de la vue, zoom et plein écran, feuille du bas sur mobile, offre Pro.
// Ce module ne fait que présenter : main.js, pro.js et compte.js gardent tout le comportement (mêmes éléments, mêmes
// identifiants) ; il observe ce qu'ils écrivent dans la page.
import { t } from "./i18n.js";

const CLE_ONGLET = "ombres.onglet";
const ONGLETS = ["soleil", "coupe", "affichage", "pro"];
const $ = s => document.querySelector(s);
const lire = cle => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrire = (cle, v) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };
const observer = (el, f, o) => el && new MutationObserver(f).observe(el, o);

export function brancherInterface({ scene, compte }) {
  const col = $("#colonne"), corps = $("#corpsColonne"), mobile = matchMedia("(max-width: 767px)");

  /* ---------------------------------------------------------------- onglets */
  const boutons = [...col.querySelectorAll("[data-vers]")];
  let onglet = ONGLETS.includes(lire(CLE_ONGLET)) ? lire(CLE_ONGLET) : "soleil";
  function choisir(o, focus = false) {
    onglet = o;
    col.dataset.onglet = o;
    for (const b of boutons) {
      const oui = b.dataset.vers === o;
      b.setAttribute("aria-selected", String(oui));
      b.tabIndex = oui ? 0 : -1;
      if (oui && focus) b.focus();
    }
    corps.scrollTop = 0;
    ecrire(CLE_ONGLET, o);
    majVide();
  }
  boutons.forEach(b => b.addEventListener("click", () => { choisir(b.dataset.vers); ouvrirFeuille(true); }));
  // flèches gauche/droite entre les onglets (modèle « tablist »)
  col.querySelector(".onglets").addEventListener("keydown", e => {
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!k) return;
    e.preventDefault();
    choisir(ONGLETS[(ONGLETS.indexOf(onglet) + k + ONGLETS.length) % ONGLETS.length], true);
  });
  // onglet vide (lieu en cours de chargement) : une ligne d'attente au lieu d'un blanc
  function majVide() {
    const vide = $("#ongletVide");
    const plein = [...corps.querySelectorAll(`[data-onglet="${onglet}"]`)].some(el => el.getClientRects().length);
    if (vide.hidden !== plein) vide.hidden = plein;
  }
  observer(corps, majVide, { attributes: true, attributeFilter: ["hidden"], subtree: true });

  /* ---------------------------------------------------------------- titre du lieu (colonne) */
  // même texte que la puce de l'en-tête : le nom en titre, le type (parcelle, canton) dessous, sans répéter le nom
  function majTitre() {
    const nom = $("#lieu").textContent.trim(), type = $("#lieuType").textContent.trim();
    $("#titreLieu").textContent = nom || type;
    $("#sousTitreLieu").textContent = nom && type.endsWith(` · ${nom}`) ? type.slice(0, -nom.length - 3) : (nom ? type : "");
  }
  for (const s of ["#lieu", "#lieuType"]) observer($(s), majTitre, { childList: true, characterData: true, subtree: true });
  majTitre();

  /* ---------------------------------------------------------------- puce de chargement */
  // main.js remplit #telechargement (texte, pourcentage, aria-valuenow) ; ici, l'anneau suit le pourcentage, et il
  // tourne quand la durée est inconnue
  {
    const boite = $("#telechargement"), anneau = boite.querySelector(".anneau"), rempli = boite.querySelector(".rempli");
    const maj = () => {
      const v = boite.getAttribute("aria-valuenow");
      anneau.classList.toggle("inconnu", v == null);
      rempli.style.strokeDashoffset = v == null ? 72 : 100 - Math.max(0, Math.min(100, +v));
      boite.title = $("#telechargementTexte").textContent;
    };
    observer(boite, maj, { attributes: true, attributeFilter: ["aria-valuenow", "hidden"] });
    observer($("#telechargementTexte"), maj, { childList: true, characterData: true, subtree: true });
    maj();
  }

  /* ---------------------------------------------------------------- puce de la vue */
  // « Maquette », ou « Ensoleillement » avec l'échelle 0 h – max quand la carte des heures est affichée ; un clic
  // ouvre l'onglet qui la règle
  function majPuce() {
    const carte = !$("#heures").hidden && $("#vHeures").checked;
    $("#puceVueTexte").textContent = t(carte ? "heures.titre" : "ui.maquette");
    $("#puceVueCle").hidden = !carte;
    $("#puceVueMax").textContent = $("#heuresMax").textContent;
  }
  observer($("#heures"), majPuce, { attributes: true, attributeFilter: ["hidden"] });
  observer($("#heuresMax"), majPuce, { childList: true, characterData: true, subtree: true });
  $("#vHeures").addEventListener("change", majPuce);
  $("#puceVue").addEventListener("click", () => {
    choisir(!$("#puceVueCle").hidden ? "soleil" : "affichage");
    ouvrirFeuille(true);
  });
  majPuce();

  /* ---------------------------------------------------------------- zoom et plein écran */
  // zoom : la caméra se rapproche (ou s'éloigne) de la cible, en quelques images
  let zoomEnCours = 0;
  function zoomer(facteur) {
    const c = scene.controls, pas = 8, f = Math.pow(facteur, 1 / pas), id = ++zoomEnCours;
    let k = 0;
    const image = () => {
      if (id !== zoomEnCours || k++ >= pas) return;
      const curseur = c.zoomToCursor;
      c.zoomToCursor = false; // vers la cible, pas vers le dernier endroit survolé
      c.dollyIn(f);
      c.zoomToCursor = curseur;
      scene.demander?.(3);
      requestAnimationFrame(image);
    };
    image();
  }
  $("#btnZoomPlus").addEventListener("click", () => zoomer(0.6));
  $("#btnZoomMoins").addEventListener("click", () => zoomer(1 / 0.6));
  const cadre = $("#cadre"), btnEcran = $("#btnPleinEcran");
  if (!document.fullscreenEnabled) btnEcran.hidden = true;
  btnEcran.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else cadre.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    const oui = document.fullscreenElement === cadre, titre = t(oui ? "ui.quitterPleinEcran" : "ui.pleinEcran");
    btnEcran.setAttribute("aria-pressed", String(oui));
    btnEcran.title = titre; btnEcran.setAttribute("aria-label", titre);
  });

  // la scène change de taille (coupe ouverte ou fermée, feuille du bas, plein écran) : une nouvelle image
  new ResizeObserver(() => scene.demander?.(3)).observe($("#vue"));

  /* ---------------------------------------------------------------- feuille du bas (mobile) */
  function ouvrirFeuille(oui) {
    if (!mobile.matches && oui) return;
    col.classList.toggle("ouverte", oui);
    $("#btnOutils").setAttribute("aria-expanded", String(oui));
    majVide();
  }
  $("#btnOutils").addEventListener("click", () => ouvrirFeuille(!col.classList.contains("ouverte")));
  // hauteur de la feuille : la scène et la coupe s'arrêtent au-dessus
  const hauteur = () => document.body.style.setProperty("--feuille-h", mobile.matches && getComputedStyle(col).display !== "none" ? `${col.offsetHeight}px` : "0px");
  new ResizeObserver(hauteur).observe(col);
  mobile.addEventListener("change", () => { if (!mobile.matches) ouvrirFeuille(false); hauteur(); });
  observer(document.body, hauteur, { attributes: true, attributeFilter: ["class"] });
  hauteur();

  /* ---------------------------------------------------------------- offre Pro (compte gratuit) */
  function majOffre() {
    const libre = !compte?.disponible?.() || !!compte.etat().pro; // sans API des comptes, tout est ouvert
    $("#offrePro").hidden = libre;
    const b = col.querySelector('[data-vers="pro"]');
    b.classList.toggle("verrou", !libre);
    b.querySelector("use")?.setAttribute("href", libre ? "#i-mallette" : "#i-cadenas"); // cadenas tant que Pro n'est pas acheté
  }
  compte?.addEventListener?.("compte", majOffre);
  $("#btnOffre").addEventListener("click", () => compte?.ouvrir?.());
  majOffre();

  choisir(onglet);
}
