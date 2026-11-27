# Terrain TIN (triangulation adaptative)

Troisième maillage de terrain, à côté de « swisstopo » et « Relevé 0,5 m » : un réseau de triangles irréguliers
tiré de la grille du sol (G.sol, 0,5 m, points « sol » du relevé). Grands triangles sur le plat, sommets serrés
sur les arêtes de talus, murs de soutènement, bords de route et ruptures de pente.

Fichiers : `src/tinNoyau.js` (algorithme, sans dépendance), `src/terrainTIN.worker.js` (Web Worker),
`src/terrainTIN.js` (maillage three.js, hauteur, mesures), `tests/terrainTIN.test.mjs` (`node tests/terrainTIN.test.mjs [R]`).

## Méthode

1. **Grille de départ** : G.sol (la même que pour les ombres et les heures). Le bord du carré prend l'altitude du
   bord du socle. Les pointes et creux isolés (une cellule plus haute, ou plus basse, que ses 8 voisines de plus de
   25 cm) sont ramenés à la médiane 3 × 3 : poteaux, reflets, points mal classés. Un mur ou un talus n'est pas
   touché, parce qu'une marche continue n'est jamais un extrême strict de son voisinage.
2. **Insertion gloutonne** (Garland et Heckbert 1995, « terra » ; code adapté de Delatin, Mapbox, licence ISC) :
   on part de deux triangles. À chaque étape, on insère la cellule la plus éloignée verticalement du maillage, puis
   on rétablit la triangulation de Delaunay (bascules d'arêtes). Seuls les nouveaux triangles sont réévalués, grâce
   à une file de priorité. On s'arrête quand **toutes** les cellules sont à moins de la tolérance (10 cm par
   défaut), ou quand le budget de triangles est atteint.
3. **Lignes de rupture** : rien n'est lissé. Une cellule au pied ou en haut d'un mur qui s'écarte de plus de 10 cm
   devient un sommet, et le mur reste une marche sur la largeur d'une cellule (0,5 m), au lieu d'une rampe de 1 à
   2 m dans la grille affichée (sommets tous les 1 m). Les normales gardent des « arêtes vives » : un coin ne lisse
   qu'avec les triangles voisins à moins de 60° du sien.
4. **Budget** : au plus autant de triangles que la grille affichée (`BUDGET_TIN = 1`). En terrain très accidenté,
   c'est le budget qui arrête le calcul. Le TIN est alors la meilleure approximation pour ce nombre de triangles,
   et l'écart atteint dépasse la tolérance (27 cm à Leysin, au lieu de 15 m d'écart maximal pour la grille).
5. **Maquette ronde** : les cellules au-delà de R + 2 m sont ignorées. Un anneau clairsemé de sommets imposés
   (tous les 8 m, à R + 0,75 m) empêche un grand triangle de traverser le cercle. Les triangles qui touchent le cercle
   sont coupés (`decouperCercle`), et leurs sommets du bord prennent l'altitude de la grille, si bien que le raccord
   avec la paroi du socle est exact. **Piscines** : les triangles autour du bassin (rectangle + 1 m) sont retirés,
   et le trou est retriangulé jusqu'au contour exact du bassin, comme dans la grille.
6. **Géométrie** indexée : position, normale, uv du fond de plan, comme `terrain()`. Les matériaux, les ombres
   reçues, le fond de plan et le clic fonctionnent sans changement.

## Accroche

- `scene.terrainAffiche("tin" | "grille")` : promesse. Le TIN est calculé dans le Worker et gardé sur G par
  réglage, puis la géométrie de `couches.terrain` est remplacée. Le choix est gardé d'un lieu à l'autre.
