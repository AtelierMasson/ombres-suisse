# Ombres — Suisse

**En ligne : https://ateliermasson.github.io/ombres-suisse/** (publié automatiquement à chaque envoi sur `main`).

Site web gratuit : on tape une adresse ou une parcelle n'importe où en Suisse, et le navigateur calcule les ombres et
l'ensoleillement à partir du **nuage de points laser de swisstopo** et du **cadastre**, sans modèle 3D tout fait.
Aucun serveur : tout est lu directement chez swisstopo et calculé dans le navigateur, donc le site s'héberge
gratuitement (GitHub Pages, Cloudflare Pages…).

## Ce que fait le site

1. **Recherche** d'une adresse ou d'une parcelle (service de recherche geo.admin.ch, toute la Suisse), depuis
   l'écran d'accueil (décor animé : un hameau inventé, le soleil qui passe) ou la barre du haut.
2. **Parcelle** : contour officiel de la mensuration (geo.admin.ch), posé sur le terrain.
3. **Nuage de points** swissSURFACE3D (format COPC) : seuls les blocs autour de la parcelle sont téléchargés
   (rayon ≥ 150 m, ~2 millions de points, quelques secondes), jusqu'à environ un point tous les 0,5 m.
4. **Reconstruction** sur une grille de 0,5 m à partir des classes du relevé : terrain (sol), bâtiments (contour et
   forme des toits mesurés), arbres (canopée).
