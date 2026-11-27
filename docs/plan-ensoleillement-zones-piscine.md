# Ensoleillement par zone et température de piscine : plan

Plan de conception du 27.11.2026, sans code. Il répond à la demande du propriétaire :

> « Ensoleillement : tu as une zone que tu peux choisir, autour d'un target, un bâtiment, ou une piscine. […] le nombre
> d'heures de soleil par semaine par zone. Aussi ensuite un export PDF en pro. Regarde s'il existe des simulations de
> température de piscine […]. Tout ça doit être dans ensoleillement, pas dans la partie projet d'urbanisme. »

Fichiers lus pour ancrer le plan : `src/heures.js`, `src/ensoleillement.worker.js`, `src/soleil.js`, `src/horizon.js`,
`src/diagramme.js`, `src/piscines.js`, `src/main.js` (heures de soleil, viseur, coordonnées du centre), `src/pro.js`
(`.pro-verrouille`), `src/exportCoupe.js` (`coupePdf`), `src/projet.js`, `src/lieux.js`, `src/importer.js`,
`src/import/`, `index.html`, `api/schema.sql`, `docs/audit-parallele.md`, `docs/soleil-methode.md`, `docs/plan-pro.md`.

Règle de base : **tout se passe dans l'onglet Soleil.** L'onglet Projet (volumes d'urbanisme) ne reçoit rien. Les
volumes du projet continuent seulement à faire de l'ombre, comme aujourd'hui (`jeuHeures` → `scene.hauteursVolumes()`).

---

## 0. Ce qui existe et ce qu'on réutilise

| Brique | Où | Réutilisation |
|---|---|---|
| Position du soleil (NOAA, ±0,01°) | `soleil.js` `positionSoleil`, `dateA` | telle quelle |
| Horizon lointain (Terrarium, 50 km) | `horizon.js` `horizonA(S.horizon, az)` | telle quelle, combinée au masque proche |
| Positions groupées par période | `heures.js` `soleilsPeriode` (jour, mois, année) | modèle pour une période « semaine » |
| Lancer de rayons dans la grille 0,5 m | `ensoleillement.worker.js` `libre()` | base du nouveau calcul de masques |
| Grilles `surface` / `base` (relevé, Swiss3D, volumes du projet) | `main.js` `jeuHeures` | telles quelles : la zone voit les mêmes bâtiments que la carte |
| Façades en carreaux de 0,5 m | `heures.js` `carreauxFacades` (champ `cote` par côté) | filtrées sur un bâtiment |
| Volume de chaque cellule de toit | `C.seg` (contours de `scene.contours` ou `contoursHeures()`) | sélection d'un toit |
| Piscines officielles, contour exact | `piscines.js` `bassinsAutour`, `creuserBassins` → `G.bassins` (`anneau`, `trous`, `niveau`) | zone « piscine existante » |
| Dessin au sol, rectangle en 3 clics | `traceVolume.js` `traceSol`, `projet.js` `rectangle(A, B, C)` | dessin de piscine (sans passer par l'onglet Projet) |
| Lecture DXF, recalage par la parcelle | `import/lecture.js` `lireDxf` (LWPOLYLINE, POLYLINE), `import/placement.js` `placer` | import d'un contour de piscine |
| PDF vectoriel | `exportCoupe.js` `coupePdf` : jsPDF + svg2pdf chargés à la demande | export PDF des zones |
| Verrou Pro | `pro.js` `basculer()` : liste `["#outilsPro", "#outilsExport"]` | ajouter `#exportZones` à la liste |
| Centre exact et viseur | `main.js` `allerCentre`, `basculerChoixCentre`, `#btnViseurCentre` | point de départ par défaut d'une zone « cible » |

Point à corriger au passage : dans une piscine creusée, `G.base` vaut le **fond** du bassin (niveau − 1,65 m). Le
rayon part donc de 0,2 m au-dessus du fond, et les parois de 1,6 m font de l'ombre. Pour une zone piscine, le rayon
doit partir **du plan d'eau** (niveau − 0,20 m, `piscines.js` `EAU`). La carte globale a le même défaut sur les
bassins.

---

## 1. Zones d'analyse

### 1.1 Types de zones

| Type | Création | Géométrie gardée |
|---|---|---|
| **Cible, cercle** | bouton « Cible », puis un clic sur la maquette. Par défaut : le centre exact s'il a été choisi au viseur (`x=1` dans l'adresse). Rayon réglable de 1 à 50 m (curseur et champ) | centre MN95 + rayon |
| **Cible, rectangle** | deux coins opposés, ou un centre + largeur × profondeur + angle | 4 coins MN95 |
| **Toit d'un bâtiment** | bouton « Bâtiment », puis un clic sur un toit : toutes les cellules du même volume (`C.seg`) | point cliqué MN95 + identifiant du volume ; recalculé au rechargement |
| **Façades d'un bâtiment** | case « avec les façades » sur une zone bâtiment : les carreaux de `carreauxFacades` des côtés de ce bâtiment | idem ; résultat par façade (N, E, S, O) |
| **Piscine existante** | bouton « Piscine » → « Choisir une piscine » : clic sur un bassin de `G.bassins` | contour officiel MN95 |
| **Piscine dessinée** | polygone (clic par coin, double-clic pour finir) ou **rectangle aux cotes** : clic du centre, puis longueur, largeur, angle (avec poignée de rotation) | polygone MN95 + profondeur |
| **Piscine importée** | DXF (polyligne fermée), GeoJSON ; IFC plus tard (voir §1.4) | polygone MN95 |

Toutes les géométries sont gardées **en MN95 absolues**. Le centre de la maquette (E0, N0) change avec le viseur ou la
parcelle choisie : une zone ne doit pas en dépendre.

### 1.2 Piscine dessinée ou importée dans le terrain

- Une piscine ajoutée passe par `creuserBassins` comme les piscines officielles. Elle rejoint `G.bassins` et le terrain
  est refait (`scene` reconstruit le maillage du terrain ; environ 0,8 s d'après l'audit).
- Option plus légère pour la première étape : pas de creusement. On calcule au niveau du terrain − 0,20 m et on dessine
  seulement le contour et l'eau. Le creusement vient à l'étape 4.
- Une piscine dessinée n'est **pas** un volume du projet : elle vit dans les zones de l'onglet Soleil.

### 1.3 Plusieurs zones nommées, gardées avec le lieu

Modèle de données (une zone) :

```
{ id, nom, type: "cercle" | "rectangle" | "toit" | "piscine",
  source: "cible" | "batiment" | "mensuration" | "dessin" | "import",
  geometrie: { centre:[E,N], rayon } | { anneaux:[[[E,N],…]] } | { point:[E,N] },
  facades: bool,
  piscine: { profondeur, couleur, bache, chauffage, saison } | null,
  visible: bool, couleur }
```

Stockage proposé, en deux temps :

1. **Navigateur** : `localStorage`, clé `ombres.zones`, indexée par lieu (même clé `e|n` que `lieux.js`). C'est le
   modèle de `projet.js` (`listerProjets`). Immédiat, sans serveur.
2. **Compte** : une colonne `zones JSON NULL` dans la table `lieux` (`api/schema.sql`) et une action `zones` dans
   `api/lieux.php`. Les zones suivent alors le lieu enregistré (☆) sur tous les appareils.

Nommage automatique : « Cible 1 », « Toit — bâtiment 2 », « Piscine 1 ». Le nom se modifie d'un clic.

### 1.4 Import : formats

- **DXF** : `lireDxf` lit déjà les polylignes fermées. On garde les polylignes fermées d'un calque nommé
  `piscine`, `bassin`, `pool`, `pool_outline`, `schwimmbad` ou `piscina`. Sinon, on propose la liste des contours
  fermés à cocher.
  Coordonnées : MN95 complètes (détectées par l'ordre de grandeur 2 400 000 / 1 100 000), ou origine locale recalée
  par la parcelle (`placer`, déjà utilisé par l'import de modèles).
- **GeoJSON** : Polygon ou MultiPolygon, en EPSG:2056 ou WGS84 (conversion par `geo.js`). Simple et sûr.
- **IFC** : `IfcSpace` ou objets nommés « pool », lus par web-ifc (WebAssembly, environ 1 Mo, licence MPL-2.0).
  À reporter : coût de chargement élevé pour un besoin rare. Une décision du propriétaire.

---

## 2. Résultat par zone

### 2.1 Ce qu'on affiche

- **Heures de soleil par semaine sur l'année** : un graphique de 52 barres (heures par jour, moyenne de la semaine et
  de la zone). En fond clair : le maximum possible au-dessus du relief (sans bâtiments ni arbres). Les initiales des
  mois servent d'axe.
- **Tableau** : semaine, dates, heures par jour, heures sur la semaine, part de la surface au soleil, et kWh/m² si
  l'énergie est calculée. Il est replié par défaut (`<details>`).
- **Mesures** (`dl.mesures`, comme `#heuresStats`) :
  - moyenne de la zone en h/jour sur l'année, et sur la saison de baignade pour une piscine ;
  - **part de la surface au soleil** : heures de soleil reçues divisées par les heures possibles au-dessus du relief
    (100 % = jamais d'ombre proche). Une seconde mesure, à trancher : la part de la surface qui reçoit au moins 6 h par
    jour en juin ;
  - minimum et maximum entre les cellules de la zone.
- **Énergie solaire reçue (optionnelle)** en kWh/m² par semaine et par an :
  - **ciel clair** : modèle de ciel clair (ESRA ou Ineichen–Perez avec un trouble de Linke mensuel) ;
  - **ciel moyen** : rayonnement global horaire mesuré par MétéoSuisse (`gre000h0`), séparé en direct et diffus par
    `ods000h0` quand la station le mesure, sinon par la corrélation d'Erbs ;
  - sur une cellule : `direct × soleil(cellule, heure) × cos(incidence) + diffus × facteur de vue du ciel`.

### 2.2 Méthode : masques d'horizon par point

Aujourd'hui, `ensoleillement.worker.js` suit un rayon **par cellule et par position du soleil**. Pour 52 semaines,
il faudrait des milliers de positions. C'est trop lent sur une grande zone (l'audit mesure 29,2 s pour 809 positions).

Approche retenue, qui est aussi la piste P3 (b) de `docs/audit-parallele.md` :

1. Pour chaque point de mesure de la zone, on calcule **une fois** la hauteur d'obstruction dans chaque direction :
   720 azimuts (pas de 0,5°). Chaque azimut demande une marche dans la grille `surface`, qui s'arrête dès que plus
   rien ne peut dépasser l'angle trouvé (comparaison avec `zmax`).
2. On prend le maximum avec l'horizon lointain (`horizonA`).
3. Une position du soleil (az, h) éclaire le point si `h > masque[az]`. Cette lecture ne coûte presque rien.
4. Le même masque donne le **facteur de vue du ciel** (diffus, et rayonnement infrarouge de la piscine vers le ciel).

Pour les semaines, on prend chaque jour de la semaine (7 × 52 jours) au pas de 10 minutes, avec les mêmes règles que
`soleilsPeriode` (hauteur > 0,5° et au-dessus du relief).

Points de mesure :
- sol, toit ou cible : centres des cellules de 0,5 m dans le contour, départ à `base + 0,2 m` (règle actuelle) ;
- piscine : départ au plan d'eau ; les cellules de la piscine elle-même sont ignorées sur les deux premiers mètres ;
- façades : carreaux de `carreauxFacades`, avec le test « soleil devant le mur » du worker actuel.

### 2.3 Coûts et façon de les tenir

| Zone | Points | Masques (720 az) | Lecture des 52 semaines |
|---|---|---|---|
| Piscine 8 × 4 m | ~130 | < 0,1 s | négligeable |
| Toit de villa | ~600 | ~0,2 s | négligeable |
| Cible de 20 m de rayon | ~5 000 | 1–3 s dans un fil, ~0,3 s sur 11 fils | ~0,2 s |
| Cible de 50 m | ~31 000 | trop long à 0,5 m : échantillonnage à 1 m (÷ 4) | ~0,3 s |

Ces chiffres sont des estimations, à mesurer à l'étape 2.

Pour les tenir :
- **Échantillonnage** : 0,5 m jusqu'à 5 000 points, puis 1 m. Les piscines et les toits restent à 0,5 m.
- **Fils de calcul** : un **pool de fils gardé pour le lieu**, avec `hardwareConcurrency − 1` fils (12 cœurs → 11),
  au lieu de `min(4, …)` (audit P3 a). `surface` et `base` ne sont envoyés qu'une fois par lieu (audit, « pistes de
  second rang »).
- **Cache** : les masques d'une zone sont gardés en mémoire (Uint8, hauteur au 0,5° près : 720 octets par point,
  3,6 Mo pour 5 000 points). Changer de semaine, d'année ou de paramètres de piscine ne relance rien. Seul un
  changement de bâtiments (Swiss3D, volumes du projet, masquage) invalide les masques, avec la même clé que
  `clePeriode`.
