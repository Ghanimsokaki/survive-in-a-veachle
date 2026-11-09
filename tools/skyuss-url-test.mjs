// Check browser URL resolution for all supported SKYUSS entry URLs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../skyuss/index.html', import.meta.url), 'utf8');
for (const [url, directory] of [
  ['https://example.test/skyuss', '/skyuss/'],
  ['https://example.test/skyuss?touch=1#play', '/skyuss/'],
  ['https://example.test/skyuss/', '/skyuss/'],
  ['https://example.test/skyuss/index.html', '/skyuss/'],
  ['https://example.test/games/skyuss', '/games/skyuss/'],
  ['https://example.test/games/skyuss/', '/games/skyuss/'],
  ['https://example.test/games/skyuss/index.html', '/games/skyuss/'],
]) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously' });
  const { document } = dom.window;
  const origin = 'https://example.test';
  assert.equal(document.baseURI, origin + directory, `base for ${url}`);
  assert.equal(document.querySelector('link[rel="stylesheet"]').href, origin + directory + 'css/sky.css');
  assert.equal(document.querySelector('script[src="js/main.js"]').src, origin + directory + 'js/main.js');
  assert.equal(new URL('assets/models/quaternius/dispatcher.obj', document.baseURI).href,
    origin + directory + 'assets/models/quaternius/dispatcher.obj');
  assert.equal(document.querySelector('script[src="../support-link.js"]').src,
    new URL('../support-link.js', origin + directory).href);
  dom.window.close();
  console.log(`ok ${url}`);
}
