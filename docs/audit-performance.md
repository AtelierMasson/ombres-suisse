# Audit de performance — Topograph (ombres-suisse)

Date : 26.11.2026. Lecture seule du code (commit `d17a355`). Les numéros de ligne peuvent bouger : la fonction est toujours nommée.

## 1. Mesures faites

Toutes en Node 22 (V8, comme Chrome) sur ce Mac, avec les **vraies données swisstopo** (tuile COPC 2025 `2542-1150`, Lutry, boîte ±150 m au centre de la tuile) et les **modules du projet importés tels quels** (scripts jetables hors du dépôt). Pas de mesure GPU : les gains de rendu sont des estimations.

### Réseau et décodage du nuage (`nuage.js`)

| Élément | Mesure |
|---|---|
| `Copc.create` (en-tête, VLR) | **670 ms par tuile**, fait **en série** tuile après tuile |
| Requête STAC | 530 ms ; `identify` parcelle : 120 ms |
| Nœuds retenus (profondeur ≤ 4) | 64 nœuds, **3,78 Mpts, 23,7 Mo** compressés |
| …dont réellement dans la boîte | 1,82 Mpts (**48 %**) : les nœuds des niveaux 0–2 couvrent toute la tuile km |
| Niveaux 0–2 seuls (communs à toute parcelle de la même tuile km) | 6,2 Mo, téléchargés à nouveau pour chaque lieu et **pour chaque tuile touchée** (≈ 51 % des boîtes ±150 m touchent 2 tuiles, 9 % en touchent 4) |
| Téléchargement 23,7 Mo, 6 en parallèle | 2,3 s ici (~80 Mbit/s) ; **≈ 9,5 s à 20 Mbit/s** |
| Décodage laz-perf (WASM) + lecture, 1 fil | 2,0 s CPU (1,9 Mpts/s), réparti sur ≤ 6 fils, soit ≈ 0,4 s |

Conclusion : **le chargement est limité par le volume téléchargé, pas par le décodage**. Le WASM est déjà là (laz-perf) et n'est pas le goulot.

Profondeur : `profMax = ceil(log2(6,80 / 0,5)) = 4`. Or, chez swisstopo, le niveau 4 contient déjà ~13 pts/m² (densité quasi complète). Avec les niveaux 0–3 seuls, il reste **6,1 pts/m² dans la boîte**. Comparaison des grilles (`depuisPoints`) faites avec les niveaux 0–3 et avec 0–4 : écart moyen des toits **7,5 cm**, du sol **4,5 cm**, 2,3 % de cellules « bâtiment » différentes. Les trous (77 % de cellules touchées au lieu de 99,8 %) sont rebouchés par `fermer()`/`remplir()`.

| Scénario (même boîte) | Données | Points |
|---|---|---|
| Actuel (≤ 4 partout) | 23,7 Mo | 3,78 M |
| ≤ 3 partout | 13,3 Mo | 1,78 M |
| **≤ 3 partout + niveau 4 à ±60 m du centre** | **14,5 Mo (−39 %)** | 2,01 M |
| Même chose, boîte décalée dans la tuile | 20,8 → 11,5 Mo (−45 %) | 3,37 → 1,56 M |

### Calcul sur le fil principal après le téléchargement

| Étape | R = 150 m (n = 600) | R = 300 m (n = 1200) |
|---|---|---|
| `depuisPoints` (grille.js) | 219 ms | 1 497 ms |
| `contoursBatiments` | 166 ms | 888 ms |
| `decouperBord` toits + murs | 125 + 24 ms | ~600 ms (est.) |
| `grillesContact` (scene.js) | 80 ms | ~320 ms (est.) |
| batiments, terrain, socle, canopée, points des arbres | ~115 ms | ~460 ms (est.) |
| **Total, en une seule tâche longue** | **≈ 0,75 s** | **≈ 3,5 s** (page figée) |

### Paysage lointain (`lointain.js`, `horizon.js`)

| Élément | Mesure |
|---|---|
| Maillage polaire | 2 048 × 353 = 723 k sommets, **1,44 M triangles** |
| Tuiles Terrarium voulues (z13/z12/z11) | **163 tuiles**, dont 159 absentes du profil d'horizon ; **~125 Ko chacune ⇒ ~15–20 Mo** |
| Préparation (objets `sommets` + ensemble `besoin`, 5 `cleEn` par sommet) | **890 ms d'un bloc** (non découpé) |
| Boucle des sommets (11 `versWgs`/`versTuile` + clés texte par sommet) | 940 ms (découpée par `setTimeout`) |
| Décodage d'une tuile (`getImageData` + détection des lacs) | 6–18 ms par tuile, fil principal ⇒ ~2 s pour 163 tuiles |
| Avec z12 / z11 / z10 (seuils 10 km / 25 km) | **52 tuiles, dont 30 seulement hors horizon** |

