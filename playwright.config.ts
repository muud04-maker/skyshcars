import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/visual',
  timeout:120000,
  expect:{timeout:15000},
  reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:3111',headless:true,trace:'off'},
  webServer:{command:'npm run start -- -p 3111',url:'http://127.0.0.1:3111',timeout:180000,reuseExistingServer:false,stdout:'ignore',stderr:'pipe'},
});