# Piscine : ensoleillement et température de l'eau — méthode

Section « Piscine » de l'onglet Soleil (27.11.2026). Code : `src/zonesSoleil.js` (interface), `src/masques.worker.js`
et `src/semaines.js` (ombres), `src/climat.js` (MétéoSuisse), `src/piscine.js` (bilan thermique, testable dans Node),
`src/graphiquesPiscine.js`, `src/exportZones.js` (PDF Pro), `src/solairePiscine.js` (chauffage solaire). Plan d'origine : `docs/plan-ensoleillement-zones-piscine.md`.

## Zone

- Piscine de la mensuration officielle (`G.bassins`, clic), polygone dessiné, rectangle aux cotes, ou polyligne fermée
  d'un DXF (calque « piscine », « bassin », « pool »… de préférence ; MN95, sinon centrée sur la maquette).
- Géométries gardées en MN95 dans le navigateur (`localStorage`, clé `ombres.piscines`). Pas encore dans le compte.
- Les piscines dessinées ne sont pas creusées dans le terrain : plan d'eau = terrain médian du contour − 0,20 m.

## Ombres

- Points de mesure : centres des cellules de 0,5 m dans le contour, **départ au plan d'eau** (niveau − 0,20 m), et non
  plus au fond du bassin creusé. Même correction pour la carte globale des heures (`baseAuPlanDEau`).
- Masque d'horizon par point : 720 azimuts (0,5°), marche dans la grille `surface` (terrain, bâtiments affichés,
  volumes du projet, arbres), arrêt dès que rien ne peut plus dépasser l'angle trouvé ; maximum avec l'horizon lointain.
  Sur les 2 premiers mètres, la margelle (moins de 0,30 m au-dessus de l'eau) est ignorée.
- Heures par semaine : chaque jour de l'année au pas de 10 min, soleil compté au-dessus de 0,5° et du relief.
  Semaines = blocs de 7 jours depuis le 1er janvier (la 52e reçoit le ou les derniers jours).
- Part au soleil = heures reçues ÷ heures possibles au-dessus du relief (mai–septembre).
- Vue du ciel (SVF) = moyenne de cos²(hauteur du masque) sur l'azimut.
- Vérification (Lutry, piscine à E 2542730 N 1152253) : semaine 25, 4,6 h/jour par les masques contre 4,7 h/jour
  par lancer de rayons direct sur un point sur trois.

## Ensoleillement réel (nuages)

Pour chaque heure des années disponibles : part de la piscine hors de l'ombre (masques, 4 positions par heure) ×
part de l'heure où la station a mesuré du soleil (`sre000h0`, minutes / 60). Somme par mois, en heures par jour ;
médiane et P10–P90 des années. Ciel clair = même somme sans le facteur de la station.
Choix : la méthode heure par heure garde la coïncidence entre l'ombre (matin, soir) et la nébulosité du moment, ce
qu'un facteur mensuel moyen perd. Limite : le soleil mesuré à la station n'est pas celui du jardin (quelques km).

La simulation de l'eau utilise la même donnée : le rayonnement direct (global mesuré − diffus mesuré) n'existe que
quand le soleil brille à la station, et il est multiplié par la part de la piscine au soleil à cette heure.

## Données météo

- MétéoSuisse, Open Government Data, SwissMetNet, horaire (`ogd-smn_{abr}_h_historical_2010-2019.csv` et `2020-2029`),
  lus directement par le navigateur : `data.geo.admin.ch` répond avec `Access-Control-Allow-Origin: *` (vérifié le
  27.11.2026). Environ 18 Mo par station, une fois par session. Années complètes seulement (2010–2025).
- Colonnes : `tre200h0`, `tde200h0`, `pva200h0`, `fkl010h0` (m/s, 10 m), `gre000h0`, `ods000h0`, `oli000h0` (si
  mesuré), `sre000h0`, `prestah0`.
- Horodatage UTC à la **fin** de l'heure (profil moyen du rayonnement de Pully en juin–juillet centré sur 11 h 37 UTC,
  midi solaire).
