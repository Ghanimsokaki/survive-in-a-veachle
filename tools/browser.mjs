// Full-browser screenshot pass (dev tool).
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const browser = await puppeteer.launch({
  args: [...chromium.args, '--disable-gpu', '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
  else if (m.type() === 'warning') console.log('warn:', m.text());
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/ui-menu.png' });

await page.click('#btnNew');
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: 'shots/ui-start.png' });

// drive a bit
await page.keyboard.down('d');
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 1400));
await page.keyboard.up('w');
await page.keyboard.up('d');
await page.mouse.move(1000, 380);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 500));
await page.mouse.up();
await page.screenshot({ path: 'shots/ui-driving.png' });

// craft panel
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shots/ui-craft.png' });
await page.keyboard.press('Escape');

// build mode with some modules in tray
await page.evaluate(() => {
  const G = window.G;
  const pool = window.__RECIPES || [];
  G.buildInv = {};
  for (const kind of ['floor', 'wall', 'storage', 'bed', 'solar', 'medbay', 'workbench', 'dronebay', 'turret']) {
    const r = pool.find((x) => x.out.spec && x.out.spec.kind === kind);
    if (r) G.buildInv[r.id] = 2;
  }
});
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/ui-buildtray.png' });

// place modules by clicking cells around the car centre
const box = await page.evaluate(() => {
  const G = window.G;
  return { cx: window.innerWidth / 2, cy: window.innerHeight / 2, zoom: G.camera.zoom, cell: G.car.grid.cell };
});
const sel = await page.evaluate(() => window.G.buildSelected);
for (let i = 0; i < 12; i++) {
  await page.evaluate((idx) => {
    window.G.buildSelected = Object.keys(window.G.buildInv)[0];
    window.G.placeAtCell(idx);
  }, i);
  await new Promise((r) => setTimeout(r, 20));
}
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/ui-built.png' });

// click through every panel
for (const [key, name] of [['n', 'crew'], ['i', 'items'], ['m', 'route'], ['h', 'help']]) {
  await page.keyboard.press(key);
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: `shots/ui-panel-${name}.png` });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
}

// state readout
const state = await page.evaluate(() => ({
  screen: window.G.screen,
  zone: window.G.zone && window.G.zone.def.name,
  hull: Math.round(window.G.car.hull),
  res: window.G.res,
  cells: window.G.car.grid.cells.filter(Boolean).length,
  enemies: window.G.enemies.length,
  recipes: window.__RECIPE_COUNT,
  dpr: window.devicePixelRatio,
  canvas: [document.getElementById('game').width, document.getElementById('game').height],
}));
console.log(JSON.stringify(state, null, 2));
console.log('errors:', errors.length);
errors.slice(0, 15).forEach((e) => console.log(e));

await browser.close();
process.exit(errors.length ? 1 : 0);
