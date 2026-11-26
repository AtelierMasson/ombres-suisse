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
    ncols, nrows, c = int(tete["ncols"]), int(tete["nrows"]), tete["cellsize"]
    x0 = tete["xllcorner"] if "xllcorner" in tete else tete["xllcenter"] - c / 2
    y0 = tete["yllcorner"] if "yllcorner" in tete else tete["yllcenter"] - c / 2
    vide = tete.get("nodata_value", -9999)
    k = max(1, int(round(pas / c)))
    pas_sortie = k * c
    if abs(pas_sortie - pas) > 1e-6: raise SystemExit(f"maille {c} m : {pas} m n'est pas un multiple, choisir un autre pas")
    if cases is None: cases = int(round(1000 / pas)); print(f"maille {c} m, regroupée par {k} -> {pas_sortie} m, {cases} cases par tuile", flush=True)
    donnees = np.loadtxt(io.StringIO(premiere + f.read()), dtype=np.float32, ndmin=2)[:nrows, :ncols]
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
        if 0 <= col < cases and 0 <= lig < cases: T[lig, col] = int(round((moy[r, q] + DECALAGE) * 10))

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
