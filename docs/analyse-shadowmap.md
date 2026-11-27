# Analyse de Shadowmap

Analyse concurrentielle pour Topograph (topograph.ch). Faite le 27 novembre 2026.

Méthode :
- lecture du site public (shadowmap.org) et de l'App Store ;
- ouverture de l'application web (app.shadowmap.org) sans compte, à Lutry ;
- lecture des requêtes réseau et du code JavaScript livré au navigateur (bibliothèques, adresses de tuiles, réglages).

Aucun compte n'a été créé. Rien n'a été payé. Les cookies non essentiels ont été refusés.

Ce qui vient du code est marqué **(code)**. Ce qui vient du site ou de la presse est marqué avec sa source. Ce qui est déduit est marqué **(déduction)**.

---

## 1. En bref

- Shadowmap est une société de Vienne (Shadowmap Technologies GmbH, fondée en 2021, 2 à 10 personnes).
- Le produit : une carte 3D du monde entier, dans le navigateur, avec le soleil et les ombres en temps réel.
- Le public visé est large : particuliers, photographes, acheteurs de logement. Les architectes sont une cible parmi d'autres (formule Studio).
- La technique est solide : three.js, ombres en cascade, occlusion ambiante avec débruitage par réseau neuronal, tuiles 3D Google, modèles LOD2 officiels (dont swisstopo).
- Le point faible pour un architecte suisse : pas de vraie sortie de plans (pas de DXF, pas de coupe), bâtiments du monde entier souvent simplifiés (empreintes extrudées), terrain à la résolution d'une tuile de zoom 14.

---

## 2. Formules et prix

Prix relevés dans la fenêtre « Upgrade » de l'application, le 27.11.2026. En euros.

| Formule | Prix | Pour qui (selon Shadowmap) |
|---|---|---|
| **Free** | 0 €, sans inscription | tout le monde |
| **Explorer** | 30 €/an (paiement annuel seulement) | photographes, cinéastes, organisateurs d'événements |
| **Home** | 10 €/mois, ou annuel (environ 17 % de rabais) | acheteurs et propriétaires de logement, jardiniers |
| **Studio** | 60 €/mois, ou annuel (environ 17 % de rabais) ; 1 projet inclus, projets en plus dès 30 €/mois | architectes, immobilier, urbanistes, professionnels du solaire |
| **Enterprise** | sur devis | plateformes immobilières |
| **API** | accès anticipé, sur dossier | intégrateurs |

Sources : fenêtre de prix de l'application ; https://shadowmap.org/pricing ; https://shadowmap.org/solutions/shadowmap-studio ; https://shadowmap.org/api.

Le paiement passe par **Paddle** (revendeur qui gère la TVA). Sur mobile, ce sont des achats intégrés Apple et Google. **(code)**

