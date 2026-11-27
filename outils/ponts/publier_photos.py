#!/usr/bin/env python3
"""Publie les photos des ponts faits main pour le panneau d'administration (src/admin.js, outil « Ponts »).

Copie depuis ~/Downloads/ombres-suisse-donnees (hors dépôt), en les réduisant (<= 1200 px de large, JPEG qualité 80 ; vues secondaires 1000 px, qualité 72 ;
sans aucune métadonnée : ni EXIF, ni géolocalisation), dans public/ponts/photos/<id>/ :
  - photo.jpg            la photo principale (champ `photo` du JSON du pont, sinon photo.jpg du dossier)
  - vue-1.jpg … vue-4.jpg les autres vues téléchargées (Commons, Flickr…) ; à défaut une orthophoto
  - superposition*.jpg   la photo avec le rendu calé par-dessus (ponts-comparaisons/<id>.jpg, <id>-*.jpg)
  - verification.jpg     la vérification au nuage de points (ponts-verif/<id>.png)
et écrit public/ponts/photos/index.json : { "<id>": { "ville": …, "fichiers": [{ fichier, role, credit }] } }.
`credit` = { auteur, licence, page } quand il est connu (photo principale, ou fichier Commons cité dans `sources`),
sinon null (le panneau affiche « source à préciser »).

    python3 outils/ponts/publier_photos.py [--donnees ~/Downloads/ombres-suisse-donnees]
"""
import argparse, hashlib, json, os, re, shutil, sys, unicodedata
from urllib.parse import unquote
from PIL import Image, ImageOps

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PONTS = os.path.join(RACINE, "public", "ponts")
SORTIE = os.path.join(PONTS, "photos")
MAX_VUES = 4
# largeur maximale et qualité JPEG par rôle : les vues secondaires un peu plus petites (poids du dépôt)
REGLAGE = {"photo": (1200, 80), "superposition": (1200, 80), "verification": (1200, 80), "vue": (1000, 72), "ortho": (1000, 72)}
# fichiers de travail qui ne sont pas des photos (rendus, découpes, grilles, caméras…)
PAS_PHOTO = re.compile(r"^(modele|rendu|render|montage|crop|zoom|grid|cam|cz_|calage|superpos|verif|test|essai|elev|z\d)", re.I)
ORTHO = re.compile(r"^ortho", re.I)
CREDIT_ORTHO = {"auteur": "swisstopo", "licence": "Données ouvertes (OGD) — SWISSIMAGE", "page": "https://www.swisstopo.admin.ch/fr/orthophotos-swissimage-10-cm"}