5. **Bâtiments aux murs droits** : chaque bâtiment est découpé en volumes de hauteur continue (corps principal,
   annexe, lucarne), le contour de chaque volume est simplifié en côtés droits et redressé selon l'orientation
   dominante ; les murs sont des plans verticaux, sans l'effet d'escalier de la grille. Les toits gardent
   les hauteurs du relevé. (Un essai de pans plans dans l'axe des façades reste dans `src/pans.js`, sans option visible.)
6. **Ombres** à la date et à l'heure choisies (animation de la journée), avec occlusion ambiante (large, en demi-résolution), un rebond de lumière calculé à l'écran (`src/rebond.js`), ciel en dégradé,
   brume légère et ombres adoucies. Un interrupteur « Effets de lumière » les coupe ; ils se réduisent tout seuls
   si l'affichage devient lent.
7. **Fond du terrain** : plan cadastral (mensuration officielle) reteinté dans la gamme du thème — sol et bâtiments
   ton sur ton, comme une maquette —, ou terrain uni (interrupteur « Plan cadastral au sol »).
8. **Arbres** en points du relevé (disques plats de teintes variées) qui s'assombrissent dans l'ombre portée (une canopée invisible, à 1 m, porte leur ombre) ; **nuage de points brut**
   affichable, coloré par classe, construit seulement quand on le demande ; sa végétation n'est pas dessinée tant que
   les arbres sont affichés.
9. **Montagnes lointaines** : profil d'horizon sur 50 km tout autour (y compris France et Italie) ; quand le soleil
   passe derrière, la parcelle est à l'ombre. Le diagramme montre l'horizon et la course du soleil (jour choisi,
   21 juin, 21 décembre) et les heures où le soleil dépasse les montagnes.
10. **Heures de soleil** autour de la parcelle : zone arrondie (parcelle élargie d'environ 20 m, bords fondus), sol,
    toits et **façades** (carreaux d'environ 1 m, du pied au toit). Période au choix : le jour, la moyenne du mois
    ou la moyenne de l'année, en heures par jour ; la carte se recalcule quand la date change. Statistiques
    (moyenne, min., max.) sur la parcelle seule.
11. **Coupe** verticale à travers le terrain et les bâtiments : deux poignées A et B à déplacer (ou deux clics), la
    partie devant le plan est masquée, les surfaces tranchées sont pochées avec un trait net. Elle suit le jeu de
    bâtiments affiché (relevé, Swiss3D, Advanced ou aucun). Le profil 2D, dessiné au trait (masse coupée en gris
    clair, arbres hachurés : couronne et tronc), indique altitudes, cotes des bâtiments, limites et numéros de
    parcelle et rayon du soleil à l'heure choisie. Terrain et bâtiments coupés forment une seule masse.
13. **Thèmes** à comparer en direct (boutons en haut à droite, choix mémorisé, ou `?theme=` dans l'adresse) :
    un bouton bascule entre le mode jour (`maquette`, blanc cassé) et le mode nuit (`nuit`, bleu sombre).
    Chaque thème règle l'interface et la scène : ciel, bâtiments, terrain, parcelle, arbres, carte des heures, coupe.

## Mode pro

Un interrupteur « Mode pro », en bas du panneau, affiche des outils supplémentaires (choix mémorisé). Sans lui,
l'interface reste celle décrite ci-dessus.

- **Sélectionner des bâtiments** : un clic sur un bâtiment du relevé le met en surbrillance et affiche sa fiche
  (hauteur au-dessus du sol, emprise en m², nombre de niveaux estimé à 3 m par niveau) ; Majuscule + clic en ajoute
  ou en retire ; « Bâtiments de la parcelle » choisit ceux de la parcelle. L'option « Par volume » désigne un seul
  volume (corps, annexe, lucarne) au lieu du bâtiment entier.
- **Masquer la sélection** : le bâtiment disparaît de l'écran **et des calculs** — ombres portées, ombre de contact,
  bord du socle, heures de soleil (sol, toits, façades : la carte se recalcule si elle est affichée) et coupe.
  « Tout réafficher » les remet, « Annuler » revient d'un pas en arrière (autant de fois que nécessaire).
- **Projets** (onglet Projet) : les projets enregistrés dans ce navigateur s'affichent en cartes (nom, lieu, date de
  modification, volumes ajoutés, bâtiments démolis, vignette en plan) avec Renommer, Dupliquer, Fermer et Supprimer
  (après confirmation) ; « Nouveau projet sur ce lieu » en ouvre un vide. Le projet ouvert **s'enregistre tout seul**
  peu après chaque modification (volumes, démolitions, coupes, date et heure, taille de la maquette) et à la fermeture
  de l'onglet ; le premier volume dessiné (ou le premier bâtiment masqué) crée un projet s'il n'y en a pas. Le dernier
  projet ouvert revient au rechargement de la page.
- **Volumes en cartes** : une carte par volume (dimensions, étages, corniche, faîte, toit, base, surfaces au sol et de
  plancher) avec, au centimètre et en plan, la distance à chaque limite de la parcelle (une par parcelle voisine) et
  aux bâtiments les plus proches ; un volume qui dépasse la limite est signalé en rouge, dans sa carte et dans la
  scène (traits cotés). La carte et le volume de la scène se sélectionnent l'un l'autre ; tout suit le glissement.
- **Taille de la maquette** : rayon chargé autour du lieu (automatique, 100, 150, 250 ou 400 m). Le lieu est rechargé ;
  à 400 m, compter une quinzaine de millions de points et de l'ordre de 1 Go de mémoire.
- **Exporter la maquette** : boutons directs OBJ et DXF (« maquette complète »), ou « Au choix… » :
  - format DXF, OBJ, glTF binaire (.glb) ou STL ;
  - contenu : terrain (maille de 0,5, 1 ou 2 m), socle (côtés et fond : fermé avec le terrain), bâtiments du jeu
    affiché (relevé sans les masqués, swisstopo ou roofer), arbres en volumes simples, limite de la parcelle,
    courbes de niveau (1 m) ;
  - coordonnées : **origine locale** (par défaut) ou **MN95 complètes** (DXF et OBJ seulement : le glTF et le STL
    stockent les nombres en simple précision).

  Le téléchargement est une archive zip : le modèle et un `LISEZ-MOI.txt`. Repère : X = est, Y = nord, Z = altitude,
  en mètres (le glTF suit sa norme, Y vers le haut : les logiciels le redressent à l'import). L'origine locale
  (E0, N0, Z0 en MN95, EPSG:2056 ; Z0 = altitude du centre arrondie au mètre) est écrite dans le nom du fichier
  (`ombres_lutry-3947_E2542768_N1152290_Z675.dxf`), dans le fichier (commentaires de tête et calque INFO du DXF,
  commentaires de l'OBJ, `asset.extras` du glTF, en-tête du STL) et dans le LISEZ-MOI. DXF en version R12 : calques
  TERRAIN, SOCLE, BATIMENTS, ARBRES, PARCELLE, COURBES et INFO ; surfaces en 3DFACE, lignes en polylignes 3D.
  Le DWG n'est pas écrit directement : AutoCAD ouvre le DXF et l'enregistre en DWG.
- **Points du nuage proches de la coupe** (quand la coupe est active) : points du relevé à moins de 0,25, 0,5, 1, 2
  ou 5 m du plan de coupe, projetés dans le profil et colorés par catégorie (sol, végétation, bâtiment, autre).
  La silhouette des arbres suit alors l'enveloppe de leurs points. Ils sont exportés avec la coupe (calque NUAGE).
  Le nuage (X, Y, Z, classe : 13 octets par point, environ 190 Mo à 400 m) est gardé en mémoire pour cela.
- **Exporter la coupe** (quand la coupe est active) : DXF ou SVG, dans le plan de la coupe — X = distance depuis A,
  Y = altitude réelle, en mètres. Calques TERRAIN_COUPE, BATIMENTS_COUPES, ARBRES, NUAGE, LIMITES_PARCELLE, COTES (bas,
  corniches, faîte, à 10 cm) et CADRE (échelle graphique, A et B en MN95, soleil). SVG à l'échelle 1:200.

Ordres de grandeur à Lutry (300 × 300 m, maquette complète, terrain à 1 m, 450 000 triangles) : OBJ 14 Mo, glTF 11 Mo,
STL 22 Mo, DXF 59 Mo (40 Mo avec le terrain à 2 m) ; 4 à 9 Mo une fois zippés ; préparés en 0,5 à 1,5 s.

**Repli** : là où le relevé laser récent n'est pas encore publié en COPC (vols plus anciens livrés en gros fichiers),
le site utilise les modèles en grille 0,5 m swissALTI3D (terrain) et swissSURFACE3D Raster (surface), issus du même
relevé. Bâtiments et arbres sont alors séparés par la forme (toit lisse, couronne rugueuse) : moins fiable, murs
moins nets, pas de nuage de points brut ni de points proches de la coupe.

**Comparaison** : la case « Comparer : bâtiments 3D swisstopo » affiche les bâtiments tout faits de
swissBUILDINGS3D (tuiles 3D de geo.admin.ch, décodeur Draco servi depuis `public/draco/`). Ils portent leurs ombres ;
décocher « Bâtiments » pour ne voir qu'eux. Ils sont tournés de la convergence des méridiens (le nord MN95 n’est pas le nord géographique, ≈ 0,5° à Lausanne) et calés sur nos toits (décalage de ±2 m au plus en plan, médiane des écarts en hauteur).
Le diagramme solaire est cliquable : un clic ou un glissé sur la course place le soleil à l'heure correspondante.
Bâtiments, sol et toits ont la même couleur et la même trame de cases de 0,5 m (aspect maquette).

## Lancer

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # site statique dans dist/, à publier tel quel
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/main.js` | Interface : recherche, accueil, chargement d'un lieu, date et heure, affichage, coupe, heures de soleil |
| `src/geo.js` | Recherche, parcelle, conversion MN95 → WGS84, catalogue STAC swisstopo |
| `src/nuage.js` | Lecture partielle du nuage COPC : choix des blocs, répartition entre les fils de calcul |
| `src/nuage.worker.js` | Téléchargement et décodage LAZ d'un bloc (copc.js + laz-perf en WebAssembly), hors du fil principal |
| `src/grille.js` | Grilles 0,5 m : sol, bâtiments, arbres, surface ; repli raster (geotiff.js) |
| `src/contours.js` | Volumes et contours des bâtiments : côtés droits, angles redressés |
| `src/pans.js` | Essai (sans option visible) : pans de toit plans par volume, arêtes dans l'axe des façades |
| `src/maillages.js` | Géométries : terrain et socle, toits et murs, canopée, nuages de points, limite de parcelle |
| `src/scene.js` | Scène three.js : lumières, ciel, ombres, occlusion ambiante, fond de plan, plan de coupe |
| `src/rebond.js` | Un rebond de lumière (éclairage indirect) à l'écran, après l'occlusion ambiante |
| `src/fond.js` | Fonds de plan WMS geo.admin.ch : plan cadastral reteinté, orthophoto |
| `src/themes.js` | Thèmes : palettes de la scène, choix mémorisé (les couleurs de l'interface sont dans `style.css`) |
| `src/soleil.js` | Position du soleil (algorithme NOAA) |
| `src/horizon.js` | Horizon lointain à partir des tuiles d'élévation Terrarium (AWS Open Data) |
| `src/heures.js` | Heures de soleil : zone arrondie, positions du soleil par période, carreaux de façade, maillages colorés |
| `src/ensoleillement.worker.js` | Lancer de rayons dans la grille (Web Workers, plusieurs fils) |
| `src/coupe.js` | Coupe : profil le long de la ligne, tranche 3D, dessin 2D |
| `src/swiss3d.js` | Comparaison : bâtiments 3D swisstopo (swissBUILDINGS3D, tuiles 3D publiques), calés sur notre terrain |
| `src/roofer.js` | Comparaison (essais Lutry et Lausanne av. Floréal) : bâtiments LoD2.2 reconstruits hors ligne par roofer (TU Delft) à partir des emprises officielles vaudoises et du nuage 2025 (`public/essais/roofer_*.json`) |
| `src/diagramme.js` | Diagramme horizon + course du soleil |
| `src/demo.js` | Hameau inventé de l'écran d'accueil |
| `src/pro.js` | Mode pro : sélection et masquage de bâtiments, projets en cartes et enregistrement automatique, cartes des volumes, taille de la maquette, boutons d'export |
| `src/volumes.js` | Mode pro : volumes numérotés, regroupés en bâtiments, fiche (hauteur, emprise, niveaux) |
| `src/export.js` | Mode pro : export de la maquette en DXF, OBJ, glTF binaire et STL (zip avec LISEZ-MOI) |
| `src/exportCoupe.js` | Mode pro : export de la coupe A–B en DXF et en SVG |

## Limites connues

- Les bâtiments sont reconstruits en 2,5D (hauteur par cellule de 0,5 m) : pas d'avant-toits ni de passages couverts.
  Les murs sont à l'aplomb du bord du toit : les façades réelles sont souvent en retrait de l'avant-toit.
- Le relevé est aérien : environ 1 point par m² sur les façades (contre ~17 sur les toits), très inégalement
  répartis. C'est trop peu pour reconstruire les murs à partir des points ; ils sont seulement affichés.
- Les heures de soleil sont calculées dans la grille de 0,5 m (et non sur les murs redressés) : écart possible
  de quelques dizaines de centimètres au pied des façades. Les moyennes du mois et de l'année échantillonnent
  6 et 24 jours.
- Au-delà du rayon chargé (≥ 150 m), seuls le relief (tuiles ~30–100 m) et non les bâtiments portent ombre.
- L'heure est celle du navigateur (fuseau supposé : Suisse).
- Mode pro : un bâtiment est un ensemble de volumes qui se touchent ; des maisons mitoyennes forment un seul bâtiment
  (utiliser « Par volume » pour n'en enlever qu'une partie).
- Exports : les bâtiments du relevé sont des enveloppes ouvertes en bas (toit et murs, sans plancher), dont les murs
  descendent 2,5 m sous le terrain ; seuls le terrain et le socle forment un volume fermé. Le DXF est lourd (un
  3DFACE par triangle). Les bâtiments swisstopo exportés sont ceux des tuiles chargées à l'écran.
- Les tuiles Terrarium mélangent plusieurs sources ; en Suisse, l'horizon est précis à quelques dixièmes de degré près.

Sources : © swisstopo (swissSURFACE3D, swissALTI3D, swissBUILDINGS3D, cadastre geo.admin.ch) · relief lointain :
Terrain Tiles (AWS Open Data, Mapzen). Résultats indicatifs.
