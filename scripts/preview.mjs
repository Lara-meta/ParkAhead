import { chromium } from '@playwright/test';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1080}});
await page.goto('http://localhost:3000');
await page.getByRole('heading',{name:/Less circling/}).waitFor();
await page.screenshot({path:'preview-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'preview-mobile.png',fullPage:true});
await browser.close();
