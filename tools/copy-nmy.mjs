import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(process.cwd(), '..'));
const src = path.join(root, 'NMY.html');
const dest = path.join(root, 'web', 'dist', 'NMY.html');

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (!fs.existsSync(src)) {
  console.warn('NMY.html not found at project root (skip copy).');
  process.exit(0);
}
fs.copyFileSync(src, dest);
console.log('Copied NMY.html -> web/dist/NMY.html');

\nconst distDir = path.join(root, 'web','dist');\nconst reactIndex = path.join(distDir, 'index.html');\ntry {\n  const reactHtml = fs.readFileSync(reactIndex, 'utf8');\n  const reactOutDir = path.join(distDir, 'react');\n  fs.mkdirSync(reactOutDir, { recursive: true });\n  fs.writeFileSync(path.join(reactOutDir, 'index.html'), reactHtml, 'utf8');\n  // Overwrite root index.html with NMY.html to make it default\n  const nmyHtml = fs.readFileSync(dest, 'utf8');\n  fs.writeFileSync(reactIndex, nmyHtml, 'utf8');\n  console.log('Set NMY.html as root index and kept React at /react/');\n} catch(e){ console.warn('Post-build tweak failed:', e?.message||e); }\n
