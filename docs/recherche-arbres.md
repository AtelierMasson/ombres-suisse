# Arbres 3D depuis swissSURFACE3D : état de l'art et pipeline recommandé

Recherche du 26.11.2026. Contexte : application navigateur (three.js, JS natif, PHP seulement côté serveur), nuage LiDAR aéroporté swissSURFACE3D (COPC/LAZ, classes 3/4/5, ~15–20 pts/m²). Aujourd'hui : points de végétation bruts à l'écran, export d'une « sucette » par maximum local d'un MNC (modèle numérique de canopée).

Mentions « (à vérifier) » : information tirée de ma mémoire ou d'une source secondaire, non confirmée sur la source primaire pendant cette recherche.

---

## 0. Fait structurant : swissSURFACE3D est acquis hors feuillaison

Les vols swissSURFACE3D sont faits **sans feuilles** (leaf-off), pour optimiser le MNT ([métadonnées VHM LiDAR LFI, EnviDat](https://www.envidat.ch/metadata/vegetation-height-model-lidar-nfi) ; [produit swissSURFACE3D](https://www.swisstopo.admin.ch/en/height-model-swisssurface3d)). Conséquences directes :

- **Conifères** : couronne « pleine », surface sommitale dense, apex pointu bien visible dans le MNC.
- **Feuillus** : peu de retours, répartis dans tout le volume de la couronne, **souvent sur les branches charpentières**. Le MNC d'un feuillu est bruité, troué, plus bas que la hauteur réelle de 0,5–1 m.
- C'est à la fois un problème (segmentation sur MNC moins fiable pour les feuillus) et une chance : les points de branches peuvent servir d'**attracteurs** pour faire pousser une ramure plausible (§2), et la texture du nuage distingue bien feuillu / conifère (§3).

---

## 1. Segmentation d'arbres individuels

### 1.1 Familles d'algorithmes

| Méthode | Principe | Entrée | Adapté 15–20 pts/m² ALS | Faisable en JS < 1–2 s (1 M pts) |
|---|---|---|---|---|
| **Maxima locaux (LMF) à fenêtre variable** (Popescu & Wynne 2004) | Sommet = max local du MNC, fenêtre fonction de la hauteur | MNC | Oui (base de toutes les méthodes MNC) | Oui, ~10–50 ms |
| **Watershed contrôlé par marqueurs** | Inversion du MNC lissé, inondation depuis les sommets | MNC + graines | Oui, robuste ; sur-segmente les feuillus larges si pas de lissage | Oui, ~50–200 ms (priority-flood) |
| **Dalponte & Coomes 2016** | Croissance de région sur le MNC depuis les graines, seuils relatifs à la hauteur du sommet + rayon max | MNC + graines | Oui, meilleur résultat sur les données d'exemple lidR ([lidR book, ch. 8](https://r-lidar.github.io/lidRbook/itd.html)) | Oui, ~50–200 ms |
| **Silva et al. 2016** | Graines + tessellation de Voronoï bornée par rayon/hauteur ([lidR `silva2016`](https://search.r-project.org/CRAN/refmans/lidR/html/its_silva2016.html) ; [article](https://research.fs.usda.gov/treesearch/52704)) | MNC + graines | Correct pour peuplements réguliers, médiocre en milieu bâti | Oui, < 50 ms |
| **Li et al. 2012** (PE&RS 78(1)) | Croissance de région **sur les points**, du plus haut au plus bas, critère d'espacement | Points | Moyen : conçu pour conifères ; omissions en hausse avec la densité de tiges | Faisable avec grille spatiale, ~1–3 s pour 1 M pts ; O(n·arbres) dans sa version naïve |
| **Layer stacking** (Ayrey et al. 2017, à vérifier) | Segmentation par tranches horizontales puis empilement | Points | Mieux pour sous-étage, mais 15–20 pts/m² leaf-off c'est juste | ~1–2 s, plus complexe |
| **Mean-shift / AMS3D** (Ferraz et al. 2012/2016) | Mean-shift 3D à noyau adapté par allométrie hauteur/couronne ([revue MDPI 2019](https://www.mdpi.com/2072-4292/11/11/1263)) | Points | Bon en forêt complexe, mais coûteux | Non en < 2 s pour 1 M pts (O(n·k·itérations)) ; possible sur sous-échantillon |
| **Deep learning** : ForAINet (Xiang et al., ETH), [SegmentAnyTree](https://arxiv.org/abs/2401.15739) (Wielgosz et al. 2024), [TreeLearn](https://github.com/ecker-lab/TreeLearn) (Henrich et al.) | Réseaux 3D type PointGroup / sparse CNN / Point Transformer | Points | SegmentAnyTree : bon > 50 pts/m², **nettement moins bon vers 10 pts/m²** (omissions) ; TreeLearn vise le LiDAR terrestre | Non : GPU, PyTorch, MinkowskiEngine. Hors de portée navigateur |

Repères de qualité :
- Benchmark NEWFOR alpin (8 méthodes ALS, 18 placettes, 4–121 pts/m²) : **taux d'appariement global ~47 %**, meilleur en résineux monostrates, arbres dominés quasi invisibles pour toutes les méthodes ([Eysn et al. 2015, Forests 6:1721](https://hal-sde.archives-ouvertes.fr/hal-01170682)). Aucune méthode ne domine franchement ; un réglage adaptatif compte plus que l'algorithme.
- Wang et al. 2016 (IEEE TGRS) : la densité de points influence fortement les méthodes basées points ; à 15–20 pts/m² les méthodes MNC restent compétitives ([résumé ProQuest](https://www.proquest.com/docview/2842774095)).
- Comparatif des implémentations lidR (Dalponte, watershed, Li 2012) en Slovénie : [Pirotti et al. 2017, ISPRS Archives](https://www.research.unipd.it/bitstream/11577/3255391/1/2017_isprs_archives_pirotti_kobal6.pdf).

### 1.2 Référence : lidR (R, licence GPL-3)
- `rasterize_canopy()` (p2r, pitfree), `locate_trees(lmf(ws = f(h)))`, `segment_trees(las, dalponte2016(chm, ttops) | watershed(chm) | li2012() | silva2016(chm, ttops))` ([doc `segment`](https://search.r-project.org/CRAN/refmans/lidR/html/segment.html)). Méthodes expérimentales (layer stacking, etc.) dans `lidRplugins`.
- Le code C++ de lidR est lisible et sert de spécification ; **la licence GPL-3 interdit de copier du code dans un site non GPL**. Réimplémenter depuis les articles.

### 1.3 Implémentations JS / WASM existantes
- Lecture : `copc.js` et `laz-perf` (WASM) déjà connus pour COPC/LAZ dans le navigateur.
- Segmentation d'arbres en JS : **aucune bibliothèque maintenue trouvée**. Le watershed et la croissance de région MNC tiennent en ~200–300 lignes (grille Float32Array, file de priorité binaire). Options : compiler un watershed C (ex. depuis scikit-image/OpenCV) en WASM, mais le gain ne vaut pas la dépendance à cette taille de grille.

### 1.4 Verdict pour l'application
**MNC 0,5 m à remplissage des trous (pit-free simplifié) → lissage gaussien 3×3 → LMF à fenêtre variable → croissance de région Dalponte (ou watershed marqueurs) → affectation des points au segment par lookup de cellule.** Coût total estimé 100–400 ms pour 1 M points de végétation dans un Web Worker. Les méthodes points (Li 2012, AMS3D) et deep learning n'apportent pas assez à cette densité leaf-off pour justifier le coût.

Spécificité feuillus leaf-off : utiliser pour le MNC le **maximum par cellule de tous les retours**, puis un **closing morphologique** (dilatation puis érosion, rayon 1 m) pour combler les couronnes trouées avant la détection des sommets ; sinon un grand tilleul ou platane devient 3–5 « arbres ».

---

## 2. Reconstruction de structure (tronc + branches)

### 2.1 Méthodes qui exigent un LiDAR terrestre (TLS/MLS) dense
| Outil | Principe | Licence | ALS 15–20 pts/m² ? |
|---|---|---|---|
| [TreeQSM](https://github.com/InverseTampere/TreeQSM) (Raumonen et al. 2013) | Couverture en patches, segmentation, ajustement de cylindres | Licence propre (LICENSE.md ; port Python [treeqsm-py](https://git.asik.fi/asikaim/treeqsm-py) en GPL-3) | **Non** : il faut le tronc échantillonné (cm) |
| AdQSM (Fan et al. 2020, à vérifier) | QSM rapide par squelette + cylindres | Binaire libre (à vérifier) | Non |
| SimpleForest (Hackenberg, plugin CompuTree) | QSM par sphères/cylindres | GPL (à vérifier) | Non |
| PypeTree (Delagrange et al. 2014) | Squelette par graphe + édition interactive | Libre (à vérifier) | Non |
| L1-medial skeleton (Huang et al. 2013) | Squelette robuste au bruit par L1-médiane | Code de recherche | Non : suppose une surface échantillonnée |
| [AdTree](https://github.com/tudelft3d/AdTree) (Du et al. 2019, [Remote Sensing 11:2074](https://www.mdpi.com/2072-4292/11/18/2074)) | Arbre couvrant minimal (Dijkstra) → simplification → cylindres ajustés → maillage OBJ + feuilles | **GPL-3**, C++17 | Partiellement : produit une ramure sur un nuage d'un arbre isolé, mais à 15–20 pts/m² le résultat est une structure grossière, tronc deviné |

### 2.2 Méthodes qui marchent avec un nuage clairsemé ou couronne seule
- **Space colonization** ([Runions, Lane & Prusinkiewicz 2007](https://algorithmicbotany.org/papers/colonization.egwnp2007.html)) : on remplit l'enveloppe de couronne de points attracteurs ; des nœuds poussent vers les attracteurs proches (distance d'influence `di`), les attracteurs sont tués à distance `dk`. Paramètres peu nombreux, résultat naturel, enveloppe respectée par construction.
- **Variante « points LiDAR = attracteurs »** (Preuksakarn et al. 2010, FSPM, à vérifier) : on remplace les attracteurs aléatoires par les points du nuage. Particulièrement pertinent ici, puisque les feuillus leaf-off ont des retours sur les branches.
- **Hu et al. 2017, « Efficient tree modeling from airborne LiDAR point clouds »** ([Computers & Graphics 67:1-13](https://www.cg.tuwien.ac.at/research/publications/2017/HU-2017-ETM/)) : normalized cut pour segmenter, ajout de points de tronc synthétiques, champ de directions, croissance gloutonne ascendante. C'est précisément le cas ALS avec peu de branches visibles. Pas de code public trouvé.
- **Modèles à enveloppe / implicites (urbanisme, CityGML)** : [de Groot 2020, TU Delft](https://repository.tudelft.nl/record/uuid:3e169fc7-5336-4742-ab9b-18c158637cfe), arbres en plusieurs niveaux de détail depuis l'ALS néerlandais (AHN) : LOD2 = modèle implicite paramétré ; LOD3.0/3.1 = tronc implicite + couronne en **enveloppe convexe ou alpha shape**. C'est l'état de l'art opérationnel pour la 3D urbaine à cette densité.
- Antérieurs : Xu, Gossett & Chen 2007 (TOG, squelette + heuristiques), Livny et al. 2010 (« Automatic reconstruction of tree skeletal structures from point clouds »), Livny et al. 2011 (« Texture-lobes », couronne en lobes + ramure synthétique) ; tous conçus pour du TLS, mais le principe des lobes est transposable.

### 2.3 Réaliste pour ALS couronne seule
**Enveloppe de couronne (paramétrique ou convexe) + tronc synthétique + ramure en space colonization dans l'enveloppe**, avec les points LiDAR de la couronne comme attracteurs prioritaires. On ne « reconstruit » pas la vraie ramure : on génère une ramure plausible et cohérente avec le volume mesuré. À dire clairement à l'utilisateur.

Coût navigateur (estimation) : par arbre, 200–600 attracteurs, 60–200 nœuds, grille de hachage pour le plus proche voisin → **1–5 ms par arbre**. 2 000 arbres → 2–10 s : à faire dans un Web Worker, à la demande (export ou sélection), pas à chaque affichage.

### 2.4 Bibliothèques JS
- [ez-tree](https://github.com/dgreenheck/ez-tree) (D. Greenheck) : générateur procédural three.js, **MIT** (textures d'écorce CC0), nombreux paramètres (niveaux, angles, effilement, feuilles) ([article Codrops](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/)). Pas guidé par une enveloppe : utile comme **modèle de maillage de branches** (tubes effilés) ou pour des arbres « de bibliothèque » mis à l'échelle.
- [proctree.js](https://github.com/supereggbert/proctree.js) (démo snappytree) : génère tronc + branches + feuilles en low-poly ; licence annoncée BSD par un port C, non déclarée sur le dépôt (à vérifier avant usage).
- Space colonization JS : [nicknikolov/space-colonization](https://relatedrepos.com/gh/nicknikolov/space-colonization), paquet npm [space-colonization](https://npmjs.com/package/space-colonization) (instable, rendu regl), [2D experiments de Jason Webb](https://jasonwebb.github.io/2d-space-colonization-experiments) ; rapport three.js de [T. Gustafsson](https://torstengustafsson.github.io/pages/projects/treegeneration/report.pdf). L'algorithme fait ~150 lignes : **mieux vaut l'écrire soi-même**.

---

## 3. Indices d'espèce / de forme

### 3.1 Depuis le nuage leaf-off lui-même (par segment)
| Indice | Conifère | Feuillu (leaf-off) |
|---|---|---|
| Rapport hauteur de couronne / diamètre | élevé (1,5–4) | 0,6–1,5 |
| Forme de l'apex dans le MNC | pointu, pente forte autour du sommet | plat ou arrondi, irrégulier |
| Densité de retours par m² de couronne | élevée, comparable au voisinage | faible, nettement sous la moyenne |
| Distribution verticale | concentrée en haut (surface) | étalée dans tout le volume |
| Part de retours multiples (non-last) | faible | élevée |
| Intensité | plus haute (aiguilles) | plus basse, variable |

L'étude deep learning conifère/feuillu sur ALS individuel montre que **les données leaf-off portent l'essentiel de l'information** (82 % conifères, 90 % feuillus) : un feuillu leaf-off ressemble à un nuage aléatoire, un conifère à une forme de couronne ([arXiv 1802.08872](https://arxiv.org/abs/1802.08872)). Mémoire UZH sur 1 400 km² du nord de la Suisse avec ALS leaf-off/leaf-on ([lien](https://lean-gate.geo.uzh.ch/typo3conf/ext/qfq/Classes/Api/download.php/mastersThesis/631)). Une règle simple à 2–3 seuils (densité relative + rapport H/D + acuité de l'apex) suffit probablement à ~80 % de justesse ; à calibrer sur quelques arbres connus.

### 3.2 Données nationales (a priori)
- **Waldmischungsgrad LFI** (BAFU/WSL) : part feuillus/résineux en **raster 10 m**, issu de Sentinel-1/2, mis à jour annuellement, GeoTIFF sur [data.geo.admin.ch (STAC `ch.bafu.landesforstinventar-waldmischungsgrad`)](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bafu.landesforstinventar-waldmischungsgrad) et WMTS ([opendata.swiss](https://opendata.swiss/en/dataset/waldmischungsgrad-lfi)). Couvre **la forêt seulement** ; pas les arbres isolés urbains.
- **Carte des essences de Suisse** (WSL, Sentinel-2 + MNT + LFI) : [EnviDat](https://envidat.ch/dataset/tree-species-map-of-switzerland) ; utile en forêt, à vérifier pour la licence.
- **Vegetationshöhenmodell LFI** (stéréo-images, 1 m) et **VHM LiDAR LFI** (swissSURFACE3D, 0,5 m) : [opendata.swiss](https://opendata.swiss/en/dataset/vegetationshohenmodell-lidar-lfi1). Inutile de les charger : l'app calcule déjà son MNC depuis les mêmes points. Le VHM stéréo (leaf-on) peut toutefois corriger la hauteur des feuillus.
- Cadastres communaux des arbres (certaines villes : Lausanne, Genève, Zurich) : espèce exacte, à croiser quand disponibles.

### 3.3 Traduction en paramètres de modèle
| Paramètre | Conifère (épicéa, sapin, mélèze) | Feuillu (hêtre, chêne, tilleul, platane) |
|---|---|---|
| Enveloppe | cône ou paraboloïde allongé, base de couronne à 20–40 % de H | ellipsoïde / demi-ellipsoïde ou enveloppe convexe des points |
| Tronc | monopodial, traverse toute la couronne jusqu'à l'apex | se divise à la base de couronne (2–4 charpentières) |
| Branches | verticilles, quasi horizontales, courtes, longueur décroissante vers le haut | obliques 30–60°, longues, ramification sympodiale |
| Space colonization | `di` petit, croissance forcée sur l'axe vertical | `di` moyen, sans contrainte d'axe, tropisme léger vers le haut |
| Diamètre du tronc | allométrie DBH ≈ f(H, diamètre couronne), ex. ~H/60 à H/40 en m | idem, plus fort à H égale |

---

## 4. Pipeline recommandé

### Étape A — Segmentation (Web Worker, ~0,1–0,4 s)
1. MNC 0,5 m : max Z par cellule des points classes 3/4/5, normalisé par le MNT (classe 2) ; closing morphologique 1 m ; lissage gaussien σ = 1 cellule.
2. Sommets : LMF à fenêtre variable `ws = clamp(0.6 + 0.08·h, 1.5, 6) m` (à calibrer), seuil h ≥ 3 m.
3. Croissance de région Dalponte (seuils 0,45 / 0,55 de la hauteur du sommet, rayon max ~ 0,6·h) ou watershed marqueurs.
4. Affectation des points 3D au segment par lookup de cellule ; fusion des segments de moins de N points ou de moins de 2 m².
Sortie par arbre : sommet (x, y, h), polygone de couronne 2D, points, base de couronne (percentile 5 % des Z du segment).

### Étape B — Enveloppe + type (~0,01 ms par arbre)
5. Indices : rapport H/D, acuité de l'apex, densité relative, part de retours multiples → `conifère | feuillu | indéterminé` ; a priori Waldmischungsgrad en forêt si chargé.
6. Enveloppe : **paramétrique par défaut** (cône pour conifère, ellipsoïde tronquée pour feuillu, ajustée sur la base de couronne, H et le rayon moyen du polygone 2D, éventuellement 8 rayons azimutaux pour l'asymétrie). En option **enveloppe convexe 3D** des points simplifiée (quickhull, ~40–80 triangles), plus fidèle mais plus « cristalline ».

### Étape C — Tronc + branches (à la demande, 1–5 ms par arbre)
7. Tronc synthétique vertical sous le sommet (ou sous le barycentre de la couronne), diamètre allométrique, de z = 0 jusqu'à la base de couronne (feuillu) ou l'apex (conifère).
8. Space colonization dans l'enveloppe : attracteurs = points LiDAR du segment (sous-échantillonnés à ~300) + points aléatoires dans l'enveloppe pour combler ; 30–80 itérations ; paramètres selon le type (§3.3).
9. Simplification : garder les nœuds de 1er et 2e ordre (charpentières), rayons par loi de Léonard / pipe model (r_parent² = Σ r_enfants²), couper sous un rayon minimal.

### Étape D — Maillage low-poly et export
| Niveau | Contenu | Triangles / arbre | Usage |
|---|---|---|---|
| LOD0 (actuel) | Sucette : cylindre + sphère | ~40–80 | vue d'ensemble, ombres rapides |
| **LOD1 (recommandé par défaut)** | Tronc prisme 6 pans (12 tri) + enveloppe paramétrique 12×6 (~120 tri) ou convexe simplifiée | **~60–150** | ombres portées, OBJ/DXF urbanisme |
| LOD2 | LOD1 + 10–30 branches en tubes 4 pans effilés, couronne en option semi-transparente ou en « touffes » | ~200–500 | rendu, présentation |

- 2 000 arbres en LOD1 ≈ 200–300 k triangles : OK pour three.js (InstancedMesh impossible car formes uniques, mais un seul BufferGeometry fusionné par type) et pour OBJ.
- DXF : écrire en `3DFACE` (ou `MESH`), un calque par type (`ARBRE_TRONC`, `ARBRE_COURONNE_CONIF`, `ARBRE_COURONNE_FEUIL`, `ARBRE_BRANCHES`) pour pouvoir masquer ; prévoir LOD1 par défaut car les logiciels CAO peinent au-delà de ~500 k faces.
- Pour l'ombre, LOD1 suffit : la silhouette de couronne pèse bien plus que les branches. Pour un feuillu leaf-off, proposer une option « couronne poreuse » (opacité / coefficient de transmission) plutôt que des branches détaillées si le calcul d'ombre est l'objectif.

### Qualité attendue
- Détection : ~70–90 % des arbres dominants isolés ou en alignement (milieu urbain, parcs) ; nettement moins en forêt dense et quasi nulle pour les arbres dominés (cf. NEWFOR ~47 % toutes strates).
- Hauteur : ±0,5–1 m (sous-estimation feuillus leaf-off) ; emprise de couronne : ±1–2 m sur le rayon.
- Branches : **plausibles, pas mesurées** ; à présenter comme une illustration.

### Effort de développement (estimation)
| Bloc | Lignes JS | Durée |
|---|---|---|
| MNC + closing + lissage + LMF + Dalponte/watershed + affectation (Worker) | ~400 | 2–3 j |
| Indices et classification conifère/feuillu | ~150 | 1 j + calibration |
| Enveloppes paramétriques + quickhull (ou three.js `ConvexGeometry`) | ~200 | 1 j |
| Space colonization + pipe model + tubes | ~300 | 2–3 j |
| Export OBJ/DXF par calques et LOD | ~150 | 1 j |
| **Total** | **~1 200** | **~1,5–2 semaines** |

Ordre conseillé : A + B + LOD1 d'abord (gain visible immédiat sur l'ombre et l'export), C/LOD2 ensuite en option.

---

## Sources principales
- lidR : [segment_trees](https://search.r-project.org/CRAN/refmans/lidR/html/segment.html), [lidR book ITD](https://r-lidar.github.io/lidRbook/itd.html), [silva2016](https://search.r-project.org/CRAN/refmans/lidR/html/its_silva2016.html)
- Eysn et al. 2015, benchmark NEWFOR : [HAL](https://hal-sde.archives-ouvertes.fr/hal-01170682)
- Pirotti et al. 2017, comparaison lidR : [PDF](https://www.research.unipd.it/bitstream/11577/3255391/1/2017_isprs_archives_pirotti_kobal6.pdf)
- Silva et al. 2016 : [USDA](https://research.fs.usda.gov/treesearch/52704)
- AMS3D / mean-shift : [Remote Sensing 2019, 11:1263](https://www.mdpi.com/2072-4292/11/11/1263)
- SegmentAnyTree : [arXiv 2401.15739](https://arxiv.org/abs/2401.15739) ; TreeLearn : [arXiv 2309.08471](https://arxiv.org/abs/2309.08471), [code](https://github.com/ecker-lab/TreeLearn)
- AdTree : [code GPL-3](https://github.com/tudelft3d/AdTree), [article](https://www.mdpi.com/2072-4292/11/18/2074) ; TreeQSM : [code](https://github.com/InverseTampere/TreeQSM)
- Runions et al. 2007 : [algorithmicbotany.org](https://algorithmicbotany.org/papers/colonization.egwnp2007.html)
- Hu et al. 2017, arbres depuis ALS : [TU Wien](https://www.cg.tuwien.ac.at/research/publications/2017/HU-2017-ETM/)
- de Groot 2020, arbres LOD depuis ALS : [TU Delft](https://repository.tudelft.nl/record/uuid:3e169fc7-5336-4742-ab9b-18c158637cfe)
- ez-tree (MIT) : [GitHub](https://github.com/dgreenheck/ez-tree) ; proctree.js : [GitHub](https://github.com/supereggbert/proctree.js)
- Conifère/feuillu leaf-off : [arXiv 1802.08872](https://arxiv.org/abs/1802.08872)
- Waldmischungsgrad LFI : [opendata.swiss](https://opendata.swiss/en/dataset/waldmischungsgrad-lfi), [STAC](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bafu.landesforstinventar-waldmischungsgrad) ; carte des essences WSL : [EnviDat](https://envidat.ch/dataset/tree-species-map-of-switzerland)
- VHM LiDAR LFI (leaf-off swissSURFACE3D) : [EnviDat](https://www.envidat.ch/metadata/vegetation-height-model-lidar-nfi)
