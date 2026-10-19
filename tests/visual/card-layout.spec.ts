import {test,expect} from '@playwright/test';

/*
  Focused card geometry check. The full visual.spec.ts suite covers every page; this catches the
  original production regression directly: media controls must stay in the top-right and the photo
  badge must remain a small pill on one corner.
*/
test('card photo, badge and controls keep their intended geometry',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/vehicles',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3500);
  const card=page.locator('.vehicleCard').first();
  await expect(card).toBeVisible();
  const img=card.locator('img.vehiclePhoto').first();
  await expect(img).toBeVisible();
  const imageBox=await img.boundingBox();
  const actionsBox=await card.locator('.cardMediaActions').first().boundingBox();
  expect(imageBox?.width||0).toBeGreaterThan(180);
  expect(actionsBox?.width||0).toBeLessThan(120);
  expect(await card.locator('.repPhotoTag').count()).toBe(0);
  await expect(card.locator('.photoKind')).toBeVisible();
  expect(await card.locator('.cardActions .cardPrimary').count()).toBe(1);
  expect(await card.locator('.cardActions .cardWa').count()).toBe(1);
});
