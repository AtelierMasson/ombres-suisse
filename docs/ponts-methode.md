# Ponts reconstruits automatiquement : méthode recommandée

Rapport d'un agent Fable 5.2 (réflexion « high »), 27 novembre 2026, à partir de la lecture de grille.js, maillages.js,
scene.js et pontsModeles.js. Feuille de route pour des ponts qui affleurent le terrain, avec la texture du sol continue
sur la chaussée, un aspect lisse et une forme générale juste.

## Principe
- Un modèle par pont, calculé une fois (`modeliserPonts(G, nuage)` → `G.ponts`, même schéma que les JSON de
  pontsModeles.js) ; un seul mailleur (`maillagePont`) pour les ponts automatiques et faits main.
- Le terrain passe toujours sous le pont, sauf sur les deux lignes de joint.
- Le terrain est modifié dans un couloir borné (largeur du tablier + 2 m), jamais là où il est mesuré sous une grande travée.

## 1. Méthode
a. **Cases pont** (`depuisPoints`) : comparer `pont` au sol mesuré (avant `remplir`) ; filtre de niveau local (≤ 1 m
   sous le 75e centile sur 6 m), les cases basses rendues au sol ; chaussée tirée des points bruts près de l'axe (le
   maximum par case prend garde-corps et parois antibruit).
b. **Sol sous le pont** (`remplir`) : relaxation de Laplace sous l'emprise dilatée de 1 m, bords fixés au sol mesuré
   (supprime les falaises le long du tablier) ; sol mesuré gardé seulement s'il est > 1 m sous le tablier.
c. **Axe et largeur** : bords classés en raccords (sol à ±0,5 m du tablier) et rives ; axe ajusté (droite, arc ou
   courbe lissée, tangente aux bouts sur 15–20 m), tangente continue dans `surAxe` ; rives par quantiles 2–98 % des
   points au niveau du tablier, largeur constante ou linéaire.
d. **Profil en long** : une courbe lisse z(s) ajustée sur le tablier et 10–15 m de route de chaque côté ; dévers
   linéaire ; abandonner `simplifierProfil(profils.h, 0.1, 1)` (décale vers le haut, marche aux bouts).
e. **Raccord** : joint là où le terrain rejoint le profil à ±0,25 m sur 2 m (cherché jusqu'à 15 m) ; avant le joint,
   graver le profil dans `G.sol` (fondu latéral 2 m) et prolonger le tablier de 5–10 cm sous le terrain ; dans
   l'emprise érodée de 1,5 m, `sol ≤ chaussée − 0,3` ; culée pleine tant que la hauteur libre < ~1,2 m ; hauteurs lues
   sur le terrain affiché (triangles de 1 m), pas avec `solEn`.
f. **Texture** : uv déjà continus ; la couture vient des normales à facettes de la chaussée : prendre les normales de
   la surface ajustée.
g. **Dessous, piles** : épaisseur constante par pont (0,6 m à portée/20) ; piles regroupées en (s, t), ≥ 50 % de la
   hauteur libre et 4 m de dégagement, espacement régularisé ; sections seulement aux courbures (flèche 5 cm) et aux
   appuis (150–300 triangles pour 100 m droit) ; repli sur `tabliersPonts` si IoU < 0,8 ou écart z > 0,4 m.

## 2. Pièges
| Cas | Traitement |
|---|---|
| Pont courbe | Axe ajusté, sections perpendiculaires à la tangente continue. |
| Deux tabliers parallèles | `fermer(pont, n, 2)` peut souder la fente : scinder s'il y a un vide persistant en t ou deux niveaux. |
| Pont sur l'eau | `gagnee` (grille.js) coupe la rivière sous le pont : autoriser si `pont[q] > niv + 1`. |
| Pont au-dessus d'une route | Ne pas imposer le terrain ni graver hors de l'emprise. |
| Ponts superposés | Une valeur par case : bout haut au-dessus du sol = bout libre ; réunir deux bouts libres alignés. |
| Viaduc très haut | Ne toucher le sol qu'aux culées ; filtre du dessous lié à la portée (7 m trop court pour un caisson variable). |
| Petit pont < 20 m | Axe droit entre les deux groupes de raccords ; attention à la main courante d'une passerelle. |
| Coupé par le cercle ou un modèle fait main | Modéliser avant la coupe ; écarter un pont auto recouvert à > 50 % par un modèle. |

## 3. Ordre de mise en œuvre
1. Grille (a, b, eau sous les ponts) : falaises, mur plein, bouts rognés.
2. Raccord (e, f) dans le `pontsLegers` actuel : jours et couture d'éclairage.
3. Rives et profil (c, d).
4. Refonte en `G.ponts` avec `maillagePont` et le garde-fou de repli.
5. Piles et épaisseur (g), section en T éventuelle.
6. Cas particuliers (tabliers jumeaux, superposés, arches) ; l'axe swissTLM3D (outils/ponts/recenser.py) comme a priori.
