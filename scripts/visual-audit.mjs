import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.AUDIT_BASE || 'http://127.0.0.1:3111';
const out = '.visual-audit';
mkdirSync(out, { recursive: true });

const requested = process.argv.slice(2);
const only = requested.length ? new Set(requested) : null;
const pages = [
  ['home', '/'],
  ['cars', '/cars'],
  ['motorcycles', '/motorcycles'],
  ['electric', '/vehicles?fuel=electric'],
  ['sold', '/sold-vehicles'],
  ['shipping', '/shipping'],
  ['destinations', '/destinations'],
  ['quote', '/quote'],
  ['account', '/account'],
  ['login', '/login'],
  ['signup', '/signup'],
  ['compare', '/compare'],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

for (const [name, path] of pages) {
  if (only && !only.has(name)) continue;
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2600);
  const info = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const main = document.querySelector('main');
    const hero = document.querySelector('.catalogHero, .heroSection, .shippingHero, .soldHero, .authPanel');
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 90) || '',
      bodyBg: body.backgroundColor,
      mainClass: main?.className || '',
      heroClass: hero?.className || '',
      heroBg: hero ? getComputedStyle(hero).backgroundImage + ' / ' + getComputedStyle(hero).backgroundColor : '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cards: document.querySelectorAll('.vehicleCard').length,
      images: [...document.querySelectorAll('.vehicleCard img.vehiclePhoto')].slice(0, 3).map((img) => ({
        src: img.getAttribute('src')?.slice(0, 90),
        loaded: img.complete && img.naturalWidth > 0,
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
      })),
    };
  });
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${name}-1440.png`, fullPage: true });
}

const detailHref = await (async () => {
  await page.goto(base + '/vehicles', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  return page.locator('.vehicleCard .vehicleImageWrap').first().getAttribute('href');
})();
if (detailHref && (!only || only.has('detail'))) {
  await page.goto(base + detailHref, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/detail-1440.png`, fullPage: true });
  console.log('detail', detailHref);
}

await browser.close();
