"""Index des ponts modélisés (public/ponts/index.json) : nom, fichier, emprise MN95. python3 outils/ponts/indexer.py"""
import json, glob, os
D = os.path.join(os.path.dirname(__file__), "..", "..", "public", "ponts")
I = []
for f in sorted(glob.glob(os.path.join(D, "*.json"))):
    if f.endswith("index.json"): continue
    P = json.load(open(f)); m = P["largeur"]; es = [p[0] for p in P["axe"]]; ns = [p[1] for p in P["axe"]]
    I.append({"nom": P["nom"], "fichier": os.path.basename(f), "boite": [min(es) - m, min(ns) - m, max(es) + m, max(ns) + m]})
json.dump(I, open(os.path.join(D, "index.json"), "w"), ensure_ascii=False)
print(len(I), "ponts")
