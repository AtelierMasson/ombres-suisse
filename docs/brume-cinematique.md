# Brume cinématique — brouillard au sol et mer de brouillard

Mode « Brume cinématique » de l'onglet Affichage : il est coupé par défaut et le navigateur retient le réglage. Il est purement visuel : ni les ombres portées, ni le calcul d'ensoleillement, ni les clics ne voient la brume. Code : `src/brumeCinematique.js` ; branchement dans `src/scene.js` (morceaux `fog_*`, `rendre`) et dans `src/main.js` (une ligne).

## 1. Ce que font les jeux et les moteurs

| Technique | Principe | Coût GPU | Rendu | Mobile |
|---|---|---|---|---|
| **Zelda BotW / TotK** | Selon les analyses publiques (Digital Foundry, moddeurs), la brume se fait en deux couches : un brouillard « simple » toujours actif, qui délave les couleurs avec la distance, et un brouillard « de volume » fait de particules et de nappes locales. TotK y ajoute un système de nuages procéduraux que l'on peut traverser. Les mers de nuages vues d'en haut sont des surfaces et des cartes (billboards) texturées par du bruit, pas un vrai volume. Aucune source primaire de Nintendo ne décrit le détail : ce point reste à vérifier. | faible | très lisible, stylisé | Switch, donc oui |
| **Unreal : Exponential Height Fog** | Densité ρ(y) = ρ₀·e^(−(y−y₀)/H), intégrée **analytiquement** le long du rayon caméra → pixel, dans le shader de chaque matériau ou en passe plein écran. D'après la documentation, le coût vaut environ deux couches de brouillard à densité constante. | très faible (quelques instructions par pixel) | brouillard au sol crédible, mais lisse et sans relief | oui |
| **Unreal : Volumetric Fog** | Volume en « froxels » (grille 3D alignée sur la vue, ~160×90×64 cellules) : on y injecte la densité et la lumière (ombres comprises), puis on intègre le long de la vue. D'après une ancienne page de la documentation : ~1 ms sur PS4 en qualité haute, ~3 ms sur GTX 970 en qualité épique. | élevé (calcul 3D, textures 3D, ombres) | rayons de lumière, vrai volume | non (WebGL 2 sans calcul 3D efficace) |
| **Local Fog Volumes / soft particles** | Volumes ou cartes de brume fondus contre la scène grâce au tampon de profondeur (« soft particles »). | moyen (surdessin) | bon de près | moyen |
| **Nappes bas-poly + bruit 2D** | Quelques maillages grossiers posés au-dessus du fond de vallée, avec un shader de bruit 2D animé et un fondu en lisière. | faible (2 nappes transparentes, une texture de bruit) | mer de nuages lisible d'en haut | oui |

## 2. Choix retenu : brume de hauteur analytique + deux nappes bas-poly

**a) Brume de hauteur analytique**, ajoutée au morceau `fog_fragment` déjà surchargé par `scene.js`, donc appliquée à tous les matériaux qui ont la brume (terrain, paysage, monde, bâtiments, points) :

- densité ρ(y) = ρ₀·exp(−(y − dessus)/H), bornée sous le dessus de la nappe (au plus e³·ρ₀) ;
- intégrale de la caméra au point en forme fermée : `τ = ρ₀·L·(f₀ − f₁)/Δ`, avec `f = exp(−(y − dessus)/H)` et `Δ = (y₁ − y₀)/H` ; cette forme ne déborde jamais en virgule flottante ;
- densité modulée par un bruit de valeur 2D qui dérive lentement ;
- teinte propre au mode : blanc laiteux éclairé par le ciel et le soleil, passé par le même tone mapping que la scène. La brume au sol a le droit de cacher le bas des bâtiments, les lacs et le fond des vallées ;
- la brume de distance existante s'applique **par-dessus**. Sa règle (« rien plus clair que le ciel à l'horizon ») et le recul du plan lointain restent inchangés.

Les valeurs passent par deux uniformes partagés (`brumeSol`, `brumeSolTeinte`), injectés dans `UniformsLib.fog` et dans chaque `ShaderLib` qui a la brume. Ce sont des objets simples, ni `Vector4` ni `Color` : `UniformsUtils.clone` les copie par référence, donc une seule valeur sert toute la scène sans toucher aux matériaux. Pour un matériau qui ne déclare pas l'uniforme, la valeur reste à 0 et l'effet est coupé.