def norm(nom):
    """Nom de fichier comparable à un titre Commons : sans accents, minuscules, espaces = _, sans extension."""
    nom = unicodedata.normalize("NFKD", unquote(nom)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", os.path.splitext(nom.lower())[0]).strip("_")


def empreinte(chemin):
    with open(chemin, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def reduire(src, dst, largeur=1200, qualite=80):
    """Copie réduite, sans métadonnées (l'image est recréée pixel par pixel : rien de l'EXIF ne passe)."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            fond = Image.new("RGB", im.size, (255, 255, 255))
            fond.paste(im, mask=im.split()[-1])
            im = fond
        else:
            im = im.convert("RGB")
        if im.width > largeur:
            im = im.resize((largeur, round(im.height * largeur / im.width)), Image.LANCZOS)
        propre = Image.new("RGB", im.size)
        propre.paste(im)
        propre.save(dst, "JPEG", quality=qualite, optimize=True, progressive=True)
    return os.path.getsize(dst)


def ville(id_, nom, inventaire):
    lieu = (inventaire.get(id_) or {}).get("lieu") or ""
    lieu = lieu.strip().strip("/").strip()
    if lieu:
        return lieu
    if "," in nom:
        return re.sub(r"\s*\([^)]*\)\s*$", "", nom.rsplit(",", 1)[1]).strip()
    return None


def credits_sources(sources):
    """Fichiers Commons cités dans les sources : nom normalisé → page."""
    r = {}
    for s in sources or []:
        m = re.search(r"commons\.wikimedia\.org/wiki/File:([^?#\s]+)", str(s))
        if m:
            r[norm(m.group(1))] = s.split()[0]
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--donnees", default=os.path.expanduser("~/Downloads/ombres-suisse-donnees"))
    a = ap.parse_args()
    D = a.donnees
    photos_dir, comp_dir, verif_dir = (os.path.join(D, x) for x in ("ponts-photos", "ponts-comparaisons", "ponts-verif"))
    if not os.path.isdir(photos_dir):
        sys.exit(f"dossier introuvable : {photos_dir}")
    index = json.load(open(os.path.join(PONTS, "index.json")))
    inv_chemin = os.path.join(RACINE, "outils", "ponts", "inventaire.json")
    inventaire = {p["id"]: p for p in json.load(open(inv_chemin))} if os.path.exists(inv_chemin) else {}
    dossiers = set(os.listdir(photos_dir))
    ids = {p["fichier"][:-5] for p in index}
    comparaisons = sorted(os.listdir(comp_dir)) if os.path.isdir(comp_dir) else []

    if os.path.isdir(SORTIE):
        shutil.rmtree(SORTIE)
    os.makedirs(SORTIE)
    sortie, total, n_img = {}, 0, 0
    for p in index:
        id_ = p["fichier"][:-5]
        P = json.load(open(os.path.join(PONTS, p["fichier"])))
        fichiers = []
        # dossier de photos : le sien, sinon celui du pont dont il est une variante (viaduc-de-biaschina-b → …-biaschina)
        dossier = id_ if id_ in dossiers else next((id_[:i] for i in range(len(id_), 0, -1)
                                                    if id_[i:i + 1] == "-" and id_[:i] in dossiers), None)
        dest = os.path.join(SORTIE, id_)

        def poser(src, nom, role, credit):
            nonlocal total, n_img
            os.makedirs(dest, exist_ok=True)
            total += reduire(src, os.path.join(dest, nom), *REGLAGE[role])
            n_img += 1
            fichiers.append({"fichier": nom, "role": role, "credit": credit})

        if dossier:
            rep = os.path.join(photos_dir, dossier)
            images = sorted(f for f in os.listdir(rep) if f.lower().endswith((".jpg", ".jpeg")))
            cites = credits_sources(P.get("sources"))
            ph = P.get("photo") or {}
            principale = ph.get("fichier") if ph.get("fichier") in images else ("photo.jpg" if "photo.jpg" in images else None)
            vus = set()
            if principale:
                src = os.path.join(rep, principale)
                vus.add(empreinte(src))
                credit = {k: ph.get(k) for k in ("auteur", "licence", "page") if ph.get(k)} or None
                if credit is None and norm(principale) in cites:
                    credit = {"page": cites[norm(principale)]}
                poser(src, "photo.jpg", "photo", credit)
            autres, orthos = [], []
            for f in images:
                if f == principale or PAS_PHOTO.match(f):
                    continue
                src = os.path.join(rep, f)
                try:
                    with Image.open(src) as im:
                        if im.width < 500:
                            continue
                except Exception:
                    continue
                h = empreinte(src)
                if h in vus:
                    continue
                vus.add(h)
                (orthos if ORTHO.match(f) else autres).append(f)
            # photos créditées d'abord, puis les plus lourdes (les plus détaillées)
            autres.sort(key=lambda f: (norm(f) not in cites, -os.path.getsize(os.path.join(rep, f))))
            choix = [(f, "vue") for f in autres][:MAX_VUES]
            choix += [(f, "ortho") for f in orthos][:MAX_VUES - len(choix)]
            for i, (f, role) in enumerate(choix, 1):
                credit = CREDIT_ORTHO if role == "ortho" else ({"page": cites[norm(f)]} if norm(f) in cites else None)
                poser(os.path.join(rep, f), f"vue-{i}.jpg", role, credit)
        # superpositions calées : <id>.jpg et <id>-xxx.jpg (si xxx n'est pas lui-même un autre pont)
        sup = [f for f in comparaisons if os.path.splitext(f)[0] == id_
               or (f.startswith(id_ + "-") and os.path.splitext(f)[0] not in ids)]
        for i, f in enumerate(sorted(sup, key=lambda f: (len(f), f))):
            poser(os.path.join(comp_dir, f), "superposition.jpg" if i == 0 else f"superposition-{i + 1}.jpg", "superposition", None)
        v = os.path.join(verif_dir, id_ + ".png")
        if os.path.exists(v):
            poser(v, "verification.jpg", "verification", None)
        entree = {"fichiers": fichiers}
        vl = ville(id_, P.get("nom") or p["nom"], inventaire)
        if vl:
            entree["ville"] = vl
        sortie[id_] = entree

    with open(os.path.join(SORTIE, "index.json"), "w") as f:
        json.dump(sortie, f, ensure_ascii=False, separators=(",", ":"))
    avec = sum(1 for e in sortie.values() if any(x["role"] == "photo" for x in e["fichiers"]))
    print(f"{n_img} images pour {len(sortie)} ponts ({avec} avec photo principale) : {total / 1e6:.1f} Mo dans {SORTIE}")


if __name__ == "__main__":
    main()
