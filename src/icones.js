// Petites icônes en SVG, dessinées pareil sur tous les systèmes (les caractères ▶ ☀ ☾ × varient selon la police :
// sous Windows, certains deviennent des émojis en couleur ou changent de taille).
const svg = (vue, taille, corps, trait = true) =>
  `<svg viewBox="0 0 ${vue} ${vue}" width="${taille}" height="${taille}" aria-hidden="true" focusable="false"` +
  (trait ? ` fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"` : ` fill="currentColor"`) +
  ` style="display:block">${corps}</svg>`;

export const ICONE = {
  lecture: svg(16, 11, `<path d="M4.5 2.8v10.4l8.6-5.2z"/>`, false),
  pause: svg(16, 11, `<rect x="3.5" y="2.8" width="3" height="10.4" rx="0.8"/><rect x="9.5" y="2.8" width="3" height="10.4" rx="0.8"/>`, false),
  soleil: svg(24, 17, `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>`),
  lune: svg(24, 16, `<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6Z"/>`),
  fermer: svg(16, 10, `<path d="M4 4l8 8M12 4l-8 8"/>`),
};