Une ancienne gamme « Light » et « Pro » existe encore dans le code ; elle a été remplacée (voir la FAQ « What happened to the Shadowmap Light and Pro subscriptions? », https://shadowmap.org/support).

---

## 3. Inventaire des outils

### 3.1 Tableau par formule

| Outil | Free | Explorer | Home | Studio |
|---|---|---|---|---|
| Carte 3D mondiale : bâtiments, relief, arbres | ✓ | ✓ | ✓ | ✓ |
| Course du soleil et boussole 3D | ✓ | ✓ | ✓ | ✓ |
| Changer l'heure du jour courant | ✓ | ✓ | ✓ | ✓ |
| **Choisir n'importe quelle date** (passé ou futur) | | ✓ | ✓ | ✓ |
| Éditer la scène 3D : ajouter des volumes simples, masquer un bâtiment ou un arbre | ✓ (sans enregistrer sans compte) | ✓ | ✓ | ✓ |
| Enregistrer et partager sa scène éditée | | ✓ | ✓ | ✓ |
| Vue à la première personne, focale réglable | | ? | ✓ | ✓ |
| Objets 3D étendus : formes libres extrudées, toits, arbres | | | ✓ | ✓ |
| Fonds satellite et « outdoor » | | | ✓ | ✓ |
| **Bâtiments 3D détaillés (LOD2)** : Suisse, Allemagne, Pays-Bas, Angleterre, USA, Vienne, New York, Tokyo | | | ✓ | ✓ |
| Étages dessinés sur les façades | | | ✓ | ✓ |
| Hauteur par défaut des bâtiments, choix du modèle de terrain | | | ✓ | ✓ |
| Rendu haute qualité | | | ✓ | ✓ |
| Météo et indice UV sur 14 jours | | | ✓ | ✓ |
| **Analyse solaire 3D** (rayonnement, heures de soleil, ciel visible) | | | | ✓ |
| **Bâtiments Google 3D** (maillage photogrammétrique) | | | | ✓ |
| **Import de modèles** : IFC, OBJ, FBX, DAE, GLB | | | | ✓ |
| Plusieurs projets | | | | ✓ (payant en plus) |
| Partage et intégration (iframe) sur un site | | | | ✓ |

Sources : https://shadowmap.org/pricing ; https://shadowmap.org/solutions/shadowmap-home ; https://shadowmap.org/solutions/shadowmap-studio ; fenêtre de prix de l'application.

### 3.2 Détail des outils

**Soleil et ombres.**
- Ombres en temps réel, toute la Terre, à l'heure et à la date choisies.
- Un anneau-boussole en 3D entoure le lieu. Il montre la course du soleil, le lever et le coucher, l'azimut et la hauteur du soleil (ex. « 215,1° » et « 14,7° »).
- Lecture d'une journée en 24 h d'un clic. Sauts rapides vers les équinoxes et les solstices.
- Source : https://shadowmap.org/learn/shadow-analysis-tools-comparison ; observation de l'application.

**Heures de soleil et analyse annuelle (Studio).**
- Le code connaît cinq mesures **(code)** :
  - rayonnement (kWh/m²) ;
  - heures de soleil ;
  - puissance solaire de pointe ;
  - **VSC** (vertical sky component, composante de ciel vertical, la mesure britannique du droit à la lumière) ;
  - **SVF** (sky view factor, part du ciel visible).
- Calcul sur le sol, les toits et les façades, avec un curseur de mois pour comparer les saisons.
- Lumière directe et lumière diffuse du ciel séparées.
- Rayonnement réel : moyennes mensuelles sur 20 ans (Global Solar Atlas), pas un ciel clair théorique.
- Résultat : carte de couleur sur la 3D (palette « viridis » notamment) et **export CSV** (`shadowmap_sun_hours_report.csv`, `shadowmap_analytics_report.csv`, `shadowmap_peak_solar_report.csv`) **(code)**.
- Annoncé pour 2026 : pose de panneaux photovoltaïques avec production estimée.
- Sources : https://shadowmap.org/3d-solar-analytics ; https://shadowmap.org/learn/shadow-analysis-tools-comparison.

**Sunscore.**
- Une note de 0 à 100 de l'ensoleillement d'un bâtiment sur l'année, par ciel clair.
- Calcul : des milliers de points sur les façades et les toits, un test toutes les 3 minutes environ sur l'année (environ 175 000 pas par point), un rayon vers le soleil à chaque pas.
- Un indice de confiance (0 à 1) dit la part des bâtiments voisins dont la hauteur est mesurée, et non estimée.
- Vendu aux portails immobiliers (le code contient des codes de rabais de portails autrichiens et allemands).
- Source : https://shadowmap.org/learn/what-sunscore-is-and-how-it-is-calculated.

**Import de modèles (Studio).**
- Formats : IFC, OBJ, FBX, DAE, GLB, avec textures. L'IFC arrive déjà géoréférencé.
- L'IFC est lu par **web-ifc 0.0.43** (WebAssembly) et le chargeur « FragmentIfcLoader » de That Open Company **(code)**.
- Pour poser le projet, on masque les bâtiments existants (« Overrides »).

**Projets, variantes, partage.**
- Une scène s'appelle « My Scene ». Le panneau « Edit » contient : partager le projet, formes (« Shapes »), masquages (« Overrides »).
- Partage par lien. L'aperçu du lien est une image générée côté serveur (`screenshots.shdw.mp/studioShares/…jpg`) **(code)**.
- Intégration dans un site (iframe) en Studio. Le visiteur garde la liberté de la caméra et du temps.
- Tout l'état de la vue est dans l'adresse : `lat`, `lng`, `zoom`, `azimuth`, `polar`, `time`, `basemap`, `elevation`, `f` (focale), `vq` (qualité). Un lien suffit donc à retrouver une vue exacte **(observation)**.
- **Pas de comparaison de variantes** côte à côte ou avant/après trouvée. On travaille avec plusieurs projets, ou en masquant des objets.

**Mesure.** Mesures de distances et d'objets dans la 3D (Studio). Source : https://shadowmap.org/solutions/shadowmap-studio.

**Export.**
- Pas d'export de géométrie (ni DXF, ni OBJ, ni STL) trouvé, ni sur le site, ni dans le code.
- Exports existants : CSV des analyses, capture d'image, partage et iframe.

**API (accès anticipé).**
- Point 1 : ce point est-il au soleil à telle heure ? (relief, bâtiments et arbres ; nuages exclus).
- Point 2 : Sunscore d'un bâtiment, par mois et par an, avec heures de soleil et confiance.
- Réponse en JSON. Source : https://shadowmap.org/api.

**Arbres.**
- Arbres OSM dans le monde entier (points avec une forme générique).
- Couronnes d'arbres mesurées en Angleterre et aux USA (fichiers `tree_crowns`, sources LiDAR de l'Environment Agency et LANDFIRE) **(code)**.
- On peut masquer un arbre, en ajouter, changer le type. Pas de saisons (feuillage) trouvées.

