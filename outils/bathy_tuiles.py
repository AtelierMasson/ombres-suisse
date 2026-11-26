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
pas = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0
os.makedirs(sortie, exist_ok=True)

z = zipfile.ZipFile(zip_chemin)
membres = [n for n in z.namelist() if n.lower().endswith((".asc", ".txt", ".grd"))]
print(f"{len(membres)} grilles dans {zip_chemin}", flush=True)
tuiles, cases = {}, None

def traiter(nom):
    """Une grille ESRI ASCII (souvent 1 km) : moyennes par case de sortie, rangées dans les tuiles kilométriques."""
    global cases, pas_sortie
    f = io.TextIOWrapper(z.open(nom), encoding="ascii")
    tete = {}
    while len(tete) < 6:
        ligne = f.readline().split()
        tete[ligne[0].lower()] = float(ligne[1])
    ncols, nrows, c = int(tete["ncols"]), int(tete["nrows"]), tete["cellsize"]
    x0 = tete["xllcorner"] if "xllcorner" in tete else tete["xllcenter"] - c / 2
    y0 = tete["yllcorner"] if "yllcorner" in tete else tete["yllcenter"] - c / 2
    vide = tete.get("nodata_value", -9999)
    k = max(1, int(round(pas / c)))
    pas_sortie = k * c
    if cases is None: cases = int(round(1000 / pas_sortie)); print(f"maille {c} m, regroupée par {k} -> {pas_sortie} m, {cases} cases par tuile", flush=True)
    donnees = np.loadtxt(f, dtype=np.float32, ndmin=2)[:nrows, :ncols]
    haut = y0 + nrows * c
    lr, lc = nrows // k, ncols // k
    b = donnees[: lr * k, : lc * k].reshape(lr, k, lc, k)
    valide = b != vide
    n = valide.sum(axis=(1, 3))
    moy = np.where(valide, b, 0).sum(axis=(1, 3)) / np.maximum(n, 1)
    for r, q in zip(*np.nonzero(n > 0)):
        xc, yc = x0 + (q + 0.5) * pas_sortie, haut - (r + 0.5) * pas_sortie
        E, N = int(xc // 1000), int(yc // 1000)
        T = tuiles.get((E, N))
        if T is None: T = tuiles[(E, N)] = np.zeros((cases, cases), dtype=np.uint16)
        col, lig = int((xc - E * 1000) // pas_sortie), int(((N + 1) * 1000 - yc) // pas_sortie)
        if 0 <= col < cases and 0 <= lig < cases: T[lig, col] = int(round(moy[r, q] * 10))

pas_sortie = pas
for i, nom in enumerate(membres):
    traiter(nom)
    if i % 50 == 0: print(f"  {i}/{len(membres)}", flush=True)
pas = pas_sortie

for (E, N), T in tuiles.items():
    T.astype("<u2").tofile(os.path.join(sortie, f"{E}-{N}.bin"))
with open(os.path.join(sortie, "index.json"), "w") as o:
    json.dump({"pas": pas, "cases": cases, "unite": "dm", "tuiles": sorted(f"{E}-{N}" for E, N in tuiles)}, o)
print(f"{len(tuiles)} tuiles écrites dans {sortie}", flush=True)
