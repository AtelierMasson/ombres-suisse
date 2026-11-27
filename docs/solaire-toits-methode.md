# Panneaux solaires sur les toits : méthode, chiffres et sources

Onglet **Soleil**, section **Panneaux solaires**. Un clic sur un toit (bâtiment du relevé, ou volume dessiné du projet
Pro) donne les pans, une implantation de modules, la production avec les ombres réelles de la maquette et, en Pro,
le détail mensuel, le coût, la rétribution unique, l'autoconsommation et le temps de retour (PDF).

| Fichier | Rôle |
|---|---|
| `src/solairePV.js` | **Module commun de production PV** (sans DOM) : position du soleil, transposition, ombres, température, pertes, année type, autoconsommation, coût, rétribution unique, rentabilité. Réutilisable pour le chauffage solaire de piscine (PV + PAC). |
| `src/pansSolaires.js` | Pans d'un toit (relevé : `pans.js` ; volume dessiné : triangles du maillage) et implantation des modules. |
| `src/solaireToits.js` | Interface (section, clics, 3D, réglages, partie Pro). |
| `src/graphiquesSolaire.js` | Graphique mensuel (SVG) et vue de dessus du toit (canvas). |
| `src/exportSolaire.js` | PDF A4 deux pages (même socle que l'export piscine, `exportZones.js`). |
| `src/masques.worker.js` | Masques d'horizon (inchangé pour la piscine) ; option `plans` pour les toits. |
| `outils/solaire/normales.mjs` | Recalcule les moyennes mensuelles `NORMALES` depuis les CSV MétéoSuisse. |
| `tests/solairePV.test.mjs` | `node --test tests/solairePV.test.mjs` |

## 1. Pans du toit

- **Bâtiment du relevé** : on reprend les pans de `pans.js` (plans ajustés par moindres carrés sur la grille de 0,5 m du
  nuage de points, pentes ramenées dans l'axe des façades, pans coplanaires réunis). Le clic désigne un volume ; on prend
  tout le bâtiment (volumes qui se touchent, `volumes.js indexVolumes`). Pans de moins de 3 m² ou de plus de 65° écartés.
- **Volume dessiné (Pro)** : les triangles du toit de son maillage (`userData.faces = −1`) sont regroupés par plan
  (normales à moins de 2°, plans à moins de 5 cm) puis rastérisés sur la grille.
- Pour chaque pan : plan `z = a·x + b·y + d`, inclinaison `atan(√(a²+b²))`, azimut de la pente
  `atan2(−a, −b)` (depuis le nord, sens horaire), surface en plan et surface inclinée (`/cos β`).

## 2. Implantation des modules

- Module type 2025–2026 : **1,722 × 1,134 m, 420 Wc** (monocristallin 108 demi-cellules, ~21,5 %). Puissance réglable.
- Marge au bord du pan (défaut **0,5 m**, en plan, réglable) : le masque des cellules du pan est érodé d'un disque.
- **Toit en pente** : rangées alignées sur la pente, modules en portrait ou en paysage (on garde celui qui en place le
  plus), 2 cm entre modules, 16 décalages de grille essayés.
- **Toit plat** (< 5°) : rangées parallèles à la façade la plus proche du sud ; soit **sud 15°** (paysage, rangées
  espacées pour que le soleil à 18° passe au-dessus de la rangée de devant), soit **est-ouest 10°** dos à dos (plus de
  modules, moins de kWh par kWc).
- Chaque pan est activable ; un pan dont le rendement est inférieur à **750 kWh/kWc** n'est pas équipé d'office.

## 3. Ombres réelles

- Points de calcul : centres des cellules du pan (0,5 m ; un sur deux au-delà de ~1600 points), à 15 cm au-dessus du
  plan (40 cm sur toit plat), relevés jusqu'à 1 m si le relevé dépasse le plan (pan à ressaut).
- Pour chaque point, masque d'horizon dans 720 directions (pas de 0,5°) lu dans la grille des obstacles affichés
  (terrain, bâtiments, arbres, volumes du projet ; `masques.worker.js`, le même calcul que pour la piscine), combiné
  au relief lointain (`horizon.js`, jusqu'à 50 km).
- **Plan propre** : un obstacle qui ne dépasse pas le plan du pan de plus de 0,3 m + 5 % de la distance est ignoré.
  Un objet sous le plan des modules ne peut leur cacher que le soleil « de derrière », qui ne compte déjà pas
  (incidence > 90°) ; la tolérance absorbe le bruit du relevé (tuiles, chéneaux).
- Par champ (pan × orientation des modules) : part au soleil heure par heure d'une année type (`semaines.js
  partHoraire`, 4 positions par heure) sur les points **sous les modules**, et vue du ciel du plan incliné, ombres
  comprises (`vueCielInclinee` : intégrale de cos(incidence) sur le ciel visible, ramenée au plan horizontal dégagé).

## 4. Production

Pour chaque heure d'une série météo :

1. Global horizontal **G**, diffus **D** (mesuré ; sinon séparation d'Erbs), direct normal `DNI = (G − D) / sin h`.
2. Transposition **Hay–Davies** : direct `DNI·cos θ`, circumsolaire `D·Ai·cos θ / sin h` (`Ai = DNI/1367`), tous deux
   × part au soleil ; diffus isotrope `D·(1 − Ai)·vue du ciel` ; réfléchi `G·0,2·(1 − cos β)/2`.
3. Réflexion : modificateur ASHRAE `1 − 0,05·(1/cos θ − 1)` sur le direct, 0,95 sur le diffus.
4. Température des cellules `Tc = Tair + 0,03·POA` (modules posés sur toit, peu ventilés), puissance × `(1 − 0,0035·(Tc − 25))`.
5. **Pertes système 14 %** (onduleur, câbles, salissure, disparités : valeur par défaut de PVGIS).

Climat :

- **Gratuit** : année type reconstruite à partir des **moyennes mensuelles 2020–2025** de la station SwissMetNet de
  référence la plus proche parmi 12 (Bâle, Berne, Coire, Davos, Genève, Lugano, Lucerne, Neuchâtel, Pully, Sion, Zurich,
  Saint-Gall ; distance + 100 m de dénivelé = 10 km) : global du mois réparti selon un profil de ciel clair (Haurwitz),
  part diffuse mesurée du mois (moyenne de Bâle, Coire, Genève et Pully pour les stations qui ne la mesurent pas),
  température ± 4 °C sur la journée, corrigée de −0,65 °C/100 m. Aucun téléchargement.
- **Pro** (« Affiner avec les mesures horaires MétéoSuisse ») : séries horaires 2010–2025 de la station la plus proche
  (`climat.js`, déjà utilisé pour la piscine) ; production médiane et fourchette P10–P90 entre les années.

Vérification (Lutry, station de Pully, modules dégagés, même modèle sur les deux climats) :

| Orientation | Année type (kWh/kWc) | Mesures horaires 2020–2025 (médiane, P10–P90) |
|---|---|---|
| Sud 30° | 1285 | 1280 (1210–1327) |
| Horizontal | 1094 | 1092 |
| Est 30° | 1049 | 1017 |
| Nord 30° | 716 | 707 |
| Façade sud 90° | 877 | 869 |

L'année type reproduit les mesures horaires à 1–3 % près. Ordre de grandeur cohérent avec PVGIS-SARAH3 pour le
bassin lémanique (~1200–1300 kWh/kWc plein sud, pertes 14 %).

**Carte de chaleur** (gratuite) : irradiation annuelle sur le plan du toit en chaque point, `direct libre × part
directe du point + diffus du pan`, la part directe du point étant pondérée par un ciel clair (Meinel) et ramenée à la
moyenne du pan calculée avec la météo. Échelle fixe 400–1400 kWh/m²·an.

## 5. Économie (Pro)

| Grandeur | Valeur par défaut | Source |
|---|---|---|
| Coût d'installation | `min(1628·P + 5278 ; 681·P + 76265)` CHF HT, + TVA 8,1 % | SuisseEnergie (OFEN), *Observation des prix de marché photovoltaïque 2025*, Planair, rapport final du 3 août 2026, tableau 3 (régression 2025, installations ajoutées). Médianes 2025 : 2497 CHF/kW (2–10 kW), 1911 (10–30), 1428 (30–100), 1102 (100–300) HT. |
| Prix imposé | facultatif (CHF/kWc TTC) | offre d'un installateur |
| Rétribution unique (PRU/GRU) | contribution de base 0 ; < 30 kW : **360 CHF/kW** (intégrée 400) ; 30–100 kW : **300** (330) ; ≥ 100 kW : **250** ; par tranche ; dès 2 kW | OEneR annexe 2.1, taux dès le 1.4.2025 (OFEN, webinaire Swissolar « Nouvelles ordonnances dès 2025 », 5.12.2024) ; à vérifier sur le tarificateur de Pronovo. |
| Prix d'achat de l'électricité | **0,28 CHF/kWh** | ElCom, tarif médian 2026 du ménage type H4 : 27,7 ct/kWh (communiqué de septembre 2025) ; 2027 : −4 % annoncé. |
| Rétribution de l'injection | **0,08 CHF/kWh** | Dès 2026, reprise alignée sur le prix du marché avec un minimum fédéral (p. ex. 6 ct/kWh pour < 30 kW avec consommation propre, fiche tarifaire 2026 de SIP Paudex) ; les tarifs locaux varient (SiL Lausanne, BKW au prix spot dès mi-2026). À régler selon le gestionnaire de réseau. |
| Consommation | **4500 kWh/an** | ménage type H4 de l'ElCom |
| Autoconsommation | heure par heure | production horaire de l'année médiane × profil de ménage (pointes matin et soir, hiver +25 %, heure légale) ; sans batterie |
| Exploitation | **3 ct/kWh** produit | entretien, assurance, provision pour l'onduleur (ordre de grandeur EnergieSchweiz) |
| Dégradation, durée | 0,5 %/an, 30 ans | fiches techniques des modules |
| Déduction fiscale | taux marginal 0 % (réglable) | investissement déductible sur un bâtiment existant dans la plupart des cantons |

Résultats : coût brut, rétribution unique, économie d'impôt, coût net, autoconsommation (part de la production et
couverture de la consommation), injection, gain de la première année, **temps de retour** (cumul non actualisé),
bilan sur la durée, coût du kWh produit.

## 6. Gratuit / Pro

- Gratuit : pans, implantation, modules en 3D, **production annuelle approximative**, kWc, kWh/kWc par pan, **carte de
  chaleur** des pans (3D et vue de dessus).
- Pro : production **mois par mois**, mesures horaires MétéoSuisse et fourchette P10–P90, **coûts**, rétribution
  unique, autoconsommation, **retour sur investissement**, **PDF** A4.

Tout est activable : chaque pan (case), modules en 3D et carte de chaleur (interrupteurs), réglages mémorisés dans le
navigateur (`ombres.solaireReglages`).

## 7. Réutiliser le module commun (`solairePV.js`)

```js
import { positionsHoraires, productionPV, anneeType, normaleProche, vueCielInclinee } from "./solairePV.js";
const pos = positionsHoraires(lat, lon);
const series = monSeriesMeteoSuisse || anneeType(normaleProche(E, N, alt), pos);
// champ dégagé (f absent) ou ombré (f : part au soleil 365 × 24, p. ex. semaines.js partHoraire)
const r = productionPV(series, [{ kWc: 6, inclinaison: 30, azimut: 180, f, vue }], pos);
r.kWh.med; r.mois; r.horaire; // horaire : kWh de chaque heure (8760) de l'année médiane, p. ex. pour une PAC
```

## 8. Limites

- Résultats indicatifs : ni offre ni dimensionnement. Précision attendue ±10 % sur l'année pour un toit bien relevé.
- Les pans viennent du nuage de points (grille de 0,5 m) : lucarnes, fenêtres de toit, cheminées, zones protégées
  (ISOS, monuments) ne sont évitées que si le relevé les montre ; un pan à ressaut peut recevoir des modules à cheval.
- Pas de neige, de salissure particulière, d'ombres mutuelles des rangées sur toit plat (espacement calculé pour 18°),
  de limitation d'injection ni de batterie. Arbres opaques toute l'année.
- Implantation simple (rangées régulières) : un installateur fera mieux sur les formes compliquées.
- Prix, rétribution et tarifs changent : ils sont réglables (Pro) et datés ici (novembre 2026).
