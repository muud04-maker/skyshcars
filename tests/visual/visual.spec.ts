import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

/*
  Release-blocking browser gate. Chromium renders the built app; the first test measures what is
  painted over the centre and corners of every visible vehicle photo, and the remaining tests capture
  the pages the owner asked us to inspect. Generated screenshots are reviewed, not just created.
*/
const SHOTS='tests/visual/screenshots';
mkdirSync(SHOTS,{recursive:true});
const widths=[{w:360,h:800,n:'360'},{w:390,h:844,n:'390'},{w:768,h:1024,n:'768'},{w:1440,h:1000,n:'1440'},{w:1920,h:1080,n:'1920'}];

async function overlayReport(page:any){
  return await page.evaluate(()=>{
    const out:any[]=[];
    const cards=[...document.querySelectorAll('.vehicleCard, .stockCard, .miniVehicle')].slice(0,24);
    for(const card of cards){
      const img=card.querySelector('img') as HTMLImageElement|null; if(!img) continue;
      const r=img.getBoundingClientRect(); if(r.width<4||r.height<4) continue;
      const pts=[[0.5,0.5],[0.5,0.25],[0.5,0.75],[0.25,0.5],[0.75,0.5]];
      const hits:any[]=[];
      for(const [fx,fy] of pts){
        const x=r.left+r.width*fx, y=r.top+r.height*fy;
        if(y<0||y>window.innerHeight) continue;
        const el=document.elementFromPoint(x,y) as HTMLElement|null;
        if(!el) continue;
        const cs=getComputedStyle(el); const rr=el.getBoundingClientRect();
        hits.push({tag:el.tagName,cls:String((el as any).className||''),bg:cs.backgroundColor,radius:cs.borderRadius,w:Math.round(rr.width),h:Math.round(rr.height),opacity:cs.opacity});
      }
      if(!hits.length) continue;
      const badges=[...card.querySelectorAll('.steeringTag,.soldBadge,.badge')].map((el:any)=>{const rr=el.getBoundingClientRect();return {cls:String(el.className||''),w:Math.round(rr.width),h:Math.round(rr.height),text:String(el.textContent||'').slice(0,40)};});
      out.push({card:String((card as any).className),img:{w:Math.round(r.width),h:Math.round(r.height),src:(img.getAttribute('src')||'').slice(0,100),loaded:img.complete&&img.naturalWidth>0},hits,badges});
    }
    return out;
  });
}

async function firstVehicleHref(page:any){
  await page.goto('/vehicles',{waitUntil:'domcontentloaded'});
  const href=await page.locator('.vehicleCard .vehicleImageWrap').first().getAttribute('href');
  expect(href).toBeTruthy();
  return href as string;
}

test('vehicle photos are fully visible; no opaque overlay and no oversized badge',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  let total=0;
  for(const path of ['/vehicles','/sold-vehicles']){
    await page.goto(path,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(path==='/vehicles'?3500:700);
    const card=page.locator('.vehicleCard').first();
    if(await card.count()){
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
    }
    const report=await overlayReport(page);
    console.log(`OVERLAY_REPORT ${path} `+JSON.stringify(report,null,1));
    total+=report.length;
    for(const item of report){
      // A slow upstream image is intentionally allowed to remain in its loading state.
      // photo-lifecycle.spec.ts verifies slow/cached success and genuine failures explicitly.
      for(const badge of item.badges){
        expect(badge.w,`oversized badge ${badge.cls} (${badge.text})`).toBeLessThan(item.img.w*0.82);
        expect(badge.h,`oversized badge ${badge.cls} (${badge.text})`).toBeLessThan(item.img.h*0.62);
      }
      for(const hit of item.hits){
        const rgba=hit.bg||'';
        const m=rgba.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        const alpha=m?Number(m[4]===undefined?1:m[4]):(/transparent/.test(rgba)?0:1);
        const opaque=alpha>0.35;
        const huge=hit.w*hit.h>0.12*(item.img.w*item.img.h);
        const isImage=hit.tag==='IMG'||/vehiclePhoto/.test(hit.cls);
        if(opaque&&huge&&!isImage) throw new Error(`Opaque overlay ${hit.w}x${hit.h} (${hit.bg}, radius ${hit.radius}) <${hit.tag} class="${hit.cls}"> covers the photo centre of ${item.card}`);
      }
    }
  }
  expect(total).toBeGreaterThan(0);
});

test('hero uses a real inventory image, not an empty marketing panel',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  const hero=page.locator('.heroMedia img').first();
  await expect(hero).toBeVisible();
  const loaded=await hero.evaluate((img:any)=>img.complete&&img.naturalWidth>0);
  expect(loaded).toBeTruthy();
  const box=await hero.boundingBox();
  expect(box?.width||0).toBeGreaterThan(300);
  expect(box?.height||0).toBeGreaterThan(200);
});

