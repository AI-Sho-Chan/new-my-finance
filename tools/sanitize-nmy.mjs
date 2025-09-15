import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const root = path.resolve(path.join(process.cwd(), ".."));
const targets = [path.join(root, 'web','dist','NMY.html'), path.join(root,'web','dist','index.html')];
const scriptRe = /<script\b[^>]*type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/i;

function countOf(s, re){ const m = s.match(re); return m ? m.length : 0; }

for (const file of targets) {
  let html;
  try { html = await fs.readFile(file, 'utf8'); }
  catch { console.log(`[sanitize-nmy] skip: ${file} not found`); continue; }
  const m = html.match(scriptRe);
  if (!m) { console.log(`[sanitize-nmy] skip: no inline babel in ${file}`); continue; }
  let code = m[1];
  const stats = {
    zeroWidth: (code.match(/[\u200B-\u200F\uFEFF]/g) || []).length,
    controls: (code.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length,
    lsep:      (code.match(/[\u2028\u2029]/g) || []).length,
    cr:        (code.match(/\r/g) || []).length,
  };
  // normalize/strip
  code = code.replace(/\r\n?/g, '\n');
  code = code.replace(/[\u2028\u2029]/g, '\n');
  code = code.replace(/[\u200B-\u200F\uFEFF]/g, '');
  code = code.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // bracket sanity
  for (const [o,c] of [[/\(/g,/\)/g],[/\{/g,/\}/g],[/\[/g,/\]/g]]){
    const co = countOf(code,o), cc = countOf(code,c);
    if (co !== cc) throw new Error(`[sanitize-nmy] bracket mismatch: ${co} != ${cc}`);
  }
  // parse jsx to verify
  try {
    parse(code, { sourceType:'unambiguous', plugins:['jsx','classProperties','classPrivateProperties','classPrivateMethods','dynamicImport','optionalChaining','nullishCoalescingOperator','topLevelAwait']});
  } catch(e){
    const outdir = path.join(root,'web','dist','__debug__');
    await fs.mkdir(outdir,{recursive:true});
    await fs.writeFile(path.join(outdir,'NMY.inline.sanitized.js'), code);
    const loc = e.loc ? `(${e.loc.line}:${e.loc.column})` : '';
    console.error(`[sanitize-nmy] babel-parse error${loc}: ${e.message}`);
    process.exit(1);
  }
  const sanitized = html.replace(scriptRe, (all, body) => all.replace(body, code));
  await fs.writeFile(file, sanitized);
  console.log(`[sanitize-nmy] sanitized: ${path.basename(file)} =>`, stats);
}