- **Pas de calcul dans le fil principal** : le contour de la zone est rasterisé ligne par ligne (audit P4), pas avec
  `dans()` sur chaque cellule.
- Plus tard, ces masques peuvent aussi accélérer la carte globale de l'année (≈ ×4 à ×6 selon l'audit).

Limites à afficher :
- les arbres sont opaques toute l'année ; les feuillus laissent passer du soleil en hiver ;
- la précision est celle de la grille de 0,5 m ;
- les bâtiments Swiss3D sont vus de dessus (`contoursHeures`) ;
- au-delà de la maquette fine, seul l'horizon lointain compte (relief à 30–100 m).

---

## 3. Température de l'eau d'une piscine

### 3.1 Ce que dit la littérature

Le bilan d'énergie d'un bassin extérieur est un modèle classique. Il est utilisé par les outils de chauffage de
piscine et validé sur mesures.

- **Woolley, Harrington et Modera (2011)**, *Swimming pools as heat sinks for air conditioners*, Building and
  Environment. Modèle horaire, un seul nœud (eau bien mélangée), données météo standard. Écart de **1,1 °C** sur la
  température horaire, R² = 0,967 sur une piscine de Davis (Californie). Il utilise l'ombre réelle : diffus seul aux
  heures d'ombre, global sinon. C'est exactement ce que Topograph peut fournir.
  https://wcec.ucdavis.edu/wp-content/uploads/2012/07/Swimming-Pools-as-Heat-Sinks_Model-Development.pdf
  (doi:10.1016/j.buildenv.2010.07.014)
