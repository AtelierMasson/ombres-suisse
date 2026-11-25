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
   dominante ; les murs sont des plans verticaux, sans l'effet d'escalier de la grille. Les toits gardent par défaut
   les hauteurs du relevé (« Toits : relevé ») ; l'option « Toits : pans » les remplace par des pans plans dont les
   arêtes (faîtage, arêtier, noue) suivent la direction des façades, et les murs montent jusqu'à ces pans.
6. **Ombres** à la date et à l'heure choisies (animation de la journée), avec occlusion ambiante (large, en demi-résolution), un rebond de lumière calculé à l'écran (`src/rebond.js`), ciel en dégradé,
   brume légère et ombres adoucies. Un interrupteur « Effets de lumière » les coupe ; ils se réduisent tout seuls
   si l'affichage devient lent.
7. **Fond du terrain** : plan cadastral (mensuration officielle) reteinté dans la gamme du thème — sol et bâtiments
   ton sur ton, comme une maquette —, photo aérienne SWISSIMAGE ou terrain uni.
8. **Arbres** en points du relevé (disques plats de teintes variées) qui s'assombrissent dans l'ombre portée ; **points mesurés sur les façades** affichables (classe 26 des vols
   récents et points « bâtiment » sous le toit) : les murs deviennent alors translucides.
9. **Montagnes lointaines** : profil d'horizon sur 50 km tout autour (y compris France et Italie) ; quand le soleil
   passe derrière, la parcelle est à l'ombre. Le diagramme montre l'horizon et la course du soleil (jour choisi,
   21 juin, 21 décembre) et les heures où le soleil dépasse les montagnes.
10. **Heures de soleil** autour de la parcelle : zone arrondie (parcelle élargie d'environ 20 m, bords fondus), sol,
    toits et **façades** (carreaux d'environ 1 m, du pied au toit). Période au choix : le jour, la moyenne du mois
    ou la moyenne de l'année, en heures par jour ; la carte se recalcule quand la date change. Statistiques
    (moyenne, min., max.) sur la parcelle seule.
11. **Coupe** verticale à travers le terrain et les bâtiments : deux poignées A et B à déplacer (ou deux clics), la
    partie devant le plan est masquée, les surfaces tranchées sont pochées avec un trait épais ; le profil 2D
    indique altitudes, limites de parcelle, arbres et rayon du soleil à l'heure choisie. Terrain et bâtiments coupés forment
    une seule masse (même couleur, un seul trait de coupe).
12. **Vue depuis la parcelle** à 1,70 m.
13. **Thèmes** à comparer en direct (boutons en haut à droite, choix mémorisé, ou `?theme=` dans l'adresse) :
    `maquette` (blanc cassé, panneau classique), `alpage` (sable et vert sapin, cartes flottantes), `nuit` (sombre,
    panneau compact à droite), `atelier` (terre cuite, panneau fixe et barre du temps au-dessus de la vue).
    Chaque thème règle l'interface et la scène : ciel, bâtiments, terrain, parcelle, arbres, carte des heures, coupe.

**Repli** : là où le relevé laser récent n'est pas encore publié en COPC (vols plus anciens livrés en gros fichiers),
le site utilise les modèles en grille 0,5 m swissALTI3D (terrain) et swissSURFACE3D Raster (surface), issus du même
relevé. Bâtiments et arbres sont alors séparés par la forme (toit lisse, couronne rugueuse) : moins fiable, murs
moins nets, pas de points de façade.

**Comparaison** : la case « Comparer : bâtiments 3D swisstopo » affiche, en bleuté, les bâtiments tout faits de
swissBUILDINGS3D (tuiles 3D de geo.admin.ch, décodeur Draco servi depuis `public/draco/`). Ils portent leurs ombres ;
décocher « Bâtiments » pour ne voir qu'eux. Leur hauteur est calée sur nos toits (médiane des écarts, de l’ordre de 0,1 m).
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
| `src/nuage.js` | Lecture partielle du nuage COPC (copc.js + laz-perf en WebAssembly) |
| `src/grille.js` | Grilles 0,5 m : sol, bâtiments, arbres, surface ; repli raster (geotiff.js) |
| `src/contours.js` | Volumes et contours des bâtiments : côtés droits, angles redressés |
| `src/pans.js` | Option « Toits : pans » : pans de toit plans par volume, arêtes dans l'axe des façades |
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
| `src/roofer.js` | Comparaison (essai Lutry) : bâtiments LoD2.2 reconstruits hors ligne par roofer (TU Delft) à partir des emprises officielles vaudoises et du nuage 2025 (`public/essais/roofer_lutry.json`) |
| `src/diagramme.js` | Diagramme horizon + course du soleil |
| `src/demo.js` | Hameau inventé de l'écran d'accueil |

## Limites connues

- Les bâtiments sont reconstruits en 2,5D (hauteur par cellule de 0,5 m) : pas d'avant-toits ni de passages couverts.
  Les murs sont à l'aplomb du bord du toit : les façades réelles sont souvent en retrait de l'avant-toit.
- « Toits : pans » : un plan par pan, ajusté sur la grille ; cheminées, petites lucarnes et toits courbes ne sont pas
  rendus, et un volume trop irrégulier (résidu moyen > 0,4 m : grands îlots, repli raster) garde la grille. Les
  ombres et les heures de soleil restent calculées dans la grille, quel que soit le style choisi.
- Le relevé est aérien : environ 1 point par m² sur les façades (contre ~17 sur les toits), très inégalement
  répartis. C'est trop peu pour reconstruire les murs à partir des points ; ils sont seulement affichés.
- Les heures de soleil sont calculées dans la grille de 0,5 m (et non sur les murs redressés) : écart possible
  de quelques dizaines de centimètres au pied des façades. Les moyennes du mois et de l'année échantillonnent
  6 et 24 jours.
- Au-delà du rayon chargé (≥ 150 m), seuls le relief (tuiles ~30–100 m) et non les bâtiments portent ombre.
- L'heure est celle du navigateur (fuseau supposé : Suisse).
- Les tuiles Terrarium mélangent plusieurs sources ; en Suisse, l'horizon est précis à quelques dixièmes de degré près.

Sources : © swisstopo (swissSURFACE3D, swissALTI3D, SWISSIMAGE, cadastre geo.admin.ch) · relief lointain :
Terrain Tiles (AWS Open Data, Mapzen). Résultats indicatifs.
