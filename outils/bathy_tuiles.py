#!/usr/bin/env python3
"""
Découpe un fond de lac swissBATHY3D (grille ESRI ASCII zippée, swisstopo) en tuiles légères pour le site.

  python3 outils/bathy_tuiles.py <fichier.zip> <dossier de sortie> [pas en m, défaut 5]

Sortie : une tuile par kilomètre MN95 touché par le lac, « <E km>-<N km>.bin », 200 × 200 valeurs (pas de 5 m),
Uint16 petit-boutiste, ligne 0 au nord ; valeur = altitude du fond en décimètres (0 = pas de donnée). Plus un
« index.json » (liste des tuiles, pas, origine). Le fichier n'est jamais décompressé sur le disque : lu en flux.
"""
import io, json, os, sys, zipfile
import numpy as np

zip_chemin, sortie = sys.argv[1], sys.argv[2]
pas = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
DECALAGE = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0  # m ajoutés avant codage (fonds sous le niveau de la mer)
os.makedirs(sortie, exist_ok=True)

z = zipfile.ZipFile(zip_chemin)
membres = [n for n in z.namelist() if n.lower().endswith((".asc", ".txt", ".grd"))]
print(f"{len(membres)} grilles dans {zip_chemin}", flush=True)
tuiles, cases = {}, None

def traiter(nom):
    """Une grille ESRI ASCII (souvent 1 km) : moyennes par case de sortie, rangées dans les tuiles kilométriques."""
    global cases, pas_sortie
    f = io.TextIOWrapper(z.open(nom), encoding="ascii", errors="replace")
    # en-tête : lignes « clé valeur » jusqu'à la première ligne de chiffres (les lignes inattendues sont ignorées)
    tete, premiere = {}, None
    while True:
        ligne = f.readline()
        if not ligne: return
        mots = ligne.split()
        if not mots: continue
        if mots[0][0].isdigit() or mots[0][0] in "-.": premiere = ligne; break
        try: tete[mots[0].lower()] = float(mots[-1])
        except ValueError: pass
    if not all(k in tete for k in ("ncols", "nrows", "cellsize")):
        print(f"  {nom} : en-tête illisible {sorted(tete)}, ignorée", flush=True); return
    ncols, nrows, c = int(tete["ncols"]), int(tete["nrows"]), tete["cellsize"]
    x0 = tete["xllcorner"] if "xllcorner" in tete else tete["xllcenter"] - c / 2
    y0 = tete["yllcorner"] if "yllcorner" in tete else tete["yllcenter"] - c / 2
    vide = tete.get("nodata_value", -9999)
    if cases is None: cases = int(round(1000 / pas)); print(f"maille {c} m -> {pas} m, {cases} cases par tuile", flush=True)
    donnees = np.loadtxt(io.StringIO(premiere + f.read()), dtype=np.float32, ndmin=2)[:nrows, :ncols]
    haut = y0 + nrows * c
    # chaque case de la grille tombe dans la case de sortie qui contient son centre (maille quelconque : 1, 2, 3 m…)
    lig, col = np.nonzero(donnees != vide)
    if not len(lig): return
    zz = donnees[lig, col].astype(np.float64)
    X = x0 + (col + 0.5) * c; Y = haut - (lig + 0.5) * c
    gx = np.floor(X / pas).astype(np.int64); gy = np.floor(Y / pas).astype(np.int64)
    cle, inv = np.unique(gx * 10_000_000 + gy, return_inverse=True)
    somme = np.bincount(inv, weights=zz); nb = np.bincount(inv)
    for kk, sm, n in zip(cle, somme, nb):
        qx, qy = int(kk // 10_000_000), int(kk % 10_000_000)
        xc, yc = (qx + 0.5) * pas, (qy + 0.5) * pas
        E, N = int(xc // 1000), int(yc // 1000)
        T = tuiles.get((E, N))
        if T is None: T = tuiles[(E, N)] = np.zeros((cases, cases), dtype=np.uint16)
        cl, li = int((xc - E * 1000) // pas), int(((N + 1) * 1000 - yc) // pas)
        if 0 <= cl < cases and 0 <= li < cases: T[li, cl] = int(round((sm / n + DECALAGE) * 10))

pas_sortie = pas
for i, nom in enumerate(membres):
    traiter(nom)
    if i % 50 == 0: print(f"  {i}/{len(membres)}", flush=True)
pas = pas_sortie

# plusieurs lacs dans le même dossier : une tuile déjà là (lac voisin) est complétée, l'index est fusionné
for (E, N), T in tuiles.items():
    chemin = os.path.join(sortie, f"{E}-{N}.bin")
    if os.path.exists(chemin):
        A = np.fromfile(chemin, dtype="<u2").reshape(cases, cases)
        T = np.where(T > 0, T, A)
    T.astype("<u2").tofile(chemin)
idx = os.path.join(sortie, "index.json")
avant = set(json.load(open(idx))["tuiles"]) if os.path.exists(idx) else set()
with open(idx, "w") as o:
    # tuile décalée : notée « E-N@décalage » dans l'index
    suffixe = f"@{int(DECALAGE)}" if DECALAGE else ""
    json.dump({"pas": 1000 / cases, "cases": cases, "unite": "dm", "tuiles": sorted(avant | {f"{E}-{N}{suffixe}" for E, N in tuiles})}, o)
print(f"{len(tuiles)} tuiles écrites dans {sortie}", flush=True)
