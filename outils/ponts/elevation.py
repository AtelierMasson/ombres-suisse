"""Élévations SVG des essais de ponts (outils/ponts/essais/*.json), côte à côte : python3 outils/ponts/elevation.py sortie.svg"""
import json, glob, math, os, sys
fichiers = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "essais", "*.json")))
W, H, marge = 520, 240, 20
blocs = []
for k, f in enumerate(fichiers):
    try: P = json.load(open(f))
    except Exception as e: blocs.append((f, None, str(e))); continue
    blocs.append((f, P, None))
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{(H + 40) * len(blocs)}" font-family="system-ui" font-size="11">']
for k, (f, P, err) in enumerate(blocs):
    oy = k * (H + 40)
    svg.append(f'<text x="8" y="{oy + 16}" font-weight="700">{os.path.basename(f)}</text>')
    if not P: svg.append(f'<text x="8" y="{oy + 32}" fill="red">{err}</text>'); continue
    axe = P["axe"]; s = [0.0]
    for a, b in zip(axe, axe[1:]): s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    L = s[-1] or 1
    zc = lambda t: next((axe[i][2] + (axe[i + 1][2] - axe[i][2]) * (t - s[i]) / ((s[i + 1] - s[i]) or 1) for i in range(len(s) - 1) if t <= s[i + 1] + 1e-6), axe[-1][2])
    zs = [p[2] for p in axe] + [a.get("z_bas", axe[0][2]) for a in P.get("appuis", []) if "z_bas" in a] + [a.get("z_naissance", axe[0][2]) for a in P.get("arches", [])]
    zmin, zmax = min(zs) - 2, max(zs) + 3
    e = min((W - 2 * marge) / L, (H - 30) / (zmax - zmin))
    X = lambda t: marge + t * e; Y = lambda z: oy + 25 + (zmax - z) * e
    ep = P.get("epaisseur", 1)
    pts = " ".join(f"{X(t):.1f},{Y(zc(t)):.1f}" for t in s) + " " + " ".join(f"{X(t):.1f},{Y(zc(t) - ep):.1f}" for t in reversed(s))
    svg.append(f'<polygon points="{pts}" fill="#7a8692"/>')
    for a in P.get("appuis", []):
        if a.get("type") != "pile": continue
        l = a.get("long", 2); t = a["s"]; zb = a.get("z_bas", zc(t) - 10); zt = zc(t) - ep
        svg.append(f'<rect x="{X(t - l / 2):.1f}" y="{Y(zt):.1f}" width="{l * e:.1f}" height="{(zt - zb) * e:.1f}" fill="#b9a98f"/>')
    for a in P.get("arches", []):
        s0, s1, zn, zk, th = a["s0"], a["s1"], a["z_naissance"], a["z_cle"], a.get("epaisseur", 1)
        n = 24; arc = [(s0 + (s1 - s0) * i / n, zn + (zk - zn) * (1 - (2 * i / n - 1) ** 2)) for i in range(n + 1)]
        haut = " ".join(f"{X(t):.1f},{Y(z + th):.1f}" for t, z in arc); bas = " ".join(f"{X(t):.1f},{Y(z):.1f}" for t, z in reversed(arc))
        svg.append(f'<polygon points="{haut} {bas}" fill="{"#b9a98f" if a.get("plein") else "#55606b"}"/>')
        if a.get("plein"):
            svg.append(f'<polygon points="{haut} ' + " ".join(f"{X(t):.1f},{Y(zc(t) - ep):.1f}" for t, _ in reversed(arc)) + '" fill="#b9a98f"/>')
    svg.append(f'<text x="8" y="{oy + H + 32}" fill="#555">L {L:.0f} m · largeur {P.get("largeur")} m · {sum(a.get("type") == "pile" for a in P.get("appuis", []))} piles · {len(P.get("arches", []))} arches · confiance {P.get("confiance")}</text>')
svg.append("</svg>")
open(sys.argv[1] if len(sys.argv) > 1 else "elevations.svg", "w").write("\n".join(svg))
print(len(blocs), "essais")
