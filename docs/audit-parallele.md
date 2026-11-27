# Audit : ce qui peut tourner en parallèle (Topograph)

Date : 27.11.2026. Lecture du code (commit `844f39e`) et mesures dans le navigateur. Aucun fichier applicatif modifié.
Ce rapport complète `docs/audit-performance.md` (26.11) sans le répéter : il se concentre sur le fil principal, les
attentes en série et le parallélisme. Le préchargement du fond de plan (commit 558b189) est en place et n'est pas
rediscuté.

## 1. Conditions de mesure

- Chrome (volet navigateur de l'app), Mac 12 cœurs (`hardwareConcurrency` = 12), réseau domestique.
- Copie figée du dépôt servie par Vite sur un port à part, parce que le serveur 5174 se rechargeait pendant les mesures
  (modifications d'autres agents). Attention : ce second Vite a réécrit le cache partagé `node_modules/.vite/deps`
  (27.11, 14:14). Le serveur 5174 peut donc réoptimiser ses dépendances et se recharger une fois.
- Lieu : `#e=2543300&n=1152700`, `ombres.ronde` = 1 et `ombres.rayonZone` = 1000. Le relevé fin a un rayon de 300 m :
  grille 1200 × 1200, **4,66 M points**. L'anneau va de 300 à 1000 m, et le paysage jusqu'à 50 km.
- Mesures prises avec un `PerformanceObserver("longtask")`, des enveloppes `performance.now()` autour des méthodes de
  `window.__scene`, les entrées `resource` et des appels directs aux modules (`/src/*.js`) sur la maquette chargée.

## 2. Chronologie mesurée du chargement (t = 0 au changement d'adresse)

| t (s) | Durée | Quoi | Où | Fil principal bloqué ? |
|---|---|---|---|---|
| 0,06 | 0,09 s | `identify` de la parcelle | `geo.js` `parcelleEn` | non |
| **0,21** | **2,05 s** | STAC swissSURFACE3D (boîte ±300 m), **lancé seulement après la parcelle** | `geo.js` `tuiles` | non |
| 0,21 | 1,1 s | Fonds WMS 2048², tuiles Terrarium de l'horizon (z10/z12) | préchargés (bien) | non |
| 2,3 → 14,1 | 11,8 s | Nuage COPC : en-têtes en parallèle, nœuds dans 6 fils | `nuage.js` | non (points visibles au fil de l'eau ; `ajouterBloc` : 120 appels, 576 ms en tout, au plus 9 ms) |
| 3,45 | 247 ms | 1re image du chargement visible (compilation des shaders) | `rendre` (au plus 244 ms) | **oui** |
| 14,17 | **878 ms** | `depuisPoints` (836 ms remesurés) + `garderCercle` | `grille.js` | **oui** |
| 15,23 | **2 243 ms** | `construire` 827 ms (dont `grillesContact` 227 ms) + **`surligner` 1 288 ms** + reste | `scene.js` | **oui** |
| 17,46 | 0,4 s | STAC swissALTI3D (boîte ±2 km), **lancé seulement après la construction et l'horizon** | `main.js` → `tuilesAlti2m` | non |
| 17,47 | 211 ms | Reteinte du cadastre 2048² (`teinterCadastre` : 115 ms) + envoi de la texture | `fond.js` | **oui** |
| 17,8 → 26,4 | **8,6 s** | `terrainAutour` : 27 GeoTIFF de 1 Mo en **1 281 requêtes par plages**, 4 à la fois | `grille.js` `lireAlti` | en partie (décodage dans le fil principal) |
| 26,47 | **1 245 ms** | `construireAnneau` 257 ms + **préparation synchrone de `reliefLointain` (≈ 1 040 ms)** | `scene.js`, `lointain.js` | **oui** |
| 26,73 | 0,34 s | STAC swissSURFACE3D ±1 km (arbres de l'anneau), puis en-têtes COPC | `main.js` `arbresAnneau` | non |
| **27,7 → 37,2** | **9,5 s** | **67 tuiles Terrarium z13/z11 du paysage, demandées seulement maintenant** (2,9 à 4,5 s chacune, en concurrence avec 131 tuiles WMS et 266 requêtes 3D) | `lointain.js` | non |
| 37,25 → 38,33 | 18 × 60 ms | Boucle des 723 k sommets du paysage (découpée par `setTimeout`) | `lointain.js` | par tranches |
| 38,44 | — | `afficherLointain` : paysage visible | | |

Au total, **6,4 s de longues tâches** pendant ce chargement. Le paysage n'apparaît qu'à **38 s**, alors que la
maquette fine est prête à 17,5 s. Après 17,5 s, presque tout ce qui reste est de l'attente réseau **en série** :
STAC ALTI, puis ALTI 2 m, puis anneau, puis Terrarium.

Autres mesures, faites sur la maquette chargée :

| Opération | Mesure | Remarque |
|---|---|---|
| `lireAlti` actuel (`fromUrl`, `maxRanges: 1`) | **958 ms et 50 requêtes** par tuile | tuiles internes 128², blocs de 64 Ko |
| Même tuile en un seul `fetch` + `fromArrayBuffer` | **267 ms + 43 ms** de décodage | 1 020 Ko |
| `profilHorizon` (tuiles en cache) | 72 ms | |
| `reliefLointain` (tuiles en cache) | 1 044 ms synchrones + 2 236 ms au total | 723 k sommets, 1,44 M triangles |
| `construireAnneau` (700 m d'anneau) | 248 ms | 589 k sommets, index en tableau JS |
| `contoursBatiments` | 107 ms | |
| `profilCoupe` complet (400 m) | 87 ms | déjà regroupé par `requestAnimationFrame` (`suivreCoupe`) |
| `hauteursDessus` (Swiss3D) | 43 ms | |
| Heures : `zoneHeures` | **606 ms** dans le fil principal | zone 794 × 767 (grande parcelle) |
| Heures : jour (51 soleils) | 3,3 s | 4 fils |
| Heures : **année (809 soleils)** | **29,2 s** | 4 fils, alors que la machine a 12 cœurs |
| Export DXF « tout » | 3,5 s, dont des tâches de **1,3 s et 1,8 s** | 858 k triangles, 117 Mo ; écriture et `zipSync` dans le fil principal |
| Export GLB « tout » | 1,1 s | 22 Mo |

## 3. Attentes en série qui pourraient être parallèles (`main.js` `depuisAdresse`)

1. **`parcelleEn` → `tuilesNuage`.** Le STAC (2 s mesurées ici, 0,5 s le 26.11) attend la parcelle. Or `R ≤ RAYON_FIN_MAX`
   (300 m). On peut donc lancer le STAC aussitôt, avec la boîte `±RAYON_FIN_MAX` autour du point cliqué (plus une marge
   pour le recentrage sur la parcelle), puis filtrer. Gain : la durée de `identify` (0,1 s), plus toute lenteur de l'API.
2. **`tuilesAlti2m` + `terrainAutour`.** La boîte (±`max(2000, Rz + 600)`) ne dépend que de E0, N0 et Rz. On peut la
   lancer juste après le calcul de E0, N0, au lieu d'attendre `await horizon`, donc la fin de la construction. Gain :
   environ **15 s de décalage** dans ce cas.
3. **Tuiles Terrarium du paysage.** La liste des tuiles de `reliefLointain` (z13 < 3 km, z12 < 12 km, z11 au-delà) ne
   dépend que de E0, N0 et R. On peut l'extraire dans une fonction `tuilesPaysage(E0, N0, R)` et la précharger avec
   l'horizon, puisque `tuile()` garde déjà un cache. Gain : environ **9,5 s**.
4. **Anneau : STAC ±Rext et en-têtes COPC (`entete()` de `lodAnneau.js`).** Ils ne dépendent que de E0, N0 et Rz. On
   peut les lancer au début et les garder dans le cache `entetes` déjà présent. Gain : environ 0,5 à 1 s de plus au
   démarrage des arbres de l'anneau.
5. **`fondLacs` et `pontsAutour`.** Ce sont des fichiers locaux et petits, mais attendus en série. `lireIndex()` et
   l'index des ponts peuvent être demandés au début. Gain faible (quelques dizaines de ms).

Précaution : tout lancer à t = 0 met ces requêtes en concurrence avec le nuage COPC, qui est le chemin critique
(~24 Mo). Il faut garder un ordre : COPC d'abord, puis les métadonnées (STAC, index), puis les tuiles du paysage avec
`fetchpriority="low"` (`Image.fetchPriority` ou `fetch(..., { priority: "low" })`), ou bien les lancer au premier
`apercu.bloc`. L'ALTI 2 m en entier fait 27 × 1 Mo, et le Terrarium 67 × ~125 Ko.

## 4. Travaux lourds du fil principal

| Fichier · fonction | Coût | Nature |
|---|---|---|
| `scene.js` `surligner` | **1,29–1,40 s** à chaque chargement **et à chaque changement de parcelle** (`choisirParcelle`) | test point-dans-polygone (`dans`, avec déstructuration) sur 1,44 M cellules ; puis `toHalfFloat` sur 2,9 M valeurs |
| `grille.js` `depuisPoints` | 836 ms (4,66 M pts) | boucles sur les points et la grille, files `push` |
| `scene.js` `construire` | 827 ms | `terrain`, `batiments` (`contoursBatiments`), `decouperBord`, `grillesContact` (227 ms : petits tableaux alloués dans la boucle), `nuagePoints`, ponts |
| `lointain.js` `reliefLointain` | ≈ 1,04 s d'un bloc + 1,1 s en tranches | 723 k objets `sommets`, `Set` de clés texte, 5 `cleEn` par sommet (`versWgs` + `versTuile` + chaîne) ; `idx` en tableau JS de 4,3 M |
| `scene.js` `construireAnneau` | 250 ms | `altFin` en fermeture, `pos.set([...])` par sommet, `idx.push` (3,5 M) puis `computeVertexNormals` |
| `grille.js` `lireAlti` / `terrainAutour` | 27 × ~43 ms de décodage + copie dans la grille 2000² | `geotiff` décode dans le fil principal (pas de `Pool`) |
| `fond.js` `teinterCadastre` | 115 ms pour 2048² ; ~3–5 ms par tuile 512² de `plan.js` | boucle par pixel en JS |
| `horizon.js` `tuile` | 6–18 ms par tuile (audit du 26.11) | `getImageData` et détection des lacs (25 lectures par pixel) |
| `heures.js` `zoneHeures` | 606 ms | même test point-dans-polygone par cellule, puis deux cartes de distances |
| `export.js` `exporterSite` | tâches de 1,3 et 1,8 s (DXF) | `ecrireDxf` (texte), `Blob` → `arrayBuffer`, `zipSync` |
| `scene.js` `rendre` (1re image) | 244 ms | compilation synchrone des shaders |
| `lodAnneau.js` `construire` | ≤ 6 ms par image | déjà budgété (bien) |

## 5. Pistes classées (gain du plus grand au plus petit)

Effort : S < 1 j, M 1–3 j, L > 1 semaine.

| # | Fichier · fonction | Coût mesuré / estimé | Solution | Gain | Effort | Risque |
|---|---|---|---|---|---|---|
| **P1** | `main.js` `depuisAdresse` (fin) + `grille.js` `lireAlti` | ALTI 2 m : 8,6 s, lancé à 17,5 s ; 1 281 requêtes pour 27 fichiers | **Requêtes en parallèle et plus tôt** : lancer `tuilesAlti2m` + `terrainAutour` dès que E0, N0 et Rz sont connus. Lire chaque GeoTIFF **en un seul `fetch`** (`fromArrayBuffer`) : 958 → ~310 ms par tuile, 50 → 1 requête. Monter à 6–8 téléchargements à la fois | anneau et paysage plus tôt d'environ **15 s** sur ce lieu ; −1 250 requêtes | S | faible : 1 Mo par tuile reste en mémoire (déjà le cas dans `ALTI`) ; garder la reprise « hors cache » |
| **P2** | `lointain.js` `reliefLointain` (liste `besoin`) + `horizon.js` `tuile` | 67 tuiles Terrarium demandées à 27,7 s, arrivées à 37,2 s | **Préchargement** : sortir le calcul des clés de tuiles dans une fonction pure, l'appeler au début avec `profilHorizon` (priorité basse) ; option : réduire les zooms (A1 de l'audit du 26.11) | paysage visible environ **9 s plus tôt** (cumulable avec P1 : de 38 s à ~19–20 s ici) | S | concurrence avec le COPC : priorité basse ou démarrage différé au premier bloc |
| **P3** | `heures.js` / `ensoleillement.worker.js` / `main.js` `calculerHeures` | année : **29,2 s** (809 soleils, zone de 610 k cellules) ; jour : 3,3 s | (a) **plus de fils** : `min(4, …)` → `hardwareConcurrency − 1` (11 ici), soit environ ×2,5 ; fils gardés en pool (sans relancer module et copies) ; (b) **algorithme** : par azimut, angle d'horizon de chaque cellule une seule fois, puis comptage des soleils (B3 du 26.11, environ ×4–6) ; (c) **calcul GPU** : marche du rayon dans un fragment shader sur la texture de surface (une passe par soleil, accumulation additive) | (a) 29 → ~12 s ; (a + b) → ~3 s ; (c) < 1–2 s | (a) S, (b) M, (c) L | (a) aucun (mémoire : une copie de 2 × 5,8 Mo par fil) ; (b) regroupement à 2° ; (c) précision du flottant, WebGL1/Safari, double code |
| **P4** | `scene.js` `surligner` (et `heures.js` `zoneHeures`) | **1,3–1,4 s** à chaque lieu et à chaque clic de parcelle ; 0,6 s pour la zone des heures | **Pas besoin de fil** : rasterisation du polygone par lignes (intersections des arêtes par rangée, puis remplissage), ou au moins un test sur la boîte englobante avant `dans` ; boucle d'arêtes sans déstructuration | 1,3 s → ~15 ms ; 0,6 s → ~10 ms | S | faible (même règle pair/impair ; à vérifier sur les multipolygones) |
| **P5** | `grille.js` `depuisPoints` + `scene.js` `construire` (`terrain`, `batiments`, `contoursBatiments`, `decouperBord`, `grillesContact`, `nuagePoints`) | **0,9 s + 2,2 s** de page figée (dont surligner, P4) | **Worker** « grille » : `depuisPoints`, `contoursBatiments`, tableaux des maillages et textures de contact calculés dans un fil, tableaux typés transférés ; le fil principal ne crée que les `BufferGeometry` (B1 du 26.11). Le nuage arrive déjà par blocs : le fil peut **remplir la grille au fil des blocs** pendant le téléchargement | page réactive, barre animée ; et ~0,5 s de moins au bout si la grille se remplit pendant le téléchargement | M | modules à garder sans `THREE` ni DOM (`maillages.js` crée des `BufferGeometry` : séparer calcul et emballage) |
| **P6** | `lointain.js` `reliefLointain` + `scene.js` `construireAnneau` + `horizon.js` `tuile` | 1,25 s d'un bloc + 1,1 s en tranches + ~1 s de décodage de tuiles | **Worker** « paysage » : `fetch` + `createImageBitmap` + `OffscreenCanvas` pour les tuiles, puis sommets, normales, eau et index (Uint32Array) transférés. Dans le fil principal : remplacer les objets `sommets` par des tableaux typés et les clés texte par des clés numériques (×5–10 sans fil). `carteRelief` en profite aussi (512² appels d'`altitude`) | −2 à −3 s de fil principal après la 1re image | M | cache des tuiles à placer dans le fil (l'horizon et `userData.altitude` en ont besoin : renvoyer les Float32Array ou garder un cache côté principal) |
| **P7** | `export.js` `exporterSite` (`ecrireDxf`, `ecrireObj`, `ecrireStl`, `zipSync`) | DXF : tâches de 1,3 s et 1,8 s, 117 Mo de texte | **Worker** d'écriture (catégories en tableaux typés, transférables) et `zip` asynchrone de fflate (qui a ses propres fils) ; `preparer` (130 ms) peut rester | plus de gel de 3 s ; la barre avance | S–M | GLB : `GLTFExporter` dépend de THREE, il reste dans le fil principal ou passe par un écrivain GLB maison |
| **P8** | `fond.js` `teinterCadastre`, `plan.js` (reteinte des tuiles), `scene.js` (compilation) | 115 ms par 2048², ~0,5 s pour 127 tuiles, 211 ms de tâche à l'arrivée ; 1re image : 244 ms | **Calcul GPU** : reteinte dans le shader (palette en uniformes), changement de thème instantané ; à défaut, **OffscreenCanvas** dans un fil (`createImageBitmap` + boucle + `transferToImageBitmap`). **`renderer.compileAsync(scene, camera)`** pendant le téléchargement du nuage (KHR_parallel_shader_compile) | −0,3 à −0,7 s de petites tâches ; 1re image sans à-coup | S–M | couleurs à recaler entre shader et version JS (export PDF, captures) |

### Pistes de second rang

| Fichier · fonction | Solution | Gain | Effort | Risque |
|---|---|---|---|---|
| `main.js` `depuisAdresse` : STAC après `identify` | lancer le STAC ±`RAYON_FIN_MAX` en parallèle de `parcelleEn` ; garder les réponses STAC (sessionStorage) | 0,1–0,5 s (plus si l'API est lente : 2 s mesurées) | S | aucun |
| `main.js` `arbresAnneau`, `lodAnneau.js` `entete` | STAC ±Rext et `Copc.create` des tuiles de l'anneau lancés au début ; en-têtes lus dans un fil (laz-perf et copc hors du bundle principal) | arbres de l'anneau ~1 s plus tôt | S | concurrence réseau (priorité basse) |
| Cache persistant (nouveau module) | **IndexedDB / Cache API** : tuiles ALTI 2 m (27 Mo, servent à tous les lieux voisins), Terrarium, réponses STAC, nœuds COPC des niveaux 0–2 | revisite ou lieu voisin : −10 à −30 s de réseau | M | quota, purge LRU |
| `grille.js` `terrainAutour` | décoder les GeoTIFF dans un fil (`geotiff` `Pool`, ou fil maison avec `fromArrayBuffer`) et copier dans la grille 2000² là-bas | −1 s de petites tâches | S | aucun |
| `scene.js` `grillesContact` | dans le fil P5 ; à défaut, boucle sans tableaux littéraux (`[[a, b, w], …]` alloués par cellule) | 227 → ~40 ms | S | aucun |
| `main.js` `calculerHeures` | envoyer `surface`/`base` une fois à un pool de fils gardé pour le lieu (pas de recopie de 2 × 5,8 Mo × 4 à chaque période) | −50 à −100 ms par calcul | S | aucun |
| `scene.js` `construireAnneau` | `Uint32Array` pour l'index, `pos[3*q] = …` au lieu de `pos.set([...])`, normales calculées depuis la grille 2 m ; ou dans le fil P6 | 250 → ~80 ms | S | aucun |
| Reconstruction « Advanced » (`main.js` `reconstruireAdvanced`) | déjà dans un fil ; le nuage (4,66 M points, ~60 Mo) est **copié** à chaque appel : le transférer est impossible (il sert encore), mais on peut n'envoyer que les points dans les emprises (filtre par boîte) | −50 à −150 ms et −60 Mo de pic | S | aucun |
| Navigation (`scene.js` boucle de rendu) | voir A6/A7 de l'audit du 26.11 (GTAO coupé pendant le mouvement, paysage exclu de la passe AO) : c'est du GPU, pas du parallélisme CPU | ×1,5–3 images/s | S–M | voir l'audit du 26.11 |

### Ce qu'il ne faut pas faire

- **OffscreenCanvas pour tout le rendu** : non (OrbitControls, lancers de rayons, poignées, DOM). Mieux vaut sortir les
  calculs du fil principal.
- **SharedArrayBuffer** : non. Il faut COOP/COEP, ce qui touche toutes les ressources tierces (WMS, Terrarium, 3D
  tiles), pour éviter des copies de quelques Mo.
- **`requestIdleCallback` pour les gros blocs** (`depuisPoints`, `surligner`) : pas suffisant. Ces boucles ne se
  découpent pas sans réécriture, et P4 rend `surligner` négligeable. `requestIdleCallback` convient en revanche à la
  reteinte des tuiles de `plan.js` et à `carteRelief`, déjà découpée par `setTimeout`.

## 6. Limite de 100 éléments dans `geo.js` `tuiles()` (pas de pagination STAC)

`tuiles(collection, boite)` demande `items?limit=100&bbox=…` et ne suit pas le lien `rel="next"`. Toutes les fonctions
s'en servent : `tuilesNuage`, `tuilesGrille` et `tuilesAlti2m`.

Mesures faites le 27.11, avec une boîte de ±2 km (c'est celle de `tuilesAlti2m` : `RAYON_FIN = max(2000, Rz + 600)`) :

| Lieu | swissALTI3D | swissSURFACE3D |
|---|---|---|
| Lutry (2543300 / 1152700) | 50 éléments, 25 tuiles | 50, 25 |
| Zurich | 52, 26 | 52, 26 |
| Berne | 50, 25 | 25, 25 |
| Gruyères (accueil) | 50, 25 | 50, 25 |
| Tessin / Genève | 49, 25 | 25 / 47 |

Aujourd'hui, la plupart des tuiles ont **deux millésimes** ; on reste sous 100, et aucun lien `next` n'est rendu. Il
suffit pourtant d'un **troisième millésime** (le cycle de mise à jour de swissALTI3D est en cours) : la boîte de ±2 km
atteint alors 75 à 78 éléments. Avec un quatrième millésime, ou avec une boîte un peu décalée (la bbox WGS84, tirée de
deux coins seulement, touche 6 × 6 = 36 tuiles), elle dépasse 100. Les éléments au-delà de 100 sont perdus **sans
erreur** :
- `tuilesNuage` rend `null` (repli raster) si une tuile manque ;
- `tuilesAlti2m` rend une grille 2 m **trouée** (anneau et raccord du paysage faux).

L'ordre de l'API n'étant pas garanti, ce sont parfois les millésimes récents qui disparaissent.

Correctifs (effort S, risque nul) :
1. Suivre `links.find(l => l.rel === "next")` jusqu'au bout, ou découper la bbox en morceaux de 1 km demandés **en
   parallèle**, comme `parcellesAutour` le fait déjà.
2. Ou bien ne demander que le plus récent, avec le filtre STAC `datetime=` ou `sortby=-datetime` si l'API le prend
   (à vérifier), ce qui divise aussi le volume des réponses.
3. Garder les réponses STAC en sessionStorage ou IndexedDB : elles changent rarement, et la même boîte revient à chaque
   changement de rayon.

## 7. Ordre conseillé

1. **P1 + P2 + P4** (une journée) : le paysage et l'anneau passent de ~38 s à ~20 s sur ce lieu, et `surligner` n'a
   plus de gel de 1,3 s (ni au chargement, ni au clic). Ajouter la pagination STAC (§ 6) en même temps.
2. **P3 (a)** tout de suite (une ligne) : l'année passe de 29 s à ~12 s. Ensuite **P3 (b)**.
3. **P5, P6** : plus de page figée pendant la construction.
4. **P7, P8**, puis le cache IndexedDB.