- Station : score = distance (km) + |dénivelé| / 10 (100 m comptent comme 10 km) ; essai des 3 premières. Lutry →
  Pully (2,0 km, 456 m). Air corrigé de −0,65 °C par 100 m. Avertissement au-delà de 15 km ou 300 m.
- **Repli** : si MétéoSuisse ne répond pas, lecture des mêmes fichiers sous `/climat/` (préparés par
  `node outils/climat/preparer.mjs PUY …`, colonnes utiles seulement). Le dossier `public/climat/` n'est pas encore
  publié ; sans lui, l'interface dit que la température ne peut pas être estimée.
- Mention obligatoire « Source : MétéoSuisse » (interface et PDF).

## Bilan thermique (horaire, un nœud)

`ρc V dTw/dt = Q_sol + Q_ir + Q_evap + Q_conv + Q_sol_parois + Q_appoint (+ Q_chauffage)`

| Terme | Choix |
|---|---|
| Solaire | α (0,85 clair, 0,90 foncé) × A × (direct × part au soleil + diffus × SVF) ; diffus mesuré, sinon Erbs |
| Infrarouge | 0,95 σ A [SVF·L↓ + (1−SVF)·σTa⁴ − σTw⁴] ; L↓ mesuré si disponible, sinon Berdahl–Martin (point de rosée) et nébulosité de Crawford–Duchon (1 − global / ciel clair de Haurwitz, la nuit : dernière valeur du jour) |
| Évaporation | McMillan (Woolley 2011) : (0,036 + 0,025 V₃)(e_s(Tw) − e_a), W/m², Pa |
| Convection | Bowen, C_B = 61 Pa/K, corrigée de la pression |
| Sol et parois | U = 0,5 W/m²K sur fond + parois ; sol = moyenne de l'air des 60 jours précédents |
| Eau d'appoint | eau évaporée remplacée à 12 °C |
| Vent | station à 10 m → 3 m (exposant 0,2) × abri : abritée 0,3, normale 0,5, exposée 0,8 |
| Bâche | la nuit (20 h – 9 h, heure d'été) : évaporation × 0,3, convection et infrarouge × 0,7, solaire × 0,9 |
| Saison | mise en eau le 15 avril à 12 °C, résultats du 1er mai au 30 septembre |
| Chauffage | puissance illimitée, juste ce qu'il faut pour tenir la consigne chaque heure dès le 1er mai |

Défauts : profondeur 1,5 m, fond clair, bâche la nuit, vent normal, seuil 25 °C, consigne 26 °C, pompe à chaleur
COP 4, 0,30 CHF/kWh.

Résultats : moyenne de l'eau par semaine (médiane, P10, P90 des années), même calcul sans ombre (part au soleil = 1,
SVF = 1), jours dont la moyenne dépasse le seuil ; chauffage : kWh par mois, puissance moyenne du jour le plus
exigeant du mois, total de la saison, mise en température, coût = kWh ÷ COP × prix.

## Chauffage solaire (Pro)

Demande du propriétaire : « pour les piscines aussi option maison avec panneaux solaires / ou panneaux eau chaude,
estimer leur efficacité par mois et besoin ». Code : `src/solairePiscine.js` (sans DOM, testable dans Node), interface
dans `zonesSoleil.js` (`blocSolaire`), graphiques `svgSolaireMois` / `svgSolaireTemp`, page 3 du PDF.

### Choix offerts

- Installation : aucune, capteurs thermiques (non vitrés, vitrés plans, tubes sous vide ; surface), ou photovoltaïque +
  pompe à chaleur (kWc, COP à air 15 °C / eau 26 °C, puissance de la pompe).
- Toit : pente et orientation saisies (0 = sud, −90 = est ; ombre du relief lointain seulement), ou **pan de la
  maquette** choisi d'un clic (`panDeToit`) : croissance de région sur `G.bat` (cellules voisines de pente semblable,
  écart < 0,25 m/m, saut < 0,6 m), plan ajusté par moindres carrés, deuxième passe autour de ce plan (résidu < 0,35 m).
  Pente, orientation et surface (en pente) en sortent ; 150 points au plus sur le pan, à 0,3 m au-dessus du plan,
  passent dans `masques.worker.js` (même calcul que la piscine) → part du pan au soleil heure par heure et vue du ciel.
  Le pan est surligné en orange sur la maquette ; le point cliqué est gardé avec la zone (`z.toit`).
