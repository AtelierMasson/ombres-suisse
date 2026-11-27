# Plan : chargement, paysage continu, prévisionnel (27.11.2026)

Plan d'architecture (agent Fable, réflexion maximale). Chiffres : lecture du code, `docs/audit-performance.md` (mesures du 26.11) et vérifications réseau du 27.11. Rien n'a été exécuté dans le navigateur.

**Recommandation centrale** : pas de quadtree maison. swisstopo sert le terrain en tuiles à niveaux de détail (quantized-mesh, `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json`, niveaux 0–18, normales, HTTP/2 depuis Zurich, 4–100 Ko par tuile, ~0,1 s), dans le même repère que bâtiments, arbres et ponts. `3d-tiles-renderer` 0.5.4 (installé) contient `QuantizedMeshPlugin`, `LoadRegionPlugin`, `TilesFadePlugin`, `ImageOverlayPlugin` et un cache LRU commun. Le chantier : un « monde » persistant, indépendant de la maquette, qui s'y insère. Couverture hors frontière : niveaux 10–13 à Chamonix, Aoste, Constance ; niveau 10 seul à Milan ; rien à Lyon ni Stuttgart. Non testé : le plugin sur ce service (premier prototype).

## A. Diagnostic

`depuisAdresse` (`src/main.js`), presque tout en série :
1. `parcelleEn` (0,12 s) → `tuilesNuage` (STAC, 0,5 s), qui attend la parcelle sans raison.
2. `Copc.create` + hiérarchie (0,7–1 s), fil principal, sans mémoire d'un lieu à l'autre.
3. Nœuds COPC 14–24 Mo (2–10 s) ; 6 fils recréés et détruits à chaque `chargerNuage` ; téléchargement et décodage couplés (≤ 6 requêtes).
4. `depuisPoints` sur le fil principal : 0,2 s (R 150) à 1,5 s (R 300).
5. `fondLacs` puis `pontsAutour` en série alors qu'ils ne dépendent que du centre.
6. `scene.construire` sur le fil principal : 0,5–2 s.
7. `await horizon`, puis seulement STAC alti, `terrainAutour`, `paysageEtAnneau`.

Travail inutile : « Paysage » décoché par défaut (`loin.voir = false`), mais on charge quand même 16–25 tuiles swissALTI3D 2 m (~1 Mo chacune, `RAYON_FIN = max(2000, Rz + 600)`), ~100 tuiles Terrarium (z 13/12/11), un maillage de 1,44 M de triangles (`reliefLointain`, 720 000 objets `sommets`, clés texte, décodage sur le fil principal dans `horizon.js`) : ~25–35 Mo et 2–4 s de fil principal pour rien de visible.

Redondances : accueil charge deux fois le relevé (150 puis 300 m) ; `arbresAnneau` refait STAC + `Copc.create` et retélécharge les niveaux 0–2 (6,2 Mo par tuile km, jusqu'à 9 tuiles) ; horizon en z10 et paysage en z11 ; image cadastrale 2048 px de la maquette doublant les tuiles du plan.

Recentrage clavier (`surVoyage`, à 0,75 R) = `depuisAdresse` complet : `scene.vider()` détruit les 3 `TilesRenderer` de `Swiss3D`, le paysage, les textures du plan ; 6–12 s pour une vitesse qui atteint 100 m/s. `TuilesPlan.demander()` est un anti-rebond de 150 ms : le plan ne se met pas à jour pendant le mouvement.

Autres : `construireAnneau` remplit l'index par `push` (jusqu'à 3,5 M) ; caches non bornés en octets (`IMAGES` 600 × 512², Terrarium, `ALTI` 80 Mo) ; pas de cache persistant, de priorité ni de `preconnect` ; GTAO et rebond pendant le mouvement ; paysage dans la passe d'occlusion. Audit : A2, A3, A1 en partie faits ; restent A4–A8, A12, B1, B2, B5, B6.

`vol.js` = mode paysage v0 : grille 2 m sans nuage ni cercle, matière du paysage (`loin.mat`), bâtiments et arbres en tuiles calés par `calerSol`, plan en tuiles, `scene.tempsVol`. Limites : centre fixe, grille monolithique (9–16 Mo), clavier coupé, paysage polaire centré.

## B. Architecture du mode paysage

`src/monde.js` (classe `Monde`), persistant, jamais vidé par `construire`. Groupe `racine` portant la matrice `versScene` (calcul existant dans `Swiss3D.charger`), avec quatre jeux de tuiles : terrain (nouveau), bâtiments, arbres, ponts (déplacés de `swiss3d.js`). Un seul décalage entre ce monde et les données MN95 (disque fin, plan, parcelles). Remplacer `versWgs` (~1 m) par les formules rigoureuses swisstopo dans la matrice. `caler` reste pour la maquette.

```js
const t = new TilesRenderer("https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/");
t.registerPlugin(new QuantizedMeshPlugin({ useRecommendedSettings: true }));
t.errorTarget = 4; racine.add(t.group);   // matière : materiauLointain(), posée au « load-model »
```

