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

// Remove Tailwind CDN include if present
const tailwindCdnRegex = /\n\s*<script\s+src=\"https:\/\/cdn\.tailwindcss\.com\"><\/script>\s*/i;
htmlNoBabelCdn = htmlNoBabelCdn.replace(tailwindCdnRegex, '\n');

// Decide CSS injection (local Tailwind or CDN fallback)
const tailwindBuilt = fs.existsSync(path.join(outDir, 'tailwind.css'));
const cssTag = tailwindBuilt
  ? '<link rel="stylesheet" href="/local-dist/tailwind.css" />'
  : '<script src="https://cdn.tailwindcss.com"></script>';

// Inject Tailwind CSS and bundled JS
let headInjected = htmlNoBabelCdn;
if (headInjected.includes('</head>')) {
  headInjected = headInjected.replace('</head>', `  ${cssTag}\n</head>`);
} else {
  headInjected += `\n${cssTag}\n`;
}
const newHtml = `${headInjected}<script defer src="/local-dist/nmy.bundle.js"></script>${after}`;
fs.writeFileSync(outHtml, newHtml, 'utf8');

console.log('Built local-dist/NMY.local.html and nmy.bundle.js');
console.log('Open: http://127.0.0.1:8080/local-dist/NMY.local.html');
