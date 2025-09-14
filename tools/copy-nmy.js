// Copy root NMY.html into web/dist for Vercel routing
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'NMY.html');
const dest = path.join(root, 'web', 'dist', 'NMY.html');

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (!fs.existsSync(src)) {
  console.error('NMY.html not found at project root.');
  process.exit(0);
}
fs.copyFileSync(src, dest);
console.log('Copied NMY.html -> web/dist/NMY.html');

