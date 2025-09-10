#!/usr/bin/env node
// Convert data/data_j.csv to data/jp-stocks.json
// Auto-detect code/name columns. CSV must be UTF-8.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import * as cpexcel from 'xlsx/dist/cpexcel.js';
if (typeof XLSX.set_cptable === 'function') {
  try { XLSX.set_cptable(cpexcel); } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(path.join(__dirname, '..'));
const SRC = path.join(ROOT, 'data', 'data_j.csv');
const DST = path.join(ROOT, 'data', 'jp-stocks.json');

function isJP(str) { return /[\u3040-\u30ff\u3400-\u9fff]/.test(str || ''); }
function normalizeCode(v) {
  const s = String(v ?? '').trim().replace(/[^0-9]/g, '');
  return s.length === 4 ? s : null;
}

function detectColumns(rows) {
  // header candidates
  const codeHeader = ['コード', '証券コード', '銘柄コード', 'コード番号', 'コードNO', '証券ｺｰﾄﾞ'];
  const nameHeader = ['銘柄名', '名称', '会社名', '企業名', '社名'];
  let headerIdx = -1, codeIdx = -1, nameIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const hdr = r.map(x => String(x ?? '').trim());
    hdr.forEach((h, j) => {
      if (codeIdx < 0 && codeHeader.some(k => h.includes(k))) { codeIdx = j; headerIdx = i; }
      if (nameIdx < 0 && nameHeader.some(k => h.includes(k))) { nameIdx = j; headerIdx = i; }
    });
    if (codeIdx >= 0 && nameIdx >= 0) break;
  }
  if (codeIdx >= 0 && nameIdx >= 0) return { headerIdx, codeIdx, nameIdx };
  // fallback by sampling
  const sample = rows.slice(0, 200);
  const width = Math.max(...sample.map(r => r.length));
  let bestCode = { idx: -1, score: -1 }, bestName = { idx: -1, score: -1 };
  for (let c = 0; c < width; c++) {
    let tot = 0, codeHits = 0, jpHits = 0;
    for (const r of sample) {
      const v = r[c]; if (v == null || String(v).trim() === '') continue; tot++;
      if (normalizeCode(v)) codeHits++;
      if (isJP(String(v))) jpHits++;
    }
    if (tot > 0) {
      const s1 = codeHits / tot, s2 = jpHits / tot;
      if (s1 > bestCode.score) bestCode = { idx: c, score: s1 };
      if (s2 > bestName.score) bestName = { idx: c, score: s2 };
    }
  }
  return { headerIdx: headerIdx >= 0 ? headerIdx : 0, codeIdx: bestCode.idx, nameIdx: bestName.idx };
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('CSV not found:', SRC);
    process.exit(1);
  }
  const buf = fs.readFileSync(SRC);
  const isBinary = buf.slice(0, 4).toString('hex').toUpperCase() === 'D0CF11E0' || buf.slice(0, 2).toString('utf8') === 'PK' || buf.includes(0);
  let rows;
  if (isBinary) {
    // Treat as Excel (xls/xlsx) despite .csv extension
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  } else {
    const text = buf.toString('utf8');
    rows = parse(text, { skip_empty_lines: true });
  }
  const { headerIdx, codeIdx, nameIdx } = detectColumns(rows);
  if (codeIdx < 0 || nameIdx < 0) {
    console.error('Failed to detect code/name columns.');
    process.exit(2);
  }
  const out = [];
  const seen = new Set();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = normalizeCode(r[codeIdx]);
    const name = String(r[nameIdx] ?? '').trim();
    if (!code || !name) continue;
    if (seen.has(code)) continue; seen.add(code);
    out.push({ code, name });
  }
  out.sort((a,b)=>a.code.localeCompare(b.code));
  fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${out.length} entries to ${path.relative(ROOT, DST)} from CSV.`);
}

main();