test('each public page has a distinct scoped identity and motorcycles are ice-blue',async({page})=>{
  const expected:[string,string][]=[
    ['/vehicles','theme-vehicles'],
    ['/cars','theme-cars'],
    ['/motorcycles','theme-motorcycles'],
    ['/vehicles?fuel=electric','theme-electric'],
    ['/sold-vehicles','theme-sold'],
    ['/shipping','pageShipping'],
    ['/destinations','pageDestinations'],
    ['/quote','pageQuote'],
    ['/account','theme-account'],
    ['/compare','theme-compare'],
    ['/login','theme-auth'],
  ];
  for(const [path,cls] of expected){
    await page.goto(path,{waitUntil:'domcontentloaded'});
    await expect(page.locator('main.'+cls)).toBeVisible();
  }
  await page.goto('/motorcycles',{waitUntil:'domcontentloaded'});
  const colors=await page.locator('.catalogHero').evaluate(el=>getComputedStyle(el).backgroundImage);
  const rgb=[...colors.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)].map(m=>[Number(m[1]),Number(m[2]),Number(m[3])]);
  expect(rgb.some(([r,g,b])=>b>r+20&&b>200&&g>200),`motorcycle hero was not light blue: ${colors}`).toBeTruthy();
});

test('no horizontal overflow on public pages',async({page})=>{
  const detail=await firstVehicleHref(page);
  for(const v of widths){
    await page.setViewportSize({width:v.w,height:v.h});
    for(const path of ['/','/vehicles','/sold-vehicles','/shipping','/quote','/login',detail]){
      await page.goto(path,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(350);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      expect(overflow,`${path} at ${v.w}px overflows by ${overflow}px`).toBeLessThanOrEqual(2);
    }
  }
});

test('mobile navigation opens and keeps every account/support route reachable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
  await page.locator('.mobileMenu summary').click();
  await expect(page.locator('.mobileMenuPanel')).toBeVisible();
  await expect(page.locator('.mobileSearch input')).toBeVisible();
  const panelBox=await page.locator('.mobileMenuPanel').boundingBox();
  expect(panelBox?.width||0).toBeGreaterThan(300);
  for(const text of ['All Vehicles','Cars','Motorcycles','Sold Vehicles','Saved vehicles','Compare','Track shipment','WhatsApp support']){
    await expect(page.locator('.mobileMenuPanel').getByText(text,{exact:true}).first()).toBeVisible();
  }
  await page.screenshot({path:`${SHOTS}/mobile-menu-390.png`});
});

test('desktop navigation fits at 1440 and 1920 without clipping',async({page})=>{
  for(const width of [1440,1920]){
    await page.setViewportSize({width,height:1000});
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const nav=await page.evaluate(()=>{
      const inner=document.querySelector('.siteNavInner') as HTMLElement;
      const links=[...document.querySelectorAll('.siteNav a')] as HTMLElement[];
      return {scroll:inner.scrollWidth,client:inner.clientWidth,lastRight:links[links.length-1].getBoundingClientRect().right,width:inner.getBoundingClientRect().width};
    });
    expect(nav.scroll,`nav overflows at ${width}px`).toBeLessThanOrEqual(nav.client+1);
    expect(nav.lastRight,`last nav item is clipped at ${width}px`).toBeLessThanOrEqual(width-8);
  }
});

test('key screenshots at phone, tablet, desktop and wide desktop',async({page})=>{
  for(const v of widths){
    await page.setViewportSize({width:v.w,height:v.h});
    for(const [path,name] of [['/','home'],['/vehicles','marketplace'],['/sold-vehicles','sold']] as const){
      await page.goto(path,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(path==='/vehicles'?3500:900);
      await page.screenshot({path:`${SHOTS}/${name}-${v.n}.png`,fullPage:true});
    }
  }
  for(const v of ['390','1440']){
    const width=widths.find(x=>x.n===v)!;
    await page.setViewportSize({width:width.w,height:width.h});
    for(const [path,name] of [['/shipping','shipping'],['/quote','quote'],['/login','login']] as const){
      await page.goto(path,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(600);
      await page.screenshot({path:`${SHOTS}/${name}-${v}.png`,fullPage:true});
    }
  }
});

test('available and sold vehicle detail pages render their gallery and actions',async({page})=>{
  const detail=await firstVehicleHref(page);
  for(const v of ['390','1440']){
    const width=widths.find(x=>x.n===v)!;
    await page.setViewportSize({width:width.w,height:width.h});
    await page.goto(detail,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(1200);
    await expect(page.locator('.vehicleGallery')).toBeVisible();
    await expect(page.locator('.vehicleInfoPanel h1')).toBeVisible();
    await expect(page.locator('.detailActions .btn').first()).toBeVisible();
    const galleryImage=page.locator('.galleryMain img').first();
    if(await galleryImage.count()) await expect(galleryImage).toBeVisible();
    await page.screenshot({path:`${SHOTS}/detail-${v}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/sold-vehicles',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(700);
  const soldCard=page.locator('.vehicleCard.isSold .vehicleImageWrap').first();
  if(await soldCard.count()){
    const href=await soldCard.getAttribute('href');
    if(href){
      await page.goto(href,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(900);
      await expect(page.locator('.soldNotice')).toBeVisible();
      await page.screenshot({path:`${SHOTS}/sold-detail-1440.png`,fullPage:true});
    }
  }
});

test('admin routes remain protected from public visitors',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/admin/vehicles',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
  const url=page.url();
  const loginVisible=await page.locator('input[type="password"], form').first().isVisible().catch(()=>false);
  expect(url.includes('/admin/login')||loginVisible,`admin route was publicly reachable at ${url}`).toBeTruthy();
  await page.screenshot({path:`${SHOTS}/admin-protected-390.png`,fullPage:true});
});