- **Smith, Löf et Jones (1994)**, *Measurement and analysis of evaporation from an inactive outdoor swimming pool*,
  Solar Energy 53(1), p. 3–7 : l'évaporation d'une piscine extérieure au repos est **16 à 28 % plus faible** que
  l'équation de l'ASHRAE. doi:10.1016/S0038-092X(94)90597-5 ; suite (piscines en usage) :
  https://www.osti.gov/biblio/653225
- **Ruiz et Martínez (2010)**, modèle TRNSYS validé sur une piscine privée de 50 m², six jeux de coefficients
  d'évaporation comparés ; l'évaporation est la première perte. https://www.osti.gov/biblio/21262147
- **Buscemi et al. (2024)**, Energy Conversion and Management : bilan d'énergie de bassins extérieurs avec des
  corrélations d'évaporation récentes, erreur moyenne < 12 % sur la consommation annuelle.
  https://iris.unipa.it/retrieve/621a22a3-c569-4daf-b24d-ec2721815983/1-s2.0-S0196890424000931-main.pdf
- Étude de 2019 (*Thermal performance prediction of outdoor swimming pools*) : 82 % des prédictions à ±0,5 °C.
  https://eld.bl.uk/catalog/100140663642_0x000001
- Modèle Modelica d'un bassin extérieur avec bâche thermique (évaporation dominante).
  https://ecp.ep.liu.se/index.php/modelica/article/download/1375/1189/1638
