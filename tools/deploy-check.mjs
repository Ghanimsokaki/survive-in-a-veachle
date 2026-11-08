#!/usr/bin/env node
/**
 * deploy-check.mjs — is this checkout actually uploadable?
 *
 * A static site like this one fails on a deploy in three boring ways: a file
 * referenced from HTML/JS was never committed, a path is absolute (so it only
 * worked from `file://` or a server root), or something is fetched from a host
 * the deploy cannot reach. This walks both entry points, follows every ES module
 * import and every asset-ish string literal, and reports what a host like Vercel
 * would 404 on.
 *
 *   node tools/deploy-check.mjs
 *   node tools/deploy-check.mjs --json
 *
 * Exits non-zero if anything would break on a static host.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pages a visitor can land on. */
export const ENTRIES = ['index.html', 'skyuss/index.html'];

const ASSET_EXT = /\.(js|mjs|css|html|json|png|jpe?g|webp|gif|svg|obj|glb|gltf|bin|mp3|ogg|wav|woff2?|ttf|ico|txt|md)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'shots', 'image-search', '.vercel', 'models']);

export function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Every URL-ish literal in a text file that looks like a relative asset. */
export function assetRefs(text) {
  const refs = new Set();
  // html attributes and css url()
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) refs.add(m[1]);
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.add(m[1]);
  // quoted strings that end in a known asset extension
  for (const m of text.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    const v = m[1];
    if (/^\.[a-z0-9]+$/i.test(v)) continue;          // a bare extension, not a path
    if (/[${}]/.test(v)) continue;                   // a template with a hole in it
    if (ASSET_EXT.test(v) && !/\s/.test(v)) refs.add(v);
  }
  return [...refs];
}

/**
 * URLs the page or the code actually *loads* from another host. A string that
 * merely documents where an SDK lives (`PORTAL_SDK_SRC`) is not a load, so the
 * patterns here are limited to the calls that fetch.
 */
const LOAD_PATTERNS = [
  /(?:src|href)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi,
  /(?:fetch|importScripts|sendBeacon)\(\s*["'](https?:\/\/[^"'\s]+)["']/gi,
  /import\(\s*["'](https?:\/\/[^"'\s]+)["']\s*\)/gi,
  /\.src\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi,
];

/** Strip block and whole-line comments: a URL written in prose is not a load. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join('\n');
}

export function externalLoads(text) {
  const code = stripComments(text);
  const out = new Set();
  for (const re of LOAD_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const url = m[1];
      if (/\.(html?|md|txt)(?:[?#]|$)/i.test(url)) continue;     // a link, not an asset
      out.add(url);
    }
  }
  return [...out];
}

/** ES module specifiers, so the module graph is followed exactly like a browser would. */
export function importSpecs(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

export function check({ json = false } = {}) {
  const report = { missing: [], optional: [], external: [], absolute: [], untracked: [], graph: [], size: 0, largest: [] };

  const queue = [];
  const seen = new Set();
  for (const entry of ENTRIES) {
    if (!fs.existsSync(path.join(ROOT, entry))) report.missing.push(entry);
    else queue.push({ rel: entry, doc: path.posix.dirname(entry) });
  }

  while (queue.length) {
    const { rel, doc } = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    const text = fs.readFileSync(abs, 'utf8');
    report.graph.push(rel);

    for (const url of externalLoads(text)) report.external.push({ from: rel, url });

    const isModule = /\.(js|mjs)$/i.test(rel);
    // module specifiers resolve against the importing file; runtime fetches and
    // <img src>/url() resolve against the page the visitor is on
    const specs = [];
    if (isModule) for (const imp of importSpecs(text)) specs.push({ spec: imp, base: path.posix.dirname(rel) });
    if (/\.(html|css|js|mjs)$/i.test(rel)) {
      for (const a of assetRefs(text)) {
        if (isModule && importSpecs(text).includes(a)) continue;
        specs.push({ spec: a, base: doc });
      }
    }

    for (const { spec, base } of specs) {
      if (/^(data:|blob:|mailto:|tel:|#|javascript:)/i.test(spec)) continue;
      if (/^https?:\/\//i.test(spec)) continue;   // handled by externalLoads()
      const clean = spec.split(/[?#]/)[0];
      if (clean.startsWith('/')) { report.absolute.push({ from: rel, spec }); continue; }
      // a browser resolves a CSS url() against the stylesheet and a fetch() against the
      // document; try both, and only call it missing when neither exists
      const bases = [...new Set([base, path.posix.dirname(rel), doc])].filter((b) => b !== undefined);
      const candidates = bases.map((b) => path.posix.normalize(path.posix.join(b === '.' ? '' : b, clean)));
      const target = candidates.find((c) => fs.existsSync(path.join(ROOT, c))) || candidates[0];
      const optional = /^skyuss\/assets\/premium\//.test(target);
      if (!fs.existsSync(path.join(ROOT, target))) {
        (optional ? report.optional : report.missing).push(`${target}  (from ${rel})`);
        continue;
      }
      if (!isTracked(target)) report.untracked.push(`${target}  (from ${rel})`);
      if (ASSET_EXT.test(target) && !seen.has(target)) queue.push({ rel: target, doc });
    }
  }

  const files = walk('.');
  for (const f of files) {
    const bytes = fs.statSync(path.join(ROOT, f)).size;
    report.size += bytes;
    report.largest.push([f, bytes]);
  }
  report.largest.sort((a, b) => b[1] - a[1]).slice(0, 12);

  if (!json) {
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    console.log(`entry points   ${ENTRIES.join('  ·  ')}`);
    console.log(`module graph   ${report.graph.length} files reachable from the entry points`);
    console.log(`deploy size    ${(report.size / 1024 / 1024).toFixed(1)} MB across ${files.length} tracked-path files`);
    console.log('largest files');
    for (const [f, n] of report.largest) console.log(`  ${kb(n).padStart(9)}  ${f}`);
    if (report.optional.length) {
      console.log(`optional       ${report.optional.length} drop-slot files are absent — the game falls back on purpose`);
    }
    const bad = report.missing.length + report.absolute.length + report.external.length + report.untracked.length;
    console.log(bad ? '\nBLOCKERS' : '\nno blockers: every referenced file exists, is committed, and is relative');
    for (const m of report.missing) console.log(`  MISSING      ${m}`);
    for (const a of report.absolute) console.log(`  ABSOLUTE     ${a.spec}  (from ${a.from})`);
    for (const e of report.external) console.log(`  EXTERNAL     ${e.url}  (from ${e.from})`);
    for (const u of report.untracked) console.log(`  NOT IN GIT   ${u}`);
    console.log('\nVercel: framework "Other", build command empty, output directory the repo root.');
    console.log('        vercel.json in this repo sets that up already — `vercel --prod` or import the GitHub repo.');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = check({ json: process.argv.includes('--json') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  const blockers = report.missing.length + report.absolute.length + report.external.length + report.untracked.length;
  process.exit(blockers ? 1 : 0);
}