**Mobile.**
- Application iOS (« Shadowmap: Solar Intelligence », iOS 13+) et Android (Google Play).
- L'analyse solaire est arrivée sur iOS (Studio).
- Source : https://apps.apple.com/app/id1566789060.
- **Réalité augmentée** : le moteur three.js contient le module WebXR, mais aucune fonction AR n'est proposée ou annoncée. Pas d'AR à ce jour **(déduction)**.

**Autres.**
- Météo et UV (weatherapi.com) ; petite pastille « 4° UV 1 » en bas à gauche.
- « Sunny Seats » : terrasses de restaurants au soleil (appel `/.netlify/functions/gastronomies`) — produit grand public.
- Blog orienté santé et lumière, podcast, programme d'affiliation.

---

## 4. Interface

### 4.1 Organisation de l'écran

Observation à Lutry, sans compte.

- **Toute la surface est la carte 3D.** Pas de barre latérale permanente.
- **En haut à droite** : champ de recherche (« Place, address, or coordinates ») et menu (trois traits).
- **Sous la recherche, le panneau du temps**, le plus important :
  - deux onglets, **VISUALIZE** et **ANALYZE** (ce dernier porte un cadenas pour Studio) ;
  - l'heure en grand (14:47), le fuseau (UTC +1:00), la date, un bouton « NOW » et un bouton lecture « 24H » ;
  - **curseur du jour** : de l'heure de lever (7:52) à l'heure de coucher (16:51), avec la zone de jour en jaune ;
  - **curseur de l'année** : du 01/01 au 31/12, avec des repères (équinoxes, solstices).
- **Sous le panneau** : « Sign in » et « Upgrade » (jaune, très visible).
- **À gauche, en colonne** : « Edit » (ouvre le tiroir de la scène), import, couches, masquage.
- **En bas** : pastille météo, logo, boussole, partage, réglages, zoom +/−, choix du fond de carte, géolocalisation.
- **Tiroir « Settings »** (à droite) :
  - Données : arbres 3D, étages sur les façades, hauteur par défaut, modèle de terrain (Nextzen, Nextzen v2, Mapbox, Stadia, Esri, Mapterhorn) ;
  - Caméra : rotation auto, vue à la première personne (bêta), focale ;
  - Présentation : course du soleil, verrouiller au lieu, vecteur soleil, cacher l'interface, anticrénelage, occlusion ambiante, qualité basse / moyenne / haute ;
  - Aller à des coordonnées.
- **Tiroir « Edit » / « My Scene »** (à gauche) : partager, ajouter une forme, masquer, puis la publicité pour Studio (import 3D, analyse solaire, projets).

### 4.2 Parcours d'un nouvel utilisateur

