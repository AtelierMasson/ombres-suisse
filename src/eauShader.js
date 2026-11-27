// Matière commune des eaux (maquette, anneau, polygones swisstopo) : dégradé clair des faibles profondeurs près des
// rives et grain de plâtre (le même que les façades et les toits). Le fragment lit `vEauM` (position monde).

// Profondeur de l'eau (texture partagée, Scene.majProfondeurEau) : 0..255 = 0..PROF_MAX m, sur le carré [-L, L] du
// lieu. Faible profondeur (fond swissBATHY3D, ou distance à la rive × pente) : l'eau s'éclaircit près des rives.
export const PROF_MAX = 12;
export const PROF = { tProf: { value: null }, profL: { value: 0 } };

export const EAU_DECL = `uniform float profL;
uniform sampler2D tProf;
float eauHachage(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float eauBruit(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(eauHachage(i), eauHachage(i + vec3(1, 0, 0)), f.x), mix(eauHachage(i + vec3(0, 1, 0)), eauHachage(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(eauHachage(i + vec3(0, 0, 1)), eauHachage(i + vec3(1, 0, 1)), f.x), mix(eauHachage(i + vec3(0, 1, 1)), eauHachage(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

export const EAU_FRAG = `{ // faible profondeur : plus clair et un peu turquoise, en deux paliers (bord, puis plateau peu profond)
  float prof = ${PROF_MAX.toFixed(1)};
  if (profL > 0.0) { vec2 uvP = (vec2(vEauM.x, -vEauM.z) + profL) / (2.0 * profL); if (uvP.x > 0.0 && uvP.y > 0.0 && uvP.x < 1.0 && uvP.y < 1.0) prof = texture2D(tProf, uvP).r * ${PROF_MAX.toFixed(1)}; }
  vec3 clair = mix(diffuseColor.rgb, vec3(0.62, 0.80, 0.78), 0.45);   // plateau (1,5 à 6 m)
  vec3 bord = mix(diffuseColor.rgb, vec3(0.80, 0.88, 0.80), 0.62);    // haut-fond près de la rive
  vec3 c = mix(bord, clair, smoothstep(0.0, 1.8, prof));
  diffuseColor.rgb = mix(c, diffuseColor.rgb, smoothstep(1.2, 7.5, prof));
  diffuseColor.a *= mix(0.94, 1.0, smoothstep(0.0, 3.0, prof)); // à peine plus transparente au bord (le fond reste discret)
}
{ // même grain que les façades et les toits (plâtre) : nuances larges, grain fin et trame de cases de 0,5 m
  float gE = 0.55 * eauBruit(vEauM * 2.7) + 0.3 * eauBruit(vEauM * 9.0) + 0.15 * eauBruit(vEauM * 0.35);
  vec2 tC = fwidth(vEauM.xz);
  float pixel = mix(0.5, eauHachage(floor(vEauM * 2.0 + 0.001) + 0.37), smoothstep(0.008, 0.035, max(tC.x, tC.y)));
  diffuseColor.rgb *= 1.0 + 0.06 * ((gE - 0.5) * 1.4 + (pixel - 0.5) * 0.9);
}`;
