# Bâtiments « Advanced » : évaluation sur des bâtiments connus

Évaluation de la reconstruction LoD2 faite dans le navigateur (`src/reconstruction/`) : comparaison aux points du
relevé laser et à la photo aérienne, sur 66 bâtiments choisis et sur les 1598 emprises entières qui les entourent ;
causes d'erreur, corrections apportées, pistes restantes. Novembre 2026.

## 1. Méthode

- **Données** : nuage swissSURFACE3D (COPC, espacement 0,5 m, classes 2 et 6, comme dans le site), emprises de la
  mensuration officielle (ogc.vd.ch pour Vaud, geodienste.ch ailleurs), photo aérienne SWISSIMAGE par le WMS public
  `wms.geo.admin.ch` (couche `ch.swisstopo.swissimage`, 0,1 m/px sur chaque bâtiment).
- **Outils** (hors site) : `outils/reconstruction/donnees-lieu.mjs` (téléchargements, avec cache),
  `outils/reconstruction/evaluer.mjs` (reconstruction de toutes les emprises de chaque lieu, mesures, causes),
  `outils/reconstruction/planches.py` (une planche PNG par bâtiment), `outils/reconstruction/echantillon.json` (la liste).

  ```
  CACHE_ESSAI=<dossier> node outils/reconstruction/evaluer.mjs --nom apres --planches <dossier json>
  CACHE_ESSAI=<dossier> node outils/reconstruction/evaluer.mjs --src <copie de src/reconstruction> --nom avant
  CACHE_ESSAI=<dossier> python3 outils/reconstruction/planches.py <dossier json> outils/reconstruction/evaluation
  ```
- **Mesures par bâtiment**, calculées sur le modèle final (polygones de toit), pas sur les étapes internes : part des
  points « bâtiment » de l'emprise à moins de 0,3 m et de 0,5 m (en hauteur) du toit le plus haut du modèle à cet
  endroit, écart médian, biais, part des points sans toit dessous, niveau (LoD2 / LoD1.2), pans détectés, polygones
  de toit. Ces mesures comptent aussi les points de façade et de superstructure : 100 % n'est pas atteignable.
- **Planches** (`outils/reconstruction/evaluation/<id>.png`, 66 fichiers, 15 Mo) : photo aérienne et emprise | points par
  hauteur | points par pan détecté (gris foncé : sans pan) | modèle vu de dessus (faîtes et arêtes en rouge, ressauts
  en orange) | écart modèle − points (vert < 0,3 m, jaune < 0,5 m, rouge modèle trop haut, bleu trop bas) | axonométrie.
- **Limites de la comparaison** : SWISSIMAGE n'est pas une orthophoto vraie, les toits hauts y sont décalés par rapport
  à l'emprise (Prime Tower : ~15 m ; villas : 1 à 2 m) ; la photo sert à compter les pans et à reconnaître les formes,
  pas à mesurer. Les « pans visibles » sont comptés à l'œil, lucarnes comprises, pour les bâtiments ordinaires
  seulement. swissBUILDINGS3D n'a pas été utilisé comme seconde référence (les points suffisent à mesurer).

## 2. Échantillon

66 bâtiments dans 40 lieux (boîtes de ±70 à ±220 m, soit 2335 emprises reconstruites dont 1598 entières avec au moins
30 points) : cathédrales et abbatiales (Lausanne, Fribourg, Genève, Saint-Gall, Payerne, Einsiedeln, Grossmünster),
gare de Zurich, EPF Zurich, Palais de Rumine, Tribunal fédéral, châteaux (Chillon, Gruyères, Grandson, Nyon,
Rapperswil, Munot), Rolex Learning Center, Prime Tower, Hallenstadion, stades (Tuilière, Letzigrund, Genève), halles
industrielles et sheds (Sulzer à Winterthour, Bobst à Mex), palaces à toits à la Mansart (Beau-Rivage, Montreux), et
des bâtiments ordinaires : villas à 2 et 4 pans, toits plats avec attique, maisons en rangée, immeubles mitoyens,
îlots à cour, fermes, hangar, chalets, annexes.

**Lieux impossibles** (constat utile pour le site) :
- pas de nuage COPC (vols antérieurs à 2024, seulement en LAS) : cathédrale et Palais fédéral de Berne, Wankdorf,
  cathédrale de Bâle, Messe et tour Roche, KKL de Lucerne, château de Thoune, Trub, Grindelwald — donc pas de BE, BS,
  LU, et d'après un sondage du catalogue STAC ni SO, BL, JU, VS, TI, GR, UR, OW. COPC présent : VD, GE, FR, NE, ZH, SH,
  AG, ZG, SZ, SG, GL, TG, AI ;
- nuage présent mais pas d'emprises en accès libre sur geodienste.ch : Neuchâtel et La Chaux-de-Fonds (NE) ;
- le toit du Letzigrund et celui du Stade de Genève ne sont pas des « bâtiments » de la mensuration (couverts) : aucun
  modèle possible, seuls les locaux sous les tribunes ont une emprise.

Le tableau complet (coordonnées, mesures avant → après) est au § 7.

## 3. Résultats avant / après