1. Écran jaune de chargement avec le logo.
2. Bandeau de cookies (refus possible en un clic).
3. La carte s'ouvre sur le lieu, en 3D inclinée, avec l'anneau du soleil. Pas de compte demandé.
4. Petites illustrations d'aide (zoom à la souris, rotation).
5. Message « We have reduced visual quality to improve performance on your device » quand la machine est lente.
6. Bulle jaune « High-detail buildings available · Preview » quand un modèle LOD2 existe (en Suisse, c'est le cas).
7. Le clic sur ANALYZE ouvre une fenêtre payante (vidéo de démonstration + « Unlock now », 60 €/mois).

### 4.3 Ce qui est bien fait

- **On voit le résultat en 2 secondes**, sans compte. Le produit se vend tout seul.
- **Le temps est au centre** : deux curseurs (jour et année) suffisent. Les bornes du curseur du jour sont le lever et le coucher réels.
- **L'anneau du soleil en 3D** est lisible même pour un non-spécialiste.
- **Tout l'état est dans l'adresse** : un lien reproduit la vue exacte, utile pour un client.
- **Qualité qui s'adapte seule** à la machine, avec un message clair.
- **Montée en gamme guidée** : chaque fonction payante affiche une courte vidéo de ce qu'on gagne.
- Langues : anglais, allemand, français, espagnol au minimum **(code)**.

### 4.4 Ce qui l'est moins

- **Beaucoup de publicité interne** : bulles, cadenas, fenêtres « Upgrade » partout. Le panneau Edit finit par une publicité.
- **Interface en anglais** par défaut, même en Suisse romande.
- **Lisibilité technique faible pour un architecte** : pas de cote, pas de plan, pas de coupe, pas d'échelle.
- **Bâtiments génériques** par défaut (empreintes extrudées, toits plats) ; le LOD2 suisse est derrière Home.
- Les icônes de la colonne de gauche ne sont pas légendées.
- **Traceurs nombreux** : Google Analytics, Google Ads, PostHog, Sentry, ProfitWell, ChartMogul, Tolt. Point faible en Suisse (nLPD) face à un site sobre.

---

## 5. Technique, derrière le capot

### 5.1 Application web

| Élément | Choix | Preuve |
|---|---|---|
| Interface | **React**, classes Tailwind, assemblage webpack | code |
| Moteur 3D | **three.js r186** (`window.__THREE__ = "186"`), **WebGL 2** | code, page |
| Carte | **pas de Mapbox GL, ni Cesium, ni deck.gl** : moteur de globe maison au-dessus de three.js | code |
| Tuiles 3D | **3d-tiles-renderer** (NASA-AMMOS) pour les 3D Tiles (b3dm, i3dm, glb) et Google Photorealistic 3D Tiles (`tile.googleapis.com/v1/createSession`) | code |
| Compression | Draco (décodeur Google gstatic), meshopt, KTX2 | code |
| Calculs | Web Workers (3 fils lancés au chargement), WebAssembly, OffscreenCanvas, SharedArrayBuffer | code, réseau |
| Projection | proj4 | code |
| Position du soleil | SunCalc (formules astronomiques, pas de service externe) | code ; article Sunscore |
| Taille | environ 7 Mo de JavaScript (dont 3,8 Mo pour le moteur 3D) | réseau |

Offre d'emploi « Senior 3D Developer » : trois ans de three.js exigés, WebGL, TypeScript et React souhaités, travail sur la performance du rendu. Source : https://www.cg.tuwien.ac.at/sites/default/files/news/9272/Shadowmap%20Job%20Offer%20-%20Senior%203D%20Developer.pdf.

### 5.2 Ombres à l'écran

- **Ombres en cascade (CSM, cascaded shadow maps)** : plusieurs cartes d'ombre emboîtées, fines près de la caméra, grossières au loin. Nombre de cascades et taille des cartes réglables **(code)**.
- Filtrage doux (PCF soft) **(code)**.
- **Occlusion ambiante N8AO**, avec un **débruitage par petit réseau neuronal** (« attention-v3-int8 ») et accumulation sur plusieurs images **(code)**.
- Réglages de qualité : basse, moyenne, haute ; anticrénelage ; occlusion ambiante on/off.

### 5.3 Analyse solaire (heures de soleil, rayonnement)

Le code du fil de calcul de l'analyse est lisible. Fonctionnement **(code, et déduction pour l'étape GPU)** :

