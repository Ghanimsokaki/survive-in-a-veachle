/**
 * support-link.js — shows the tip-jar link, or hides it.
 *
 * Both games load this same module; it finds `#supportLink`, reads
 * support-config.js and either points the anchor at your page or leaves it
 * `hidden`. Nothing renders if the URL is blank or is not http(s), so a
 * half-configured build never shows a broken button to a player.
 */

import { SUPPORT } from './support-config.js';

const SAFE = /^https?:\/\/[^\s"'<>]+$/i;

/**
 * Wire one anchor element.
 * @param {{getElementById: Function}} doc a document (real or fake, for tests)
 * @param {{url?: string, label?: string, note?: string}} cfg
 * @returns the element when shown, or null when hidden
 */
export function mountSupportLink(doc = typeof document !== 'undefined' ? document : null, cfg = SUPPORT) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  const el = doc.getElementById('supportLink');
  if (!el) return null;
  const url = String((cfg && cfg.url) || '').trim();
  if (!SAFE.test(url)) {
    el.hidden = true;
    if (typeof el.removeAttribute === 'function') el.removeAttribute('href');
    return null;
  }
  el.hidden = false;
  el.href = url;
  el.textContent = (cfg && cfg.label) || '♥ Support';
  if (typeof el.setAttribute === 'function') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');   // never hand window.opener to another site
    if (cfg && cfg.note) el.setAttribute('title', cfg.note);
  }
  return el;
}

if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountSupportLink());
  else mountSupportLink();
}
