# Plan : chargement, paysage continu, prévisionnel (27.11.2026)

Plan d'architecture (agent Fable, réflexion maximale). Chiffres : lecture du code, `docs/audit-performance.md` (mesures du 26.11) et vérifications réseau du 27.11. Rien n'a été exécuté dans le navigateur.

## État au 27.11.2026 (soir) : fait, mesures, reste

### Fait

Déjà en place avant cette série : maquette ronde, points du relevé révélés en continu, points d'arbres de l'anneau chargés selon la caméra (`lodAnneau.js`), bâtiments swisstopo jusqu'à 3 km.

**Étape 0 (gains rapides)**
- **D1** : terrain 2 m et paysage chargés seulement s'ils se voient (`terrainFin`, `paysageEtAnneau`, `main.js`). Anneau : rayon + 300 m ; case « Paysage » : comme avant (≥ 2 km). Cocher « Paysage » plus tard lance le calcul.
- **D2** : tuiles du relevé demandées en même temps que la parcelle (`preparerTuiles`) ; ponts demandés pendant le relevé.
- **D3** : réponses STAC gardées par tuile km et par jeu (`tuilesJeu`, `geo.js`) ; en-têtes et pages de hiérarchie COPC gardés (`enteteCopc`, `pageHierarchie`, `nuage.js`), partagés avec `lodAnneau.js` ; fils de décodage gardés d'un lieu à l'autre et chauffés au premier focus de la recherche.
- **D4** (en partie) : l'anneau reprend les en-têtes et hiérarchies du relevé. Les nœuds bas ne sont pas encore réutilisés.
- **D5** : bâtiments swisstopo gardés au changement de lieu (`Swiss3D.vider({ garder })`, `repositionner`) : nouvelle matrice, puis recalage sur les tuiles déjà chargées. Pas pour la maquette carrée (géométrie découpée).
- **D6** : `preconnect` vers api3, data, 3d et wms ; `dns-prefetch` vers S3.
- **D7** (en partie) : `TuilesPlan` régulé (au plus toutes les 200 ms, y compris en mouvement) ; pixels selon l'image cible (64–512). Le passage au WMTS n'est pas fait.
- **D9** : sans GTAO ni rebond pendant la navigation à la main, image complète à l'arrêt (`scene.allegerMouvement = false` pour revenir en arrière) ; paysage et monde hors de la passe d'occlusion.
- **D10** : index typé dans `construireAnneau` ; caches bornés : plan 48 Mpx (16 sur mobile), Terrarium 300 tuiles (120), ALTI 80 (32).
- **F1** : `outils/index_tuiles.mjs` écrit et essayé ici sur une boîte de 3 × 3 km (16 tuiles par jeu, gabarits sans exception). Le site lit `donnees/tuiles-v1.json` s'il existe, sinon STAC. Un index partiel n'est utilisé que dans sa boîte. **L'index complet n'est pas généré** : environ 1000 pages STAC par collection, à lancer hors des heures de pointe, puis à publier dans `public/donnees/`.
- **F10a** : `.htaccess` : `immutable` sur tout dossier `/vN/`, un jour pour `bathy/`, `ponts/` et `donnees/`, `AddType application/wasm`. `bathy/` n'est pas versionné : à déplacer dans `bathy/v1/` au prochain dépôt.
- Mesures : `scene.tempsVol` étendu à `depuisAdresse` (marques parcelle, tuiles, nuage, grille, maquette, image, horizon, alti, anneau, paysage, et le tas JS) ; `outils/mesurer.mjs` compte les octets (fils compris), la mémoire et les temps. Ne dépend pas des marques, donc compare aussi une version plus ancienne.
- Matrice ECEF → scène : formules rigoureuses swisstopo (`mn95VersEcef`, ~1 cm ; avant, `versWgs` : 0,2–0,8 m), similitude conforme (plus d'avertissement « non uniform scale »). Sert aussi à `Swiss3D`.

**Étape 1 (monde persistant, prototype)**
- `src/monde.js` : classe `Monde` (groupe `racine`, matrice unique, `placer`, `rebaser`, `solSous`, calage vertical), terrain `ch.swisstopo.terrain.3d` par `QuantizedMeshPlugin` (niveau ≤ 17, jupes de 30 m), matière du paysage (plan drapé, grain, brume), trou facultatif sous la maquette (`discard` dans le shader).
- Prototype : `#vol=gruyeres&monde=1` (monde seul, sans terrain 2 m ni Terrarium) et `monde=2` (monde autour du terrain 2 m du centre).
- Constats : le plugin lit le service sans réglage particulier. Les hauteurs servies sont **altimétriques, pas ellipsoïdales** : le calage trouve +49,7 m à Gruyères, soit le géoïde. Le calage doit ignorer les tuiles grossières (au niveau 0, la corde passe ~40 km sous la surface) : seules les tuiles de rayon < 800 m comptent. Il est réestimé toutes les 1,5 s au début, puis toutes les 15 s.

**Étape 2 (paysage navigable, prototype)**
- `#p=E,N` : décor du vol sans maquette, souris et clavier libres. Pas de rechargement : au-delà de 250 m, l'origine suit la cible (`Monde.rebaser`, `Swiss3D.deplacerOrigine`, `TuilesPlan.decaler`) et l'adresse est mise à jour. Altitude du sol sous la caméra lue sur le monde (`solSous`). Le voyage `surVoyage` reste le comportement par défaut des maquettes.

### Mesures (27.11, Chromium sans carte graphique, conteneur à ~15 Mbit/s, rayon 150 m, fenêtre 640 × 384)

Les trois lieux sont ouverts à la suite dans la même page, contexte neuf. Avant = `main` (ff2efd5), après = étape 0. Octets : services extérieurs seulement (le serveur de développement est exclu). Tas JS : après ramasse-miettes, réseau calme.

| Lieu | Octets avant → après | Tas JS avant → après | Maquette (s) | Réseau calme (s) |
|---|---|---|---|---|
| Gruyères (lien direct) | 67,3 → 34,0 Mo | 300 → 113 Mo | 32,5 → 34,8 | 70,7 → 46,2 |
| Gruyères voisin (280 m) | 21,2 → 18,9 Mo | 203 → 167 Mo | 18,6 → 18,0 | 32,4 → 27,2 |
| Lutry | 40,3 → 20,0 Mo | 364 → 204 Mo | 22,4 → 17,4 | 53,3 → 31,6 |

- Le gain vient surtout de D1 : terrain 2 m (−17 à −23 Mo par lieu) et Terrarium (13,6 → 3,7 Mo à Gruyères ; 5,3 → 1,1 Mo à Lutry). Ce qui reste de Terrarium sert au profil d'horizon (soleil).
- Temps jusqu'à la maquette : inchangé ici. Ils sont limités par le téléchargement du relevé (13–30 Mo à ~15 Mbit/s) et par le rendu logiciel (SwiftShader). Les gains de D2, D3 et D9 (0,5–2 s attendues) se noient dans le bruit de ce conteneur : à mesurer sur une vraie machine avec `node outils/mesurer.mjs`.
- Marques après, Gruyères : parcelle 1,7 s, tuiles 2,2 s, nuage 28,9 s, grille 31,8 s, maquette 34,0 s, horizon 34,3 s.
- Vol `#vol=gruyeres&monde=1` : alti 6,9 s, première image 7,3 s, terrain fin calé à 98 s (rendu logiciel), 40 Mo depuis 3d.geo.admin.ch (terrain, bâtiments, arbres), 7,7 Mo de data.geo.admin.ch (1 tuile 2 m au lieu de 9), tas 188 Mo. Calage +49,7 m, dispersion P10–P90 10,4 m avec le seuil de 3 km (seuil resserré à 800 m ensuite, non remesuré).
- Paysage `#p=2572794,1159319` : première image 5,1 s, terrain fin calé à 87 s (rendu logiciel). 40 s de clavier (Maj + W) : origine déplacée deux fois (+261 m est, +323 m nord), adresse mise à jour, aucune erreur, tas 257 Mo. Deux défauts trouvés et corrigés : après un rebasage, le calage se refaisait sur la grille du départ (dz faussé à +105 m), il est maintenant figé au rebasage ; les points de calage sortaient de la grille de 300 m (dispersion 31 m), ils y restent maintenant. Dernier essai : première image 3,4 s, terrain fin calé à 48 s, deux rebasages, dz = 50,7 m stable, dispersion P10–P90 = 1,9 m, bâtiments et arbres en place après déplacement, tas 255 Mo.

### Reste

- **Étape 0** : D4 (réutiliser les nœuds COPC bas entre relevé et anneau, profondeur plafonnée au-delà de 500 m) ; D7 WMTS ; D8 (`reliefLointain` en tableaux typés et dans un fil) ; D11 inutile si l'étape 2 remplace le voyage ; index F1 complet à générer et publier ; `bathy/v1/`.
- **Étape 1** : jugement visuel du raccord (`monde=2`) sur une vraie carte graphique ; couverture hors frontière (Chamonix, Aoste, Constance, Milan) et repli Terrarium ou brume là où il manque des tuiles ; teinte des lacs (F11) ; ponts et arbres déplacés de `swiss3d.js` vers le monde ; `TilesFadePlugin`.
- **Étape 2** : caméra d'anticipation (position + vitesse × 1,5 s) et `LoadRegionPlugin` ; ombres qui suivent la cible (aujourd'hui, boîte de ±360 m autour de l'origine, rebasage à 250 m) ; nuage d'arbres de l'anneau et plan WMTS dans le paysage ; budget mobile vérifié sur un appareil ; remplacer `surVoyage` (aujourd'hui, `#p=` est une adresse à part) ; entrée dans l'interface (bouton « Paysage ») ; colonne propre au paysage (elle affiche aujourd'hui « Chargement de la maquette… »).
- **Étapes 3 et 4** non commencées : paysage ↔ maquette, préchargements d'intention, fil de reconstruction, Cache API, IndexedDB, accueil pré-calculé (`outils/accueil_precalcul.mjs`). Avant tout préchargement : lire les conditions d'usage et les quotas de geo.admin.ch (non vérifiés).
- Risques encore ouverts : précision des flottants (rebasage à 250 m dans `#p=`) ; géoïde (calage réestimé, à suivre sur de longs trajets) ; mémoire mobile (cache 3D à 96 Mo, plan à 16 Mpx, non mesurés sur un appareil).

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
