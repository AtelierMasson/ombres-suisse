# Modéliser un pont (v2) : relevé laser + photos

Niveau de détail de swissBUILDINGS3D : on doit reconnaître la forme générale (arches ou piles, leur nombre, leur place,
leur taille et forme grossière, l'épaisseur du tablier). Pas de détail fin. Précision ~1 m.

## Ce que tu as déjà (ne le recherche pas)
Un résumé du relevé laser swisstopo autour du pont (fichier indiqué dans ta mission) : l'axe mesuré du tablier (bouts
en MN95), sa longueur et sa largeur, puis tous les 4 m le dessus et le dessous du tablier, le terrain, l'eau, et les
points trouvés sous le tablier (piles, arcs). C'est la source de vérité pour la géométrie et les altitudes.
Limite : le laser vient d'en haut ; sous un tablier large, les arcs et piles fines sont peu ou pas touchés.

## Ce que tu cherches
Le type de pont et ce que le laser ne voit pas : arc ou poutre, voûtes en pierre, forme des piles (rectangulaires,
rondes, élargies en bas), arc sous le tablier. Pour cela : une ou deux recherches web (nom du pont + lieu), puis
**regarde 1 à 3 photos** : télécharge l'image (jpg/png, < 2 Mo, de Wikimedia Commons ou d'une page publique) dans
/private/tmp/ponts-photos/ avec curl, puis ouvre-la avec l'outil Read pour la voir. N'installe rien.
Si tu ne trouves pas de photo, déduis le type du résumé (piles nettes et régulières = pont à poutres sur piles).

## Sortie
Le même JSON que dans outils/ponts/consigne.md (lis seulement sa section « Sortie »), avec l'axe repris du résumé
(les deux bouts, altitudes = colonne chaussee) et `s` compté depuis le premier bout du résumé.
Ajoute "photos_vues": <nombre> au JSON.
