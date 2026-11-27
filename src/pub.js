// Publicité Google AdSense (version gratuite) : un seul emplacement, en bas du panneau des réglages.
// Jamais pour les comptes Pro, jamais sur l'accueil. Le script de Google n'est chargé que si un emplacement est défini
// (SLOT, créé dans AdSense après l'approbation du site) ; le consentement (UE, Suisse) passe par la fenêtre de Google
// (« Confidentialité et messages » dans AdSense), servie par ce même script.
export const CLIENT = "ca-pub-4424415212884229";
export const SLOT = "1498907080"; // bloc « topograph-colonne » (annonces display, taille adaptable)

let charge = false, rempli = false;
export function brancherPub(compte) {
  const zone = document.getElementById("pub");
  if (!zone) return;
  const maj = () => {
    const pro = !!compte?.etat?.().pro, accueil = document.body.classList.contains("accueil");
    const montrer = !!SLOT && !pro && !accueil;
    // tant qu'aucune annonce n'est servie (site en examen chez Google, pas d'annonce), la zone reste en place mais
    // repliée (hauteur nulle) : cachée, elle n'aurait pas de largeur et Google ne saurait quelle taille servir
    zone.hidden = !montrer;
    zone.classList.toggle("pub-remplie", rempli);
    if (!montrer || charge) return;
    charge = true;
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
    document.head.append(s);
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    // bannière horizontale dans la place réservée (90 px de haut) ; un cadre discret tant qu'aucune annonce n'est servie
    Object.assign(ins.dataset, { adClient: CLIENT, adSlot: SLOT, adFormat: "horizontal", fullWidthResponsive: "false" });
    const place = document.createElement("div");
    place.className = "pub-place";
    place.append(ins);
    zone.append(place);
    // Google écrit data-ad-status="filled" (annonce servie) ou "unfilled" sur l'emplacement
    new MutationObserver(() => { rempli = ins.dataset.adStatus === "filled"; maj(); }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };
  compte?.addEventListener?.("compte", maj);
  new MutationObserver(maj).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  maj();
}