- **Outils existants** :
  - **Enerpool 3.0** (Ressources naturelles Canada) : bilan horaire, piscines chauffées ou non, année météo type.
    https://natural-resources.canada.ca/science-data/data-analysis/geospatial-data-tools-services/enerpool-30
  - **Energy Smart Pools** (DOE, États-Unis) : estimation annuelle, ancien.
    https://search.worldcat.org/title/The-energy-smart-pools-computer-program/oclc/5572163347
  - **TRNSYS** (types de piscine, validés ci-dessus) et **Polysun** (module piscine, sert de référence de validation
    dans plusieurs articles) : logiciels payants, pas intégrables au site, mais utiles pour vérifier nos résultats.
  - Guide NREL sur le chauffage solaire des piscines (pertes : environ 95 % par la surface).
    https://www.nrel.gov/docs/fy00osti/28038.pdf

Aucun de ces outils ne tient compte de l'ombre réelle des bâtiments et des arbres voisins. C'est la valeur ajoutée de
Topograph.

### 3.2 Équations retenues

Eau bien mélangée, pas de temps d'une heure, surface A (m²), volume V = A × profondeur moyenne :

```
ρ c V · dTw/dt = Q_sol + Q_ir + Q_conv + Q_evap + Q_sol_parois + Q_appoint + Q_chauffage      (W)
```

ρ c = 4,18 MJ/m³K. Constante de temps : environ 3 à 4 jours pour 1,5 m de profondeur. Le schéma explicite au pas
d'une heure est donc stable.

| Terme | Formule | Paramètres usuels |
|---|---|---|
| **Solaire absorbé** | `Q_sol = α · A · [ G_b,h · f_soleil(t) + G_d · SVF ]` | α = 0,85 (liner clair) à 0,90 (foncé) ; `f_soleil` = part de la surface au soleil à cette heure (masques, §2.2) ; SVF = facteur de vue du ciel moyen de la zone |
| **Infrarouge** | `Q_ir = ε_w σ A [ SVF·L↓/σ + (1 − SVF)·(Ta+273)⁴ − (Tw+273)⁴ ]` | ε_w = 0,95 ; L↓ mesuré (`oli000h0`) si la station le donne, sinon ERA5-Land, sinon ciel de Berdahl–Martin (Woolley, éq. 8–9) : `ε_ciel = 0,787 + 0,764·ln((Tdew+273)/273)`, × `(1 + 0,0224·N − 0,0035·N² + 0,00028·N³)` (N : nébulosité en dixièmes ; coefficients de Clark et Allen, le texte de Woolley imprime « 0,224 », à vérifier) ; puis `T_ciel = (Ta+273)·ε_ciel^0,25 − 273` |
| **Évaporation** | McMillan, repris par Woolley : `Q_evap = −(0,036 + 0,025·V₃) · (e_s(Tw) − e_a)` (W/m², pressions en Pa) | V₃ : vent à 3 m ; e_s : pression de vapeur saturante à la surface ; e_a : pression de vapeur de l'air (`pva200h0` ou depuis Td) |
| Variante | ASHRAE (Carrier) : `m = A (p_w − p_a)(0,089 + 0,0782·V) / Y` (kg/s, kPa, m/s, Y en kJ/kg), × 0,74 à 0,84 pour une piscine au repos (Smith 1994) | sert de test de sensibilité |
| **Convection** | rapport de Bowen : `Q_conv = Q_evap · C_B · (p/p₀) · (Tw − Ta)/(e_s − e_a)` | C_B ≈ 61 Pa/K (0,61 hPa/K, valeur classique ; le texte de Woolley imprime « 6,13 », à vérifier) ; p/p₀ corrige l'altitude |
| **Sol et parois** | `Q_sol_parois = −U_sol · A_contact · (Tw − T_sol)` | U ≈ 0,5 W/m²K (béton non isolé dans la terre ; Woolley prend k_sol = 0,52 W/mK et un facteur de forme) ; T_sol = moyenne annuelle de l'air, déphasée d'environ 1 mois ; terme faible |
| **Eau d'appoint** | `Q_appoint = ṁ_evap · c · (T_réseau − Tw)` | T_réseau ≈ 10–12 °C ; ṁ_evap = Q_evap / 2,45 MJ/kg ; terme faible |
| **Chauffage** | si Tw < consigne : `Q_chauffage = min(P_max, besoin)` | consigne (ex. 26 °C) ; puissance (ex. 9 kW de pompe à chaleur) ; résultat : kWh par semaine |

