#!/usr/bin/env node
/**
 * fetch-models.mjs — pull a model library off the Hub, correctly.
 *
 * The batch script this replaces had three problems:
 *
 *   1. `f"https://huggingface.co{HF_USERNAME}/{HF_DATASET}/…"` has no slash and
 *      no `/datasets/`, so it asks for the *host* `huggingface.coHwiiiiiiii`.
 *      Every file fails before a single byte moves. `resolveUrl()` below builds
 *      `https://huggingface.co/datasets/<repo>/resolve/main/<file>` with each
 *      path segment URL-encoded — filenames like
 *      `USS Enterprise NCC-1701-I  Odin Class.blend` have two spaces in them.
 *   2. It kept no record of what it got. Downloads into `models/` now come with
 *      `models/manifest.json`: size, sha256, source URL, timestamp.
 *   3. A dropped connection lost the whole file. Every download resumes from a
 *      `.part` file with a Range request and retries with backoff.
 *
 * Usage
 *   node skyuss/tools/fetch-models.mjs --list
 *   node skyuss/tools/fetch-models.mjs --dry-run
 *   node skyuss/tools/fetch-models.mjs --out models
 *   node skyuss/tools/fetch-models.mjs --file model.fbx --file NCC1701D_FIND.blend
 *   HF_TOKEN=hf_xxx node skyuss/tools/fetch-models.mjs          # gated repos
 *
 * Everything it writes lands in `models/`, which is gitignored: these are
 * third-party meshes and must never enter the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPO = 'Hwiiiiiiii/for';
export const HOST = 'https://huggingface.co';

/** The library as it actually exists in `Hwiiiiiiii/for`. */
export const LIBRARY = [
  'NCC1701D_FIND.blend',
  'USS Enterprise NCC-1701-I  Odin Class.blend',
  'USS Enterprise NCC-1701.zip',
  'enterprise blend.blend',
  'model.fbx',
  'starship+3d+model.zip',
];

/** --- URL building -------------------------------------------------------- */

/**
 * Hub download URL for one file in one dataset repo.
 * `repo` is the owner/name pair, e.g. `Hwiiiiiiii/for`.
 */
export function resolveUrl(repo, file, { base = HOST, revision = 'main', download = true } = {}) {
  const cleanRepo = String(repo).replace(/^\/+|\/+$/g, '');
  if (!/^[^/]+\/[^/]+$/.test(cleanRepo)) throw new Error(`repo must look like "owner/name", got "${repo}"`);
  // encode each segment on its own so the slashes of a nested path survive
  const encoded = String(file)
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const q = download ? '?download=true' : '';
  return `${base.replace(/\/+$/, '')}/datasets/${cleanRepo}/resolve/${revision}/${encoded}${q}`;
}

/** Tree listing endpoint (JSON) for a dataset repo. */
export function treeUrl(repo, { base = HOST, revision = 'main', recursive = true } = {}) {
  const cleanRepo = String(repo).replace(/^\/+|\/+$/g, '');
  return `${base.replace(/\/+$/, '')}/api/datasets/${cleanRepo}/tree/${revision}${recursive ? '?recursive=1' : ''}`;
}

/** Human byte sizes, for progress lines. */
export function human(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Turn a raw transport error into advice a human can act on. */
export function diagnose(err, url = '') {
  const msg = String((err && err.message) || err || '');
  const code = String((err && err.code) || '');
  const hugging = /huggingface\.co/i.test(url);
  if (/ECONNRESET|EPROTO|SSL|socket hang up|TLS/i.test(msg + code)) {
    return hugging
      ? 'TLS to huggingface.co was cut. This sandbox\'s egress policy blocks the Hub (github.com works). '
        + 'Run this script on your own machine, or mirror the files to GitHub and pass --base.'
      : `TLS/connection reset while talking to ${url}`;
  }
  if (/ENOTFOUND|EAI_AGAIN|No address associated/i.test(msg + code)) {
    return `DNS could not resolve ${url} — no egress to that host from here.`;
  }
  if (code === 'HTTP_401' || code === 'HTTP_403') {
    return 'HTTP ' + code.slice(5) + ': repo is gated or private — pass --token or set HF_TOKEN.';
  }
  if (code === 'HTTP_404') return 'HTTP 404: that file is not in the repo (check the exact name, spaces included).';
  return msg || 'unknown error';
}

/** --- HTTP with redirects, resume and retry ------------------------------- */

function request(url, { headers = {}, method = 'GET', timeout = 30000 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.request(url, { method, headers }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        const next = new URL(loc, url).toString();
        return resolve(request(next, { headers, method, timeout }, redirects + 1));
      }
      resolve(res);
    });
    req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (method === 'GET') req.end();
    else req.end();
  });
}

function httpError(code) {
  const e = new Error(`HTTP ${code}`);
  e.code = `HTTP_${code}`;
  return e;
}