- Dépassement solaire (2 K par défaut) : le solaire peut monter l'eau jusqu'à consigne + 2 °C (l'eau stocke la chaleur
  du jour, comme avec une régulation solaire usuelle) ; au-delà, capteurs ou pompe arrêtés.

### Modèle, heure par heure (mêmes années MétéoSuisse que l'eau)

- **Rayonnement sur le plan** : direct = (global − diffus) / sin h × cos θ, × part du plan au soleil, × perte
  d'incidence ASHRAE 1 − b0 (1/cos θ − 1) ; diffus isotrope (Liu–Jordan) × vue du ciel du plan (min de (1 + cos β)/2
  et de la vue mesurée par les masques) ; sol : global × 0,2 × (1 − cos β)/2. Soleil au milieu de l'heure.
- **Capteurs thermiques** (EN ISO 9806, surface brute) :
  - vitrés plans et tubes : η = η0 − a1 ΔT/G − a2 ΔT²/G, ΔT = eau + 5 K (échangeur) − air ;
  - non vitrés (absorbeurs en polypropylène, eau de la piscine directe, ΔT = eau + 1 K − air) :
    q = η0 (1 − bu u) G″ − (b1 + b2 u) ΔT, avec G″ = G + 0,95 (E_L − σTa⁴) (échange infrarouge avec le ciel, même
    E_L que pour l'eau, × (1 + cos β)/2). u = vent de la station × 0,65 (toit) ;
  - pompe en marche si le gain dépasse 15 W/m² ; 5 % de pertes dans les conduites.

  | Type | η0 | a1 / b1 | a2 / b2 | bu | b0 |
  |---|---|---|---|---|---|
  | Non vitré (PP) | 0,85 | 11 W/m²K | 2,5 J/m³K | 0,04 s/m | 0,05 |
  | Vitré plan | 0,75 | 3,6 W/m²K | 0,014 W/m²K² | – | 0,12 |
  | Tubes sous vide | 0,55 | 1,1 W/m²K | 0,006 W/m²K² | – | 0 |

  Valeurs « typiques » choisies dans la fourchette des fiches Solar Keymark (surface brute) ; un capteur précis peut
  s'écarter de ±10 %. Pour un capteur non vitré, le vent compte autant que le rayonnement (b2 u ΔT, bu) ; un
  capteur PVT non vitré certifié TÜV/Solar Keymark donne par exemple η0 0,578, bu 0,028 s/m, b1 12,08 W/m²K,
  b2 1,842 J/m³K (Brottier, EuroSun 2018 ; η0 plus bas à cause des cellules).
- **Photovoltaïque** : P = kWc × G_plan / 1000 × (1 − 0,004 (Tc − 25 °C)) × (1 − 0,14) ; Tc = Ta + G_plan / (25 + 6,84 u)
  (Faiman 2008, valeurs par défaut de PVsyst / IEC 61853) ; 14 % de pertes du système = valeur par défaut de PVGIS
  (onduleur, câbles, salissures, mismatch) ; perte d'incidence b0 = 0,05.
- **Pompe à chaleur** : COP(Ta, Tw) = COP₁₅/₂₆ × (1 + 0,035 (Ta − 15) − 0,02 (Tw − 26)), borné à [1,5 ; 1,8 × COP₁₅/₂₆].
  Les fiches des pompes de piscine donnent deux points (air 15 °C / eau 26 °C et air 26 °C / eau 26 °C) ; le COP à
  26/26 vaut environ 1,3 à 1,5 fois celui à 15/26, soit 3 à 4 % par degré d'air. Le PV alimente la pompe dans l'heure,
  dans la limite de sa puissance (défaut : volume / 6 kW) ; pas de batterie.
- **Bilan** (`bilanSolaire`), pour chaque année :
  1. chauffage seul (piscine.js, consigne) → **besoin** par heure ;
  2. solaire (jusqu'à consigne + dépassement) puis appoint pour tenir la consigne → **appoint** ;
     **solaire** = besoin − appoint (gain net, il tient compte des pertes plus fortes d'une eau plus chaude) ;
  3. solaire seul, sans appoint → température de l'eau par semaine, jours ≥ 25 °C ; potentiel des capteurs (ce
     qu'ils donneraient à la température de l'eau, sans arrêt) ;
  4. PV : production de l'année entière (kWh/kWc), pour comparer aux références.

  Par mois : médianes des années ; part couverte = 1 − appoint / besoin. Économie : capteurs = solaire ÷ COP de
  l'appoint (réglage du chauffage) × prix ; PV = (électricité de la pompe sans solaire − électricité du réseau avec
  solaire) × prix. La production PV non utilisée par la piscine (maison, injection) n'est pas comptée.
- Le solaire tourne aussi pendant les 15 jours de mise en eau avant l'ouverture : il réduit la mise en température.

### Valeurs obtenues à Lutry (piscine E 2542730 N 1152253, 51 m², Pully 2010–2025, consigne 26 °C, bâche la nuit)

Besoin de la saison 12 400 kWh (dont 1 300 kWh de mise en température), surtout en mai et septembre.

| Installation | Solaire | Part couverte | Économie | Contrôle |
|---|---|---|---|---|
| 31 m² non vitrés, toit saisi 30° sud | 6 200 kWh | 48 % (41–60 %) | CHF 460 | potentiel 429 kWh/m² mai–sept. (848 kWh/m² sur le plan) |
| 31 m² non vitrés, pan de la maison (50 m², 28°, orienté 20° SSO, au soleil 75 %) | 5 800 kWh | 45 % (38–57 %) | CHF 440 | potentiel 390 kWh/m² |
| 5 kWc PV + pompe COP 5, même pan | 7 800 kWh | 63 % (56–72 %) | CHF 480 | 1 134 kWh/kWc par an |

Sans appoint, jours avec une eau ≥ 25 °C (année médiane) : 32 sans chauffage, 93 avec les capteurs, 106 avec le PV
(pompe limitée à 13 kW). Essai Node sans ombre (40 m², toit 30° sud) : potentiel 393 kWh/m² (non vitrés),
496 (vitrés plans), 414 (tubes) ; PV 1 233 kWh/kWc par an.

Comparaison : 250 à 400 kWh/m² par saison pour des absorbeurs non vitrés en Suisse (ordre de grandeur demandé) ;
SPF : 300 à 400 kWh/m²·an pour des capteurs non couverts à basse température sur le Plateau, 267 kWh/m² mesurés
sur une installation PVT non couverte (piscine + sondes) ; PV en Suisse romande : environ 1 000 à 1 200 kWh/kWc par an
(PVGIS). Le **potentiel** du modèle est dans ces fourchettes ; la part **utile** est bien plus basse (≈ 190 kWh/m²)
parce qu'en juillet–août la piscine de Lutry n'a presque pas besoin de chaleur : c'est le résultat le plus utile
au propriétaire (le solaire sert surtout à allonger la saison).

### Limites (affichées)

Valeurs de capteur typiques, pas celles d'un produit ; rayonnement d'une station à quelques km ramené au plan par un
modèle isotrope (le diffus circumsolaire est sous-estimé, quelques % sur un toit sud) ; vent sur le toit estimé ;
régulation idéale ; pompe de circulation, inertie des capteurs, pertes nocturnes des conduites non comptées ; pan de
toit reconnu sur une grille de 0,5 m (surface ±10 %) ; avec un toit saisi, seule l'ombre du relief lointain est
comptée. Estimation pour comparer, pas un dimensionnement.

### Sources

- EN ISO 9806:2017, *Solar energy — Solar thermal collectors — Test methods* (modèle des capteurs non vitrés avec
  vent et infrarouge) : https://www.iso.org/standard/67978.html ; ISO 9806-3:1995 (capteurs non vitrés) :
  https://standards.iteh.ai/catalog/standards/iso/d86c1b25-45eb-4e6d-9ae3-a7db373d3b0e/iso-9806-3-1995
- Base de données Solar Keymark (fiches de capteurs certifiés) : https://solarkeymark.eu/database/ ; exemples de
  fiches (capteurs plans vitrés) : https://www.dincertco.de/logos/011-7S2939%20F.pdf
- Brottier L. et al. (2018), EuroSun 2018, capteurs PVT non vitrés chauffant une piscine extérieure (paramètres
  certifiés selon les règles Solar Keymark, ISO 9806:2013) :
  https://proceedings.ises.org/conference/eurosun2018/papers/eurosun2018-0030-Brottier.pdf
- Zenhäusern D., Bamberger E., Baggenstos A. (2017), *PVT Wrap-Up*, SPF Rapperswil pour SuisseEnergie (rendements des
  capteurs non couverts en Suisse, chauffage de piscine) : https://pubdb.bfe.admin.ch/en/publication/download/9455
- Molineaux B., Lachal B., Guisan O. (1994), *Thermal analysis of five outdoor swimming pools heated by unglazed solar
  collectors*, Solar Energy 53 (doi:10.1016/S0038-092X(94)90600-9) : https://www.osti.gov/scitech/biblio/6990794
- Bartelsen B., Rockendorf G., Sillmann R. (1996), *Charakterisierung von Schwimmbad-Absorbern*, ISFH (dépendance au
  vent) : https://www.osti.gov/etdeweb/biblio/380501
- Matériau des absorbeurs (PP), IEA SHC Task 39 : https://www.iea-shc.org/Data/Sites/1/publications/Task39-C1--Polypropylene-absorber-materials--Wallner_Povacz.pdf
- Règle de surface : U.S. DOE, *Solar Swimming Pool Heaters* (50 à 100 % de la surface du bassin) :
  https://www.energy.gov/energysaver/solar-swimming-pool-heaters ; Baunetz Wissen, *Schwimmbadabsorber* (moitié à
  totalité, 0,8 m²/m²) : https://www.baunetzwissen.de/solar/fachwissen/solarkollektoren/schwimmbadabsorber-165870 ;
  OKU, tableau 50 à 90 % selon la pente, +50 % sans bâche :
  https://www.pool-systems.de/out/media/Prospekt_OKU_Pool_Solarheizung(13).pdf
