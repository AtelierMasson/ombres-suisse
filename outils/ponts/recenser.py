"""Recensement des ponts routiers de swissTLM3D (couche TLM_STRASSE, extraite par zip_distant.py) :
ponts des autoroutes, semi-autoroutes et routes de la Confédération ou des cantons, d'au moins SEUIL mètres.

   python3 outils/ponts/recenser.py <dossier tlm> <sortie.json> [seuil m = 50]

Les tronçons « pont » qui se touchent (même ouvrage coupé en plusieurs morceaux) sont réunis ; la longueur est celle
de l'axe (en plan). Sortie : liste [{ id, nom, type, proprietaire, longueur, axe: [[E, N, Z], …], boite }] et un résumé.
"""
import json, math, os, struct, sys
from collections import defaultdict

dossier, sortie = sys.argv[1], sys.argv[2]
SEUIL = float(sys.argv[3]) if len(sys.argv) > 3 else 50.0


def lire_dbf(chemin, garder):
    """Enregistrements du .dbf : renvoie (champs, générateur de dict des champs `garder`)."""
    f = open(chemin, "rb")
    entete = f.read(32)
    n, lg_entete, lg_rec = struct.unpack("<IHH", entete[4:12])
    champs, pos = [], 1
    while True:
        d = f.read(32)
        if d[0] == 0x0D: break
        nom = d[:11].split(b"\0")[0].decode("latin-1")
        champs.append((nom, chr(d[11]), d[16], pos)); pos += d[16]
    f.seek(lg_entete)
    idx = [(c[0], c[3], c[2]) for c in champs if c[0] in garder]

    def recs():
        for i in range(n):
            r = f.read(lg_rec)
            yield i, {nom: r[p:p + l].decode("utf-8", "replace").strip() for nom, p, l in idx}
    return champs, n, recs()


def lire_shp(chemin, voulus):
    """Géométries (polylignes Z) des enregistrements `voulus` (indices) : {indice: [[(x, y, z), …], …]}."""
    f = open(chemin, "rb")
    f.seek(100)
    res, i = {}, 0
    while True:
        tete = f.read(8)
        if len(tete) < 8: break
        lg = struct.unpack(">i", tete[4:8])[0] * 2
        contenu = f.read(lg)
        if i in voulus:
            typ = struct.unpack("<i", contenu[:4])[0]
            if typ in (3, 13, 23):
                nparts, npts = struct.unpack("<ii", contenu[36:44])
                parts = struct.unpack(f"<{nparts}i", contenu[44:44 + 4 * nparts])
                o = 44 + 4 * nparts
                xy = struct.unpack(f"<{2 * npts}d", contenu[o:o + 16 * npts])
                z = struct.unpack(f"<{npts}d", contenu[o + 16 * npts + 16:o + 16 * npts + 16 + 8 * npts]) if typ == 13 else [0.0] * npts
                bornes = list(parts) + [npts]
                res[i] = [[(xy[2 * k], xy[2 * k + 1], z[k]) for k in range(bornes[p], bornes[p + 1])] for p in range(nparts)]
        i += 1
    return res


dbf = os.path.join(dossier, "swissTLM3D_TLM_STRASSE.dbf")
champs, n, _ = lire_dbf(dbf, set())
print(f"{n} tronçons ; champs : {', '.join(c[0] for c in champs)}", flush=True)
noms = {c[0] for c in champs}
K = next(c for c in ("KUNSTBAUTE", "KUNSTBAUT") if c in noms)
O = "OBJEKTART"
P = next((c for c in ("EIGENTUEME", "EIGENTUEMER") if c in noms), None)
NOM = next((c for c in ("STRASSENNA", "NAME") if c in noms), None)
_, _, recs = lire_dbf(dbf, {K, O, P, NOM, "UUID"} - {None})

valeurs_k, valeurs_o, valeurs_p = defaultdict(int), defaultdict(int), defaultdict(int)
ponts = {}
AUTOROUTE = {"Autobahn", "Autostrasse", "Ein_Ausfahrt", "Einfahrt", "Ausfahrt", "Verbindung", "Dienstzufahrt"}
for i, r in recs:
    valeurs_k[r[K]] += 1
    if "Bruecke" not in r[K] and "Brücke" not in r[K]: continue
    valeurs_o[r[O]] += 1
    if P: valeurs_p[r[P]] += 1
    type_route = r[O]
    proprio = r.get(P, "") if P else ""
    # autoroutes et semi-autoroutes (et leurs bretelles), ou routes de la Confédération ou d'un canton
    if not (type_route in AUTOROUTE or proprio in ("Bund", "Kanton")): continue
    ponts[i] = {"type": type_route, "proprietaire": proprio, "nom": r.get(NOM, "") if NOM else ""}
print("ouvrages (KUNSTBAUTE) :", dict(valeurs_k), flush=True)
print("ponts par type de route :", dict(valeurs_o), flush=True)
print("ponts par propriétaire :", dict(valeurs_p), flush=True)
print(f"{len(ponts)} tronçons de pont retenus ; lecture des géométries…", flush=True)
geom = lire_shp(os.path.join(dossier, "swissTLM3D_TLM_STRASSE.shp"), set(ponts))

# tronçons qui se touchent (bout à bout, à 1 m près) : un même ouvrage
cle = lambda p: (round(p[0]), round(p[1]))
bouts = defaultdict(list)
for i, g in geom.items():
    for part in g:
        for p in (part[0], part[-1]): bouts[cle(p)].append(i)
parent = {i: i for i in geom}
def racine(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
for l in bouts.values():
    for a in l[1:]: parent[racine(a)] = racine(l[0])
groupes = defaultdict(list)
for i in geom: groupes[racine(i)].append(i)

resultat = []
for g in groupes.values():
    lignes = [part for i in g for part in geom[i]]
    longueur = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for part in lignes for a, b in zip(part, part[1:]))
    # une chaussée par sens : les deux tronçons parallèles d'une autoroute sont deux ouvrages ; on garde la longueur
    # de chaque groupe (axe le plus long), pas la somme
    plus_long = max(lignes, key=lambda part: sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(part, part[1:])))
    lg_axe = longueur if len(g) > 1 else sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(plus_long, plus_long[1:]))
    if lg_axe < SEUIL: continue
    xs = [p[0] for part in lignes for p in part]; ys = [p[1] for part in lignes for p in part]
    info = ponts[g[0]]
    resultat.append({"id": len(resultat), "nom": next((ponts[i]["nom"] for i in g if ponts[i]["nom"]), ""), "type": info["type"],
                     "proprietaire": info["proprietaire"], "longueur": round(lg_axe, 1), "troncons": len(g),
                     "boite": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                     "axe": [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in plus_long]})
resultat.sort(key=lambda p: -p["longueur"])
for k, p in enumerate(resultat): p["id"] = k
json.dump(resultat, open(sortie, "w"), ensure_ascii=False)
par_type, par_prop = defaultdict(int), defaultdict(int)
for p in resultat: par_type[p["type"]] += 1; par_prop[p["proprietaire"]] += 1
print(f"\n{len(resultat)} ponts d'au moins {SEUIL:.0f} m ; par type : {dict(par_type)} ; par propriétaire : {dict(par_prop)}")
for s in (30, 50, 100, 200, 500):
    print(f"  ≥ {s} m : {sum(p['longueur'] >= s for p in resultat)}")
print("les plus longs :", [(p["nom"] or p["type"], p["longueur"]) for p in resultat[:15]])
