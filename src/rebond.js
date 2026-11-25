// Un rebond de lumière (éclairage indirect) calculé à l'écran, comme l'occlusion ambiante :
// chaque point reçoit une part de la lumière renvoyée par les surfaces voisines visibles (sol ensoleillé, murs, toits).
// Demi-résolution, quelques échantillons par pixel, puis un flou qui respecte les arêtes. Un peu de bruit est accepté.
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const COMMUN = /* glsl */`
#include <packing>
uniform sampler2D tProfondeur, tNormales;
uniform mat4 projection, projectionInverse;
uniform float pres, loin;
float vueZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tProfondeur, uv).x, pres, loin); }
vec3 vuePos(vec2 uv) {
  float z = texture2D(tProfondeur, uv).x;
  vec4 p = projectionInverse * vec4(vec3(uv, z) * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec3 normale(vec2 uv) { return normalize(texture2D(tNormales, uv).xyz * 2.0 - 1.0); }
`;

const REBOND = /* glsl */`
${COMMUN}
uniform sampler2D tCouleur;
uniform float rayon;
varying vec2 vUv;
const int N = 10;
float bruitIG(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float z = texture2D(tProfondeur, vUv).x;
  if (z >= 1.0) { gl_FragColor = vec4(0.0); return; }
  vec3 P = vuePos(vUv), n = normale(vUv);
  // échantillons pris directement sur l'écran, dans un disque qui correspond à « rayon » mètres autour du point
  float rEcran = rayon * projection[1][1] / max(0.5, -P.z) * 0.5;
  float a0 = 6.2831853 * bruitIG(gl_FragCoord.xy);
  vec3 somme = vec3(0.0);
  for (int k = 0; k < N; k++) {
    float u = (float(k) + bruitIG(gl_FragCoord.yx + float(k) * 3.1)) / float(N);
    float ang = a0 + 2.3999632 * float(k);                       // spirale dorée
    vec2 uv = vUv + vec2(cos(ang) * projection[0][0] / projection[1][1], sin(ang)) * rEcran * sqrt(u);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    if (texture2D(tProfondeur, uv).x >= 1.0) continue;             // ciel : pas de rebond
    vec3 S = vuePos(uv), d = S - P;
    float L = length(d);
    if (L < 0.1 || L > rayon * 1.5) continue;
    d /= L;
    vec3 nS = normale(uv);
    float recu = max(0.0, dot(n, d)), emis = max(0.0, dot(nS, -d));
    float att = 1.0 / (1.0 + L * L / (rayon * rayon * 0.25));
    // couleur renvoyée en partie désaturée : les arbres en points (absents de la profondeur) ne débordent pas en vert
    vec3 col = texture2D(tCouleur, uv).rgb;
    somme += mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.45) * recu * emis * att;
  }
  gl_FragColor = vec4(somme / float(N) * 4.0, 1.0);
}`;

// flou séparable qui ne traverse pas les arêtes (profondeur et normale)
const FLOU = /* glsl */`
${COMMUN}
uniform sampler2D tSource;
uniform vec2 pas;
varying vec2 vUv;
void main() {
  float z0 = vueZ(vUv);
  vec3 n0 = normale(vUv);
  vec3 s = vec3(0.0); float w = 0.0;
  for (int k = -4; k <= 4; k++) {
    vec2 uv = vUv + pas * float(k);
    float wk = exp(-float(k * k) / 10.0)
      * exp(-abs(vueZ(uv) - z0) / max(0.3, abs(z0) * 0.02))
      * pow(max(0.0, dot(normale(uv), n0)), 8.0);
    s += texture2D(tSource, uv).rgb * wk; w += wk;
  }
  gl_FragColor = vec4(s / max(1e-4, w), 1.0);
}`;