- `scene.construire(G, nuage, parcelle, urls, { terrain: "tin" })` : même chose dès la construction (la grille
  s'affiche d'abord, le TIN la remplace dès qu'il est prêt).
- Coupe : `profilCoupe` lit `G.tin.hauteur(x, y)` quand le TIN est affiché.
- Ombres, heures, ensoleillement, export : toujours sur la grille G.sol.
- Si G.sol change (piscine creusée après coup), appeler `oublierTIN(G)` puis `terrainAffiche("tin")`.

## Mesures

Navigateur (onglet du panneau, souvent en arrière-plan : les durées sont pessimistes). Le noyau tourne dans le
Worker ; le maillage three.js est construit dans le fil principal. Écarts « à la grille » : aux centres des
cellules de G.sol, dans le cercle. Écarts « aux points » : un point « sol » (classe 2) sur quatre, hors des lacs
et du dessous des ponts.

| Lieu (rayon) | Source | Grille affichée | TIN 10 cm, budget 1 | TIN 5 cm, sans budget |
|---|---|---|---|---|
| Lutry (213 m) | nuage 2,6 M pts | 285 698 tri., 9,3 Mo, 60–180 ms | 283 051 tri. (écart atteint 10,3 cm), 10,3 Mo, noyau 0,43 s + maillage 0,2–0,3 s | 544 840 tri., 17,8 Mo, 0,87 s + 0,45 s |
| Berne vieille ville (150 m) | rasters swissALTI3D (pas de COPC sur cette tuile) | 142 378 tri. | **35 791 tri. (−75 %)**, 1,4 Mo, 0,1 s + 0,05 s | 78 923 tri., 0,15 s + 0,05 s |
| Zermatt (150 m) | rasters (pas de COPC) | 142 378 tri. | **68 872 tri. (−52 %)**, 2,5 Mo, 0,15 s + 0,04 s | 134 510 tri. |
| Leysin, alpin (300 m) | nuage 13,2 M pts | 567 434 tri., 18,4 Mo, 130 ms | 564 493 tri. (budget atteint, écart 27 cm), 26,7 Mo, 1,0–1,3 s + 0,3–0,4 s | 1 788 853 tri., 64 Mo, 2,9 s + 1,8 s |

Écart à la grille 0,5 m (max / p99 / RMS) :

| Lieu | Grille affichée (1 m) | TIN 10 cm, budget 1 | TIN 5 cm |
|---|---|---|---|
| Lutry | 3,96 m / 60 cm / 13 cm | 10 cm (*) / 9,8 cm / 4,1 cm | 5 cm (*) / 4,8 cm / 2,4 cm |
| Berne | 4,93 m / 45 cm / 13 cm | 10 cm / 8,6 cm / 3,1 cm | 5 cm / 4,6 cm / 1,7 cm |
| Zermatt | 1,98 m / 41 cm / 8,8 cm | 10 cm (*) / 9 cm / 3,4 cm | 5 cm (*) / 4,7 cm / 2,0 cm |
| Leysin | 15,4 m / 84 cm / 29 cm | 30 cm / 26 cm / 10,5 cm | 5 cm / 4,7 cm / 1,3 cm |

(*) hors cellules épointées : 313 à Lutry et 128 à Zermatt, où le TIN s'écarte volontairement de la grille
(jusqu'à 4 m, sur une pointe isolée).

Écart aux points « sol » du nuage (RMS / p99) : à Lutry, 11,3 cm / 29 cm pour le TIN, 12,1 cm / 38 cm pour la grille
affichée et 10,8 cm / 28 cm pour la grille 0,5 m. Le TIN garde donc l'information de la grille 0,5 m avec autant de
triangles que la grille affichée. À Leysin (forte pente, forêt), les trois sont à environ 75 cm RMS, avec un
biais de −21 cm. Cet écart vient de la grille elle-même (le sol d'une cellule est son point le plus bas), pas du
maillage.

Captures (même vue, même lumière ; arbres masqués) : `docs/terrain-tin/lutry-grille.jpg` et `lutry-tin.jpg`
(route en remblai et murs de soutènement : bords nets dans le TIN, arrondis sur 1 à 2 m dans la grille) ;
`berne-grille.jpg` et `berne-tin.jpg` (talus de l'Aare sous la vieille ville).

## Limites

- La précision ne dépasse pas celle de G.sol : 0,5 m en plan. Le sol d'une cellule est son point le plus bas, d'où
  un biais de −6 cm (Lutry) à −21 cm (pente raide) par rapport aux points. Prendre la médiane des points sol par
  cellule pour les sommets du TIN réduirait ce biais. Cela n'a pas été fait ici, pour rester identique à la grille
  des calculs.
- Un mur est une marche sur une cellule (0,5 m), pas une verticale. Il n'y a pas encore de vraies lignes de rupture
  contraintes (Delaunay contraint sur des arêtes de mur détectées).
- Près du bord d'une maquette carrée, les sommets du bord sont repoussés de 0,25 m jusqu'au bord. L'écart peut y
  atteindre environ 1,5 × la tolérance.
- Terrain très accidenté : le budget limite la finesse (Leysin : 27 cm). `calculerTerrainTIN(G, { budget: 0 })`
  lève la limite, mais le maillage pèse alors 2 à 3 fois la grille.
- Le maillage three.js (normales, piscines, cercle) est construit dans le fil principal : 0,05 à 0,4 s selon le lieu,
  une fois par lieu (comparable à `terrain()`, 0,06 à 0,18 s). Seul le noyau tourne dans le Worker.
- Sans nuage classé (repli raster swissALTI3D), le TIN simplifie la grille raster, qui est déjà lisse : c'est là
  qu'il gagne le plus de triangles.
