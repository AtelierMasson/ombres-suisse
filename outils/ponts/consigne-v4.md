# Modéliser un pont (v4) : un pont par mission, économe, vérifié au nuage et à la photo

Référence de précision : `outils/ponts/modeles/poya.json` (pont de la Poya). Schéma complet des champs : section
« Sortie » de `outils/ponts/consigne-v3.md` (lis seulement cette section) et l'en-tête de `src/pontsModeles.js`
(commentaires uniquement, pas le code). Méthode détaillée et pièges : `outils/ponts/METHODE.md` (déjà résumée ici).

## Économie (obligatoire)
- Ne lis pas d'autres fichiers du dépôt que ceux nommés ici. Ne recopie pas le résumé du relevé dans ta réflexion :
  lis-le avec `sed -n`/`awk` par tranches utiles (bouts, piles, terrain).
- Recherche web : 3 requêtes au plus. Photos : **au moins 2, de côtés différents** (niveau A : 2 à 4 ; niveau B : 1 à 2), < 1,5 Mo chacune,
  Wikimedia Commons de préférence ; ouvre-les avec Read. Pont au-dessus d'une autoroute ou d'une route : cherche en
  priorité une vue prise depuis la chaussée dessous (Commons, catégorie du pont ou de la route ; Mapillary si un
  jeton est fourni dans `MAPILLARY_TOKEN`). Pas d'images Google Street View (conditions d'utilisation).