| Distance | Source |
|---|---|
| 0–300 m | relevé laser 0,5 m (maquette seulement) |
| jusqu'à ~1,5 km | niveaux 16–17 (plafonner à 17 : le 18 pèse 100 Ko) |
| 1,5–10 km | niveaux 12–15 |
| au-delà | niveaux 8–11 |

Garder `reliefLointain` (Terrarium) en repli hors couverture, dans un fil, seulement quand l'origine change (à décider au prototype).

Sol : garder `TuilesPlan` (régulation au lieu d'anti-rebond, image intermédiaire ~5 km, WMTS au lieu de WMS, reteinte dans le shader). Lacs : le terrain porte la surface plane ; teinte par le plan ou polygones (F11) ; eau translucide et fond propres à la maquette.

Origine flottante : au-delà de ~2 km, translation caméra + cible, recalcul de la seule matrice `racine`, décalage de `TuilesPlan` et des groupes MN95 ; tuiles gardées. Tant qu'un disque fin existe, son centre reste l'origine (uniformes `ZONE*`, `CONTACT`, heures) ; libéré au-delà de ~20 km.

```js
rebaser(E, N) { const dx = E - this.E0, dn = N - this.N0;
  for (const v of [camera.position, controls.target]) { v.x -= dx; v.z += dn; }
  this.racine.matrix.copy(versScene(E, N, zRef)); this.E0 = E; this.N0 = N; tuilesPlan.decaler(dx, dn); }
```

`scene.js` : scinder `vider()` (maquette / monde persistant) ; ombres suivant la cible (`placerSoleil`) ; `deplacerClavier` sans `surVoyage`, altitude minimale au-dessus du terrain ; zone des arbres découpée dans le shader (`decoupeZone`) au lieu de `limiterZone`.

Budget mémoire : LRU unique 256 Mo (ordinateur) / 96 Mo (mobile) ; plan 4096² + 2048² (~105 Mo GPU) / 2048² + 1024² ; un seul disque fin (~150–250 Mo) ; caches bornés en octets.

Relevé fin à la demande (recherche, clic parcelle, bouton) ; pas de construction automatique à l'arrêt (14–24 Mo, > 100 Mo de mémoire) : préchargement en sourdine seulement.

Paysage ↔ maquette : ouvrir un lieu affiche le monde (~1 s) comme écran de chargement ; pipeline actuel inchangé en parallèle ; à l'arrivée, rebasage sur le centre, trou (`zoneMin`) dans terrain et bâtiments du monde, `animerConstruction`. En maquette, le monde suit la case « Paysage ». Sortir : masquer socle et anneau, garder le disque incrusté.

## C. Chargement prévisionnel

- Caméra d'anticipation à position + vitesse × 1,5 s (`vitesseClavier`), `setCamera` à demi-résolution ; `LoadRegionPlugin` en sphère autour de la cible ; centre de `TuilesPlan.voulues()` décalé pareil.
- Intentions : première suggestion de recherche → `parcelleEn`, index, en-tête et hiérarchie COPC (~1,5–2 s gagnées) ; bulle « Construire ici » → idem + niveaux 0–2 ; arrêt > 1 s près du sol → idem, ≤ ~8 Mo. Rien si `navigator.connection.saveData`.
- Cache persistant : Cache API pour les octets immuables (nœuds COPC par URL + offset + taille, via un lecteur passé à `Copc.create` / `loadPointDataView` ; Terrarium ; plan). IndexedDB pour les résultats (grille Int16 compressée par `CompressionStream`, ~1 Mo R 150, 2–4 Mo R 300, points d'arbres) ; clé centre + rayon + année + version ; revisite < 1 s ; LRU par taille.
- Fils : pool permanent pour le nuage, téléchargement (12–16 requêtes) découplé du décodage ; fil « reconstruction » (`depuisPoints`, `contoursBatiments`, maillages ; audit B1) ; fil « paysage » (`reliefLointain`, `createImageBitmap`).
- Priorités : une file (centre d'abord, grossier avant fin, préchargement en `priority: "low"`) ; `priorityCallback` pour les tuiles 3D ; annulation par `AbortSignal` et génération, sans jeter ce qui est téléchargé.

## D. Gains rapides (sans refonte)

| # | Changement | Effet attendu |
|---|---|---|
| 1 | Paysage et alti 2 m seulement si « Paysage » coché ou anneau | −25 à −35 Mo, −2 à −4 s de fil principal par lieu |
| 2 | `tuilesNuage` en parallèle de `parcelleEn` ; `pontsAutour`, `fondLacs`, alti dès le début | −0,3 à −0,8 s |
| 3 | Mémoire de `Copc.create`, hiérarchie, STAC ; pool de fils permanent | −0,7 à −1,2 s par recentrage, voisin, anneau |
| 4 | `arbresAnneau` réutilise les nœuds bas, profondeur plafonnée au-delà de 500 m | −6 à −50 Mo |
| 5 | `Swiss3D` : pas de `dispose()` au changement de lieu, seulement la matrice | bâtiments et arbres immédiats |
| 6 | `preconnect` (api3, data, wms, 3d, S3) | −0,1 à −0,3 s par service |
| 7 | `TuilesPlan` : régulation, pixels selon le niveau, WMTS | plan qui suit le vol ; ~15 → 3 Mo |
| 8 | `reliefLointain` : tableaux typés, zooms partagés avec `profilHorizon`, décodage hors fil | −1,5 à −3 s de saccades, −8 Mo |
| 9 | Sans GTAO ni rebond pendant le mouvement ; paysage hors occlusion | 1,5 à 3 × plus fluide sur GPU intégré |
| 10 | Index typé dans `construireAnneau` ; caches bornés | −0,1 à −0,3 s ; mémoire stable |
| 11 | Voyage provisoire : recentrage léger façon `vol.js`, relevé à l'arrêt | ~8 s → ~1 s |

## E. Ordre de mise en œuvre

0. Gains rapides (1–2 j) : D1–D10, F1, F10a ; étendre `tempsVol` à `depuisAdresse` pour mesurer.
1. Monde persistant (2–3 j) : `monde.js`, terrain swisstopo prototypé dans `#vol=gruyeres` ; valider qualité, raccord, calage, couverture.
2. Paysage navigable (3–5 j) : `#p=`, clavier sans rechargement, origine flottante, ombres, budget, caméra d'anticipation ; remplace `surVoyage`.
3. Paysage ↔ maquette (2–4 j) : monde comme écran de chargement, disque inséré, préchargements d'intention, derrière un drapeau.
4. Fils et caches (3–5 j) : fil reconstruction, Cache API, IndexedDB, accueil pré-calculé (F2).
5. Options : F3, pilote F4, anneau remplacé par le monde découpé, lacs (F11).

Risques : précision des flottants (rebasage tous les ~2 km ; matrice unique : ~0,3 m à 2 km, ~8 m à 10 km, pas pour mesurer) ; géoïde (~10 cm/km, réestimer `calerSol` en douceur) ; mémoire mobile ; quotas geo.admin.ch non vérifiés (à lire avant le préchargement) ; tuiles manquantes (repli `depuisRasters`, Terrarium ou brume, `surFondAbsent`) ; plugin non éprouvé.

## F. Données servies depuis Infomaniak

Vérifié : HTTP/2, 35 ms, gzip à la volée (y compris `.bin`), pas de Brotli, aucun `Cache-Control` sur `/bathy/*.bin` ni `.json`. Le mutualisé ne sert que du statique : génération hors ligne (Mac ou Actions), puis rsync, comme `bathy/`.

| # | Idée | Gain | Stockage | Génération | Priorité |
|---|---|---|---|---|---|
| F1 | Index des tuiles km (année alti, COPC, raster) à la place de STAC | −0,5 s × 2–3 appels par lieu ; URL connues d'avance ; lève `limit=100` | ~130 Ko | script STAC ~15 min, mensuel | 1 |
| F2 | Accueil pré-calculé (grille Gruyères, arbres) | ~40–60 Mo → 3–5 Mo ; première image < 1 s | ~5 Mo | script Node < 1 min | 1 |
| F10a | `Cache-Control: immutable` sur dossiers versionnés (`bathy/v1/`), `AddType wasm` | revisites sans requête | 0 | — | 1 |
| F10b | Brotli précompressé | JS −17 % ; bathy ÷4,6 | −200 Mo | à la construction | 2 |
| F3 | Relief lointain ~100 m, Suisse + 60 km, ~60 dalles | ~100 requêtes et ~10 Mo par lieu → 1–2 Mo une fois ; plus d'AWS | ~10–12 Mo | GDAL ~10 min | 2 |
| F11 | Polygones et niveaux des lacs (swissTLM3D) | teinte des lacs sans cadastre | 0,1–0,3 Mo | script | avec étape 2 |
| F4 | Grilles 0,5 m par sous-tuiles de 250 m | maquette en 1–3 Mo sans calcul | Suisse ~200 Go ; zones bâties ~15–20 Go ; agglomération ~1,5 Go | plusieurs To et semaines (Suisse), heures (région) | 3, pilote régional |
| F5 | Nuage réduit | faible | 2–3 × F4 | — | non |
| F6 | Terrain auto-hébergé | nul (swisstopo le sert) | 20–40 Go | lourde | non |
| F7 | Cadastre pré-teinté | nul ; rediffusion cantonale à vérifier | 10–15 Go | — | non |
| F8 | Index de recherche MariaDB | < 0,1 s, inutile | ~0,5 Go | import | non (option : localités en statique, 100 Ko) |
| F9 | Proxy PHP des services swisstopo | négatif (+50–150 ms devant un CDN à Zurich) | — | — | non |

Draco déjà utilisé par swisstopo ; meshopt et KTX2 sans objet ; pas de CDN (public suisse, sous-traitant de plus). F4 : choisir les régions d'après l'usage reviendrait à enregistrer des lieux, exclu par la politique de confidentialité.

À créer : `src/monde.js`, `src/cache.js`, `src/reconstruction.worker.js`, `outils/index_tuiles.mjs`, `outils/accueil_precalcul.mjs`.
