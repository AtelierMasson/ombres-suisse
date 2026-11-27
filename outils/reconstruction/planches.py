#!/usr/bin/env python3
"""Planches d'évaluation de la reconstruction « Advanced » : une image par bâtiment de l'échantillon, à partir des
fichiers écrits par evaluer.mjs (--planches). Six vues : photo aérienne SWISSIMAGE (WMS public de geo.admin.ch),
points du toit par hauteur, points par pan détecté, pans du modèle vus de dessus (contours, faîtes, ressauts),
écart des points au modèle, vue axonométrique du modèle.
Usage : python3 planches.py <dossier des .json> <dossier des .png> [identifiant …]
Dépendances : Pillow, numpy."""
import colorsys, io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont

C = 540          # côté d'une vue (px)
MARGE = 4.0      # m autour de l'emprise
WMS = "https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:2056&FORMAT=image/jpeg"

def police(t):
    try: return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", t)
    except Exception: return ImageFont.load_default()
P12, P14, P18 = police(12), police(14), police(18)

def degrade(v):
    """Dégradé bleu → vert → jaune → rouge pour v dans [0, 1] (tableau)."""
    v = np.clip(v, 0, 1)
    pts = np.array([[40, 60, 160], [40, 160, 190], [90, 190, 90], [240, 220, 60], [220, 70, 40]], float)
    x = v * (len(pts) - 1); i = np.minimum(x.astype(int), len(pts) - 2); f = (x - i)[:, None]
    return (pts[i] * (1 - f) + pts[i + 1] * f).astype(np.uint8)

def couleur_pan(k):
    h = (k * 0.61803398875) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.65 if k % 2 else 0.9, 0.95 if k % 3 else 0.7)
    return int(r * 255), int(g * 255), int(b * 255)

def photo(boite, cache, cle):
    f = os.path.join(cache, f"photo_{cle}.jpg")
    if not os.path.exists(f):
        cote = boite[2] - boite[0]
        px = int(min(1600, max(400, cote / 0.1)))
        u = f"{WMS}&BBOX={boite[0]:.2f},{boite[1]:.2f},{boite[2]:.2f},{boite[3]:.2f}&WIDTH={px}&HEIGHT={px}"
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "evaluation-reconstruction"}), timeout=60) as r:
            d = r.read()
        Image.open(io.BytesIO(d)).verify()
        open(f, "wb").write(d)
    return Image.open(f).convert("RGB")

def plan_newell(a):
    a = np.asarray(a, float); b = np.roll(a, -1, axis=0)
    n = np.array([((a[:, 1] - b[:, 1]) * (a[:, 2] + b[:, 2])).sum(), ((a[:, 2] - b[:, 2]) * (a[:, 0] + b[:, 0])).sum(), ((a[:, 0] - b[:, 0]) * (a[:, 1] + b[:, 1])).sum()])
    l = np.linalg.norm(n)
    return n / l if l > 1e-9 else np.array([0, 0, 1.0])

