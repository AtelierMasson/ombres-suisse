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

## 5. Session du 27 novembre (suite) : diagnostic mesuré et banc d'essai — code des ponts inchangé

Session interrompue (arrêt de la machine) après le diagnostic : **aucune ligne de `src/` n'a été modifiée**. Ce qui
est livré : un banc de mesure hors navigateur, les mesures de référence sur 15 sites, les causes identifiées et le
plan détaillé des étapes 4 à 6. Version de référence (« avant ») : commit `ff2efd5` (code des ponts identique à
`a1f178d`).

### Banc de mesure (`outils/ponts/banc/`)
Depuis ce dossier (Node ≥ 22 ; les modules de `src/` sont importés tels quels, `env.mjs` remplace `import.meta.env`) :
- `node charger.mjs <site…>` : nuage du site téléchargé comme le fait l'application (parcelle → centre, densité,
  disque de 303 m), gardé en cache (`$BANC_PONTS/cache`, par défaut le dossier temporaire ; 15 s par site).
- `node --import ./env.mjs banc.mjs <étiquette> [--src <dossier src>] [site[@rayon]…]` : grille + ponts comme
  `scene.construire`, mesures par pont dans `$BANC_PONTS/mesures/<étiquette>-<site>-<R>.json`. Si `maillages.js`
  exporte `modeliserPonts` / `maillagesPonts` (étape 4), le banc les appelle ; sinon l'ancien chemin (`pontsLegers`).