**Vent sur l'eau.** C'est le paramètre le plus sensible (Ruiz 2010). La station mesure à 10 m dans un lieu dégagé.
On ramène à 3 m (loi de puissance, exposant ≈ 0,2), puis on applique un **facteur d'abri** de 0,3 à 1. Il est choisi
par l'utilisateur (« abritée », « normale », « exposée »). Une valeur par défaut peut venir du masque d'horizon : un
SVF faible indique un jardin abrité.

**Bâche.** Valeurs du DOE et du NREL :
- l'évaporation baisse de 50 à 95 % selon le type de bâche et sa pose ;
- une bâche à bulles transparente réduit le solaire absorbé de 5 à 15 %, une bâche opaque de 20 à 40 % ;
- le chauffage baisse de 50 à 70 %.

Modèle : Q_evap × 0,1 à 0,3 ; Q_conv et Q_ir × 0,5 ; Q_sol × 0,9 (transparente) ou × 0,7 (opaque). Horaires :
« jamais », « la nuit (20 h – 9 h) », « hors baignade ».
https://www.energy.gov/energysaver/swimming-pool-covers ; https://www.nrel.gov/docs/fy00osti/28038.pdf ;
https://www.epa.gov/watersense/pool-water-efficiency

**Démarrage.** Mise en eau à la date d'ouverture (par défaut le 1er mai), Tw = température du réseau, puis
simulation jusqu'à la fermeture (par défaut le 30 septembre). Il faut 15 jours de mise en régime avant le premier
résultat affiché.

### 3.3 Données météo suisses

