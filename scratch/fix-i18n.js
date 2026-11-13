const fs = require('fs');
const p = 'libraries/react-shared-libraries/src/translation/locales/en/translation.json';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const out = lines.map((l) => {
  const m = l.match(/^(\s*)"([^"]+)":\s*(.*)$/);
  if (!m) return l;
  const key = m[2].replace(/Latte/g, 'postiz');
  const val = m[3].replace(/Latte-app/g, 'postiz-app');
  return `${m[1]}"${key}": ${val}`;
});
fs.writeFileSync(p, out.join('\n'));
const o = JSON.parse(fs.readFileSync(p, 'utf8'));
const bad = Object.keys(o).filter((k) => /Latte/.test(k));
console.log('keys:', Object.keys(o).length, 'badKeys:', bad.length, bad);
