/**
 * support-config.js — the only file to edit to start accepting tips.
 *
 * Put your Trakteer (or Saweria / Ko-fi) page in `url` and the "♥ Support" link
 * appears in both games' menus. Leave it empty and the link stays hidden, so a
 * plain build never shows a dead button.
 *
 *   url: 'https://trakteer.id/your-name'
 *
 * Rules of thumb for a first tip jar:
 *   · one link, in the menu, not in the middle of gameplay
 *   · say what the money is for ("pays for the domain and my time")
 *   · do not promise rewards you cannot deliver
 *   · if you are under 18, the account has to be a parent's — see MONEY-PLAN.md
 */

export const SUPPORT = {
  url: '',                                    // ← paste your page here
  label: '♥ Support the developer',
  note: 'Tips keep the domain alive. Thank you!',
};
