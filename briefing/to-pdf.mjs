import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'preview.html');
const pdfPath = path.join(__dirname, 'briefing.pdf');

const browser = await puppeteer.launch();
const page = await browser.newPage();

await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, {
  waitUntil: 'networkidle0',
  timeout: 30000,
});

// mermaid 렌더링 완료 대기
await page.waitForFunction(
  () => document.querySelectorAll('.mermaid svg').length > 0,
  { timeout: 15000 }
);
await new Promise(r => setTimeout(r, 2000));

await page.pdf({
  path: pdfPath,
  format: 'A4',
  margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  printBackground: true,
});

await browser.close();
console.log(`PDF saved: ${pdfPath}`);