1. **Positions du soleil** sur la période choisie (jour, mois, année), pas à pas.
2. **Regroupement par direction** : les positions proches sont réunies dans des « paniers » d'environ 5,5° (4,5° au minimum). Chaque panier reçoit un poids : le temps passé, ou l'énergie reçue. Des milliers de positions deviennent quelques centaines de directions.
3. **Rayonnement réel** : un fichier mondial `/analytics/ghi.bin` (grille de 1024 × 512, latitudes −60° à +70°) donne, pour chaque mois, le rayonnement global horizontal (GHI) et la part diffuse. Seuls les 48 octets du lieu sont téléchargés (requête HTTP « Range »). Source citée : Global Solar Atlas.
4. **Lumière diffuse** : le ciel est découpé en **64 directions** ; un modèle de ciel répartit la part diffuse entre elles.
5. **GPU** : pour chaque direction, une carte d'ombre est rendue ; les résultats pondérés sont **additionnés dans une cible de rendu en virgule flottante** (accumulation). C'est la méthode « shadow map accumulation ».
6. Affichage en carte de couleur, export CSV.

Le Sunscore de l'API, lui, utilise un **lancer de rayons** par point, toutes les 3 minutes, sur une année, par ciel clair (https://shadowmap.org/learn/what-sunscore-is-and-how-it-is-calculated).

### 5.4 Données 3D, terrain et arbres

**Bâtiments du monde entier (par défaut)** **(code)** :
- OpenStreetMap ;
- Overture Maps, servi par leurs propres tuiles vectorielles (`vector-tiles-world.shadowmap.org/overture/2026-10-21.0/{z}/{x}/{y}.mvt`) ;
- empreintes détectées par IA de Microsoft et de Google (Open Buildings) ;
- hauteur absente = hauteur par défaut réglable.
- Variante : tuiles vectorielles Nextzen, Mapbox Streets, OpenMapTiles (Stadia).

**Bâtiments détaillés (LOD2), hébergés chez eux** en 3D Tiles (`building-data.shadowmap.org/…/tileset.json`) **(code)** :
- **Suisse : `switzerland_optimized_2`, attribution swisstopo, identifiant `GEBAEUDEEINHEIT`** → c'est **swissBUILDINGS3D**, retraité et décalé de 3 m en hauteur (`offsetZ: 3`) ;
- Pays-Bas (3DBAG), Allemagne, Berlin, Munich, Vienne, Tokyo (PLATEAU) ;
- Angleterre et USA en PMTiles, avec couronnes d'arbres.

**Bâtiments Google 3D** (Studio) : Google Photorealistic 3D Tiles. Une zone « SolarAPIHighArea » signale où Google est détaillé.

**Terrain** **(code)** :
- par défaut **Mapterhorn** : un seul fichier PMTiles hébergé chez eux (`mapterhorn.shadowmap.org/2026-09-11.pmtiles`), encodage « terrarium », zoom 14 au maximum, tuiles de 512 px ;
- autres : Nextzen / Terrarium (AWS), Mapbox, Esri, Stadia ; AHN4 aux Pays-Bas (zoom 12 à 16).
- Au zoom 14 en 512 px, une cellule fait environ 5 à 7 m en Suisse **(déduction)**. C'est bien moins fin que swissALTI3D à 0,5 m.
- Ombres portées des objets jusqu'à 50 km (site).

**Arbres** : OSM ; tuiles d'arbres maison (`model.shadowmap.org/trees`) ; couronnes LiDAR en Angleterre et aux USA.

**Fonds de carte** : Stadia (alidade bright, satellite, outdoors), MapTiler, Thunderforest.

**Recherche d'adresses** : geocode.earth (Pelias) et MapTiler.

### 5.5 Tuiles et niveau de détail

- Bâtiments, arbres et fonds en tuiles par zoom (`{z}/{x}/{y}`).
- 3D Tiles avec erreur d'écran (« screen space error ») pour choisir le niveau de détail selon la distance.
- **PMTiles partout** : un seul gros fichier par jeu de données, lu par morceaux (requêtes « Range »), posé sur un stockage simple. Pas de serveur de tuiles à faire tourner.
- Les requêtes de tuiles partent des Web Workers (invisibles dans la liste des ressources de la page principale).