### Plan cadastral en tuiles (`plan.js`)

Vue de départ : **127 tuiles WMS de 512 px** (36 de 125 m, 31 de 250 m, 26 de 500 m, 29 de 1 km, 5 de 2 km). WMS 512 px ≈ 145 Ko et 0,37 s de rendu serveur par tuile ⇒ **~12–18 Mo**. Or les tuiles de 1 km et plus tombent dans l'image « large » (15,6 m/pixel) : 64 à 128 px suffiraient. La même couche existe en **WMTS** (tuiles en cache CDN : 23 Ko, 0,28 s).

### Heures de soleil (`ensoleillement.worker.js`)

Zone 196 × 196 cellules, 3 145 carreaux de façade, un seul fil : **jour 91 soleils = 257 ms ; année 822 soleils = 3 267 ms** (≈ 0,9 s sur 4 fils). L'année ne compte que **123 azimuts distincts** (à 2°), le mois 91.

### Coupe

`profilCoupe` : **25–32 ms par appel** (R = 150 m), recalculé à **chaque `pointermove`** pendant qu'on tire une poignée, avec la reconstruction de la tranche et le dessin SVG.

### Bundle (`npm run build`)

| Fichier | Taille | gzip | brotli |
|---|---|---|---|
| `index-*.js` | 1 352 Ko | 388 Ko | 321 Ko |
| `index-*.css` (Bootstrap entier) | 254 Ko | 36 Ko | 27 Ko |
| `nuage.worker` + `laz-perf.wasm` | 80 + 214 Ko | 26 + 73 Ko | — |