**b) Deux nappes bas-poly** (grilles de 129 × 129 sommets sur ±16 km, soit ~250 m de maille), visibles seulement quand le paysage est affiché :

- carte des altitudes Terrarium (zoom 11, tuiles déjà en cache pour l'horizon), 256² sur ±16 km, courbure terrestre comprise ;
- **niveau de base** : le 3ᵉ centile des altitudes à moins de 3 km (le lac ou le fond de la vallée) ; dessus de la nappe = base + hauteur réglable (20–800 m) ;
- forme : à plat au-dessus du fond, et sur le relief lissé (deux flous en boîte, ~600 m) là où celui-ci dépasse. La nappe s'y amincit (décroissance exponentielle au-dessus du dessus) ;
- **fondu en lisière sans tampon de profondeur** : l'épaisseur de la nappe au-dessus du terrain se lit dans la carte des altitudes (texture demi-flottante de 256²), puis `smoothstep(0, 45 m, épaisseur)`. Il n'y a ni pré-passe de profondeur ni boucle de rétroaction sur la cible du compositeur ;
- dessus de la nappe : trois échelles d'une texture de bruit répétable (256², mipmaps) qui dérivent avec le vent. La normale est tirée de la pente du bruit et éclairée par le soleil : le dessus est plus clair côté soleil, sans saturer, et les creux sont plus sombres ;
- nappe haute : plus clairsemée, avec un bruit à une autre échelle (parallaxe) ;
- fondu près de la caméra (pas de plan dur collé à l'objectif), vue de dessous atténuée, bord de la grille fondu ;
- hors de l'occlusion ambiante et du rebond (`horsAO`), sans ombre portée, ignorée par les lancers de rayons.

**Coupures** : en vue en plan et en élévations (`scene.modeVue`), et pendant le vol de l'accueil. L'animation demande une image environ tous les 1/12 s, et seulement quand les nappes sont visibles et l'onglet affiché.

**Pourquoi ce choix** : on obtient le rendu « mer de brouillard » vu d'en haut (le cas courant du site) pour un coût de quelques instructions par pixel plus deux surfaces transparentes. Tout tient en WebGL 2 sans texture 3D, donc le mode marche aussi sur mobile. Un brouillard volumétrique à froxels coûterait 5 à 10 fois plus et demanderait des passes de calcul que WebGL gère mal.

## 3. Mesures

Mesures prises sur un Mac portable, canevas de 1101 × 1032 px, effets complets (occlusion ambiante et rebond). Chaque valeur est la médiane de 25 images ; le temps d'une image est compté du rendu jusqu'à un `readPixels` qui force la synchronisation.

| Lieu, vue | sans | avec | écart |
|---|---|---|---|
| Lutry, survol du Léman | 5,3–6,0 ms | 5,6–6,0 ms | ≈ +0,3 ms |
| Lutry, nappe plein écran (vue plongeante) | 2,4–2,5 ms | 2,7–3,0 ms | ≈ +0,4 ms |
| Grindelwald, vallée alpine | 9,1–12 ms | 10,6–11,4 ms | ≈ +1 ms (mesure bruitée) |

## 4. Limites connues

- La nappe est éclairée par le soleil même là où une montagne fait de l'ombre. On pourrait reprendre la carte `tRelief` de `lointain.js`.
- Sur la maquette seule, sans paysage, seule la brume de hauteur agit : la carte de ~125 m est trop grossière pour poser une nappe sur un modèle de 300 m.
- L'occlusion ambiante de la maquette ne s'efface pas encore dans la brume au sol, seulement dans la brume de distance.
- Pendant l'animation au repos, environ 12 images complètes par seconde sont dessinées.

## Sources

- Epic, [Exponential Height Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/exponential-height-fog-in-unreal-engine) et [Volumetric Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-fog-in-unreal-engine)
- Digital Foundry, analyse de TotK, résumée par [Zelda Dungeon](https://www.zeldadungeon.net/?p=200946) et [Nintendo Everything](https://nintendoeverything.com/zelda-tears-of-the-kingdom-tech-analysis-including-frame-rate-and-resolution/)
- Mod « defogger » de TotK, qui décrit les deux couches de brouillard ([Nexus Mods](https://www.nexusmods.com/legendofzeldatearsofthekingdom/mods/27/))
- Schneider, [Nubis Cubed, Advances 2023](https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20(Advances%202023).pdf), pour les nuages volumétriques (référence haut de gamme)