| Source | Contenu utile | Format, taille | Licence | Accès |
|---|---|---|---|---|
| **MétéoSuisse OGD, SwissMetNet** (`ch.meteoschweiz.ogd-smn`) | ~160 stations. Horaire : `tre200h0` (air à 2 m), `ure200h0` (humidité), `tde200h0` (point de rosée), `pva200h0` (pression de vapeur), `fu3010h0` (vent, km/h), `gre000h0` (global), `ods000h0` (diffus), `oli000h0` (infrarouge descendant, sur certaines stations), `sre000h0` (durée d'ensoleillement), `prestah0` (pression) | CSV `;`, un fichier par station et par décennie : `ogd-smn_{abr}_h_historical_2010-2019.csv` (Pully : 10,8 Mo), plus `_h_recent` et `_h_now`. Métadonnées : `ogd-smn_meta_stations.csv` (coordonnées, altitude), `_meta_parameters.csv`, `_meta_datainventory.csv` | CC BY, mention « Source : MétéoSuisse » | STAC `https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn` ; fichiers servis avec `Access-Control-Allow-Origin: *` (vérifié le 27.11.2026) |
| **MétéoSuisse, normes climatologiques 1991–2020** | moyennes mensuelles par station ; cartes à 2 km (NetCDF, GeoTIFF) | ZIP de TXT, un fichier par paramètre | CC BY | opendata.swiss |
| **Copernicus ERA5-Land** | horaire depuis 1950, maille 0,1° (~9 km) : température, point de rosée, vent, rayonnement solaire et **infrarouge descendant** | NetCDF ou GRIB ; volumineux | CC BY (mention Copernicus) | API du CDS : compte et clé ; **côté serveur seulement** |
| **ERA5** (0,25°) | comme ERA5-Land, plus la **nébulosité** | idem | CC BY | idem |
| **PVGIS 5.3** (JRC) | rayonnement horaire satellite (SARAH), année type ISO 15927-4 (`tmy`), séries `seriescalc` | CSV, JSON, EPW | réutilisation avec mention | API `https://re.jrc.ec.europa.eu/api/v5_3/` ; **AJAX refusé** : serveur seulement ; 30 appels/s |
| Open-Meteo (archive ERA5) | même contenu qu'ERA5, CORS ouvert | JSON | **API gratuite non commerciale** : un site avec abonnement ou publicité doit payer | à écarter, ou payer |

Sources :
- https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations
- https://opendatadocs.meteoswiss.ch/c-climate-data/c6-climate-normals
- https://www.meteoswiss.admin.ch/services-and-publications/service/open-data.html
- https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land
- https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
- https://open-meteo.com/en/docs/historical-weather-api et https://open-meteo.com/en/terms

**Choix de la station.**
- Station SMN la plus proche **à altitude comparable**. Un score combine la distance et 100 m de dénivelé = 10 km.
  Exemple : Lutry → Pully (PUY).
- Correction d'altitude : température −0,65 °C par 100 m ; point de rosée gardé ; pression corrigée.
- Variables manquantes dans la station (diffus, infrarouge) : prises à la station voisine qui les mesure, ou à
  ERA5-Land au point.
- Avertissement si la station est à plus de 15 km ou à plus de 300 m de dénivelé. On affiche toujours son nom et sa
  distance.
- Pas d'interpolation entre stations au départ. Le relief suisse rend l'interpolation simple trompeuse (lac,
  inversions). ERA5-Land peut servir de garde-fou.

### 3.4 Approche proposée

1. **Préparer les données sur notre serveur** (script `outils/climat/`, lancé une fois par an) :
   - télécharger les CSV horaires SMN de 2000 à l'an dernier ;
   - garder 6 à 8 variables en entiers 16 bits ;
   - écrire un binaire par station (`public/climat/PUY.bin`, ~1,2 Mo compressé pour 25 ans) et un
     `stations.json` (abréviation, nom, coordonnées, altitude, variables disponibles).
   - Volume total : environ 200 Mo pour 160 stations (ou ~100 Mo pour 2010 et après).
   - Pourquoi ne pas lire MétéoSuisse depuis le navigateur ? C'est possible (CORS ouvert), mais il faudrait 3 fichiers
     de 11 Mo à analyser par lieu, et les noms de fichiers peuvent changer.
2. **Simulation horaire de chaque année réelle** (2000 → dernière année complète) avec l'ombre calculée par Topograph
   sur la zone de la piscine.
3. **Année type = médiane par semaine des années réelles.** Elle répond à « les années précédentes, et la moyenne
   sinon ». La fourchette = 10e et 90e centiles. Une année météo type (ISO 15927-4, comme PVGIS) sert seulement de
   repli si une station a moins de 10 ans de données.
4. **Quatre variantes** : avec ou sans bâche, avec ou sans chauffage.
5. **Comparaison « sans ombre »** : même piscine, `f_soleil = 1` et SVF = 1. On montre ainsi ce que coûte l'ombre du
   lieu, en °C et en jours de baignade.
6. **Résultats** :
   - température de l'eau par semaine (médiane et fourchette, de mai à septembre) ;
   - nombre de jours au-dessus de 24 °C par saison (médiane et fourchette ; seuil réglable) ;
   - avec chauffage : kWh par semaine et par saison ;
   - les années réelles une par une dans le tableau (« 2022 : 41 jours », « 2021 : 12 jours »).

### 3.5 Limites et précision, à afficher honnêtement

- Précision attendue : environ ±1 à 2 °C sur la moyenne de la semaine (Woolley : 1,1 °C à l'heure, avec une station
  sur place). Ici, la station est à quelques kilomètres : l'incertitude est plus grande.
- Le vent au niveau de l'eau est estimé et domine l'évaporation.
- Ce qui n'est pas modélisé : baigneurs, débordement, filtration la nuit, stratification (piscines profondes),
  pluie, feuilles, couleur exacte du fond.
- Les arbres sont opaques ; une haie feuillue est plus perméable.
- Le résultat sert de comparaison et d'aide à la décision. Ce n'est pas un dimensionnement de chauffage. Une phrase
  dans ce sens, sous le graphique et dans le PDF.
- Validation prévue : quelques séries réelles de température d'eau (sondes de clients, si le propriétaire en a), et
  des cas Enerpool ou Polysun.

### 3.6 Où calculer

- **Navigateur.** La simulation coûte 8 760 pas × 25 années × 4 variantes, soit environ 1 M pas : quelques dizaines
  de millisecondes dans un fil. Les ombres viennent des masques déjà calculés. Il n'y a pas de serveur de calcul.
- **Serveur** : seulement le dépôt de fichiers statiques (binaires par station) chez Infomaniak. Les fichiers sont
  préparés hors ligne par `outils/climat/`. Pas de PHP à ajouter, pas de clé CDS sur le serveur public.
- Le code du modèle (`src/piscine.js`) n'utilise ni three.js ni le DOM. Il est testable dans Node, comme
  `src/import/`.

---

## 4. Export PDF Pro

**Outil** : jsPDF et svg2pdf, déjà dans `package.json` et chargés à la demande dans `exportCoupe.js` (`coupePdf`).
On factorise la mise en page dans un petit module `exportZones.js`, sur le même principe.

**Police.** `coupePdf` passe les textes par `ascii()` : les accents sont supprimés. Pour un rapport destiné aux
clients, il faut embarquer une police libre (licence OFL, ~150–300 Ko, chargée seulement à l'export) pour le
français, l'allemand et l'italien.

**Mise en page A4 portrait, 2 pages (3 avec la piscine)** :

1. Page 1 — la zone
   - En-tête : Topograph, nom de la zone, lieu, coordonnées MN95 et GPS, date du calcul.
   - **Plan de la zone** (vectoriel, SVG) : parcelles (`S.toutes`), contours des bâtiments, contour de la zone, flèche
     du nord, barre d'échelle, échelle 1:200 ou 1:500. La carte des heures est posée dessous en image (pixels de
     `textureHeures`, sans filtrage).
   - Mesures principales : moyenne, part au soleil, kWh/m².
2. Page 2 — l'année
   - **Graphique hebdomadaire** (SVG → vectoriel) : 52 barres et le maximum possible.
   - **Tableau** des 52 semaines, en deux colonnes de 26 lignes.
3. Page 3 — la piscine (si c'est une zone piscine)
   - Température de l'eau par semaine (médiane et fourchette), avec et sans ombre.
   - Jours au-dessus de 24 °C ; énergie de chauffage s'il y en a.
   - **Hypothèses** : profondeur, couleur, bâche, chauffage, vent, station, années utilisées.
4. Pied de chaque page
   - Sources : swisstopo (swissSURFACE3D, swissALTI3D), mensuration officielle, « Source : MétéoSuisse », Copernicus
     si utilisé.
   - Avertissement « résultats indicatifs » (texte des conditions), version du site, page n / N.

**Verrou** : le bouton « Exporter en PDF » de la section Zones reçoit `.pro-verrouille` par `pro.js` `basculer()`. Il
suffit d'ajouter son identifiant à la liste. Il reste visible et grisé pour un compte gratuit ; un clic ouvre l'offre
Pro.

---

## 5. Interface dans l'onglet Soleil

Une nouvelle `section.cellule#zones` sous « Heures de soleil », avec le même style Bootstrap (petits boutons
`btn-sm btn-outline-secondary`, `dl.mesures`, textes `small text-secondary`).

```
Zones d'analyse
[◎ Cible] [▣ Bâtiment] [≈ Piscine ▾]          ← menu Piscine : Choisir une piscine · Dessiner · Rectangle aux cotes · Importer…
───────────────────────────────────────────
● Piscine 1        32 m²   👁  ✕             ← clic : sélection ; double-clic sur le nom : renommer
○ Toit — bâtiment 2 148 m²  👁  ✕
○ Cible 1 (r = 10 m)        👁  ✕
───────────────────────────────────────────
Piscine 1 · Pully (2,1 km)
 Moyenne 6 h 40/j   Part au soleil 78 %   1 120 kWh/m²·an
 [graphique 52 barres]
 ▸ Tableau des semaines
 Température de l'eau
   Profondeur [1,5] m   Fond [clair ▾]   Bâche [la nuit ▾]   Vent [normal ▾]
   Chauffage [non ▾]  (consigne 26 °C, 9 kW)
   [courbe mai–septembre, médiane et fourchette]
   Jours > 24 °C : 38 (21–57)   · sans ombre : 52
 [Exporter en PDF]  (Pro)
```

Comportement :
- un outil actif se signale comme le viseur (`aria-pressed`, curseur en croix, `message()` d'aide, Échap annule) ;
- les clics sur la maquette vont à l'outil actif, avant la sélection de parcelle (comme `pro.dessine()`) ;
- dans la 3D, chaque zone est un contour de couleur posé sur le sol ou le toit ; la zone sélectionnée est plus
  épaisse ; l'œil la masque ;
- le calcul se lance seul après la création d'une zone (masques), puis tout est instantané ;
- sur mobile (feuille du bas), la liste se replie et les résultats s'ouvrent en dessous ;
- textes dans les 4 langues (`src/langues/fr.js`, `de.js`, `it.js`, `en.js`), clés `zones.*` et `piscine.*`.

Ce qui reste hors de l'onglet Projet : outils, liste, résultats et export. Les piscines dessinées ne passent pas par
`P.volumes`.

---

## 6. Étapes livrables

Tailles : S < 1 jour, M = 1 à 3 jours, L > 1 semaine.

| # | Livrable | Contenu | Taille |
|---|---|---|---|
| 1 | **Zones cible** | modèle de zone, stockage `localStorage`, section « Zones », outil Cible (cercle, rectangle), contours en 3D, liste nommée | M (2–3 j) |
| 2 | **Heures par semaine** | masques d'horizon dans un pool de fils, période « semaine », graphique de 52 barres, tableau, mesures, départ au plan d'eau | M (2–3 j) |
| 3 | **Zones bâtiment** | toit par `C.seg`, façades par côté (`carreauxFacades` filtrés), résultat par orientation | S–M (1–2 j) |
| 4 | **Piscines** | choix d'un bassin officiel, dessin (polygone, rectangle aux cotes), import DXF et GeoJSON, creusement dans le terrain | M (3 j) |
| 5 | **Données climat** | script `outils/climat/`, binaires par station, `stations.json`, choix de la station, correction d'altitude, mention des sources | M (2–3 j) |
| 6 | **Énergie solaire** | ciel clair et ciel moyen, kWh/m² par semaine | S–M (1–2 j) |
| 7 | **Température de l'eau** | `src/piscine.js` (bilan horaire), réglages, graphique, jours > 24 °C, tests Node, `docs/piscine-methode.md` | M (3–4 j) |
| 8 | **Export PDF Pro** | `exportZones.js`, police embarquée, 2–3 pages A4, verrou Pro | M (2 j) |
| 9 | **Compte et finitions** | colonne `zones` de la table `lieux`, traductions DE/IT/EN, pages légales (sources météo) | S–M (1–2 j) |
| — | Plus tard | import IFC (web-ifc) ; arbres saisonniers ; masques réutilisés pour la carte globale de l'année | L |

Total : environ 3 à 4 semaines de travail. Les étapes 1 à 3 donnent déjà la demande principale (heures par semaine
par zone). Les étapes 5 à 7 sont indépendantes des étapes 3 et 4, et peuvent avancer en parallèle.

---

## 7. Décisions à trancher par le propriétaire

1. **Gratuit ou Pro** : zones et heures par semaine pour tous, ou pour un compte gratuit ? Température de l'eau en
   Pro seulement ? (Le PDF est Pro dans tous les cas.)
2. **Stockage des zones** : navigateur seulement au départ, ou tout de suite au compte (colonne `zones` de `lieux`) ?
3. **Données climat** : héberger les séries MétéoSuisse préparées (2000 → aujourd'hui, ~200 Mo ; ou 2010 →
   aujourd'hui, ~100 Mo) ? Ajouter ERA5-Land (compte Copernicus, préparation hors ligne) pour l'infrarouge et les
   stations incomplètes ?
4. **Semaines** : semaines ISO 1 à 52 (la 53e fusionnée avec la 52e), ou blocs de 7 jours depuis le 1er janvier ?
5. **« Part de la surface au soleil »** : rapport aux heures possibles (proposé), ou part de la surface avec au moins
   6 h par jour ?
6. **Seuil et saison** : 24 °C fixe ou réglable ? Saison par défaut du 1er mai au 30 septembre ?
7. **Valeurs par défaut de la piscine** : profondeur 1,5 m, fond clair, bâche la nuit, vent « normal » ?
8. **Arbres** : opaques toute l'année (comme aujourd'hui), ou perméables en hiver ?
9. **Import IFC** : maintenant (environ 1 Mo de bibliothèque) ou plus tard ?
10. **PDF** : police embarquée (accents), langue du PDF = langue de l'interface ?
11. **Validation** : avez-vous des relevés de température d'eau de piscines de clients pour caler le modèle ?
12. **Texte d'avertissement** à valider (résultats indicatifs, pas un dimensionnement de chauffage).

## Décisions du propriétaire (27.11.2026)

- **Gratuit** : ensoleillement de la piscine (heures de soleil par semaine sur la zone de la piscine) et indication
  simple de la température de l'eau : **au-dessus ou en dessous de 25 °C** (seuil retenu : 25 °C, et non 24 °C),
  semaine par semaine ou par période.
- **Pro** :
  - graphique exact de la température estimée de l'eau, **sans chauffage externe** (médiane et fourchette sur les
    années de données, avec l'ombre réelle) ;
  - **coût du chauffage estimé** : puissance (W) et énergie (kWh) nécessaires selon les saisons pour atteindre et
    tenir une température choisie (par exemple 26 ou 28 °C), avec ou sans bâche ; total par mois et par saison, et
    équivalent en francs avec un prix de l'énergie réglable (électricité directe, pompe à chaleur avec COP réglable).
  - export PDF.
- Tout se trouve dans l'onglet **Soleil**, jamais dans l'onglet Projet.
