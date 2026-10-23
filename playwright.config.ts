import {defineConfig} from '@playwright/test';
// Test-only legacy admin credentials let the browser suite render the protected analytics shell
// without touching production data or requiring a real administrator password.
process.env.ADMIN_EMAIL=process.env.ADMIN_EMAIL||'visual-admin@skyshcars.invalid';
process.env.ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'visual-test-only';
export default defineConfig({
  testDir:'./tests/visual',
  timeout:120000,
  expect:{timeout:15000},
  reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:3111',headless:true,trace:'off'},
  webServer:{command:'npm run start -- -p 3111',url:'http://127.0.0.1:3111',timeout:180000,reuseExistingServer:false,env:{...process.env,PHOTO_TEST_ROUTE:'1'},stdout:'ignore',stderr:'pipe'},
});