Contenu du JS principal : three core 440 Ko, src 308 Ko (dont 4 langues × 22 Ko), addons three 156 Ko (GLTFLoader 44, GLTFExporter 36, fflate, STL/OBJ, DRACOLoader), 3d-tiles-renderer 83 Ko, **laz-perf 51 Ko + copc 16 Ko** (lecture d'en-tête sur le fil principal), geotiff 46 Ko. La page reste **invisible** (`html:not(.pret) body {visibility:hidden}`) jusqu'à l'exécution de tout ce JS.

### Rendu, image par image (lecture du code)

Avec les effets : RenderPass (plein écran, MSAA ×4 si ratio < 1,5) → GTAO (**la scène redessinée une 2ᵉ fois** pour normales et profondeur, demi-résolution, 16 échantillons + débruitage 16) → Rebond (10 échantillons + 2 flous) → OutputPass. Ombre 4096², recalculée seulement quand le soleil ou la scène changent (bien). Rendu à la demande (bien). La 2ᵉ passe GTAO inclut le paysage (1,44 M triangles), qui n'a pas besoin d'occlusion à 12 m de rayon.

---

## 2. Recommandations

Gain / effort : ★★★ fort, ★★ moyen, ★ faible. Effort S < 1 j, M 1–3 j, L > 1 semaine.

### A. Gains rapides

| # | Où | Ce qui coûte | Changement proposé | Gain attendu | Effort | Risque |
|---|---|---|---|---|---|---|
| A1 | `lointain.js` `reliefLointain` (choix `z: d < 8000 ? 13 : d < 30000 ? 12 : 11`) | 163 tuiles Terrarium (~15–20 Mo) et ~2 s de décodage | Zooms 12 / 11 / 10 avec seuils 10 km et 25 km (2 km–8 km : la maille fait déjà ≥ 30 m, z12 ≈ 26 m/px suffit ; < 2 km, c'est swissALTI3D) | ★★★ **−70 % de tuiles (163 → 52)**, environ −12 à −15 Mo, environ −1,5 s de CPU | S | relief un peu plus doux entre 2 et 8 km : à vérifier à l'œil |
| A2 | `nuage.js` `chargerNuage` (`profMax`, filtre des nœuds) | 23,7 Mo, 3,8 Mpts | Niveau 4 seulement près de la parcelle (boîte de la parcelle + ~40 m), niveaux ≤ 3 au-delà (passer la boîte intérieure en paramètre) | ★★★ **−39 à −45 % d'octets**, de décodage et de points à mettre en grille | S | anneau extérieur un peu moins fin (écart moyen mesuré : 7,5 cm sur les toits) ; nuage brut et points de coupe plus clairsemés loin de la parcelle |
| A3 | `nuage.js` boucle `for (const t of tuiles)` (`await Copc.create`, puis la hiérarchie) | 0,7 s par tuile, en série | `Promise.all` sur les tuiles (en-tête et hiérarchie) | ★★ −0,7 s par tuile en plus (51 % des lieux) | S | aucun |
| A4 | `main.js` `depuisAdresse` (`parcelleEn` puis `tuilesNuage`) | STAC (0,5 s) attend la parcelle | Lancer STAC aussitôt avec la boîte maximale (±300 m) et filtrer ensuite ; garder les réponses STAC (sessionStorage) | ★ −0,1 à −0,5 s | S | aucun |
| A5 | `index.html` | DNS + TLS au premier appel de chaque service | `<link rel="preconnect">` vers api3, data, wms (et wmts).geo.admin.ch et elevation-tiles-prod.s3.amazonaws.com ; pour un lien profond (`#e=…`), lancer `identify` dans un petit script inline avant le bundle | ★★ −0,1 à −0,3 s, et **−(téléchargement + exécution du bundle)** sur les liens partagés | S | aucun |
| A6 | `scene.js` `ao.render` (liste `caches`) | 1,44 M triangles redessinés dans la passe GTAO | Ajouter `this.loin.maille` aux objets cachés pendant la passe | ★★ environ −40 % de géométrie dans la 2ᵉ passe | S | pas d'occlusion ni de rebond sur le paysage (invisibles à cette distance) ; vérifier la jonction au bord du socle |
| A7 | `scene.js` (boucle de rendu, `controls`) | GTAO + rebond à chaque image pendant qu'on tourne la vue | Pendant le mouvement (`start` → `end` + amorti), rendu sans GTAO ni rebond (ou en ratio 1), puis une image complète à l'arrêt (le rendu à la demande le permet déjà) | ★★★ **×1,5 à ×3 d'images/s en navigation** sur GPU intégré (estimation) | S–M | l'occlusion « apparaît » à l'arrêt (usage courant) |
| A8 | `plan.js` `PIXELS = 512` | Tuiles lointaines 4 à 8 fois trop fines | Taille demandée selon l'image cible (proche 0,59 m/px, large 15,6 m/px), bornée à 64–512 px ; ne pas demander les tuiles entièrement cachées sous la maquette | ★★ −40 à −50 % d'octets WMS (~6–8 Mo), rendu serveur plus court | S | aucun |
| A9 | `maillages.js` `decouperBord` | 125 ms pour les toits ; un tableau par sommet et des `push` | Copier tels quels les triangles entièrement dedans (test sur la boîte), ne découper que ceux du bord, garder l'index | ★ 150 → ~20 ms (R 150), ~600 → ~80 ms (R 300) | S | faible (tests de désignation des volumes) |
| A10 | `main.js` (bloc de la boussole, `dessiner`) | `svg.replaceChildren()` et ~20 éléments recréés à chaque `change` des contrôles | Créer les éléments une fois, ne mettre à jour que les attributs | ★ moins de travail DOM à chaque image | S | aucun |
| A11 | Coupe : `scene.js` `pointermove` des poignées, puis `majCoupe` | 25–32 ms par mouvement (R 150), ×4 en R 300 | Regrouper par `requestAnimationFrame` (un calcul par image), et dans `appliquerCoupe` ne mettre `needsUpdate` que si le nombre de plans change | ★★ glisser fluide | S | aucun |
| A12 | `nuage.js` (création des fils), `main.js` `calculerHeures` | Nouveaux fils (et instances laz-perf) à chaque lieu et à chaque calcul | Garder un pool de fils ; le préchauffer pendant l'accueil (script du fil + wasm) | ★ −0,1 à −0,3 s au 1er lieu | S | faible |
| A13 | `main.js` `accueil()` | Accueil animé : rendu complet (GTAO, rebond) en continu et ombre 4096² recalculée ~14 fois/s | Accueil en ratio 1, sans GTAO, plafonné à 30 images/s | ★ batterie et chauffe (aucun effet sur le chargement d'un lieu) | S | aucun |
| A14 | `public/.htaccess` | Pas de brotli ; type wasm non déclaré | Fichiers `.br` précompressés à la construction et règle pour les servir ; `AddType application/wasm .wasm` (compilation en flux) ; ne pas recompresser PNG/JPG | ★ −17 % sur le JS (388 → 321 Ko) | S | config Apache Infomaniak à tester |

### B. Moyen

| # | Où | Ce qui coûte | Changement proposé | Gain attendu | Effort | Risque |
|---|---|---|---|---|---|---|
| B1 | `main.js` → `depuisPoints`, puis `scene.construire` | 0,75 s (R 150) à **3,5 s** (R 300) de page figée | Fil « reconstruction » : grille, contours, tableaux des maillages (terrain, toits, murs, socle, canopée, points) calculés dans un fil ; tableaux typés transférés ; le fil principal ne crée que les `BufferGeometry` | ★★★ page réactive pendant la construction, barre animée ; durée totale à peu près égale | M | modules à garder sans DOM (c'est déjà presque le cas) |
| B2 | `lointain.js` `reliefLointain` + `horizon.js` `tuile` | ~1,8 s de calcul + ~2 s de décodage des tuiles sur le fil principal, après la première image | (a) tableaux typés, une seule projection par sommet, voisins déduits en pixels, clés numériques ⇒ ×5–10 ; (b) tout dans un fil (`fetch` + `createImageBitmap` + `OffscreenCanvas`) ; (c) `nA` 2048 → 1024 (pas angulaire 0,3 % de la distance contre 1,5 % en radial) | ★★ −3 à −4 s de fil principal après la première image ; −50 % de triangles du paysage | M | (c) silhouettes lointaines un peu moins fines |
| B3 | `ensoleillement.worker.js` (`libre`, `soleils.forEach`) | Année : 822 soleils × 38 k cellules, rayons jusqu'à `zmax` global | Par azimut (123 pour l'année), calculer une fois l'**angle d'horizon** de chaque cellule et de chaque carreau, puis compter tous les soleils de cet azimut (`hauteur > horizon`) ; arrêter le rayon dès que `(zmax − z0)/d` ne peut plus dépasser le maximum ; option : pyramide des maxima pour sauter les blocs bas | ★★ année ~3,3 s → ~0,5 s de CPU (estimation ×4–6), mois ×2 | M | regroupement par azimut à 2° près (l'année regroupe déjà à 2°) : écarts minimes à valider |
| B4 | `main.js` + `vite.config.js` | Bundle de 1,35 Mo, et page invisible jusqu'à son exécution | `import()` différé : pro/export/import (~150 Ko), swiss3d + 3d-tiles + Draco (~90 Ko, seulement quand Swiss3D est coché), langues (~66 Ko : seule l'active), geotiff (46 Ko) ; lecture de l'en-tête COPC dans le fil (retire laz-perf et copc du principal, 67 Ko) ; Bootstrap purgé (254 → ~40 Ko de CSS) ; afficher la page dès le CSS en production | ★★ −30 % de JS critique (~−120 Ko gz) ; page affichée avant le JS : −0,2 à −1 s en 4G, presque rien sur fibre | M | textes non encore traduits visibles un instant (de/it/en) si la page s'affiche avant `traduirePage` |
| B5 | Cache persistant (nouveau module) | Tout est retéléchargé à chaque lieu et à chaque visite | Cache API : nœuds COPC (clé url + offset ; les niveaux 0–2 servent à toute la tuile km), STAC, tuiles Terrarium et WMS/WMTS ; quota et purge LRU | ★★ revisite ou parcelle voisine : −6 à −24 Mo ; nul pour un 1er lieu | M | quota de stockage, invalidation (URL datée par année : faible) |
| B6 | `plan.js` + `fond.js` `teinterCadastre` | ~3–5 ms de CPU par tuile 512² (~0,5 s pour 127 tuiles) ; 4096² + 2048² repeints (avec mipmaps) à chaque arrivée et à chaque arrêt de caméra (`nettoyer()` remet toujours `sale = true`) | Reteinte dans le shader de la passe de peinture (palette en uniformes) ; `sale = true` seulement si quelque chose a changé ; WMTS au lieu de WMS (cache CDN, 23 Ko/tuile) | ★★ CPU ≈ 0, changement de thème instantané, réseau ÷3 à ÷6 | M | WMTS 2056 : grille de tuiles à recaler (résolutions non binaires) |
| B7 | `scene.js` (constructeur) | Ombre 4096², GTAO 16 + 16 échantillons | En qualité réduite ou sur mobile : ombre 2048 ; GTAO 8 + 8 ; pendant la lecture animée du soleil, ombre 2048 puis 4096 à l'arrêt | ★ −20 à −30 % du coût GPU des effets | S–M | contrôle visuel |
| B8 | Maillages terrain et toits | R 300 : ~720 k triangles de terrain, ~540 k de toits (2 par cellule, même sur un toit plat) | Simplification (RTIN/Martini pour le terrain, meshoptimizer en WASM pour les toits), à décider **après** une mesure `renderer.info` sur GPU intégré | ★ ? (incertain : dépend du GPU) | M | arêtes et désignation par triangle à revoir |

### C. Gros chantiers (WASM, WebGPU, serveur)

| # | Idée | Verdict | Pourquoi |
|---|---|---|---|
| C1 | Décodeur LAZ WASM avec décompression sélective (laz-rs : X, Y, Z et classe seulement) | **Pas maintenant** | Décodage ≈ 0,4 s réparti sur les fils, contre 2–10 s de téléchargement. À revoir seulement si un profil mobile montre le décodage en tête après A2. |
| C2 | WASM pour la grille, les contours, la coupe | **Non** | Boucles déjà en tableaux typés ; gain ×1,2–1,5 au mieux. B1 (passage dans un fil) apporte bien plus. |
| C3 | WASM SIMD ou WebGPU (calcul) pour les heures de soleil | **Non (d'abord B3)** | Gain ×4–6 par l'algorithme ; WebGPU impose de migrer tout le rendu (`onBeforeCompile` GLSL, ShaderMaterial) vers `WebGPURenderer`/TSL : L, risque élevé. |
| C4 | Rendu dans un fil (`OffscreenCanvas`) | **Non** | Interface très liée au DOM (OrbitControls, lancer de rayons, poignées) ; mieux vaut sortir du fil principal les calculs (B1, B2, B6). |
| C5 | `SharedArrayBuffer` | **Non** | Il faut COOP/COEP (contrainte sur toutes les ressources tierces) pour éviter quelques copies de quelques Mo (quelques ms). |
| C6 | Affinage progressif (niveaux ≤ 3, première image, puis niveau 4 et reconstruction) | Peut-être, après A2 | Première image à environ 55 % des octets ; coût : deux reconstructions, des états à gérer. |
| C7 | Prétraitement côté serveur (API PHP Infomaniak) : grilles 0,5 m compactes par lieu, nuage brut à la demande | Long terme | Pourrait réduire 15–24 Mo à ~1–2 Mo, mais demande la bande passante et le CPU du serveur (hébergement mutualisé) et ajoute un service à maintenir. |

---

## 3. Ordre conseillé

1. **A1, A2, A3, A5, A8** (une journée en tout) : réseau pour un lieu typique d'environ **60 Mo à environ 30 Mo** (nuage ~24 → ~14,5 Mo, paysage ~18 → ~5 Mo, plan ~15 → ~8 Mo), et la première image plus tôt d'environ 30–40 % sur une connexion moyenne.
2. **A6, A7, A11** : fluidité de la navigation et de la coupe.
3. **B1, B2** : plus de page figée (surtout R = 300 m en mode pro).
4. **B3, B4, B5, B6** selon l'usage réel (heures de soleil sur l'année, revisites, mobile).
5. Avant B8 et C* : mesurer dans Chrome (onglet Performance, `renderer.info`, GPU intégré, mobile) ; ce rapport ne contient aucune mesure GPU.

Temps jusqu'à la première image (estimation, 50 Mbit/s, boîte sur 1 tuile) : aujourd'hui ≈ 0,1 + 0,5 + 0,7 + 3,8 (24 Mo) + 0,75 ≈ **6 s** ; après la première série ≈ 0,4 + 0,7 + 2,3 (14,5 Mo) + 0,7 ≈ **4 s** ; à 20 Mbit/s, de ~12 s à ~7 s. Sur 2 à 4 tuiles, l'écart grandit (A3 et A2 jouent par tuile).

## 4. Remarques annexes

- `dist/assets` contient une 2ᵉ copie du décodeur Draco (version asm.js de 719 Ko comprise) émise par une dépendance ; elle n'est pas chargée à l'exécution (DRACOLoader lit `public/draco/`), mais elle alourdit le déploiement.
- `public/draco/*` reçoit `immutable` pendant 1 an sans empreinte dans le nom : à renommer à chaque mise à jour du décodeur.
- COPC swisstopo : `Cache-Control: max-age=7200` + ETag. Les navigateurs gardent en partie les réponses 206 : vérifier dans DevTools (colonne Taille, « disk cache ») avant d'investir dans B5.
