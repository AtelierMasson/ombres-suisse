# Arbres : essences (conifère, feuillu, mélèze) et points cachés

Code : `src/arbresEspeces.js` (appelé par `nuagePoints` dans `src/maillages.js`) ; teintes dans le shader `SOMMETS`
(`maillages.js`) ; degré de mélange LFI lu par `affinerParMelange` (appelé par `Scene3D.construire`).
Case à cocher : Affichage → « Essences des arbres » (`DEGRADE.especes`).

## Ce qui existait avant (27.11.2026)

- **Aucune classification** : tous les points de végétation avaient la même teinte de base, dégradé du thème
  `T.arbres = [c1 ombre, c2 lumière, c3 accent]` selon la hauteur dans la couronne (`aRel`).
- **Petites taches de variation** : `aVar = 0,75 · bruit de valeur lisse (cellule de 7 m) + 0,25 · aléa par point`.
  Le bruit donne des plaques d'environ un arbre qui tirent vers l'accent `c3` ; l'aléa module la clarté point par point.
  Elles sont gardées telles quelles, par-dessus les nouvelles teintes.
- `aCache` (vue en plan seulement) : point retiré si le plus haut point de sa case de 0,5 m est plus d'1 m au-dessus.
- Un seul objet `THREE.Points` pour toute la maquette : jamais écarté par three.js (sa sphère englobe tout).
- Les ombres des arbres viennent de la **canopée en grille** (`canopee()`), pas des points ; l'ensoleillement aussi
  (grilles `G.veg`). Les points ne portent pas d'ombre (`castShadow` faux). Retirer des points à l'affichage ne change
  donc ni les ombres ni les calculs.

## 1. Arbres un par un

Sur une grille de 1 m (2 × 2 cases de la grille de 0,5 m) :

1. Modèle de canopée `chm` = hauteur de la végétation au-dessus du sol (max de `G.veg − G.sol`), lissé légèrement
   (moitié valeur propre, moitié moyenne 3 × 3).
2. Sommets : maxima locaux ≥ 3 m, fenêtre de ±1 m (arbre < 8 m), ±2 m (< 18 m), ±3 m au-delà.
3. Couronnes : croissance de région depuis les sommets, du plus haut au plus bas (file par paliers de 25 cm), arrêtée
   sous 1,5 m, sous 30 % de la hauteur du sommet, en remontant de plus de 0,5 m, ou au-delà du rayon
   `0,25 · H + 1,5 m` (2,5 à 9 m). Les bords encore libres sont rattachés à la couronne voisine (2 m au plus).