const COMPOSE = /* glsl */`
uniform sampler2D tDiffuse, tRebond;
uniform float force;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 r = texture2D(tRebond, vUv).rgb;
  // la lumière renvoyée éclaire surtout les parties sombres (ombres), sans « brûler » les surfaces au soleil
  float sombre = 1.0 - smoothstep(0.25, 0.9, dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)));
  gl_FragColor = vec4(c.rgb + r * c.rgb * force * (0.35 + 0.65 * sombre), c.a);
}`;

const SOMMETS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

/**
 * Passe « rebond » : à placer après le GTAOPass, dont elle réutilise la profondeur et les normales (déjà en demi-résolution).
 * `force` règle l'intensité (0 = coupé).
 */
export class RebondPass extends Pass {
  constructor(camera, ao, { rayon = 8, force = 3 } = {}) {
    super();
    this.camera = camera; this.ao = ao; this.force = force;
    const cible = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cA = cible(); this.cB = cible();
    const communs = () => ({
      tProfondeur: { value: null }, tNormales: { value: null }, projection: { value: new THREE.Matrix4() },
      projectionInverse: { value: new THREE.Matrix4() }, pres: { value: 1 }, loin: { value: 1000 },
    });
    this.mRebond = new THREE.ShaderMaterial({ uniforms: { ...communs(), tCouleur: { value: null }, rayon: { value: rayon } }, vertexShader: SOMMETS, fragmentShader: REBOND, depthTest: false, depthWrite: false });
    this.mFlou = new THREE.ShaderMaterial({ uniforms: { ...communs(), tSource: { value: null }, pas: { value: new THREE.Vector2() } }, vertexShader: SOMMETS, fragmentShader: FLOU, depthTest: false, depthWrite: false });
    this.mCompose = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tRebond: { value: null }, force: { value: force } }, vertexShader: SOMMETS, fragmentShader: COMPOSE, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(null);
  }

  setSize(w, h) {
    const lw = Math.max(1, Math.ceil(w / 2)), lh = Math.max(1, Math.ceil(h / 2));
    this.cA.setSize(lw, lh); this.cB.setSize(lw, lh);
    this.l = lw; this.h = lh;
  }

  render(renderer, writeBuffer, readBuffer) {
    const ao = this.ao, cam = this.camera;
    if (!this.force || !ao.depthTexture) { // rien à ajouter : simple copie
      this.mCompose.uniforms.tDiffuse.value = readBuffer.texture;
      this.mCompose.uniforms.force.value = 0;
    } else {
      for (const m of [this.mRebond, this.mFlou]) {
        const u = m.uniforms;
        u.tProfondeur.value = ao.depthTexture; u.tNormales.value = ao.normalTexture;
        u.projection.value.copy(cam.projectionMatrix); u.projectionInverse.value.copy(cam.projectionMatrixInverse);
        u.pres.value = cam.near; u.loin.value = cam.far;
      }
      this.mRebond.uniforms.tCouleur.value = readBuffer.texture;
      this.passe(renderer, this.mRebond, this.cA);
      this.mFlou.uniforms.tSource.value = this.cA.texture; this.mFlou.uniforms.pas.value.set(1.5 / this.l, 0);
      this.passe(renderer, this.mFlou, this.cB);
      this.mFlou.uniforms.tSource.value = this.cB.texture; this.mFlou.uniforms.pas.value.set(0, 1.5 / this.h);
      this.passe(renderer, this.mFlou, this.cA);
      this.mCompose.uniforms.tDiffuse.value = readBuffer.texture;
      this.mCompose.uniforms.tRebond.value = this.cA.texture;
      this.mCompose.uniforms.force.value = this.force;
    }
    this.quad.material = this.mCompose;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  passe(renderer, mat, cible) {
    this.quad.material = mat;
    renderer.setRenderTarget(cible);
    this.quad.render(renderer);
  }

  dispose() {
    this.cA.dispose(); this.cB.dispose();
    for (const m of [this.mRebond, this.mFlou, this.mCompose]) m.dispose();
    this.quad.dispose();
  }
}
