const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
for (const [, attributes, source] of scripts) {
  const external = attributes.match(/\bsrc="([^"]+)"/);
  const filename = external?.[1] || 'index.html:inline';
  new vm.Script(external ? fs.readFileSync(path.join(root, filename), 'utf8') : source, { filename });
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
for (const match of html.matchAll(/(?:href|src)="([^"#]+\.(?:css|js))"/g)) {
  assert.ok(fs.existsSync(path.join(root, match[1])), 'Missing asset: ' + match[1]);
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'cloud-config.json'), 'utf8'));
assert.match(config.url, /^https:\/\/[a-z\d-]+\.supabase\.co\/?$/i);
assert.match(config.publishableKey, /^sb_publishable_/);
for (const file of ['appearance.css', 'study-tools.css']) {
  assert.ok(fs.readFileSync(path.join(root, file), 'utf8').trim());
}
console.log('PASS: JavaScript syntax, unique HTML IDs, static assets and public cloud configuration.');