def planche(d, cache):
    A = d["anneaux"]; ext = np.array(A[0])
    x0, y0, x1, y1 = ext[:, 0].min(), ext[:, 1].min(), ext[:, 0].max(), ext[:, 1].max()
    cote = max(x1 - x0, y1 - y0) + 2 * MARGE; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bx0, by0 = cx - cote / 2, cy - cote / 2; e = C / cote
    px = lambda p: ((p[0] - bx0) * e, C - (p[1] - by0) * e)
    pts = np.array([[p[0], p[1], p[2], p[3], np.nan if p[4] is None else p[4]] for p in d["points"]], float).reshape(-1, 5)
    U = ((pts[:, 0] - bx0) * e).astype(int); V = (C - (pts[:, 1] - by0) * e).astype(int)
    ok = (U >= 0) & (U < C - 1) & (V >= 0) & (V < C - 1)
    r = 1 if e * 0.25 < 1.5 else 2   # taille du point selon l'échelle

    def semis(couleurs, fond=(250, 250, 250), ordre=None):
        im = np.full((C, C, 3), fond, np.uint8)
        idx = np.nonzero(ok)[0] if ordre is None else ordre[ok[ordre]]
        for du in range(r):
            for dv in range(r):
                im[V[idx] + dv, U[idx] + du] = couleurs[idx]
        return Image.fromarray(im)

    def contours(im, couleur=(0, 0, 0), l=1, voisins=True):
        g = ImageDraw.Draw(im)
        if voisins:
            for B in d.get("voisins", []):
                for a in B: g.line([px(p) for p in a + [a[0]]], fill=(150, 150, 150), width=1)
        for a in A: g.line([px(p) for p in a + [a[0]]], fill=couleur, width=l)
        return g

    vues = []
    # 1. photo aérienne
    O = d["origine"]; bp = [O[0] + bx0, O[1] + by0, O[0] + bx0 + cote, O[1] + by0 + cote]
    try:
        im = photo(bp, cache, d["id"]).resize((C, C), Image.LANCZOS)
    except Exception as ex:
        im = Image.new("RGB", (C, C), (200, 200, 200)); ImageDraw.Draw(im).text((10, 10), f"photo indisponible : {ex}"[:80], fill=(0, 0, 0), font=P12)
    contours(im, (255, 230, 0), 2, voisins=False)
    vues.append(("Photo aérienne SWISSIMAGE (emprise officielle en jaune)", im))
    # 2. points par hauteur
    if len(pts):
        z = pts[:, 2]; za, zb = np.percentile(z, 1), np.percentile(z, 99.5)
        im = semis(degrade((z - za) / max(0.5, zb - za)), ordre=np.argsort(z))
        g = contours(im)
        g.text((6, C - 18), f"z de {za:.1f} à {zb:.1f} m (du bleu au rouge), {d['n']} points classe 6", fill=(0, 0, 0), font=P12)
    else: im = Image.new("RGB", (C, C), (250, 250, 250)); contours(im)
    vues.append(("Points « bâtiment » par hauteur", im))
    # 3. points par pan détecté
    if len(pts):
        et = pts[:, 3].astype(int); coul = np.array([couleur_pan(k) if k >= 0 else (60, 60, 60) for k in range(-1, max(0, et.max()) + 1)], np.uint8)
        im = semis(coul[et + 1]); g = contours(im)
        g.text((6, C - 18), f"{len(d['pansDetectes'])} pans détectés ; gris foncé : sans pan ({100 * (et < 0).mean():.0f} % des points)", fill=(0, 0, 0), font=P12)
    else: im = Image.new("RGB", (C, C), (250, 250, 250)); contours(im)
    vues.append(("Points par pan détecté (plans.js)", im))
    # 4. modèle vu de dessus
    im = Image.new("RGB", (C, C), (250, 250, 250)); g = ImageDraw.Draw(im, "RGBA")
    toits = [p for p in d["polygones"] if p["t"] == "toit"]
    T = []
    for t in toits:
        a = np.asarray(t["r"][0], float); n = plan_newell(a); c0 = a.mean(axis=0)
        T.append((t, n, c0, a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()))
    def dedans(r, x, y):
        d_ = False
        for a in r:
            for i in range(len(a)):
                p, q_ = a[i], a[i - 1]
                if (p[1] > y) != (q_[1] > y) and x < (q_[0] - p[0]) * (y - p[1]) / (q_[1] - p[1]) + p[0]: d_ = not d_
        return d_
    def z_en(k, x, y):
        _, n, c0 = T[k][:3]
        return c0[2] - (n[0] * (x - c0[0]) + n[1] * (y - c0[1])) / n[2] if abs(n[2]) > 1e-6 else c0[2]
    for k, (t, n, c0, *_b) in enumerate(sorted(T, key=lambda u: u[2][2])):
        pente = math.hypot(n[0], n[1]) / max(1e-6, abs(n[2]))
        if pente < 0.03: coul = (205, 205, 205)
        else:
            h = (math.atan2(n[1], n[0]) / (2 * math.pi)) % 1.0
            rr, gg, bb = colorsys.hsv_to_rgb(h, min(0.75, 0.25 + pente * 0.5), 0.95); coul = (int(rr * 255), int(gg * 255), int(bb * 255))
        m = Image.new("L", (C, C), 0); gm = ImageDraw.Draw(m)
        gm.polygon([px(p) for p in t["r"][0]], fill=255)
        for trou in t["r"][1:]: gm.polygon([px(p) for p in trou], fill=0)
        im.paste(coul, (0, 0), m)
    g = ImageDraw.Draw(im)
    # arêtes : chaque côté est classé par morceaux de 1 m selon le toit d'en face (aucun : bord ; même hauteur : faîte,
    # noue ou arêtier ; autre hauteur : ressaut)
    lf = lr = 0.0
    for k, (t, *_r) in enumerate(T):
        for a in t["r"]:
            for i in range(len(a)):
                p, q_ = a[i], a[(i + 1) % len(a)]; L = math.hypot(q_[0] - p[0], q_[1] - p[1])
                if L < 1e-6: continue
                nx_, ny_ = (q_[1] - p[1]) / L, -(q_[0] - p[0]) / L; nb = max(1, int(L))
                for s_ in range(nb):
                    f0, f1 = s_ / nb, (s_ + 1) / nb; fm = (f0 + f1) / 2
                    mx, my = p[0] + fm * (q_[0] - p[0]), p[1] + fm * (q_[1] - p[1])
                    autre = None
                    for sg in (1, -1):
                        ox, oy = mx + sg * 0.06 * nx_, my + sg * 0.06 * ny_
                        for j, u in enumerate(T):
                            if j != k and u[3] <= ox <= u[5] and u[4] <= oy <= u[6] and dedans(u[0]["r"], ox, oy): autre = j; break
                        if autre is not None: break
                    A0 = px((p[0] + f0 * (q_[0] - p[0]), p[1] + f0 * (q_[1] - p[1]))); A1 = px((p[0] + f1 * (q_[0] - p[0]), p[1] + f1 * (q_[1] - p[1])))
                    if autre is None: g.line([A0, A1], fill=(0, 0, 0), width=1)
                    elif abs(z_en(k, mx, my) - z_en(autre, mx, my)) < 0.1: g.line([A0, A1], fill=(150, 0, 0), width=3); lf += L / nb / 2
                    else: g.line([A0, A1], fill=(255, 130, 0), width=2); lr += L / nb / 2
    for a in A: g.line([px(p) for p in a + [a[0]]], fill=(0, 0, 0), width=1)
    g.text((6, C - 18), f"{d['niveau']} : {len(toits)} polygones de toit ; faîtes/arêtes {lf:.0f} m (rouge), ressauts {lr:.0f} m (orange)", fill=(0, 0, 0), font=P12)
    vues.append(("Modèle Advanced vu de dessus (teinte = orientation du pan)", im))
    # 5. écarts
    if len(pts):
        dz = pts[:, 4]; coul = np.zeros((len(pts), 3), np.uint8)
        coul[:] = (200, 0, 200)
        coul[np.abs(dz) < 0.5] = (235, 200, 40); coul[np.abs(dz) < 0.3] = (60, 170, 80)
        coul[dz >= 0.5] = (215, 50, 40); coul[dz <= -0.5] = (40, 80, 200)
        im = semis(coul, ordre=np.argsort(-np.nan_to_num(np.abs(dz), nan=99)) [::-1]); g = contours(im)
        g.text((6, C - 32), "vert < 0,3 m ; jaune < 0,5 m ; rouge : modèle trop haut ;", fill=(0, 0, 0), font=P12)
        g.text((6, C - 18), "bleu : modèle trop bas ; violet : pas de toit sous le point", fill=(0, 0, 0), font=P12)
    else: im = Image.new("RGB", (C, C), (250, 250, 250)); contours(im)
    vues.append(("Écart vertical modèle − points", im))
    # 6. axonométrie (vue du sud-ouest)
    im = Image.new("RGB", (C, C), (250, 250, 250)); g = ImageDraw.Draw(im)
    polys = d["polygones"]
    if polys:
        az, el = math.radians(-35), math.radians(35)
        def proj(p):
            x, y, z = p[0] - cx, p[1] - cy, p[2] - (d.get("zSol") or 0)
            u = x * math.cos(az) - y * math.sin(az); w = x * math.sin(az) + y * math.cos(az)
            return u, -(w * math.sin(el) + z * math.cos(el)), w * math.cos(el) - z * math.sin(el)
        tout = [proj(p) for q_ in polys for p in q_["r"][0]]
        us = [t[0] for t in tout]; vs = [t[1] for t in tout]
        ech = (C - 30) / max(max(us) - min(us), max(vs) - min(vs), 1); u0 = (max(us) + min(us)) / 2; v0 = (max(vs) + min(vs)) / 2
        lum = np.array([-0.5, -0.4, 0.77]); lum /= np.linalg.norm(lum)
        liste = []
        for q_ in polys:
            pr = [proj(p) for p in q_["r"][0]]
            n = plan_newell(q_["r"][0]); s = 0.45 + 0.55 * abs(float(n @ lum))
            base = (200, 95, 70) if q_["t"] == "toit" else (225, 220, 210)
            liste.append((max(t[2] for t in pr) if q_["t"] == "mur" else sum(t[2] for t in pr) / len(pr), [(C / 2 + (t[0] - u0) * ech, C / 2 + (t[1] - v0) * ech) for t in pr], tuple(int(c * s) for c in base)))
        for _, pp, coul in sorted(liste, key=lambda t: -t[0]):
            if len(pp) >= 3: g.polygon(pp, fill=coul, outline=(70, 70, 70))
    vues.append(("Modèle Advanced, vue axonométrique", im))

    # assemblage
    H0 = 64
    img = Image.new("RGB", (3 * C + 4 * 8, H0 + 2 * (C + 26) + 8), (255, 255, 255)); g = ImageDraw.Draw(img)
    g.text((10, 6), f"{d.get('nom', d['id'])} — {d.get('categorie', '')}", fill=(0, 0, 0), font=P18)
    pv = d.get("pans")
    g.text((10, 30), f"E {d['E']:.0f}, N {d['N']:.0f} · emprise {d['aire']:.0f} m² ({d['source']}) · relevé {d.get('annee', '?')} · {d['niveau']}"
           f"{' (' + d['motif'] + ')' if d.get('motif') else ''} · pans détectés {d['plans']}, polygones de toit {d['toits']}"
           f"{', pans visibles sur la photo ≈ ' + str(pv) if pv else ''}", fill=(0, 0, 0), font=P14)
    g.text((10, 47), f"points de toit à moins de 0,3 m du modèle : {100 * d['p03']:.1f} % · à moins de 0,5 m : {100 * d['p05']:.1f} % · |écart| médian {d['mediane']:.2f} m · "
           f"biais {d['biais']:+.2f} m · sans toit {100 * d['sansToit']:.1f} % · {d['ms']:.0f} ms", fill=(0, 0, 0), font=P14)
    for k, (titre, im) in enumerate(vues):
        x = 8 + (k % 3) * (C + 8); y = H0 + (k // 3) * (C + 26)
        g.text((x, y + 4), titre, fill=(0, 0, 0), font=P14)
        img.paste(im, (x, y + 24)); g.rectangle([x, y + 24, x + C - 1, y + 24 + C - 1], outline=(120, 120, 120))
    return img

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    cache = os.environ.get("CACHE_ESSAI") or os.path.join(src, "photos"); os.makedirs(cache, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if not f.endswith(".json") or (len(sys.argv) > 3 and f[:-5] not in sys.argv[3:]): continue
        d = json.load(open(os.path.join(src, f)))
        img = planche(d, cache)
        # image indexée (palette de 128 couleurs) : planches légères
        img.quantize(128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(dst, f[:-5] + ".png"), optimize=True)
        print(f[:-5], os.path.getsize(os.path.join(dst, f[:-5] + ".png")) // 1024, "ko")
