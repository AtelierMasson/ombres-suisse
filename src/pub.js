// Publicité Google AdSense (version gratuite) : un seul emplacement, en bas du panneau des réglages.
// Jamais pour les comptes Pro, jamais sur l'accueil. Le script de Google n'est chargé que si un emplacement est défini
// (SLOT, créé dans AdSense après l'approbation du site) ; le consentement (UE, Suisse) passe par la fenêtre de Google
// (« Confidentialité et messages » dans AdSense), servie par ce même script.
export const CLIENT = "ca-pub-4424415212884229";
export const SLOT = ""; // identifiant du bloc d'annonces (data-ad-slot), à remplir après l'approbation

let charge = false;
export function brancherPub(compte) {
  const zone = document.getElementById("pub");
  if (!zone) return;
  const maj = () => {
    const pro = !!compte?.etat?.().pro, accueil = document.body.classList.contains("accueil");
    const montrer = !!SLOT && !pro && !accueil;
    zone.hidden = !montrer;
    if (!montrer || charge) return;
    charge = true;
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
    document.head.append(s);
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    Object.assign(ins.dataset, { adClient: CLIENT, adSlot: SLOT, adFormat: "auto", fullWidthResponsive: "true" });
    ins.style.display = "block";
    zone.append(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };
  compte?.addEventListener?.("compte", maj);
  new MutationObserver(maj).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  maj();
}