### 5.6 Performance

- Qualité (« vq ») baissée automatiquement si l'appareil peine, avec un message.
- Toile à la densité de l'écran (2048 × 1536 pour une fenêtre de 1024 × 768).
- Décodage et maillage dans les fils de calcul ; WebAssembly pour Draco et l'IFC.
- Fichiers JavaScript lourds (environ 7 Mo), mais chargés en parallèle et mis en cache.

### 5.7 Serveur et services

- **Netlify** : hébergement, fonctions serveur (`/.netlify/functions/…`), comptes (« Netlify Identity ») **(code)**.
- Connexion Google (Google Identity).
- Paddle (paiement), ProfitWell et ChartMogul (suivi des abonnements), Tolt (affiliés).
- PostHog (analyse d'usage, sondages, clics morts) et Sentry (erreurs), tous deux derrière leur propre domaine `shdw.mp`.
- Images de partage générées côté serveur (`screenshots.shdw.mp`).
- Données lourdes sur des sous-domaines (`building-data`, `area-data`, `mapterhorn`, `vector-tiles-world`, `model`) : fichiers statiques, probablement sur un stockage objet avec CDN **(déduction)**.
- Le calcul se fait **dans le navigateur**, sauf l'API Sunscore, calculée côté serveur.
- Remarque : leurs clés de services (cartes, géocodage, météo, Google Tiles) sont visibles dans `/env.js`. C'est courant pour des clés limitées par domaine, mais à ne pas reproduire sans restriction.

---

## 6. Comparaison avec Topograph

### 6.1 Ce que Shadowmap a, et Topograph pas (encore)

| Fonction | Shadowmap | Topograph |
|---|---|---|
| Couverture | monde entier | Suisse seulement |
| Import de modèles IFC, OBJ, FBX, DAE, GLB | ✓ (Studio) | prévu (plan pro) |
| Volumes dessinés : formes extrudées, toits, cuboïdes, arbres | ✓ | prévu |
| Rayonnement réel (kWh/m², météo sur 20 ans), lumière diffuse | ✓ | non (heures de soleil seulement) |
| VSC et part de ciel visible (SVF) | ✓ | non |
| Export CSV des analyses | ✓ | non |
| Partage par lien, état complet dans l'adresse, iframe | ✓ | partiel |
| Projets enregistrés, comptes | ✓ | prévu |
| Applications iOS et Android | ✓ | non |
| Météo et UV | ✓ | non |
| Vue à la première personne, focale | ✓ | non |
| Maillage Google photoréaliste | ✓ (Studio) | non |
| API | ✓ (accès anticipé) | non |

### 6.2 Ce que Topograph fait mieux

- **Données suisses mesurées** : nuage LiDAR swissSURFACE3D, grille de 0,5 m, toits mesurés. Shadowmap montre au mieux swissBUILDINGS3D (Home, 10 €/mois), sinon des boîtes.
- **Terrain** : 0,5 m (swissALTI3D / relevé) contre environ 5 à 7 m chez Shadowmap.
- **Arbres réels** du relevé laser, avec leur forme, contre des arbres OSM génériques.
- **Coupe** verticale avec poché, cotes, limites de parcelle, rayon du soleil, export DXF et SVG à l'échelle 1:200. **Shadowmap n'a aucune coupe.**
- **Export de la maquette** en DXF, OBJ, glTF et STL, en coordonnées MN95. **Shadowmap n'exporte aucune géométrie.**
- **Impression 3D** (STL avec socle fermé). Rien d'équivalent chez Shadowmap.
- **Cadastre** : parcelle officielle, plan cadastral au sol, statistiques sur la parcelle.
- **Horizon lointain** sur 50 km avec diagramme horizon + course du soleil.
- **Comparaison** relevé / swissBUILDINGS3D / roofer sur le même lieu.
- **Prix** : 39 CHF une fois, contre 720 €/an pour Studio.
- **Interface en français**, sobre, sans traceurs publicitaires.

### 6.3 Idées à reprendre, classées par intérêt pour un architecte suisse

1. **Avant / après et différence d'ombre.** Shadowmap ne le fait pas. Topograph peut le faire en premier : « ombre en plus due au projet », en heures et en m², sur les parcelles voisines. C'est la question des oppositions et des permis.
2. **Import IFC géoréférencé.** web-ifc (WebAssembly) lit l'IFC dans le navigateur. Avec MN95, le projet tombe juste. Formats à suivre : IFC, GLB, OBJ, puis DAE et FBX.
3. **Volumes simples dessinés** : polygone extrudé, toit à deux pans, cuboïde, arbre. Assez pour une étude de faisabilité.
4. **Analyse par accumulation de cartes d'ombre sur le GPU**, avec regroupement des positions du soleil par direction (paniers de quelques degrés). Plus rapide que le lancer de rayons sur une grille ; donne des bords nets sur les façades. (C'est l'option C du plan `soleil-methode.md`.)
5. **Rayonnement réel** : ajouter les kWh/m² par mois avec la part diffuse (64 directions de ciel). En Suisse, utiliser les données de MétéoSuisse ou du cadastre solaire de l'OFEN plutôt qu'un atlas mondial.
6. **VSC et part de ciel visible** : utiles pour la lumière du jour dans les logements (normes SIA, SN EN 17037).
7. **Tout l'état dans l'adresse** (lieu, date, heure, caméra, couches) : un lien = une vue. Facile, très utile pour les clients.
8. **Curseur de l'année** sous le curseur du jour, avec repères des solstices et équinoxes ; bornes du jour = lever et coucher réels.
9. **Export CSV** des heures de soleil (par carreau ou par parcelle) pour les rapports.
10. **Qualité qui baisse seule**, avec un message clair, sur les machines faibles.
11. **Image d'aperçu des liens partagés** générée côté serveur (pour les messageries).
12. **PMTiles** pour héberger ses propres données (ex. bâtiments roofer précalculés) sur un simple stockage, sans serveur de tuiles.
13. **Intégration iframe** pour les sites de promoteurs et de communes (offre organisation / projets publics).

À ne pas reprendre :
- les fenêtres de vente à chaque clic ;
- les nombreux traceurs ;
- l'abonnement mensuel élevé pour un usage ponctuel.

---

## 7. Sources

- Site et formules : https://shadowmap.org/ ; https://shadowmap.org/pricing
- Formules : https://shadowmap.org/solutions/shadowmap-home ; https://shadowmap.org/solutions/shadowmap-studio
- Analyse solaire : https://shadowmap.org/3d-solar-analytics
- Comparaison d'outils (données, sources des bâtiments, terrain) : https://shadowmap.org/learn/shadow-analysis-tools-comparison
- Sunscore, méthode de calcul : https://shadowmap.org/learn/what-sunscore-is-and-how-it-is-calculated
- API : https://shadowmap.org/api
- Couverture des bâtiments détaillés : https://shadowmap.org/data-coverage
- Aide et FAQ : https://shadowmap.org/support
- Blog : https://shadowmap.org/learn
- Application iOS : https://apps.apple.com/app/id1566789060
- Société (Vienne, 2–10 personnes) : https://linkedin.com/company/shadowmap
- Offre d'emploi (three.js, React, TypeScript) : https://www.cg.tuwien.ac.at/sites/default/files/news/9272/Shadowmap%20Job%20Offer%20-%20Senior%203D%20Developer.pdf
- Application et code livré au navigateur : https://app.shadowmap.org/ (consulté le 27.11.2026, sans compte)
- Bibliothèques citées : three.js https://threejs.org ; 3d-tiles-renderer https://github.com/NASA-AMMOS/3DTilesRendererJS ; N8AO https://github.com/N8python/n8ao ; web-ifc https://github.com/ThatOpen/engine_web-ifc ; PMTiles https://github.com/protomaps/PMTiles ; Mapterhorn https://mapterhorn.com
- Données : Overture Maps https://overturemaps.org ; Google Open Buildings https://arxiv.org/abs/2107.12283 ; Global Solar Atlas https://globalsolaratlas.info ; swisstopo https://www.swisstopo.admin.ch
