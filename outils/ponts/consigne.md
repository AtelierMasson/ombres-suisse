# Modéliser un pont, au niveau de détail de swissBUILDINGS3D

But : une description légère d'un pont réel suisse, assez juste pour qu'on reconnaisse sa forme générale
(arches ou piles, nombre et position des appuis, taille et forme grossière des piles, épaisseur du tablier).
Pas de détail fin : pas de garde-corps ajourés, pas de rivets, pas de décor. Précision visée : ~1 m en plan, ~0,5 m en hauteur.

## Sources autorisées
- Géodonnées publiques swisstopo (pas de clé) :
  - recherche : https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=<nom>&type=locations&sr=2056
  - objets de swissTLM3D (axe des routes/ponts) : https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&geometry=<e0>,<n0>,<e1>,<n1>&imageDisplay=500,500,96&mapExtent=<e0>,<n0>,<e1>,<n1>&tolerance=5&layers=all:ch.swisstopo.swisstlm3d-strassen&sr=2056&returnGeometry=true
  - altitude d'un point : https://api3.geo.admin.ch/rest/services/height?easting=<E>&northing=<N>&sr=2056
  - profil le long d'une ligne : https://api3.geo.admin.ch/rest/services/profile.json?geom={"type":"LineString","coordinates":[[E1,N1],[E2,N2]]}&sr=2056&nb_points=100
- Photos et descriptions publiques (Wikipedia, Wikimedia Commons, sites des communes ou de l'ingénieur, Street View si une
  page publique le montre). Les photos servent à compter les arches et piles et à estimer leurs proportions.
- Ne rien télécharger d'autre que des pages web et ces réponses d'API ; ne rien installer.

## Sortie : un seul fichier JSON (et rien d'autre)
Coordonnées MN95 (EPSG:2056), altitudes en m (NF02). `s` = distance le long de l'axe depuis son premier point.

```json
{
  "nom": "Pont Bessières, Lausanne",
  "axe": [[E, N, Z_chaussee], ...],          // 2 à 6 points, le dessus de la chaussée, d'une culée à l'autre
  "largeur": 12.0,                           // largeur totale du tablier (m)
  "epaisseur": 1.2,                          // épaisseur du tablier (chaussée -> dessous)
  "appuis": [                                 // culées et piles
    {"type": "culee", "s": 0},
    {"type": "pile", "s": 45.0, "forme": "rect", "long": 3.0, "larg": 10.0, "z_bas": 480.0, "fruit": 0.02},
    {"type": "culee", "s": 170.0}
  ],                                          // forme : "rect" | "rond" ; long = le long de l'axe ; larg = en travers ;
                                              // fruit = rétrécissement par mètre de hauteur (0 si droit)
  "arches": [                                 // vides sous le tablier en arc, s'il y en a (sinon [])
    {"s0": 3.0, "s1": 45.0, "z_naissance": 490.0, "z_cle": 505.0, "epaisseur": 1.5, "larg": 10.0, "plein": false}
  ],                                          // plein=true : maçonnerie pleine entre l'arc et le tablier (pont en pierre) ;
                                              // false : arc porteur seul (pont métallique ou béton à montants)
  "sources": ["url", ...],
  "confiance": "faible|moyenne|bonne",
  "notes": "une ou deux phrases sur ce qui est incertain"
}
```