- Pas de navigateur au niveau B. Au niveau A, un seul onglet à toi (jamais l'onglet « seed »), fermé à la fin.

## Étapes
1. **Relevé** : `node outils/ponts/preparer.mjs E N [rayon] > outils/ponts/resumes/<id>.txt` (rayon ≈ demi-longueur +
   60 m, 150 par défaut ; avec un axe TLM fourni : `preparer_axe.mjs`). Le relevé est la vérité pour l'axe, les
   altitudes, la longueur, la place des piles. Un résumé trop court ou qui attrape un pont voisin : relance avec un
   autre centre/rayon (2 essais au plus). Pas de points classe 17 du tout (vieux pont couvert, petit ouvrage) : modèle
   depuis l'axe TLM, les altitudes du terrain et les photos, `confiance` « faible ».
2. **Sources et photos** : type, portées, nombre et forme des piles/arches/pylônes, matériaux. Regarde chaque appui
   **au-dessus, en dessous et à côté du tablier**.
3. **Modèle** dans `outils/ponts/modeles/<id>.json`, au style du pont (voir tableau). **D'abord caler le modèle sur
   le nuage** (axe, altitudes, largeur, place et taille des piles, hauteur du toit ou des pylônes : points classes
   17, 6, 1, 26 et 27 du couloir (26/27 : piles et dessous d'ouvrage dans les relevés récents) ; un pont couvert est souvent classé « bâtiment », 6), **ensuite seulement les photos** pour
   la forme. Un pont couvert : tablier, parois, toiture à deux pans et dessous **ouvert entre les piles** (jamais un
   bloc plein jusqu'à l'eau). Puis
   `python3 outils/ponts/ajouter.py outils/ponts/modeles/<id>.json`.
4. **Nuage** : `node outils/ponts/verifier_nuage.mjs outils/ponts/modeles/<id>.json ~/Downloads/ombres-suisse-donnees/ponts-verif/<id>.png`.
   Cibles : tablier médiane à ±0,2 m ; ≥ 85 % des points d'ouvrage à < 1,5 m du modèle ; **« Terrain de la maquette :
   aucun conflit »** ; **aucune pile au-dessus du sol**. Corrige et relance (3 tours au plus). Un conflit de terrain
   qui reste (sol de la maquette qui traverse le tablier, p. ex. rue ou bâtiment sous un viaduc urbain) : note les `s`
   dans `notes`, ne le cache pas en déformant le pont. L'application abaisse le sol sous le tablier jusqu'aux pieds
   des piles et naissances d'arches ; là où l'ouvrage est réellement rempli (arches murées ou enterrées, vallée
   remblayée), indique les tronçons dans `"remblai": [[s0, s1], …]` pour que le sol y reste.
5. **Photo calée (niveau A seulement)** : `calage.json` (6–10 points), `python3 -I outils/ponts/caler_photo.py …`
   (> 15 px de résidu = point à corriger), rendu dans ton onglet
   (`http://localhost:5174/#e=E&n=N&t=Voyage`, puis `await import('/outils/ponts/rendu_cale.js')` et `renduCale(…)` ;
   le récepteur du port 5391 tourne déjà, ne le relance pas ; `renduCale` attend la maquette du relevé, passe
   `sansArbres: true` si des arbres masquent l'ouvrage ; il refuse une caméra sous le terrain : choisis des points de calage
   à des altitudes variées — pieds de piles et sommets, pas seulement le tablier), `superposer.py`. Lis les écarts élément par élément
   (pylônes, têtes et pieds de piles, épaisseur du tablier, arcs), corrige, 2 tours au plus.
   Fichiers : `~/Downloads/ombres-suisse-donnees/ponts-photos/<id>/` et `…/ponts-comparaisons/<id>.jpg`.
   **Obligatoire au niveau A** : si les photos sont des gros plans, cherche une vue d'ensemble (Commons catégorie du
   pont, structurae, site de la ville ou du canton) ; 6 points suffisent (bouts du tablier, têtes de piles, clés
   d'arcs, sommets de pylônes). Ne saute cette étape que si aucune vue d'ensemble n'existe, et dis-le.

## Pas de COPC (Berne 2023, Landwasser 2020…)
`preparer.mjs`/`verifier_nuage.mjs` répondent « pas de nuage COPC » : cherche une autre année en COPC dans le STAC v1
(`ch.swisstopo.swisssurface3d`, items de la même tuile) ; sinon lis seulement la tuile LAS/LAZ utile avec
`python3 outils/ponts/zip_distant.py <url>` (téléchargement partiel) ; en dernier recours modèle depuis l'axe TLM,
swissALTI3D et les photos, `confiance` « faible », et écris « non vérifié au laser » dans `notes`.
**Disque** : les dalles LAS/LAZ/ZIP et les tableaux `.npy` téléchargés ou extraits (souvent 0,3 à 2 Go par pont) sont
**supprimés dès que le pont est vérifié** ; ne garde que le JSON du modèle, les photos, le calage et les images. Le disque
de la machine est presque plein.

## Au style du pont
| Type | Ce qui compte |
|---|---|
| Voûtes en maçonnerie | arches `forme: "cintre"`, `plein: true`, piles à avant-becs (`sections`, `nez_*`), parapet plein, `materiau: "pierre"` |
| Poutre / caisson béton | épaisseur variable (`epaisseur_appuis`, `gousset`), sous-face, piles (forme exacte) |
| Haubané / extradossé | pylônes, haubans (nappe, nombre, ancrages), tablier mince |
| Arc béton ou acier | arc (naissances, clé, nervures), montants (pas, épaisseur), tablier porté ou suspendu |
| Treillis, suspendu | `elements` (membrures, câbles) au plus simple qui reste reconnaissable, `materiau: "acier"` |
| Couvert en bois | `toits`, `parois` (façades, ouvertures), `volumes` (pavillons), `bois` / `tuile` / `pierre` |
| Passerelle | tablier mince, garde-corps ajouré, appuis fins |

**Piles et pylônes : un seul volume sculpté** par appui (fût, tête, pied, jambes qui se rejoignent), jamais des boîtes
empilées qui se touchent. Utilise la forme sculptée du schéma telle que dans `poya.json`. Niveau B : piles simples
(`rect`, `rond`, `double`) mais aux bonnes proportions.

**Formes libres (v5, détail dans METHODE.md)** : `sections` (piles, pylônes, `volumes` : rect, rond, ogive, chanfrein,
poly, avant-becs `nez_amont`/`nez_aval`, fruit par les sections), `sections_tablier` (corniches, caisson, consoles),
`toits` (deux pans, pignons/croupes, élargissements en pyramide), façades (`parois` : `ouvertures`, `soubassement`,
`z_haut`), `materiau` par partie (beton, acier, bois, pierre, tuile, verre). Niveau A : estime les faces au nuage avec
`CACHE=… node outils/ponts/sections_nuage.mjs <modele> pile <s>` (et `tablier`) avant les photos ; complète sur photo ce
que l'outil déclare non vu. Regarde la forme des piles et de ce qui est au-dessus (arrondi, pointu, pyramidal) et
celle des façades d'un pont couvert sur au moins deux photos.

## Niveaux
- **A** (pont connu, ouvrage d'art) : toutes les étapes, précision de la Poya.
- **B** (pont urbain ordinaire, passerelle) : étapes 1–4, une photo si elle existe (sinon l'orthophoto suffit :
  `https://wms.geo.admin.ch/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=ch.swisstopo.swissimage&CRS=EPSG:2056&BBOX=E0,N0,E1,N1&WIDTH=800&HEIGHT=800&FORMAT=image/jpeg`),
  ~15 appels d'outils par pont.

## À rendre (dernier message, données brutes)
`id`, `fichier`, `nom` réel trouvé, `type`, `confiance`, `tablier_mediane`, `pct_points`, `conflit_terrain`
(texte de la ligne du vérificateur), `calage_px` (A), `notes` (2 phrases : incertitudes, ce que le schéma ne sait pas faire).
Ne commite rien, ne pousse rien, ne publie rien.