| Ensemble | LoD2 (%) | Points < 0,3 m (%) | Points < 0,5 m (%) | Par bâtiment, médiane < 0,3 m | Par bâtiment, médiane < 0,5 m | Polygones de toit / bât. |
|---|--:|--:|--:|--:|--:|--:|
| Échantillon (66 bâtiments) | 100,0 → 100,0 | 79,4 → **86,7** | 83,0 → **89,6** | 87,4 → **91,2** | 91,0 → **92,9** | 36,4 → 45,1 |
| Toutes les emprises entières (1598) | 98,3 → 98,7 | 82,6 → **86,2** | 85,3 → **88,6** | 88,2 → **89,6** | 90,1 → **91,5** | 7,3 → 8,7 |
| dont emprises < 60 m² (308) | 91,9 → 94,2 | 85,3 → **87,2** | 87,2 → **88,7** | 93,6 → **94,2** | 95,1 → **95,5** | 2,0 → 2,3 |
| dont 60–400 m² (1118) | 99,8 → 99,8 | 85,3 → **86,5** | 87,3 → **88,4** | 87,6 → **88,4** | 89,4 → **90,4** | 5,9 → 7,0 |
| dont ≥ 400 m² (172) | 100,0 → 100,0 | 80,4 → **86,0** | 83,6 → **88,7** | 87,5 → **89,2** | 90,0 → **91,6** | 25,4 → 31,3 |

- Par bâtiment (1598) : 484 gagnent plus d'un point (< 0,3 m), dont 127 plus de cinq ; 46 en perdent plus d'un, dont 4
  plus de cinq ; 1068 inchangés. Sur l'échantillon : 29 gagnent plus d'un point, 1 en perd plus d'un (îlot Hardturm, −1,2).
- Plus forts gains : EPF Zurich 63,4 → 91,5 %, cathédrale de Genève 60,0 → 80,9, cathédrale de Lausanne 54,6 → 74,0,
  Beau-Rivage 68,2 → 85,7, gare de Zurich 66,7 → 83,9, Montreux Palace 67,1 → 80,1, Munot 68,2 → 80,4.
- **Vitesse** (un fil, Node, machine occupée par ailleurs) : 2,25 → 2,34 s pour 200 emprises en moyenne sur les 2335 ;
  bâtiment le plus lent ≈ 890 → ≈ 750 ms (Rolex Learning Center, 147 000 points).
- **Essais Lutry et Floréal** (`outils/essai-reconstruction.mjs`, cases de 0,5 m, part à moins de 0,25 m de la médiane
  des points) :

| Lieu | Maison avant | Maison après | roofer (réf.) | Couverture avant → après | Temps avant → après | Murs |
|---|--:|--:|--:|--:|--:|--:|
| Lutry (80 emprises) | 96,7 % | 96,7 % | 93,3 % | 98,6 → 99,4 % | 487 → 478 ms | 1572 → 1336 |
| Floréal (119 emprises) | 91,6 % | **93,1 %** | 92,4 % | 99,1 → 99,4 % | 902 → 868 ms | 4423 → 3690 |

  Floréal passe devant roofer ; à Lutry cinq emprises à moitié couvertes (parkings, terrasses) passent en LoD1.2.

## 4. Catalogue des erreurs par cause

Part des points de toit à plus de 0,3 m du modèle, sur les 1598 emprises (avant → après ; total 17,4 → 13,8 %) :

| Cause mesurée | Avant | Après |
|---|--:|--:|
| À moins de 1 m du bord de l'emprise (façades, avant-toits, mitoyens, emprise ≠ toit) | 5,6 % | 5,1 % |
| Sans pan, au-dessus du modèle (superstructures, lucarnes, pans trop petits ou trop raides) | 4,6 % | 3,9 % |
| Sans pan, sous le modèle (niveaux inférieurs vus à travers, verrières, façades de cour) | 3,1 % | 2,8 % |
| Sur un pan détecté, mais le modèle en place un autre (carte des pans, partition) | 3,3 % | 1,1 % |
| Sur un pan détecté qui s'écarte des points (toits courbes, fusions) | 0,5 % | 0,6 % |
| Aucun toit du modèle sous le point | 0,3 % | 0,3 % |

### 4.1 Partition par droites qui coupe mal (corrigé pour l'essentiel)
*Exemples : EPF Zurich, gare de Zurich, cathédrales de Genève et de Lausanne, Beau-Rivage, Montreux Palace, Einsiedeln.*
Les pans étaient bien détectés (191 à l'EPF) mais le modèle en faisait de grands triangles en travers du bâtiment.
Trois causes : (a) les côtés de l'emprise comptaient dans le plafond de 90 droites — une coupole ou une abside
arrondie (centaines de petits côtés) l'épuisait avant la première droite de toit ; (b) chaque droite traversait tout le
bâtiment ; (c) deux droites étaient jugées « confondues » sur leur écart au centre de la boîte, même à 50 m l'une de
l'autre. *Autre lecture des points* : un faîte ne vaut que là où ses deux pans se touchent.

### 4.2 Seuils de détection des plans
- **Toits raides** (flèches, brisis de toits à la Mansart, clochers : Floréal, Beau-Rivage, tours du Grossmünster) : les
  écarts étaient mesurés verticalement ; à 60° un bruit de 5 cm devient 10 cm et le pan n'était pas semé. *Autre
  lecture* : mesurer perpendiculairement au plan (corrigé). Restent les flèches et lanternes à huit pans de moins de
  1 m² chacun (tour-lanterne de Lausanne, Grossmünster : 70,7 %) et les poivrières coniques (Gruyères, Chillon).
- **Petits pans** (lucarnes, édicules) : seuil de 25 points (~1,5 m²) abaissé à 16 (~1 m²) ; les lucarnes d'au moins
  1 m² deviennent de petits pans, les autres restent ignorées (points sans pan au-dessus du modèle).
- **Pans de pente voisine** (arêtiers de toits à faible pente, Lutry `VD-48931621`, 6 %) : la limite entre les deux
  étiquettes s'écarte de 0,7 à 0,8 m de l'intersection réelle (les points proches conviennent aux deux plans), le test
  à 0,6 m rejetait l'arêtier et le remplaçait par un escalier de ressauts. *Autre lecture* : tolérance 0,18 m / écart de
  pente (corrigé). L'intersection de deux pans presque parallèles reste mal placée quand ils sont petits (Nyon
  `VD-49074754`, coyau de 88 points) : d'où le plafond prudent.
