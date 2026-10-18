import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';

const SHOTS='tests/visual/screenshots';
mkdirSync(SHOTS,{recursive:true});
const email='visual-admin@skyshcars.invalid';
const password='visual-test-only';
const token=createHash('sha256').update(`sky-admin:${email}:${password}`).digest('hex');

async function adminPage(page:any){
  await page.context().addCookies([{name:'sky_admin',value:token,url:'http://127.0.0.1:3111'}]);
  await page.goto('/admin/analytics',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
}

test('executive analytics renders the complete dense reporting structure',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await adminPage(page);
  await expect(page.locator('h1')).toHaveText('Business Analytics');
  await expect(page.locator('.analyticsKpi')).toHaveCount(16);
  await expect(page.locator('.analyticsPanel')).toHaveCount(27);
  await expect(page.locator('.analyticsWideTable')).toHaveCount(8);
  await expect(page.locator('.analyticsDefinitions')).toHaveCount(1);
  await expect(page.locator('.analyticsWarning')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.screenshot({path:`${SHOTS}/analytics-1440.png`,fullPage:true});
});

test('executive analytics is readable on a phone and print view is available',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await adminPage(page);
  await expect(page.locator('.analyticsKpi')).toHaveCount(16);
  await expect(page.locator('.analyticsPanel')).toHaveCount(27);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.screenshot({path:`${SHOTS}/analytics-390.png`,fullPage:true});
  await page.goto('/admin/analytics/print',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(400);
  await expect(page.locator('.analyticsPrintButton')).toBeVisible();
  await page.screenshot({path:`${SHOTS}/analytics-print-390.png`,fullPage:true});
});

test('analytics API is not public',async({request})=>{
  const r=await request.get('/api/admin/analytics');
  expect(r.status()).toBe(401);
  const e=await request.get('/api/admin/analytics/export?format=csv');
  expect(e.status()).toBe(401);
});