- `vue.mjs` (vue de dessus PNG : cases du tablier bleues = couvertes, noires = non couvertes, orange / violet =
  chaussée trop basse / haute de plus de 15 cm, arêtes du modèle en rouge), `photo.mjs` (SWISSIMAGE, WMS public),
  `profil.mjs` (surface visible le long d'un raccord), `coupe.mjs` (coupe en travers des points bruts),
  `dessous.mjs` (points sous le tablier par station et par classe).
- `node captures.mjs <étiquette> [site[@rayon]…]` : captures dans le navigateur (serveur de dev sur 5174, Chromium
  sans interface) aux mêmes points de vue pour toutes les étiquettes : biais, long, dessus, dessous, raccords A / B,
  et pour le premier pont les modes uni, photo, couleur selon la hauteur ; modèles faits main et passages du cercle.
- `reference/` : mesures « avant » et zones de mesure des raccords (`avant-*.ref.json` : axes et bouts des ponts de
  référence, pour mesurer toutes les versions aux mêmes endroits). Pour refaire la version « avant » :
  `git archive ff2efd5 src | tar -x -C <dossier>` puis `patch -p1 < reference/instrumentation-avant.patch`.

Mesures ajoutées à celles de la section 4 : `marche` (plus grand saut de la surface visible — terrain affiché ou
chaussée — entre deux points à 25 cm, sur trois lignes parallèles à l'axe, de 8 m dans le tablier à 8 m après le
joint), `bosse` (écart à la moyenne glissante sur 3 m), `pli` (angle entre deux faces voisines du dessus), `bords
ouverts` (longueur des arêtes libres du solide dessus + côtés), `trous` (cases intérieures du tablier sans face du
dessus), `piles` (blocs posés par le modèle).

### Mesures de référence (version « avant »)
| Pont | Couvert | Écart méd. | Marche aux raccords | Pli max | Piles posées | Remarque |
|---|---|---|---|---|---|---|
| Lutry, pont courbe 172 m | 97,1 % | 6 cm | 25 et 11 cm | 71,7° | 0 | bouts en pointe (largeur ajustée 8,2 m et 1,4 m) |
| Lutry, pont coupé par le cercle | 97,1 % | 5 cm | 36 cm | — | 0 | bout libre au cercle |
| A9 Lutrive, viaduc haut 429 × 27 m | 98,4 % | 4 cm | 37 et 14 cm | 71,7° (site) | 2 | deux tabliers soudés |
| A9 Lutrive, viaduc bas 439 × 20,5 m | 99,7 % | 3 cm | 10 et 14 cm | | 0 | deux tabliers soudés |
| Zurich, Dreikönigstrasse | 99,9 % | 7 cm | 34 et 63 cm | 72,2° (site) | 0 | |
| Zurich, Bleicherweg | 99,4 % | 4 cm | 26 et 18 cm | | 0 | IoU 0,75 |
| Zurich, Münsterbrücke | 98,1 % | 2 cm | 29 cm | 49,4° | 0 | bout libre au cercle |
| Lausanne, Chauderon | 99,0 % | 6 cm | 25 et 18 cm | 40,3° | 7 (5 réelles) | poutre droite, pas d'arches |
| Lausanne, Grand-Pont (fait main) | — | — | — | 76,2° (restes) | — | 835 m² de restes du tablier en repli, 6524 triangles |
| Chillon (faits main) | 99,8 % | 2 cm | — | 53,8° | — | deux rubans automatiques de 610 × 4 m le long des modèles |
| Fribourg, Poya (haubané) | 99,3 % | 3 cm | bouts libres | 25,4° | 2 | pylônes et haubans dans le relevé |
| Fribourg, Pérolles | 98,8 % | 5 cm | 67 cm | 2,9° | 3 | arches non rendues |
| Échangeur A1 (site « courbe ») | 98,5 % | 1 cm | — | 87,6° | — | repli (IoU 0,69) : 120 628 triangles case par case |
| Passage supérieur A1 | 99,1 % | 5 cm | 15 et 7 cm | 21,6° | 0 | |
| Genève, Peney (Rhône) | 99,8 % | 4 cm | 17 et 20 cm | 22,9° | 3 | |
| Genève, Mont-Blanc | 95,5 % | 5 cm | 27 et 30 cm | 65,1° | 0 | 707 cases intérieures non couvertes |
| Genève, passerelles (Bergues, île Rousseau) | 78 à 91 % | 2 cm | 7 à 23 cm | | 0 | trous (151 à 536 cases) |
| Genève, Butin | 98,7 % | 5 cm | 20 cm | 34,2° | 3 | arches non rendues |

Bords ouverts : 80 à 870 m par site (les solides ne sont pas fermés : piles sans dessus ni dessous, raccords plein /
ajouré) ; aucune face du dessus tournée vers le bas (sauf 28 et 346 dans les replis).

### Causes identifiées
1. **Ressaut au raccord** (10 à 60 cm) : la chaussée « glisse » vers le terrain non modifié ; sur une ligne à 30 % de
   la largeur, à Lutry (bout est), elle descend de 1,2 m en 1 m parce que le terrain y est un talus (`profil.mjs`).
2. **Pli** (jusqu'à 72°) : même cause, plus les **bouts en biais** : les rives sont ajustées sur la pointe de
   l'emprise (culée oblique), le tablier ajusté se termine en pointe et l'éventail de triangles converge vers le joint.
3. **Tabliers jumeaux** (Lutrive) : la coupe en travers montre deux plans de même dévers décalés de 17 cm au milieu
   (t ≈ 0,5 m) et une fente d'un demi-mètre que `fermer(pont, n, 2)` bouche.
4. **Piles** : le relevé ne classe « pont » (17) que le dessus ; les piles sont en classe 27. Chauderon : 5 piles
   vraies sur 7 blocs ; Lutrive : 2 blocs pour une dizaine de piles.
5. **Arches** : à Chauderon, la classe 27 donne les piles (du sol à 2,1 m sous la chaussée) et les reins des arcs
   près des piles (5,3 m sous la chaussée à 3 m de la pile, 3,1 m à 6 m, 2,2 m à 9 m : parabole de flèche ≈ 7,4 m) ;
   rien à la clé. À Pérolles, les piles ne sont vues qu'à partir de 19 m sous la chaussée : les arcs sont cachés par
   le tablier (à déduire : sommet des piles très en dessous du tablier = naissance des arcs).
6. **Modèles faits main** : `dansPont` n'efface que largeur / 2 + 2 m ; les bords du vrai tablier restent et sont
   modélisés à part (rubans, repli). À écarter : toute composante couverte à plus de 50 % par un modèle.
7. **Nappe d'eau de la Lutrive** : `gagnee` (grille.js) étend le niveau d'une case d'eau à toute voisine dont le sol
   est plus bas ; pour un ruisseau en pente, le niveau d'amont se propage vers l'aval et inonde tout le versant
   (quartier entier sous les viaducs). À limiter aux plans d'eau plats, ou à 1 m de profondeur et quelques mètres.
8. **Couleurs** (exigence ajoutée) : le dessus (matière du terrain) suit déjà cadastre, photo, uni et couleur selon la
   hauteur ; les côtés (matière « mur ») suivent la couleur selon la hauteur mais restent en plâtre clair en mode
   photo ; les ponts de l'anneau (`mat.pontsAnneau`, MeshStandardMaterial gris sans `grainPlatre`) ne suivent aucun
   mode ; en mode photo, le sol sous un viaduc porte la photo du tablier (orthophoto drapée).

### Plan retenu pour la suite (rien de fait)
- **Étape 4, raccord** : la chaussée reste partout la surface ajustée (profil + dévers), jamais tirée vers le
  terrain ; un **ruban de pleine largeur** va d'un joint à l'autre (rives ajustées sans les pointes des bouts en
  biais, prolongées) ; c'est le **terrain qui est gravé** : dans l'emprise du ruban, tout sol à moins de ~0,5 m sous
  la surface (ou au-dessus) est ramené à surface − 2 cm (fondu latéral de 2 m, fondu de 3 m après le joint), le sol
  loin dessous (vide, talus) n'est pas touché et le corps du pont y montre sa rive ; après le joint la chaussée
  plonge sous le terrain (extrémité toujours enterrée, sinon face droite). Gravure avant `terrain(G, zRef)`, donc au
  début de `scene.construire` (`modeliserPonts(G, nuage, modèles, lieu)` → `G.ponts`, idempotent, puis `majSurface`).
- **Mailleur unique** : `maillagePont(P, …)` de pontsModeles.js étendu au schéma commun — en plus de `axe`,
  `largeur`, `epaisseur`, `appuis`, `arches` : par nœud `rives` [t min, t max], `devers`, `epaisseurs`, `plein`, et
  `bouts` (libre, joint) ; normales lisses, uv du plan, faces du dessus vers le haut (une seule face), paroi au
  cercle pour tous les ponts (intervalles de hauteur par partie : tablier, arche, pile) ; le raccord « glissé » des
  modèles faits main est gardé tel quel. Repli `tabliersPonts` inchangé.
- **Étape 5** : piles = stations où les points de classe 27 vont du sol au dessous du tablier, regroupées en (s, t),
  espacement régularisé ; arches = parabole par travée ajustée sur les reins (classe 27), ou déduite du sommet des
  piles quand il est à plus de ~8 m sous la chaussée, émise dans `arches` (le mailleur les dessine déjà).
- **Étape 6** : tabliers jumeaux scindés (fente persistante dans les points bruts ou deux plans décalés), échangeurs
  (composante qui se ramifie) découpés en branches avant le repli.
- **Cercle** : mesurer d'abord la marche avec le pont swissTLM3D de l'anneau (Lutry, rayon 725) ; piste : décaler
  en hauteur les sommets de la tuile swissTLM3D près du passage pour rejoindre notre profil.
- **Couleurs** : matière des côtés des ponts = plâtre + teinte du plan du sol floutée (niveau de mipmap élevé) à la
  verticale, un peu assombrie (photo et cadastre) ; `mat.pontsAnneau` avec `grainPlatre` (couleur selon la hauteur)
  et la même teinte tirée des tuiles du plan (`tPlanP` / `tPlanL` du paysage).
