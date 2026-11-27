"""Ajoute (ou remplace) un pont modélisé dans public/ponts : copie du JSON et ligne de l'index (boîte = axe ± marge).
   python3 outils/ponts/ajouter.py outils/ponts/modeles/<nom>.json [<nom de fichier>]"""
import fcntl, json, os, sys

src = sys.argv[1]
nom_fichier = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(src)
racine = os.path.join(os.path.dirname(__file__), "..", "..", "public", "ponts")
d = json.load(open(src))
xs = [p[0] for p in d["axe"]]; ys = [p[1] for p in d["axe"]]
m = d.get("largeur", 10) / 2 + 2 + max((p.get("larg", 0) for p in d.get("appuis", [])), default=0)
for y in d.get("pylones", []):
    m = max(m, y.get("ecart", 0) / 2 + y.get("epaisseur", 3))
boite = [round(min(xs) - m, 1), round(min(ys) - m, 1), round(max(xs) + m, 1), round(max(ys) + m, 1)]
json.dump(d, open(os.path.join(racine, nom_fichier), "w"), ensure_ascii=False)
idx_f = os.path.join(racine, "index.json")
# plusieurs agents ajoutent des ponts en même temps : l'index est relu et réécrit sous verrou
with open(idx_f + ".verrou", "w") as v:
    fcntl.flock(v, fcntl.LOCK_EX)
    idx = [e for e in json.load(open(idx_f)) if e["fichier"] != nom_fichier]
    idx.append({"nom": d["nom"], "fichier": nom_fichier, "boite": boite})
    tmp = idx_f + ".tmp"
    json.dump(idx, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, idx_f)
print(nom_fichier, boite)