- PVGIS (JRC), pertes du système 14 % par défaut : https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en
- Faiman D. (2008), *Assessing the outdoor operating temperature of photovoltaic modules*, Progress in Photovoltaics
  16 (doi:10.1002/pip.813).
- Pompes à chaleur de piscine, COP à 15/26 et 26/26 : fiches Poolex (https://poolstar.fr/en/produit/heating-pump-poolex-jet-pro) ;
  essais des pompes air-eau, Centre de test des pompes à chaleur, OST Buchs :
  https://www.ost.ch/fileadmin/dateiliste/3_forschung_dienstleistung/institute/ies/wpz/luft-wasser-waermepumpen/pruefresultate_lw_29052026.pdf

## Gratuit / Pro

- Gratuit : heures par semaine, carte de la piscine, ensoleillement réel par mois, semaines au-dessus / en dessous de
  25 °C.
- Pro (`#outilsPiscinePro`, verrou de `pro.js`) : courbe exacte, jours ≥ 25 °C, chauffage et coût, chauffage solaire,
  PDF A4 (police Inter, OFL, `public/polices/` ; page 3 pour le solaire si une installation est choisie).

## Limites (affichées)

Estimation, ±1 à 2 °C sur la moyenne d'une semaine ; vent au niveau de l'eau estimé ; baigneurs, filtration, pluie,
feuilles, stratification non modélisés ; arbres opaques toute l'année ; station à quelques kilomètres. Pas un
dimensionnement de chauffage. Pas encore de validation sur des relevés réels.
