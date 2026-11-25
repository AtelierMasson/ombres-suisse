# Ombres — Suisse

**En ligne : https://ateliermasson.github.io/ombres-suisse/** (publié automatiquement à chaque envoi sur `main`).

Site web gratuit : on tape une adresse ou une parcelle n'importe où en Suisse, et le navigateur calcule les ombres et
l'ensoleillement à partir du **nuage de points laser de swisstopo** et du **cadastre**, sans modèle 3D tout fait.
Aucun serveur : tout est lu directement chez swisstopo et calculé dans le navigateur, donc le site s'héberge
gratuitement (GitHub Pages, Cloudflare Pages…).

## Ce que fait le site

1. **Recherche** d'une adresse ou d'une parcelle (service de recherche geo.admin.ch, toute la Suisse).
2. **Parcelle** : contour officiel de la mensuration (geo.admin.ch), affiché en rouge.
3. **Nuage de points** swissSURFACE3D (format COPC) : seuls les blocs autour de la parcelle sont téléchargés
   (rayon ≥ 150 m, ~2 millions de points, quelques secondes), jusqu'à environ un point tous les 0,5 m.
4. **Reconstruction** sur une grille de 0,5 m à partir des classes du relevé : terrain (sol), bâtiments (contour et
   forme des toits mesurés), arbres (canopée).
5. **Ombres** à la date et à l'heure choisies (animation de la journée), avec l'orthophoto SWISSIMAGE sur le terrain.
6. **Montagnes lointaines** : profil d'horizon sur 50 km tout autour (y compris France et Italie) ; quand le soleil
   passe derrière, la parcelle est à l'ombre. Le diagramme montre l'horizon et la course du soleil (jour choisi,
   21 juin, 21 décembre) et les heures où le soleil dépasse les montagnes.
7. **Heures de soleil** sur la parcelle pour la journée (carte de couleurs, moyenne, min., max.), en tenant compte
   des bâtiments, des arbres et des montagnes.
8. **Vue depuis la parcelle** à 1,70 m.

**Repli** : là où le relevé laser récent n'est pas encore publié en COPC (vols plus anciens livrés en gros fichiers),
le site utilise les modèles en grille 0,5 m swissALTI3D (terrain) et swissSURFACE3D Raster (surface), issus du même
relevé. Bâtiments et arbres sont alors séparés par la forme (toit lisse, couronne rugueuse) : moins fiable.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # site statique dans dist/, à publier tel quel
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/geo.js` | Recherche, parcelle, conversion MN95 → WGS84, catalogue STAC swisstopo, orthophoto |
| `src/nuage.js` | Lecture partielle du nuage COPC (copc.js + laz-perf en WebAssembly) |
| `src/grille.js` | Grilles 0,5 m : sol, bâtiments, arbres, surface ; repli raster (geotiff.js) |
| `src/scene.js` | Scène three.js : terrain, bâtiments, arbres, ombres, carte des heures |
| `src/soleil.js` | Position du soleil (algorithme NOAA) |
| `src/horizon.js` | Horizon lointain à partir des tuiles d'élévation Terrarium (AWS Open Data) |
| `src/ensoleillement.worker.js` | Heures de soleil par lancer de rayons dans la grille (Web Worker) |
| `src/diagramme.js` | Diagramme horizon + course du soleil |

## Limites connues

- Les bâtiments sont reconstruits en 2,5D (hauteur par cellule de 0,5 m) : pas d'avant-toits ni de passages couverts.
- Au-delà du rayon chargé (≥ 150 m), seuls le relief (tuiles ~30–100 m) et non les bâtiments portent ombre.
- L'heure est celle du navigateur (fuseau supposé : Suisse).
- Les tuiles Terrarium mélangent plusieurs sources ; en Suisse, l'horizon est précis à quelques dixièmes de degré près.

Sources : © swisstopo (swissSURFACE3D, swissALTI3D, SWISSIMAGE, cadastre geo.admin.ch) · relief lointain :
Terrain Tiles (AWS Open Data, Mapzen). Résultats indicatifs.
