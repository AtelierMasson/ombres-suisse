"""Superpose le rendu calé de la maquette sur la photo : trois vues côte à côte (photo, rendu, mélange à 50 %) et un
calque des contours du rendu (en rouge) sur la photo, pour voir d'un coup d'œil les écarts de forme et de proportion.
   python3 -I outils/ponts/superposer.py photo.jpg rendu.jpg sortie.jpg "Titre"
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

photo, rendu, sortie = sys.argv[1:4]
titre = sys.argv[4] if len(sys.argv) > 4 else ""
P = Image.open(photo).convert("RGB")
R = Image.open(rendu).convert("RGB").resize(P.size, Image.LANCZOS)
H = 520
redim = lambda im: im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
melange = Image.blend(P, R, 0.5)
# contours du rendu : arêtes nettes (changements de teinte), épaissies, en rouge sur la photo
bords = R.convert("L").filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 28 else 0).filter(ImageFilter.MaxFilter(3))
calque = P.copy(); calque.paste((230, 30, 40), mask=bords)
vues = [redim(x) for x in (P, R, melange, calque)]
m, haut = 12, 44
W = sum(v.width for v in vues[:2]) + 3 * m
img = Image.new("RGB", (W, 2 * H + haut + 3 * m), "white")
img.paste(vues[0], (m, haut)); img.paste(vues[1], (2 * m + vues[0].width, haut))
img.paste(vues[2], (m, haut + H + m)); img.paste(vues[3], (2 * m + vues[2].width, haut + H + m))
d = ImageDraw.Draw(img)
try: f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
except Exception: f = ImageFont.load_default()
d.text((m, 12), f"{titre}  —  photo · rendu calé · mélange 50 % · contours du rendu sur la photo", fill="#222", font=f)
img.save(sortie, quality=88)
print(sortie, img.size)
