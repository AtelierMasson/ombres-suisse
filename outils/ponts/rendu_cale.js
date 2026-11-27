// Rendu de la maquette depuis la caméra d'une photo calée (outils/ponts/caler_photo.py), envoyé au récepteur local
// (outils/ponts/recepteur.mjs). À coller dans la console du serveur de dev (window.__scene existe), le lieu chargé en
// mode Voyage centré sur le pont (#e=…&n=…&t=Voyage), puis :
//   await renduCale({ position, vise, haut, fov_vertical }, { E0, N0, largeur: 1920, hauteur: 1440, nom: "poya-rendu.jpg" })
async function renduCale(cam, { E0, N0, largeur, hauteur, nom = "rendu.jpg", sansArbres = false }) {
  const s = window.__scene, el = s.el, zr = s.zRef;
  const v = ([E, N, Z]) => [E - E0, Z - zr, -(N - N0)];
  // la vue prend les proportions de la photo (au plus 1400 px de large à l'écran)
  const k = Math.min(1, 1400 / largeur, 900 / hauteur), avant = el.getAttribute("style") || "";
  el.style.width = `${Math.round(largeur * k)}px`; el.style.height = `${Math.round(hauteur * k)}px`; el.style.flex = "none";
  s.taille();
  const arbres = document.querySelector("#vArbres");
  if (sansArbres && arbres?.checked) arbres.click();
  const c = s.camera, [px, py, pz] = v(cam.position), [vx, vy, vz] = v(cam.vise), h = cam.haut || [0, 0, 1];
  c.position.set(px, py, pz);
  c.up.set(h[0], h[2], -h[1]);                       // haut de l'image (MN95 -> scène)
  c.fov = cam.fov_vertical; c.near = 1; c.far = 60000;
  c.lookAt(vx, vy, vz); c.updateProjectionMatrix();
  s.controls.target.set(vx, vy, vz);
  // laisser les tuiles et le paysage arriver, puis rendre sans que les contrôles ne bougent la caméra
  await new Promise(r => setTimeout(r, 2500));
  c.position.set(px, py, pz); c.up.set(h[0], h[2], -h[1]); c.lookAt(vx, vy, vz); c.updateProjectionMatrix();
  s.rendre();
  const url = s.renderer.domElement.toDataURL("image/jpeg", 0.9);
  await fetch(`http://localhost:5391/${nom}`, { method: "POST", body: url });
  el.setAttribute("style", avant); s.taille();
  if (sansArbres && arbres && !arbres.checked) arbres.click();
  c.up.set(0, 1, 0);
  return { nom, taille: url.length };
}
window.renduCale = renduCale;
