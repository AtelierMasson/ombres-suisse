# Piscine : ensoleillement et température de l'eau — méthode

Section « Piscine » de l'onglet Soleil (27.11.2026). Code : `src/zonesSoleil.js` (interface), `src/masques.worker.js`
et `src/semaines.js` (ombres), `src/climat.js` (MétéoSuisse), `src/piscine.js` (bilan thermique, testable dans Node),
`src/graphiquesPiscine.js`, `src/exportZones.js` (PDF Pro). Plan d'origine : `docs/plan-ensoleillement-zones-piscine.md`.

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

## Gratuit / Pro

- Gratuit : heures par semaine, carte de la piscine, ensoleillement réel par mois, semaines au-dessus / en dessous de
  25 °C.
- Pro (`#outilsPiscinePro`, verrou de `pro.js`) : courbe exacte, jours ≥ 25 °C, chauffage et coût, PDF A4 (police
  Inter, OFL, `public/polices/`).

## Limites (affichées)

Estimation, ±1 à 2 °C sur la moyenne d'une semaine ; vent au niveau de l'eau estimé ; baigneurs, filtration, pluie,
feuilles, stratification non modélisés ; arbres opaques toute l'année ; station à quelques kilomètres. Pas un
dimensionnement de chauffage. Pas encore de validation sur des relevés réels.
