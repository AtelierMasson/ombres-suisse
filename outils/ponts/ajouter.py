"""Ajoute (ou remplace) un pont modélisé dans public/ponts : copie du JSON et ligne de l'index (boîte = axe ± marge).
   python3 outils/ponts/ajouter.py outils/ponts/modeles/<nom>.json [<nom de fichier>] [--doublon-voulu]
   Refuse un pont dont le tablier recouvre celui d'un pont déjà publié sous un autre nom de fichier (même ouvrage
   modélisé deux fois) ; --doublon-voulu force l'ajout (p. ex. deux chaussées qui se touchent)."""
import fcntl, json, math, os, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0]
nom_fichier = args[1] if len(args) > 1 else os.path.basename(src)
forcer = "--doublon-voulu" in sys.argv


def points_axe(axe, pas=5.0):
    """Points de l'axe tous les `pas` mètres."""
    out = []
    for a, b in zip(axe, axe[1:]):
        n = max(1, int(math.dist(a[:2], b[:2]) / pas))
        out += [[a[k] + (b[k] - a[k]) * i / n for k in range(3)] for i in range(n)]
    return out + [axe[-1]]


def recouvrement(d1, d2):
    """Part de l'axe de d1 posée sur le tablier de d2 (en plan à moins de la demi-largeur, à 4 m près en hauteur)."""
    P, Q = points_axe(d1["axe"]), points_axe(d2["axe"], 2.0)
    lim = d2.get("largeur", 10) / 2
    dessus = sum(1 for p in P if any(math.dist(p[:2], q[:2]) < lim and abs(p[2] - q[2]) < 4 for q in Q))
    return dessus / len(P)
racine = os.path.join(os.path.dirname(__file__), "..", "..", "public", "ponts")
d = json.load(open(src))
xs = [p[0] for p in d["axe"]]; ys = [p[1] for p in d["axe"]]
m = d.get("largeur", 10) / 2 + 2 + max((p.get("larg", 0) for p in d.get("appuis", [])), default=0)
for y in d.get("pylones", []):
    m = max(m, y.get("ecart", 0) / 2 + y.get("epaisseur", 3))
boite = [round(min(xs) - m, 1), round(min(ys) - m, 1), round(max(xs) + m, 1), round(max(ys) + m, 1)]
# pile flottante : z "tablier" est le DESSOUS du tablier ; un haut de pile plus bas que lui laisse un vide visible
for a in d.get("appuis", []) or []:
    hauts = [S.get("dz", 0) or 0 for S in a.get("sections", []) or [] if S.get("z") == "tablier"]
    if hauts and max(hauts) < -0.3:
        sys.exit(f"Refusé : la pile s={a.get('s')} s'arrête {-max(hauts):.2f} m sous le tablier. z \"tablier\" désigne déjà le "
                 "dessous du tablier : le haut de la pile prend dz = 0 (ne pas retrancher l'épaisseur).")
idx_f = os.path.join(racine, "index.json")
if not forcer:
    for e in json.load(open(idx_f)):
        b = e["boite"]
        if e["fichier"] == nom_fichier or b[0] > boite[2] or b[2] < boite[0] or b[1] > boite[3] or b[3] < boite[1]:
            continue
        autre = json.load(open(os.path.join(racine, e["fichier"])))
        r = max(recouvrement(d, autre), recouvrement(autre, d))
        if r > 0.5:
            sys.exit(f"Refusé : {r:.0%} du tablier recouvre {e['fichier']} ({e['nom']}). Même ouvrage ? Remplace ce "
                     f"fichier-là (2e argument {e['fichier']}) ou ajoute --doublon-voulu si ce sont bien deux ouvrages.")
json.dump(d, open(os.path.join(racine, nom_fichier), "w"), ensure_ascii=False)
# plusieurs agents ajoutent des ponts en même temps : l'index est relu et réécrit sous verrou
with open(idx_f + ".verrou", "w") as v:
    fcntl.flock(v, fcntl.LOCK_EX)
    idx = [e for e in json.load(open(idx_f)) if e["fichier"] != nom_fichier]
    idx.append({"nom": d["nom"], "fichier": nom_fichier, "boite": boite})
    tmp = idx_f + ".tmp"
    json.dump(idx, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, idx_f)
print(nom_fichier, boite)