export async function head(url, { token } = {}) {
  const res = await request(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0', 'User-Agent': 'skyuss-fetch/1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  res.destroy();
  if (res.statusCode >= 400) throw httpError(res.statusCode);
  const cr = res.headers['content-range'];              // bytes 0-0/12345
  const total = cr ? Number(String(cr).split('/')[1]) : Number(res.headers['content-length'] || 0);
  return { size: Number.isFinite(total) ? total : 0, status: res.statusCode, resumed: res.statusCode === 206 };
}

/**
 * Download one file to `dest`. Resumes from `dest.part` when present and
 * verifies the final byte count. Returns `{ bytes, sha256, skipped }`.
 */
export async function download(url, dest, { token, retries = 3, force = false, log = () => {} } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;

  if (!force && fs.existsSync(dest)) {
    const bytes = fs.statSync(dest).size;
    log(`skip ${path.basename(dest)} (already here, ${human(bytes)})`);
    return { bytes, sha256: sha256File(dest), skipped: true };
  }

  let expected = 0;
  try {
    expected = (await head(url, { token })).size;
  } catch (err) {
    if (err.code && err.code.startsWith('HTTP_')) throw err;
    // a HEAD-ish probe failing on transport is fatal too — surface it
    throw err;
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let start = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (expected && start > expected) { fs.rmSync(part, { force: true }); start = 0; }
    if (expected && start === expected && start > 0) {
      fs.renameSync(part, dest);
      log(`done ${path.basename(dest)} (resumed, ${human(start)})`);
      return { bytes: start, sha256: sha256File(dest), skipped: false };
    }
    try {
      const res = await request(url, {
        headers: {
          'User-Agent': 'skyuss-fetch/1',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(start > 0 ? { Range: `bytes=${start}-` } : {}),
        },
      });
      if (res.statusCode >= 400) { res.resume(); throw httpError(res.statusCode); }
      if (start > 0 && res.statusCode !== 206) start = 0;   // server ignored Range
      if (!expected) {                                      // CDNs often answer the probe with no size
        const cr = res.headers['content-range'];
        const cl = Number(res.headers['content-length'] || 0);
        expected = cr ? Number(String(cr).split('/')[1]) : (cl ? cl + start : 0);
        if (Number.isFinite(expected) && expected > 0) log(`  ${path.basename(dest)}: ${human(expected)} to fetch`);
      }
      const out = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
      await new Promise((resolve, reject) => {
        let got = start;
        let lastTick = Date.now();
        res.on('data', (chunk) => {
          got += chunk.length;
          if (Date.now() - lastTick > 2000 && expected) {
            lastTick = Date.now();
            log(`  ${path.basename(dest)} ${human(got)} / ${human(expected)}`);
          }
        });
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
      });
      const bytes = fs.statSync(part).size;
      if (expected && bytes !== expected) throw new Error(`short read: ${bytes} of ${expected} bytes`);
      fs.renameSync(part, dest);
      log(`done ${path.basename(dest)} (${human(bytes)})`);
      return { bytes, sha256: sha256File(dest), skipped: false };
    } catch (err) {
      if (err.code === 'HTTP_404' || err.code === 'HTTP_401' || err.code === 'HTTP_403') throw err;
      if (attempt === retries) throw err;
      const wait = 500 * 2 ** attempt;
      log(`  retry ${attempt + 1}/${retries} in ${wait}ms — ${diagnose(err, url)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

/** `--list`: what is actually in the repo, straight from the tree API. */
export async function listRepo(repo = DEFAULT_REPO, { token, base = HOST } = {}) {
  const res = await request(treeUrl(repo, { base }), {
    headers: { 'User-Agent': 'skyuss-fetch/1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.statusCode >= 400) { res.resume(); throw httpError(res.statusCode); }
  const text = await new Promise((resolve, reject) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { buf += c; });
    res.on('end', () => resolve(buf));
    res.on('error', reject);
  });
  const rows = JSON.parse(text);
  return rows
    .filter((r) => r.type === 'file')
    .map((r) => ({ name: r.path, bytes: r.size || (r.lfs && r.lfs.size) || 0 }));
}

/* ---------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, out: 'models', files: [], token: process.env.HF_TOKEN || '', list: false, dryRun: false, force: false, base: HOST };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--token') opts.token = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--file') opts.files.push(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('node skyuss/tools/fetch-models.mjs [--list] [--dry-run] [--out models] [--file name]… [--repo owner/name] [--token hf_x] [--base url]');
    return;
  }
  if (opts.list) {
    try {
      const rows = await listRepo(opts.repo, { token: opts.token, base: opts.base });
      for (const r of rows) console.log(`${human(r.bytes).padStart(8)}  ${r.name}`);
      console.log(`\n${rows.length} files in ${opts.repo}`);
    } catch (err) {
      console.error(`cannot list ${opts.repo}: ${diagnose(err, treeUrl(opts.repo, { base: opts.base }))}`);
      process.exit(2);
    }
    return;
  }

  const files = opts.files.length ? opts.files : LIBRARY;
  const manifestPath = path.join(opts.out, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { repo: opts.repo, files: {} };

  let failed = 0;
  for (const name of files) {
    const url = resolveUrl(opts.repo, name, { base: opts.base });
    if (opts.dryRun) { console.log(`DRY  ${url}`); continue; }
    try {
      const r = await download(url, path.join(opts.out, name), { token: opts.token, force: opts.force, log: (m) => console.log(m) });
      manifest.files[name] = { bytes: r.bytes, sha256: r.sha256, url, fetchedAt: new Date().toISOString() };
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}\n     ${url}\n     ${diagnose(err, url)}`);
    }
  }
  if (!opts.dryRun) {
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nmanifest → ${manifestPath}`);
  }
  if (failed) process.exit(1);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => { console.error(diagnose(err)); process.exit(1); });
}
