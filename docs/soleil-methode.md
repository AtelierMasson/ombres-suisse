# Carte des heures de soleil à bords nets : plan

Plan d'un agent Fable 5.2 (réflexion « high »), 27 novembre 2026, à partir de heures.js, ensoleillement.worker.js,
scene.js (grainPlatre, afficherHeures), main.js (calculerHeures), maillages.js, contours.js et swiss3d.js.
Durées et coûts : estimations, rien n'a été mesuré.

## Diagnostic
Les valeurs vivent sur la grille monde de 0,5 m, les faces affichées n'y sont pas alignées :
- toits du relevé : `nappe` déplace les coins de bord sur les côtés redressés, mais `grainPlatre` lit `tHeures` en (x, y)
  monde : près du bord, le toit lit des cellules « sol » et inversement ;
- Swiss3D : calcul via `hauteursDessus` puis `contoursBatiments`, sans rapport avec les vrais triangles des tuiles ;
- murs : fond pris à la cellule à 0,7 m devant le mur (une valeur de sol) + carreaux en calque décalé ;
- worker : la boucle `facades` évalue déjà un point 3D quelconque, mais ne teste l'incidence que pour des normales horizontales.

## Approche retenue : carte par face (atlas), évaluée par le worker actuel
- A. grille affinée + masques : premier pas et repli, ne règle ni les murs ni Swiss3D ;
- B. **atlas de texels dans le repère de chaque face plane** (u horizontal, v selon la pente), 0,5 m mesuré sur la face,
  colonnes égales sur la longueur exacte, rangées depuis l'égout, la géométrie coupe les pixels ; NearestFilter, attribut
  `aCarte` ; marge de 1–2 texels ; valeur d'un texel = moyenne de sous-points dans la face (2×2, 4×4 aux arêtes) ;
- C. même atlas évalué par le GPU (cartes d'ombre accumulées), plus tard si les ombres en marches gênent.

## Étapes
1. Couches sol et bâti dilatées dans `textureHeures` ; `grainPlatre` : toit → bâti, sol/mur → sol, swiss selon `nM.y`
   (supprime le débordement sol/toit, ~½ journée).
2. `cartesFaces(maillages, zone)` remplace `carreauxFacades` : regroupe les triangles par plan, atlas par étagères,
   `aCarte` par sommet, worker avec normale 3D et test d'incidence ; supprime `maillagesHeures`, le décalage 0,7 m et le calque.
3. Toits du relevé : une carte par volume (`userData.volumes`, `dominante`), altitude sur le toit affiché.
4. Départ des rayons à 0,1 m le long de la normale, cellules du même volume ignorées sur les 3 premiers pas, tolérance 0,3 m.
5. Swiss3D : `toNonIndexed()` au chargement, recalcul après `tiles-load-end`, calage dans `clePeriode`.
6. Vitesse : une marche par point et par azimut (pente d'occultation maximale), ~×5 sur l'année.
7. Option : évaluateur GPU sur le même atlas.

## Pièges
Toits en pente (le test d'incidence change les chiffres des pans nord), moiré rasant (tolérance de l'étape 4), murs
obliques (exemption par volume), normales Swiss3D non orientées (orienter vers le côté où la grille est plus basse),
calage Swiss3D (calculer après chargement complet, en positions monde), niveaux de détail des tuiles, `decouperBord`
(propager `aCarte`), matériaux partagés (texel (0, 0) = vide, clé de programme), ombres portées encore en marches (B),
mobile (1 sous-point, 2 workers).