- **Fusion de niveaux proches** : deux toits parallèles à 20–30 cm l'un de l'autre sont fusionnés (chœur de l'église de
  Gruyères, abbatiale de Payerne : bandes jaunes). *Autre lecture* : `fusionEcart` 0,15 → 0,10 m ; non retenu sans
  mesure dédiée (risque de couper les toits ondulés).

### 4.3 Superstructures, toits plats à attique
*Exemples : Glattpark (76,2 %), immeuble en peigne Sulzer (75,6 %), îlot Hardturm (69,9 %), toits plats de Floréal.*
Garde-corps, acrotères, cages d'ascenseur, panneaux solaires inclinés, végétation de toiture : points sans pan
au-dessus du modèle. Les attiques eux-mêmes sont bien rendus (ressauts dans l'axe des façades). Les rangées de
panneaux solaires de Bobst donnent 179 polygones en dents de scie, justes mais lourds. *Autre lecture* : fusionner
en un pan moyen les petits pans répétés (même pente, même pas) posés sur un toit plat.

### 4.4 Points manquants ou traversants (verrières, façades vitrées)
*Exemples : Prime Tower (47,3 %, inchangé), sheds Sulzer (77,3 %), verrière de faîte de la gare de Zurich, cours vitrées.*
Le laser traverse le verre : la Prime Tower a des points « bâtiment » à toutes les hauteurs sous le toit ; les faces
vitrées des sheds n'ont presque pas de points et la limite du pan glisse de 1 à 2 m. *Autre lecture* : ne garder par
case de 0,5 m que les points du haut (centile 90) avant de chercher les plans ; pour les sheds, prolonger le pan opaque
jusqu'à l'intersection avec le suivant plutôt que jusqu'aux derniers points.

### 4.5 Emprise officielle ≠ toit réel
- **Avant-toits** : Grand Chalet de Rossinière et chalets de Château-d'Oex — 100 % des points de l'emprise sont justes,
  mais le toit réel déborde de 1,5 à 3 m et le modèle s'arrête au mur. *Autre lecture* : étendre chaque pan de rive
  tant que des points « bâtiment » le prolongent hors de l'emprise (à moins de 0,2 m du plan).
- **Emprise plus grande que le toit** (terrasses, parkings enterrés : Lutry villa en L, maison en rangée, Letzigrund
  `ZH-26806047`) : les zones sans point « bâtiment » sont trouées si le sol y est vu, sinon couvertes par le pan voisin.
  Quand moins de la moitié de l'emprise porte un toit, l'emprise extrudée suit mieux les points (corrigé par le contrôle
  final).
- **Découpage cadastral** : la Tuilière est découpée en plusieurs emprises (tribunes, champs de panneaux), le château de Chillon aussi ;
  la cathédrale de Saint-Gall partage son emprise avec l'aile du couvent.
- **Couverts non cadastrés** : toits du Letzigrund et du Stade de Genève (voir § 2).

### 4.6 Murs mitoyens et bords
*Exemples : Morat, Stein am Rhein (72,3 %), Appenzell (77,5 %), Cité de Lausanne.* Sur 1 m le long de l'emprise, 5 %
des points sont faux : points de façade (classe 6 sous l'avant-toit), toit du voisin qui dépasse de 20–40 cm dans
l'emprise, pignons. *Autre lecture* : écarter de la détection les points du bord situés plus de 1 m sous le pan local
(façades), et ne pas créer de pan pour une bande de moins de 0,5 m le long d'une limite mitoyenne.

### 4.7 Toits courbes
*Exemples : Rolex Learning Center (97,1 %), Hallenstadion (95,9 %), coupole de l'EPF, rotonde Sulzer, Munot.* Rendus
par facettes : la hauteur est juste, mais le nombre de polygones est élevé (83 à 91) et les ressauts entre facettes
(quelques centimètres) dessinent des murs inutiles. *Autre lecture* : ne pas dresser de mur de ressaut de moins de
0,15 m (raccorder les deux pans à leur hauteur moyenne).

### 4.8 Repli LoD1.2
Rare sur les emprises entières (1,3 %) ; il concerne les petites annexes (< 60 m² : 5,8 %) sans pan de 16 points, et
désormais les emprises peu couvertes (27 cas sur 2335). Les emprises sans aucun modèle (« trop peu de points », 98 sur 2335)
sont des bâtiments souterrains, démolis ou coupés par le bord de la boîte.

### 4.9 Nombre de pans : modèle contre photo
Sur les 32 bâtiments où les pans ont été comptés : toits simples exacts (villas à 2 et 4 pans, hangar, chalets, annexe,
maison en rangée : 2/2, 4/4) ; toits à lucarnes proches (16 → 22, 15 → 17) ; toits plats sur-découpés (3 visibles → 9
ou 10 polygones, Glattpark 8 → 30) à cause des superstructures et acrotères (§ 4.3).

## 5. Ce qui a été changé dans `src/reconstruction/`

Chaque changement a été mesuré sur les 1598 emprises (points pondérés < 0,3 m / < 0,5 m) :

| Étape | < 0,3 m | < 0,5 m | Bâtiments en hausse / en baisse de plus d'un point |
|---|--:|--:|--:|
| Avant | 82,6 % | 85,3 % | – |
| Partition locale + recoupe des cellules mêlées + tolérance des arêtiers | 85,2 % | 87,6 % | 45 / 25 |
| + écarts perpendiculaires au plan | 85,6 % | 88,0 % | 148 / 64 (par rapport à l'étape précédente) |
| + pans dès 16 points | 86,2 % | 88,6 % | 376 / 19 |
| + contrôle final contre l'emprise extrudée | 86,2 % | 88,6 % | 4 / 0 (27 replis sur 2335 emprises) |

1. **Partition locale** — `geometrie.js:152` `partitionLocale`, `:167` `couperCellule`, `:216` `raccorderCellules` ;
   `batiment.js:148-212`. Chaque droite porte ses appuis (le côté de l'emprise, ou l'étendue de la limite entre deux pans
   ± 1 m) et ne coupe que les cellules qu'elle y traverse. Les arêtes gardent leur droite porteuse : les sommets sont
   des intersections de porteuses (identiques d'une cellule à l'autre) et les cellules sont raccordées à la fin. Les
   côtés de l'emprise ne comptent plus dans le plafond (`maxDroites` 90 → 400 droites de toit) ; une droite de toit qui
   longe une droite existante à moins de 0,3 m sur son appui lui donne son appui (`batiment.js:161`).
2. **Recoupe des cellules mêlées** — `batiment.js:214-272`. Une cellule où au moins 4 cases (1 m²) portent un autre pan
   que le pan majoritaire est recoupée par la droite connue qui sépare le mieux ses cases. Sans cette étape la
   partition locale seule faisait reculer 130 bâtiments (droite arrêtée trop tôt).
3. **Arêtiers des toits à faible pente** — `batiment.js:194-199` : intersection de deux pans admise dès 0,02 m/m d'écart
   de pente (0,08 avant), tolérance sur la limite `max(0,6 ; min(2,5 ; 0,18 / écart de pente))` m.
4. **Écarts perpendiculaires au plan** — `plans.js:79, 91, 98` (plan local et croissance des régions).
5. **Pans dès 16 points** — `plans.js:10` (`minimum` 25 → 16).
6. **Contrôle final** — `batiment.js:274-283` : si l'emprise extrudée met à moins de 0,25 m au moins 15 % de points de
   plus que le modèle final, repli LoD1.2 (motif « le toit plat suit mieux les points »).
7. `options.batiment.detail` (`batiment.js:211`) renvoie plans, droites et limites pour les outils de mise au point.

Essayés et écartés : partition locale sans recoupe (130 bâtiments en baisse) ; tolérance des arêtiers à 0,25 m / écart
de pente (casse les coyaux) ; contrôle final à 0,5 m avec 5 % de marge (112 replis, dont des appentis justes).

## 6. Ce qui reste (pistes chiffrées)

Part des points en jeu sur les 1598 emprises, par ordre de gain possible :

1. **Bord de l'emprise, 5,1 %** : filtrer les points de façade avant la détection ; étendre les pans aux avant-toits
   (chalets, fermes : débord réel 1,5–3 m, invisible dans la mesure actuelle car hors emprise).
2. **Superstructures et petits pans, 3,9 %** : pan moyen pour les rangées de panneaux solaires ; flèches et lanternes à
   petits pans (tolérance de normale plus large quand les voisins manquent) ; ou les ignorer franchement et lisser le toit.
3. **Points sous le toit, 2,8 %** : ne garder que le haut de chaque case avant la détection (verrières, Prime Tower :
   47 % aujourd'hui, la moitié de ses points sont sous le toit).
4. **Pan mal placé, 1,1 %** : réétiqueter les points proches d'une limite par le plan le plus proche (la limite
   suivrait l'intersection) ; sheds : prolonger le pan opaque jusqu'au suivant.
5. **Allègement** : pas de mur pour un ressaut < 0,15 m (toits courbes), fusion des facettes presque coplanaires
   après la partition — sans effet sur la mesure, −20 à −30 % de polygones sur les grands bâtiments.
6. **Couverture** : lire les anciens vols LAS (zip de 1 km) ou swissSURFACE3D Raster pour BE, BS, LU, VS, TI, GR ;
   autre source d'emprises pour NE (ou TLM).

## 7. Tableau de l'échantillon (avant → après)

Le nom renvoie à la planche. Pans photo : pans visibles comptés à l'œil (– : non compté).

| Bâtiment | Type | E, N (MN95) | Emprise m² | Points | Pans photo | Pans détectés | Polygones de toit | < 0,3 m (%) | < 0,5 m (%) | Écart médian (m) |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| [Cathédrale de Lausanne](../outils/reconstruction/evaluation/cath-lausanne.png) | édifice remarquable | 2538353, 1152683 | 2870 | 56493 | – | 81 → 132 | 105 → 146 | 54.6 → **74.0** | 58.5 → **78.0** | 0.17 → 0.08 |
| [Palais de Rumine, Lausanne](../outils/reconstruction/evaluation/rumine.png) | édifice remarquable | 2538253, 1152790 | 5209 | 82407 | – | 73 → 86 | 72 → 85 | 86.6 → **91.7** | 88.5 → **92.5** | 0.03 → 0.03 |
| [Ancienne Académie, Lausanne (long bâtiment en L)](../outils/reconstruction/evaluation/academie-lausanne.png) | bâtiment en L | 2538331, 1152799 | 1237 | 26125 | 12 | 39 → 44 | 44 → 47 | 90.1 → **91.3** | 91.6 → **93.3** | 0.06 → 0.06 |
| [Ancien Évêché, Lausanne (grand toit à 4 pans)](../outils/reconstruction/evaluation/eveche-lausanne.png) | toit à 4 pans | 2538316, 1152623 | 844 | 13036 | 8 | 24 → 25 | 27 → 24 | 96.2 → **95.8** | 97.2 → **97.0** | 0.04 → 0.04 |
| [Maison mitoyenne de la Cité, Lausanne](../outils/reconstruction/evaluation/cite-mitoyen.png) | maisons mitoyennes | 2538194, 1152681 | 222 | 3239 | – | 11 → 17 | 15 → 17 | 87.2 → **91.8** | 89.1 → **93.2** | 0.03 → 0.03 |
| [Cathédrale Saint-Nicolas, Fribourg](../outils/reconstruction/evaluation/cath-fribourg.png) | édifice remarquable | 2578965, 1183925 | 1822 | 32239 | – | 30 → 33 | 34 → 35 | 91.2 → **91.7** | 93.0 → **93.9** | 0.05 → 0.05 |
| [Grossmünster, Zurich](../outils/reconstruction/evaluation/grossmunster.png) | édifice remarquable | 2683480, 1247180 | 1294 | 21401 | – | 20 → 33 | 22 → 33 | 70.4 → **70.7** | 73.2 → **75.0** | 0.08 → 0.08 |
| [Gare centrale de Zurich](../outils/reconstruction/evaluation/gare-zurich.png) | édifice remarquable | 2683150, 1248030 | 15083 | 189146 | – | 210 → 232 | 174 → 242 | 66.7 → **83.9** | 71.3 → **86.1** | 0.09 → 0.05 |
| [EPF Zurich, bâtiment principal (coupole, cours)](../outils/reconstruction/evaluation/eth-zurich.png) | cour intérieure | 2683800, 1247886 | 12205 | 148269 | – | 191 → 197 | 139 → 217 | 63.4 → **91.5** | 66.9 → **92.9** | 0.05 → 0.02 |
| [Prime Tower, Zurich](../outils/reconstruction/evaluation/prime-tower.png) | tour | 2681452, 1248937 | 1621 | 35176 | – | 12 → 13 | 13 → 13 | 47.1 → **47.3** | 50.3 → **50.5** | 0.46 → 0.45 |
| [Hallenstadion, Zurich](../outils/reconstruction/evaluation/hallenstadion.png) | halle | 2684002, 1251778 | 12694 | 158228 | – | 77 → 91 | 63 → 91 | 93.8 → **95.9** | 95.9 → **97.1** | 0.03 → 0.02 |
| [Château de Chillon](../outils/reconstruction/evaluation/chillon.png) | édifice remarquable | 2560696, 1140483 | 3898 | 46297 | – | 101 → 116 | 127 → 128 | 70.9 → **80.2** | 76.2 → **84.5** | 0.09 → 0.07 |
| [Château de Gruyères](../outils/reconstruction/evaluation/chateau-gruyeres.png) | édifice remarquable | 2572830, 1159329 | 1420 | 23058 | – | 47 → 66 | 59 → 69 | 81.2 → **85.7** | 85.5 → **90.3** | 0.09 → 0.08 |
| [Église Saint-Théodule, Gruyères](../outils/reconstruction/evaluation/eglise-gruyeres.png) | église | 2572781, 1159209 | 994 | 21596 | 9 | 27 → 38 | 32 → 44 | 84.3 → **85.3** | 89.6 → **90.9** | 0.04 → 0.04 |
| [Stade de la Tuilière, Lausanne](../outils/reconstruction/evaluation/tuiliere.png) | stade | 2537302, 1155011 | 3078 | 32540 | – | 18 → 27 | 3 → 6 | 96.8 → **96.9** | 99.8 → **99.7** | 0.03 → 0.03 |
| [Rolex Learning Center, EPFL](../outils/reconstruction/evaluation/rolex.png) | édifice remarquable | 2533215, 1152330 | 20225 | 147042 | – | 63 → 82 | 90 → 83 | 96.8 → **97.1** | 98.8 → **99.0** | 0.03 → 0.03 |
| [Cathédrale (abbatiale) de Saint-Gall](../outils/reconstruction/evaluation/abbatiale-st-gall.png) | édifice remarquable | 2746227, 1254290 | 3574 | 54982 | – | 56 → 57 | 68 → 63 | 85.8 → **88.4** | 87.4 → **90.1** | 0.06 → 0.06 |
| [Cathédrale Saint-Pierre, Genève](../outils/reconstruction/evaluation/cath-geneve.png) | édifice remarquable | 2500418, 1117449 | 2193 | 27779 | – | 69 → 87 | 106 → 96 | 60.0 → **80.9** | 63.3 → **83.6** | 0.10 → 0.06 |
| [Abbatiale de Payerne](../outils/reconstruction/evaluation/abbatiale-payerne.png) | édifice remarquable | 2561776, 1185639 | 1376 | 16776 | – | 41 → 44 | 49 → 46 | 85.4 → **86.3** | 89.8 → **90.6** | 0.07 → 0.07 |
| [Abbaye d'Einsiedeln](../outils/reconstruction/evaluation/einsiedeln.png) | édifice remarquable | 2699700, 1220350 | 3794 | 69834 | – | 101 → 119 | 102 → 113 | 69.0 → **80.2** | 72.5 → **83.3** | 0.09 → 0.06 |
| [Halle Sulzer à sheds, Winterthour](../outils/reconstruction/evaluation/sulzer-sheds.png) | toit en shed | 2696405, 1261370 | 5524 | 79038 | – | 77 → 84 | 74 → 87 | 71.1 → **77.3** | 82.2 → **88.1** | 0.11 → 0.09 |
| [Halle Sulzer à lanterneaux, Winterthour](../outils/reconstruction/evaluation/sulzer-halle.png) | halle industrielle | 2696479, 1261300 | 5301 | 74021 | – | 52 → 58 | 52 → 48 | 86.1 → **86.0** | 93.0 → **93.0** | 0.10 → 0.10 |
| [Rotonde des locomotives, Winterthour](../outils/reconstruction/evaluation/sulzer-rotonde.png) | halle industrielle | 2696505, 1261363 | 1520 | 21257 | 8 | 11 → 12 | 13 → 12 | 97.8 → **97.4** | 99.5 → **99.3** | 0.03 → 0.03 |
| [Immeuble en peigne, Winterthour](../outils/reconstruction/evaluation/sulzer-peigne.png) | bâtiment en U | 2696490, 1261506 | 4825 | 66288 | – | 16 → 24 | 15 → 18 | 74.9 → **75.6** | 75.8 → **76.5** | 0.04 → 0.04 |
| [Beau-Rivage Palace, Lausanne](../outils/reconstruction/evaluation/beau-rivage.png) | toit à la Mansart | 2537941, 1151064 | 4815 | 56185 | – | 94 → 118 | 116 → 138 | 68.2 → **85.7** | 73.5 → **89.0** | 0.08 → 0.05 |
| [Tribunal fédéral, Lausanne](../outils/reconstruction/evaluation/tribunal-federal.png) | édifice remarquable | 2539031, 1152338 | 4999 | 52480 | – | 50 → 67 | 47 → 59 | 83.3 → **89.7** | 86.6 → **91.7** | 0.04 → 0.03 |
| [Montreux Palace](../outils/reconstruction/evaluation/montreux-palace.png) | toit à la Mansart | 2559139, 1143130 | 7301 | 128665 | – | 157 → 225 | 146 → 244 | 67.1 → **80.1** | 69.8 → **82.4** | 0.08 → 0.05 |
| [Usine Bobst, Mex](../outils/reconstruction/evaluation/bobst.png) | halle industrielle | 2532042, 1157835 | 9802 | 118260 | – | 158 → 264 | 114 → 179 | 86.0 → **91.7** | 91.0 → **95.2** | 0.07 → 0.07 |
| [Villa à 4 pans, Lutry](../outils/reconstruction/evaluation/lutry-4pans.png) | villa à 4 pans | 2542772, 1152236 | 147 | 2701 | 4 | 4 → 7 | 4 → 4 | 85.6 → **85.6** | 87.3 → **87.3** | 0.05 → 0.05 |
| [Villa à 2 pans, Lutry](../outils/reconstruction/evaluation/lutry-2pans.png) | villa à 2 pans | 2542792, 1152365 | 120 | 1333 | 2 | 2 → 2 | 2 → 2 | 100.0 → **100.0** | 100.0 → **100.0** | 0.02 → 0.02 |
| [Villa à toit plat, Lutry](../outils/reconstruction/evaluation/lutry-plat.png) | toit plat | 2542682, 1152331 | 288 | 4309 | 5 | 9 → 10 | 9 → 10 | 98.1 → **98.6** | 100.0 → **99.9** | 0.03 → 0.03 |
| [Petit immeuble récent, Lutry](../outils/reconstruction/evaluation/lutry-immeuble.png) | toit à 4 pans | 2542869, 1152351 | 392 | 5564 | 4 | 5 → 6 | 7 → 5 | 96.4 → **100.0** | 98.8 → **100.0** | 0.05 → 0.03 |
| [Maison en rangée, Lutry](../outils/reconstruction/evaluation/lutry-mitoyen.png) | maisons mitoyennes | 2542818, 1152399 | 95 | 727 | 1 | 2 → 2 | 1 → 1 | 99.7 → **99.7** | 99.7 → **99.7** | 0.03 → 0.03 |
| [Villa en L, Lutry](../outils/reconstruction/evaluation/lutry-villa-l.png) | bâtiment en L | 2542751, 1152357 | 338 | 2068 | 4 | 4 → 6 | 4 → 7 | 92.9 → **93.6** | 93.7 → **93.8** | 0.01 → 0.01 |
| [Annexe de jardin, Lutry](../outils/reconstruction/evaluation/lutry-annexe.png) | annexe / garage | 2542746, 1152312 | 48 | 637 | 4 | 4 → 4 | 4 → 4 | 100.0 → **100.0** | 100.0 → **100.0** | 0.03 → 0.03 |
| [Grande villa, Lutry](../outils/reconstruction/evaluation/lutry-grande-villa.png) | villa à 4 pans | 2542823, 1152187 | 433 | 6794 | 15 | 15 → 16 | 19 → 17 | 90.4 → **90.2** | 91.7 → **91.6** | 0.02 → 0.02 |
| [Immeuble av. Floréal 18, Lausanne](../outils/reconstruction/evaluation/floreal-18.png) | immeuble mitoyen | 2537676, 1151559 | 255 | 3170 | 4 | 4 → 5 | 4 → 4 | 98.2 → **98.2** | 98.3 → **98.3** | 0.03 → 0.03 |
| [Immeuble d'angle arrondi, Lausanne](../outils/reconstruction/evaluation/floreal-angle.png) | immeuble mitoyen | 2537682, 1151635 | 609 | 6931 | 10 | 17 → 17 | 19 → 18 | 91.6 → **91.6** | 92.2 → **92.2** | 0.04 → 0.04 |
| [Immeuble à lucarnes, Lausanne](../outils/reconstruction/evaluation/floreal-lucarnes.png) | toit à la Mansart | 2537640, 1151511 | 427 | 5615 | 16 | 19 → 21 | 22 → 22 | 89.4 → **89.7** | 91.0 → **91.2** | 0.06 → 0.06 |
| [Immeuble à toit plat, Lausanne](../outils/reconstruction/evaluation/floreal-plat.png) | toit plat | 2537756, 1151478 | 842 | 8085 | 3 | 7 → 8 | 7 → 9 | 98.8 → **98.6** | 99.4 → **99.4** | 0.04 → 0.03 |
| [Immeuble récent à attique, Lausanne](../outils/reconstruction/evaluation/floreal-attique.png) | toit plat avec attique | 2537757, 1151683 | 439 | 3885 | 3 | 9 → 13 | 8 → 10 | 99.2 → **99.3** | 99.8 → **99.8** | 0.03 → 0.03 |
| [Église sous-gare, Lausanne](../outils/reconstruction/evaluation/floreal-eglise.png) | église | 2537771, 1151547 | 667 | 7532 | 8 | 10 → 11 | 11 → 11 | 94.9 → **94.4** | 95.1 → **94.7** | 0.03 → 0.03 |
| [Maison en rangée Bernoulli, Zurich](../outils/reconstruction/evaluation/bernoulli.png) | maisons mitoyennes | 2680829, 1249805 | 54 | 642 | 6 | 6 → 7 | 6 → 7 | 85.7 → **94.1** | 88.9 → **95.8** | 0.02 → 0.02 |
| [Immeuble à cour, Zurich Hardturm](../outils/reconstruction/evaluation/bernoulli-cour.png) | cour intérieure | 2680949, 1249808 | 767 | 12633 | 5 | 8 → 10 | 8 → 9 | 71.1 → **69.9** | 72.1 → **71.0** | 0.06 → 0.07 |
| [Îlot Röntgenstrasse, Zurich](../outils/reconstruction/evaluation/rontgen.png) | cour intérieure | 2682230, 1248668 | 220 | 3338 | 8 | 12 → 14 | 16 → 14 | 83.9 → **85.6** | 86.9 → **88.6** | 0.04 → 0.04 |
| [Immeuble Glattpark, Opfikon](../outils/reconstruction/evaluation/glattpark.png) | toit plat avec attique | 2684557, 1253041 | 3475 | 52374 | 8 | 23 → 36 | 23 → 30 | 75.6 → **76.2** | 80.7 → **81.1** | 0.06 → 0.06 |
| [Bâtiment Im Lot, Uster](../outils/reconstruction/evaluation/uster.png) | immeuble | 2696138, 1244936 | 383 | 4116 | 2 | 6 → 6 | 2 → 4 | 95.9 → **97.2** | 96.2 → **97.4** | 0.07 → 0.07 |
| [Grande ferme, Peney-le-Jorat](../outils/reconstruction/evaluation/peney-ferme.png) | ferme | 2545577, 1164851 | 516 | 6501 | 6 | 5 → 5 | 6 → 5 | 98.7 → **98.7** | 98.8 → **98.8** | 0.04 → 0.04 |
| [Ferme, Peney-le-Jorat](../outils/reconstruction/evaluation/peney-ferme2.png) | ferme | 2545557, 1164942 | 578 | 7568 | 8 | 9 → 12 | 9 → 11 | 95.6 → **95.6** | 96.6 → **96.7** | 0.06 → 0.06 |
| [Hangar agricole, Peney-le-Jorat](../outils/reconstruction/evaluation/peney-hangar.png) | hangar | 2545527, 1165065 | 943 | 10707 | 2 | 2 → 2 | 2 → 2 | 99.0 → **99.0** | 99.0 → **99.0** | 0.03 → 0.03 |
| [Temple de Château-d'Oex](../outils/reconstruction/evaluation/oex-temple.png) | église | 2576243, 1146862 | 430 | 7866 | 8 | 15 → 14 | 15 → 14 | 93.1 → **93.1** | 94.6 → **95.1** | 0.06 → 0.06 |
| [Grand chalet, Château-d'Oex](../outils/reconstruction/evaluation/oex-chalet.png) | chalet | 2576339, 1146978 | 506 | 9773 | 8 | 12 → 15 | 13 → 15 | 89.5 → **89.8** | 90.9 → **91.2** | 0.04 → 0.04 |
| [Chalet à 2 pans, Château-d'Oex](../outils/reconstruction/evaluation/oex-chalet2.png) | chalet | 2576195, 1147000 | 96 | 1702 | 2 | 3 → 3 | 2 → 2 | 100.0 → **100.0** | 100.0 → **100.0** | 0.03 → 0.03 |
| [Petite annexe, Château-d'Oex](../outils/reconstruction/evaluation/oex-garage.png) | annexe / garage | 2576212, 1146981 | 59 | 1162 | 2 | 2 → 2 | 2 → 2 | 88.6 → **88.6** | 89.0 → **89.0** | 0.03 → 0.03 |
| [Grand Chalet de Rossinière](../outils/reconstruction/evaluation/grand-chalet.png) | chalet | 2572668, 1146195 | 125 | 2517 | 2 | 2 → 2 | 2 → 2 | 100.0 → **100.0** | 100.0 → **100.0** | 0.02 → 0.02 |
| [Forteresse du Munot, Schaffhouse](../outils/reconstruction/evaluation/munot.png) | édifice remarquable | 2690200, 1283607 | 3044 | 43082 | – | 96 → 137 | 103 → 146 | 68.2 → **80.4** | 74.0 → **85.3** | 0.12 → 0.08 |
| [Letzigrund, Zurich : bâtiment sous la tribune ouest (le toit du stade n'a pas d'emprise)](../outils/reconstruction/evaluation/letzigrund.png) | stade | 2680450, 1248560 | 948 | 12266 | – | 14 → 17 | 16 → 18 | 80.4 → **80.6** | 81.4 → **81.6** | 0.04 → 0.04 |
| [Halle à toiture photovoltaïque, Zurich Letzigrund](../outils/reconstruction/evaluation/letzigrund-halle.png) | halle industrielle | 2680580, 1248485 | 3835 | 85103 | – | 30 → 38 | 26 → 33 | 90.8 → **91.2** | 93.5 → **93.6** | 0.08 → 0.08 |
| [Bâtiment à plan en octogones, Le Grand-Saconnex (près de Palexpo)](../outils/reconstruction/evaluation/octogones-geneve.png) | cour intérieure | 2498396, 1121686 | 6372 | 55047 | – | 63 → 86 | 50 → 72 | 92.7 → **95.5** | 95.4 → **97.2** | 0.08 → 0.07 |
| [Hôtel de ville, Stein am Rhein](../outils/reconstruction/evaluation/stein-am-rhein.png) | maisons mitoyennes | 2706742, 1279702 | 282 | 3921 | 5 | 8 → 14 | 8 → 13 | 64.5 → **72.3** | 77.1 → **84.4** | 0.19 → 0.15 |
| [Maison de la Hauptgasse, Appenzell](../outils/reconstruction/evaluation/appenzell.png) | maisons mitoyennes | 2748915, 1244086 | 128 | 2481 | – | 7 → 12 | 7 → 14 | 70.9 → **77.5** | 74.7 → **80.3** | 0.06 → 0.05 |
| [Maison de la Hauptgasse, Morat](../outils/reconstruction/evaluation/morat.png) | maisons mitoyennes | 2575559, 1197516 | 136 | 1757 | – | 7 → 7 | 5 → 5 | 86.2 → **87.3** | 87.3 → **88.7** | 0.05 → 0.06 |
| [Château de Grandson](../outils/reconstruction/evaluation/chateau-grandson.png) | édifice remarquable | 2539459, 1184546 | 223 | 3211 | – | 8 → 10 | 8 → 9 | 73.9 → **75.0** | 77.9 → **78.8** | 0.09 → 0.09 |
| [Stade de Genève](../outils/reconstruction/evaluation/stade-geneve.png) | stade | 2498720, 1114850 | 3875 | 43209 | – | 13 → 14 | 16 → 17 | 87.4 → **87.1** | 94.5 → **94.2** | 0.09 → 0.09 |
| [Château de Rapperswil](../outils/reconstruction/evaluation/chateau-rapperswil.png) | édifice remarquable | 2704193, 1231616 | 34 | 444 | – | 1 → 1 | 1 → 1 | 100.0 → **100.0** | 100.0 → **100.0** | 0.06 → 0.06 |
| [Château de Nyon](../outils/reconstruction/evaluation/chateau-nyon.png) | édifice remarquable | 2507806, 1137472 | 470 | 6528 | – | 14 → 23 | 14 → 23 | 73.1 → **76.3** | 75.6 → **80.7** | 0.08 → 0.07 |
