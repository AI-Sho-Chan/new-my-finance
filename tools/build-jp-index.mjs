#!/usr/bin/env node
// Build data/jp-stocks.json from data/data_j.xls by fetching names from Yahoo

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import * as cpexcel from 'xlsx/dist/cpexcel.js';
if (typeof XLSX.set_cptable === 'function') {
  try { XLSX.set_cptable(cpexcel); } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(path.join(__dirname, '..'));
const SRC = path.join(ROOT, 'data', 'data_j.xls');
const DST = path.join(ROOT, 'data', 'jp-stocks.json');

function normalizeCode(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[^0-9]/g, '');
  if (s.length !== 4) return null;
  return s.padStart(4, '0');
}

function getCodesFromXls() {
  if (!fs.existsSync(SRC)) throw new Error('Missing ' + SRC);
  const wb = XLSX.readFile(SRC);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const codes = new Set();
  for (const r of rows) {
    for (const cell of r) {
      const c = normalizeCode(cell);
      if (c) codes.add(c);
    }
  }
  return Array.from(codes).sort();
}

async function fetchPriceName(code) {
  const headers = { 'User-Agent': 'Mozilla/5.0 NewMyFinance/build-jp-index', 'Accept': 'application/json', 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' };
  const sym = `${code}.T`;
  const u1 = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=price`;
  try {
    const r1 = await fetch(u1, { headers });
    const j1 = await r1.json();
    const res = (j1?.quoteSummary?.result || [])[0] || {};
    const price = res.price || {};
    const nm = price.longName || price.shortName || null;
    if (nm) return nm;
  } catch {}
  const u2 = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=price`;
  try {
    const r2 = await fetch(u2, { headers });
    const j2 = await r2.json();
    const res = (j2?.quoteSummary?.result || [])[0] || {};
    const price = res.price || {};
    const nm = price.longName || price.shortName || null;
    if (nm) return nm;
  } catch {}
  return null;
}

async function main() {
  const codes = getCodesFromXls();
  console.log(`Found ${codes.length} candidate codes in xls`);
  const out = [];
  const concurrency = 20;
  let i = 0;
  async function runBatch(batch) {
    await Promise.all(batch.map(async code => {
      const name = await fetchPriceName(code);
      out.push({ code, name: name || '' });
    }));
  }
  while (i < codes.length) {
    const batch = codes.slice(i, i + concurrency);
    process.stdout.write(`Resolving names ${i+1}-${Math.min(i+concurrency, codes.length)} / ${codes.length}...\r`);
    await runBatch(batch);
    i += concurrency;
    await new Promise(r => setTimeout(r, 200));
  }
  out.sort((a,b)=>a.code.localeCompare(b.code));
  fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nWrote ${out.length} entries to ${path.relative(ROOT, DST)}`);
}

main().catch(e => { console.error(e); process.exit(1); });