Coût mesuré (navigateur, machine chargée) : 4,6 M points au Jorat ≈ 0,55 s, dont 0,02 s pour la segmentation ;
0,75 M points à Lutry ≈ 0,1–0,15 s. Tout est fait une fois, au chargement, dans `nuagePoints` (synchrone, pas de fil
de calcul : les tableaux sont encore là, les points ne sont copiés qu'une fois).

## 2. Indices de forme

Le relevé swissSURFACE3D est fait **sans feuilles** (voir `docs/recherche-arbres.md`, § 0 et § 3).

| Indice | Calcul | Conifère | Feuillu (hiver) |
|---|---|---|---|
| `pente` | descente moyenne du `chm` entre 1,5 et 2,5 m du sommet, en m par m | cône pointu : forte | dôme : faible |
| `prof` | part des points de l'arbre à plus de 2,5 m sous le dessus de leur case de 0,5 m | arrêt du laser près de la surface | retours dans tout le volume (branches) |
| `H` | hauteur du sommet | — | — |

Les deux indices dépendent de la hauteur (un grand conifère laisse aussi passer le laser loin sous son sommet), d'où
une régression logistique avec interactions, calée sur les arbres de forêts « pures » selon le degré de mélange LFI
(≤ 15 % de feuillus = conifère, ≥ 85 % = feuillu), classes équilibrées :

```
p = min(pente, 3) (1 si inconnue), lh = ln(clamp(H, 3, 45))
L = 6,29 − 4,31 p − 25,1 prof − 0,786 lh + 1,72 p·lh + 4,57 prof·lh      (borné à ±4 ; 0 sous 12 points)
```

Bien classés **par la forme seule** (sans a priori), arbres de forêts pures :

| Lieu | conifères | feuillus |
|---|---|---|
| Jorat (pessière, ~860 m) | 77 % (1 026) | 92 % (669) |
| Lutry (bord du lac, parcs et vallons) | 77 % (39) | 69 % (215) |
| Sihlwald (hêtraie, ~670 m) | 73 % (51) | 77 % (1 332) |

C'est l'ordre de grandeur attendu (~80 %) pour un relevé hiver à cette densité. L'intensité et le nombre de retours
ne sont pas lus par `nuage.worker.js` (seulement X, Y, Z, classe) : ils pourraient améliorer `prof`, mais il faudrait
toucher au chargement du nuage.

Ce qui n'a pas marché seul : la pente (à Lutry les grands feuillus ont un sommet plus « pointu » que les petits
conifères d'ornement) ; la pénétration seule (au Jorat, conifères et feuillus ont la même, ~0,55).

## 3. A priori

- **Altitude** (pied de l'arbre) : `p(conifère) = 0,25 + 0,67 / (1 + exp(−(alt − 1100) / 150))`, soit ~0,26 en
  plaine, 0,58 à 1 100 m, 0,84 à 1 400 m, 0,91 au-delà de 1 600 m.
- **Degré de mélange LFI** (`ch.bafu.landesforstinventar-waldmischungsgrad`, BAFU/WSL, Sentinel, 10 m, valeur =
  part de feuillus en %, −128 hors forêt). Lu directement dans le COG de data.geo.admin.ch
  (CORS ouvert, requêtes par plages : en-tête une fois par session, puis une fenêtre de 60 × 60 px par lieu, quelques
  dizaines de Ko, ~0,2–0,3 s). Remplace l'a priori d'altitude **en forêt** dès qu'il arrive ; l'attribut est mis à
  jour sans reconstruire. Vérification : Sihlwald ≈ 99 (hêtraie), Jorat et Engadine ≈ 0–5 (résineux).
- Décision : `p = sigmoïde(logit(a priori) + L)` ; conifère si `p ≥ 0,5`.
- **Mélèze** : conifère qui perd ses aiguilles, donc « feuillu » pour le laser d'hiver. Mais en montagne le relevé
  est souvent fait en été (neige) : à Zermatt et en Haute-Engadine, presque tous les arbres ont la forme d'un conifère
  (`L > 0` pour 98 %). Règle retenue, au-dessus de 1 400 m (ou de 1 250 m dans une forêt à moins de 30 % de feuillus
  selon le LFI), où les vrais feuillus sont rares : un arbre à forme de feuillu ou un conifère à couronne peu dense
  (`L < 1`, environ le quart des arbres en Haute-Engadine) est classé mélèze (couronne claire et ajourée).
  **Heuristique non vérifiée** : pas de carte des mélèzes à disposition.
- Hors couronne (haies, buissons < 3 m) : essence la plus probable à l'altitude du lieu.

Proportions obtenues (arbres, après le degré de mélange) :

| Lieu | altitude | arbres | conifères | feuillus | mélèzes |
|---|---|---|---|---|---|
| Lutry (parcelle 265) | ~600 m | 759 | 342 (45 %) | 417 (55 %) | 0 |
| Jorat | ~860 m | 3 005 | 1 572 (52 %) | 1 433 (48 %) | 0 |
| Sihlwald | ~670 m | 1 906 | 256 (13 %) | 1 650 (87 %) | 0 |
| Haute-Engadine (Celerina) | ~1 850 m | 3 179 | 2 362 (74 %) | 0 | 817 (26 %) |

Avant le degré de mélange (altitude seule + forme) : Lutry 289 / 470, Jorat 929 / 2 076 : le LFI corrige
nettement le Jorat (pessière). Le tirage des points affichés (1 sur 2) varie un peu d'un chargement à l'autre :
±1–2 % sur ces nombres.

## 4. Teintes

Toutes tirées du thème (`scene.T.arbres`), dans le shader : base `mix(c1, c2, aRel)`, puis
- conifère : vers `c1` (30–55 %), × (0,84 ; 0,95 ; 1,10) → plus sombre, bleuté ; accent `c3` réduit à 30 % ;
- feuillu : un peu vers `c2` (0–20 %), vers `c3` (6–22 %), × (1,03 ; 1,02 ; 0,93) → plus clair, plus jaune ;
- mélèze : vers `c3` (34–52 %), × (1,05 ; 1,04 ; 0,88) → vert tendre ; accent à 50 % ;
- chaque arbre : clarté × 0,9–1,1 et dosage ci-dessus tirés de sa teinte propre (hachage du numéro d'arbre) ;
- puis les petites taches `aVar` comme avant.

Forme : les points d'un conifère sont rapprochés de l'axe de l'arbre, de 0 % au pied à 12 % au sommet (silhouette
plus effilée). Les ombres (canopée) ne changent pas.

Attribut `aEsp` : un octet signé par point, `±(1 + 40 · essence + teinte 0..39)`, négatif = point enfoui. Les points
sans cet attribut (arbres swisstopo du vol, arbres de l'anneau) lisent 0 et gardent l'ancienne teinte.

## 5. Points non dessinés (comme dans les jeux vidéo)

Les ombres et l'ensoleillement ne passent pas par les points (canopée en grille) : rien ne change pour eux.

1. **Points enfouis** (`aEsp < 0`) : au cœur d'une couronne dense, cachés de tous côtés. Deux étapes :
   - colonnes de 1 m (dessus, dessous, nombre de points) : point ≥ 2 m sous les dessus de son voisinage 3 × 3,
     ≥ 1 m au-dessus du bas de sa colonne, colonnes denses (≥ 5 points), et dans chacune des 8 directions une paire de
     colonnes (sur 4 m) qui l'enjambent ;
   - puis par voxel de 1 m (occupation tirée des points) : au moins un voxel occupé sur 5 m le long de 24 rayons
     (8 azimuts × horizontal, ~30° et ~55° en montant), 2 voxels occupés au-dessus et 1 au-dessous dans sa colonne
     (les couronnes sans feuilles sont creuses : une colonne qui enjambe ne suffit pas).
   - Dans le shader : pas dessinés si la caméra est à plus de **40 m** (`MARGE_ENFOUIS`) ; toujours dessinés en coupe
     (plans de coupe actifs) ; case « Essences » sans effet sur ce tri (`DEGRADE.cacherEnfouis`).
2. **Tuiles** : points rangés par tuiles carrées (≤ 8 × 8, ≥ 40 m de côté, ≥ ~80 000 points), visibles puis enfouis
   dans chaque tuile. Chaque tuile est un enfant `THREE.Points` qui partage les attributs (un seul tampon sur la carte
   graphique) et le matériau, avec sa propre sphère englobante : three.js l'écarte hors du champ. Les enfouis d'une
   tuile ne sont même pas envoyés (`drawRange`) si la tuile entière est à plus de 40 m de la caméra.
3. **Allègement au loin par tuile** : le shader gardait déjà, au loin, une part des points seulement (plus gros), mais
   chaque point passait quand même dans le shader. Les points visibles de chaque tuile sont maintenant mélangés une
   fois et numérotés (`aRang`, un octet) : le shader garde ceux de rang < part gardée, et la tuile n'envoie que le
   début de sa liste (part gardée à son point le plus proche). Même image, beaucoup moins de sommets traités.
   Sans effet en vue en plan, en élévation (caméra orthographique) et en coupe.
4. Relief / horizon : pas fait (la maquette fine fait 300–600 m ; l'anneau et le paysage ont leur propre chargement).
   Le terrain n'est pas découpé en tuiles non plus : il est en cours de refonte (`terrainTIN.js`).

### Vérification « pas de trou »

Image rendue avec et sans (même caméra, sans effets), pixel par pixel : part des pixels dont l'écart dépasse 24
niveaux sur R + V + B. Les écarts restants sont des points isolés d'un pixel, invisibles à l'œil (capture de la
différence en rouge : rien de lisible à 100 %).

| Lieu, vue | sommets envoyés (avant → après) | pixels qui changent |
|---|---|---|
| Lutry, vue de départ | 0,75 M → 0,51 M (−33 %) | 0,02 % |
| Lutry, de haut | 0,75 M → 0,41 M (−46 %) | 0,01 % |
| Jorat, vue de départ | 4,56 M → 1,45 M (−68 %) | 0,09 % |
| Jorat, basse | 4,56 M → 1,75 M (−62 %) | 0,07 % |
| Jorat, de haut | 4,56 M → 1,27 M (−72 %) | 0,15 % |
| Jorat, rasante | 4,56 M → 1,66 M (−64 %) | 0,03 % |
| Jorat, caméra dans la forêt (2 m du sol, 4 directions) | −71 à −82 % | 0 à 0,002 % |
| Jorat, coupe active | 4,56 M → 3,58 M | 0 % |
| Sihlwald, vue de départ | 9,14 M → 3,41 M (−63 %) | 0,07 % |
| Sihlwald, basse | 9,14 M → 3,73 M (−59 %) | 0,04 % |
| Sihlwald, de haut | 9,14 M → 2,59 M (−72 %) | 0,08 % |
| Sihlwald, rasante | 9,14 M → 3,53 M (−61 %) | 0 % |

Réglage des points enfouis : avec 2 voxels par rayon au lieu d'un, aucun pixel ne change mais il y a 10 fois moins
de points enfouis ; avec le seul test par colonnes, 0,8 % des pixels changent (taches visibles sous les couronnes en
bord de forêt).

### Temps d'image

Rendu complet (`Scene3D.rendre`, effets compris) synchronisé par `readPixels`, médiane de 5 à 9 séries ; « arbres » =
temps avec arbres − temps sans arbres. Mesures dans un onglet partagé avec d'autres (bruit de ±0,2 ms).

| Lieu, vue | image avant → après | arbres avant → après |
|---|---|---|
| Lutry, vue de départ | 3,11 → 3,07 ms | 0,48 → 0,44 ms |
| Lutry, basse | 2,43 → 2,38 ms | 0,38 → 0,33 ms |
| Jorat, vue de départ | 5,24 → 4,69 ms (−10 %) | 2,12 → 1,57 ms (−26 %) |
| Jorat, basse | 4,39 → 3,81 ms (−13 %) | 1,75 → 1,17 ms (−33 %) |
| Jorat, rasante | 4,29 → 3,72 ms (−13 %) | 2,09 → 1,52 ms (−27 %) |
| Sihlwald, vue de départ | 6,57 → 5,47 ms (−17 %) | 3,84 → 2,74 ms (−29 %) |
| Sihlwald, basse | 5,42 → 4,37 ms (−19 %) | 3,20 → 2,15 ms (−33 %) |

Le reste du coût des arbres est surtout celui des pixels (disques qui se recouvrent), pas des sommets. À Lutry les
arbres coûtent peu ; le gain y est faible (d'où le minimum de ~80 000 points par tuile : chaque tuile est un appel de
dessin, 50 tuiles coûtaient plus au processeur qu'elles n'épargnaient).

### Coût au chargement

`preparerArbres` (synchrone, dans `nuagePoints`) : ~0,1–0,15 s à Lutry (0,75 M points), ~0,5 s au Jorat (4,6 M), 1 à
2 s au Sihlwald (9,1 M) selon la charge de la machine ; détail par étape dans `bilan.etapes`. Si c'est trop long sur
les grands lieux, la suite logique est de le déplacer dans un fil de calcul (il travaille sur des tableaux typés).
