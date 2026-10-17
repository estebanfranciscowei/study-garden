const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');
fs.mkdirSync(outputDir, { recursive: true });

async function launchBrowser() {
  const options = { headless: true };
  if (process.env.PLAYWRIGHT_CHANNEL) options.channel = process.env.PLAYWRIGHT_CHANNEL;
  return chromium.launch(options);
}

module.exports = { root, outputDir, launchBrowser };
