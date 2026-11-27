"""Calage d'une photo sur la maquette : retrouve la caméra (position, visée, focale, roulis) à partir de points repérés
à la fois sur la photo (pixels) et dans le monde (MN95 + altitude). Au moins 4 points, 6 à 10 c'est mieux, bien
répartis (haut et bas, gauche et droite, près et loin).

   python3 -I outils/ponts/caler_photo.py points.json > camera.json

points.json : { "largeur": 1920, "hauteur": 1440,
                "points": [ { "nom": "sommet pylône ouest", "px": [1004, 150], "mn95": [2578990.1, 1184847.3, 636.3] }, … ] }
Sortie : { "position": [E, N, Z], "vise": [E, N, Z], "fov_vertical": deg, "roulis": deg, "erreur_px": moyenne,
           "residus": [{nom, dx, dy}] } ; un point mal repéré a un gros résidu : le corriger ou le retirer.

Modèle : caméra sténopé, centre optique au milieu de l'image, pixels carrés, sans distorsion. Moindres carrés
(Levenberg-Marquardt) sur 7 inconnues : position (3), orientation (3, vecteur de rotation), focale (1).
"""
import json, math, os, sys
import numpy as np

d = json.load(open(sys.argv[1]))
W, H = d["largeur"], d["hauteur"]
P = d["points"]
X = np.array([p["mn95"] for p in P], float)
u = np.array([p["px"] for p in P], float)
o = X.mean(axis=0)          # origine locale (précision numérique)
Xl = X - o


def rot(v):
    t = np.linalg.norm(v)
    if t < 1e-12: return np.eye(3)
    k = v / t; K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * K @ K


def projeter(q):
    C, r, f = q[:3], q[3:6], q[6]
    R = rot(r)                                   # monde -> caméra (x droite, y bas, z avant)
    Pc = (R @ (Xl - C).T).T
    return np.stack([W / 2 + f * Pc[:, 0] / Pc[:, 2], H / 2 + f * Pc[:, 1] / Pc[:, 2]], 1), Pc[:, 2]


def residus(q):
    if q[6] <= 1: return np.full(2 * len(P), 1e4)   # focale positive (sinon solution en miroir)
    pr, z = projeter(q)
    r = (pr - u).ravel()
    r = np.where(np.repeat(z, 2) > 0, r, 1e4)
    if os.environ.get("ROULIS") is not None:    # roulis imposé (degrés, photo d'aplomb : 0) par un terme de pénalité
        r = np.r_[r, 300 * (math.degrees(math.asin(max(-1, min(1, rot(q[3:6])[0][2])))) - float(os.environ["ROULIS"]))]
    return r


def depart(C, cible, f):
    # rotation qui vise `cible` depuis C, horizon horizontal : z caméra = visée, x = droite (horizontal), y = bas
    zc = cible - C; zc /= np.linalg.norm(zc)
    xc = np.cross(zc, [0, 0, 1.0]); xc /= np.linalg.norm(xc)
    yc = np.cross(zc, xc)
    R = np.stack([xc, yc, zc])
    # vecteur de rotation de R (formule de Rodrigues inverse)
    a = math.acos(max(-1, min(1, (np.trace(R) - 1) / 2)))
    if a < 1e-9: return np.r_[C, 0, 0, 0, f]
    v = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * math.sin(a)) * a
    return np.r_[C, v, f]


def lm(q):
    lam = 1e-3
    e = residus(q); c = e @ e
    for _ in range(400):
        J = np.zeros((len(e), 7))
        for k in range(7):
            h = 1e-4 * max(1, abs(q[k])); dq = np.zeros(7); dq[k] = h
            J[:, k] = (residus(q + dq) - e) / h
        A = J.T @ J; g = J.T @ e
        pas = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), -g)
        q2 = q + pas; e2 = residus(q2); c2 = e2 @ e2
        if c2 < c: q, e, c, lam = q2, e2, c2, lam / 3
        else: lam *= 4
        if np.linalg.norm(pas) < 1e-7: break
    return q, c


# départs : caméra autour du nuage de points, à plusieurs distances et directions ; la meilleure solution gagne
centre = Xl.mean(axis=0); taille = np.ptp(Xl[:, :2], axis=0).max() + 50
meilleur = None
for dist in (0.7, 1.2, 2.0, 3.5):
    for az in range(0, 360, 30):
        for hz in (-0.1, 0.05, 0.25):
            C = centre + taille * dist * np.array([math.cos(math.radians(az)), math.sin(math.radians(az)), hz])
            for f in (0.8 * W, 1.3 * W, 2.2 * W):
                q, c = lm(depart(C, centre, f))
                if meilleur is None or c < meilleur[1]: meilleur = (q, c)
q, c = meilleur
pr, _ = projeter(q)
R = rot(q[3:6]); C = q[:3] + o
avant = R[2]; bas = R[1]
fov = 2 * math.degrees(math.atan(H / 2 / q[6]))
# roulis : angle de l'axe « droite » de la caméra avec l'horizontale
roulis = math.degrees(math.asin(max(-1, min(1, R[0][2]))))
ecarts = pr - u
json.dump({
    "position": [round(float(x), 2) for x in C],
    "vise": [round(float(x), 2) for x in C + avant * 100],
    "haut": [round(float(x), 4) for x in -bas],
    "fov_vertical": round(fov, 2),
    "roulis": round(roulis, 2),
    "erreur_px": round(float(np.sqrt((ecarts ** 2).sum(1)).mean()), 1),
    "residus": [{"nom": p["nom"], "dx": round(float(a), 1), "dy": round(float(b), 1)} for p, (a, b) in zip(P, ecarts)],
}, sys.stdout, ensure_ascii=False, indent=1)
print()
