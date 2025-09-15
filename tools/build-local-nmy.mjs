import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const root = path.resolve(path.join(process.cwd()));
const srcPath = path.join(root, 'NMY.html');
const outDir = path.join(root, 'local-dist');
const outHtml = path.join(outDir, 'NMY.local.html');
const outJs = path.join(outDir, 'nmy.bundle.js');

const html = fs.readFileSync(srcPath, 'utf8');
const tag = '<script type="text/babel">';
const i = html.indexOf(tag);
if (i < 0) {
  console.error('No <script type="text/babel"> block found in NMY.html');
  process.exit(2);
}
const j = html.indexOf('</script>', i + tag.length);
if (j < 0) {
  console.error('No closing </script> found for Babel block');
  process.exit(3);
}
const before = html.slice(0, i);
const code = html.slice(i + tag.length, j);
const after = html.slice(j + '</script>'.length);

// Compile JSX -> JS (React global)
const built = transformSync(code, {
  loader: 'jsx',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: 'es2020',
  legalComments: 'none',
  minify: false,
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outJs, built.code, 'utf8');

// Remove the Babel standalone script include line if present
const babelCdnRegex = /\n\s*<script\s+src=\"https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js\"><\/script>\s*/i;
let htmlNoBabelCdn = before.replace(babelCdnRegex, '\n');

// Inject bundled script tag (defer to keep order)
const newHtml = `${htmlNoBabelCdn}<script defer src="/local-dist/nmy.bundle.js"></script>${after}`;
fs.writeFileSync(outHtml, newHtml, 'utf8');

console.log('Built local-dist/NMY.local.html and nmy.bundle.js');
console.log('Open: http://127.0.0.1:8080/local-dist/NMY.local.html');

