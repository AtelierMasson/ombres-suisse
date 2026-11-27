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

## 4. État au 27 novembre 2026 (étapes 1 à 3, une partie de 4 et 5)

Cause première des ponts « creux » : les faces du dessus de `pontsLegers` tournaient vers le bas (454 triangles sur 474
à Lutry, de même à Zurich et à Lausanne) alors que la matière du terrain ne montre que la face avant : la chaussée
n'était pas dessinée, on voyait l'intérieur du tablier (rives et dessous) sans la texture du sol.

### Fait
- **Grille** (`grille.js`) : `niveauLocal` (a : cases à plus d'un mètre sous le 75e centile du tablier à 3 m, retirées) ;
  `solSousPonts` + `relaxer` (b : sol sous l'emprise interpolé par relaxation de Laplace ; le sol mesuré à moins d'un
  mètre sous la chaussée n'est gardé que s'il tient au sol voisin hors de l'emprise, au même niveau). L'emprise n'est
  pas élargie d'un mètre : cela effaçait la rue aux bouts des ponts bas de Zurich (axe droit perdu). La chaussée reste
  le maximum par case ; les bords (garde-corps) sont écartés à l'ajustement (cases du milieu, médiane).
- **Axe** (c) : centres par tranche sans les tranches des coins, trois passes de lissage, droite si l'écart à la corde
  est sous 40 cm ; normales interpolées entre les nœuds (tangente continue) ; prolongement de 45 m dans la direction
  des 12 derniers mètres. L'axe droit des ponts courts (`axeDroit`) est gardé.
- **Rives** (c) : droite robuste (pont court) ou lissage de Whittaker robuste (λ = 1500) des écarts par station.
- **Profil en long** (d) : lissage de Whittaker robuste (λ = 60) sur la chaussée et 15 m de route de chaque côté ;
  dévers par moindres carrés, lissé ; `simplifierProfil` n'est plus utilisé pour les ponts.
- **Raccord** (e) : bout libre si la route ne rejoint pas le tablier dans les 15 m ; sinon joint là où le terrain
  affiché (`solAffiche`, triangles d'un mètre) rejoint le profil à 25 cm près sur 2 m ; fondu sur 3 m, puis 1,5 m sous
  le terrain (6 à 36 cm) ; tablier plein jusqu'à 60 cm sous le terrain quand la hauteur libre est sous 1,2 m, face de
  culée au passage plein / ajouré. Le profil n'est pas gravé dans `G.sol` (voir « Reste »).
- **Dessus** (f) : faces tournées vers le haut (vérifié triangle par triangle), normales de la surface ajustée,
  fondues dans celles du terrain au raccord ; 2 à 6 bandes en travers.
- **Allègement** (g) : sections tous les mètres puis Douglas-Peucker à 5 cm sur les points du dessus et le dessous
  (64 sections pour 172 m courbes, 79 pour 430 m) ; épaisseur relevée par station puis lissée (pas constante : les
  tabliers à hauteur variable gardent leur forme) ; piles comme avant, bornées aux rives.
- **Repli** (g) : emprise ajustée / relevée (IoU) sous 0,7 ou écart médian de hauteur au-dessus de 0,4 m, ou erreur :
  le pont est rendu par `tabliersPonts`. Seuil à 0,7 et non 0,8 : le Bleicherweg (0,75, tablier aussi large que long,
  bouts en biais) est mieux rendu par le modèle. Aucun des ponts d'essai ne passe en repli.
- **Bord du modèle** : `decouperCercle` coupe la chaussée au cercle (elle dépassait de 25 m sur l'anneau, sans rives) ;
  une paroi ferme le pont coupé le long du cercle.

### Mesures (avant → après)
Part des cases du tablier couvertes par une face du dessus visible ; écart médian chaussée / relevé.

| Pont | Couvert | Écart |
|---|---|---|
| Lutry, pont courbe de 172 m | 2 % → 97 % | 9 → 1 cm |
| Lutry, pont coupé par le cercle | 5 % → 91 % | 18 → 2 cm |
| Zurich, Dreikönigstrasse | 0 % → 100 % | 7 cm |
| Zurich, Bleicherweg | 0 % → 99 % | 2 cm |
| Lausanne, Chauderon | 1 % → 99 % | 6 → 3 cm |
| Zurich, Münsterbrücke (lien « Quaibrücke », au bord du cercle) | 1 % → 99 % | 4 → 1 cm |
| A9, viaducs de la Lutrive (430 m) | 1 % → 98 % et 100 % | 6 → 1 cm |

### Reste
- Étape 4 : `modeliserPonts(G, nuage)` → `G.ponts` avant la coupe au cercle, un seul mailleur avec `pontsModeles.js`,
  et le profil gravé dans `G.sol` avant le joint. Aujourd'hui le terrain garde sa forme : là où il dépasse la
  chaussée de quelques centimètres près du joint, c'est lui qu'on voit (même texture, léger ressaut).
- Rive au-dessus d'un talus ou d'un mur au raccord (plus de 1,5 m d'écart) : le point reste au niveau du profil, la
  chaussée fait un pli vers ses voisins.
- Au cercle, le pont du relevé s'arrête net et celui de swissTLM3D (anneau) reprend avec une autre géométrie : marche
  visible. Les ponts faits main (`maillagePont`) ne sont pas fermés par une paroi au cercle.
- Étape 5 : piles regroupées en (s, t) et espacement régularisé, épaisseur constante, section en T ; arches (Chauderon
  est rendu en poutre droite sur piles, comme avant).
- Étape 6 : tabliers jumeaux soudés (viaducs de la Lutrive : une seule chaussée de 27 m), ponts superposés, axe
  swissTLM3D comme a priori.
- Hors ponts, vu aux viaducs de la Lutrive : le ruisseau s'étale en une grande nappe d'eau inclinée (présente avant
  ces changements).
