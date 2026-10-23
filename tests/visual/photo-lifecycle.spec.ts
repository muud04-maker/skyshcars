import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const SHOTS='tests/visual/screenshots';
mkdirSync(SHOTS,{recursive:true});

async function firstLoadedCard(page:any){
  const cards=page.locator('.vehicleCard');
  await expect.poll(()=>cards.count(),{timeout:15000}).toBeGreaterThan(0);
  for(let i=0;i<Math.min(12,await cards.count());i++){
    const card=cards.nth(i);
    await card.scrollIntoViewIfNeeded().catch(()=>{});
    const img=card.locator('img.vehiclePhoto').first();
    if(!(await img.count()))continue;
    const loaded=await expect.poll(async()=>{
      try{return await img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))}catch{return false}
    },{timeout:20000}).toBeTruthy().then(()=>true).catch(()=>false);
    if(loaded)return {card,img,src:String(await img.getAttribute('src')||'')};
  }
  throw new Error('No successfully loaded vehicle image found');
}

async function assertStillVisible(img:any,card:any,src:string){
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toBe(src);
  expect(await img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  expect(await card.locator('.vehiclePhotoFallback').count()).toBe(0);
  const kind=String(await card.locator('.photoKind').textContent()||'');
  expect(kind).not.toContain('Photo on request');
  expect(kind.toLowerCase()).not.toContain('temporarily unavailable');
}

test('homepage photos remain visible after 20 seconds, scrolling, resizing and reload',async({page})=>{
  test.setTimeout(120000);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  let found=await firstLoadedCard(page);
  await assertStillVisible(found.img,found.card,found.src);
  await page.screenshot({path:`${SHOTS}/photo-home-initial-1440.png`,fullPage:false});

  await page.waitForTimeout(10000);
  await assertStillVisible(found.img,found.card,found.src);
  await page.screenshot({path:`${SHOTS}/photo-home-10s-1440.png`,fullPage:false});

  await page.waitForTimeout(10000);
  await assertStillVisible(found.img,found.card,found.src);
  await page.screenshot({path:`${SHOTS}/photo-home-20s-1440.png`,fullPage:false});

  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(500);
  await assertStillVisible(found.img,found.card,found.src);

  for(const width of [360,390,768,1440,1920]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(350);
    await assertStillVisible(found.img,found.card,found.src);
  }

  await page.reload({waitUntil:'domcontentloaded'});
  found=await firstLoadedCard(page);
  await page.waitForTimeout(10000);
  await assertStillVisible(found.img,found.card,found.src);
  await page.screenshot({path:`${SHOTS}/photo-home-cached-reload-1440.png`,fullPage:false});
});

test('a slow but valid image is never replaced by a timeout fallback',async({page})=>{
  test.setTimeout(60000);
  await page.route('**/api/model-photo/1/0',async route=>{
    await new Promise(resolveTimeout=>setTimeout(resolveTimeout,8000));
    await route.fulfill({path:resolve('public/demo/vehicles/car-1.webp'),contentType:'image/webp'});
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/cars',{waitUntil:'domcontentloaded'});
  const card=page.locator('.vehicleCard').first();
  await expect(card).toBeVisible();
  const img=card.locator('img.vehiclePhoto');
  await expect(img).toHaveCount(1);
  await page.waitForTimeout(2000);
  expect(await card.locator('.vehiclePhotoFallback').count()).toBe(0);
  await expect(card.locator('.photoKind')).toContainText('Photo loading');

  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0)),{timeout:15000}).toBeTruthy();
  expect(await card.locator('.vehiclePhotoFallback').count()).toBe(0);
  await expect(card.locator('.photoKind')).toContainText('Representative photo');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${SHOTS}/photo-slow-loaded-1440.png`,fullPage:false});
});

test('a genuinely broken image shows an honest temporary-error fallback',async({page})=>{
  await page.route('**/api/model-photo/1/0',route=>route.abort('failed'));
  await page.goto('/cars',{waitUntil:'domcontentloaded'});
  const card=page.locator('.vehicleCard').first();
  const fallback=card.locator('.vehiclePhotoFallback.isError');
  await expect(fallback).toBeVisible({timeout:15000});
  await expect(fallback).toContainText('Photo temporarily unavailable');
  await expect(card.locator('.photoKind')).toContainText('temporarily unavailable');
  await expect(card.locator('.photoKind')).not.toHaveText(/^Exact stock photo$/);
  expect(await card.getByText('Photo on request',{exact:true}).count()).toBe(0);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${SHOTS}/photo-broken-1440.png`,fullPage:false});
});

test('image source changes are source-safe and ignore stale callbacks',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/photo-lifecycle-test',{waitUntil:'domcontentloaded'});
  const harness=page.locator('[data-testid="photo-harness"]');
  const img=harness.locator('img.vehiclePhoto');
  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  await harness.getByRole('button',{name:'Show vehicle B'}).click();
  await expect(img).toHaveAttribute('src',/moto-1/);
  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  await harness.getByRole('button',{name:'Show vehicle A'}).click();
  await expect(img).toHaveAttribute('src',/car-1/);
  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  expect(await harness.locator('.vehiclePhotoFallback').count()).toBe(0);
});

test('stale delayed callbacks cannot replace a newer image source',async({page})=>{
  test.setTimeout(60000);
  await page.route('**/demo/vehicles/moto-1.webp',async route=>{
    await new Promise(resolveTimeout=>setTimeout(resolveTimeout,5000));
    await route.fulfill({path:resolve('public/demo/vehicles/moto-1.webp'),contentType:'image/webp'});
  });
  await page.goto('/photo-lifecycle-test',{waitUntil:'domcontentloaded'});
  const harness=page.locator('[data-testid="photo-harness"]');
  const img=harness.locator('img.vehiclePhoto');
  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  await harness.getByRole('button',{name:'Show vehicle B'}).click();
  await page.waitForTimeout(250);
  await harness.getByRole('button',{name:'Show vehicle A'}).click();
  await page.waitForTimeout(6000);
  await expect(img).toHaveAttribute('src',/car-1/);
  expect(await img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  expect(await harness.locator('.vehiclePhotoFallback').count()).toBe(0);
});

test('detail gallery images also persist and the remaining vehicle pages render',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/vehicles/1',{waitUntil:'domcontentloaded'});
  const img=page.locator('.galleryMain img').first();
  await expect.poll(()=>img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0)),{timeout:20000}).toBeTruthy();
  const src=await img.getAttribute('src');
  await page.waitForTimeout(10000);
  await expect(img).toHaveAttribute('src',src||'');
  expect(await img.evaluate((el:any)=>!!(el.complete&&el.naturalWidth>0))).toBeTruthy();
  await page.screenshot({path:`${SHOTS}/photo-detail-10s-1440.png`,fullPage:false});

  for(const [path,name] of [['/','photo-final-home'],['/cars','photo-final-cars'],['/motorcycles','photo-final-motorcycles'],['/sold-vehicles','photo-final-sold']] as const){
    await page.goto(path,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(700);
    await page.screenshot({path:`${SHOTS}/${name}-1440.png`,fullPage:false});
  }
});
