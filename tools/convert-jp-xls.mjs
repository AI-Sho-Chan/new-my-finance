#!/usr/bin/env node
// Convert data/data_j.xls (TSE all listings) to data/jp-stocks.json
// Heuristics to detect code and name columns.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
// Enable legacy codepage support for .xls (Shift_JIS etc.)
import * as cpexcel from 'xlsx/dist/cpexcel.js';
if (typeof XLSX.set_cptable === 'function') {
  try { XLSX.set_cptable(cpexcel); } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(path.join(__dirname, '..'));
const SRC = path.join(ROOT, 'data', 'data_j.xls');
const DST = path.join(ROOT, 'data', 'jp-stocks.json');

function isJP(str) {
  if (typeof str !== 'string') return false;
  // Any Hiragana/Katakana/Kanji
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(str);
}

function normalizeCode(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[^0-9]/g, '');
  if (s.length === 0) return null;
  // Accept 4 digit codes only
  if (s.length !== 4) return null;
  return s.padStart(4, '0');
}

function detectColumns(rows) {
  // rows: array of arrays (header+data)
  // Try to find header row first
  let headerIndex = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const r = rows[i] || [];
    const filled = r.filter(x => x != null && String(x).trim() !== '').length;
    if (filled >= 2) { headerIndex = i; break; }
  }
  if (headerIndex < 0) headerIndex = 0;
  const header = (rows[headerIndex] || []).map(x => String(x || '').trim());

  // Common header name candidates
  const codeHeaderCandidates = ['コード', '銘柄コード', '証券コード', 'コード番号', 'コードNO', '証券ｺｰﾄﾞ'];
  const nameHeaderCandidates = ['銘柄名', '名称', '会社名', '企業名', '社名'];

  let codeIdx = -1, nameIdx = -1;
  header.forEach((h, i) => {
    if (codeIdx < 0 && codeHeaderCandidates.some(k => h.includes(k))) codeIdx = i;
    if (nameIdx < 0 && nameHeaderCandidates.some(k => h.includes(k))) nameIdx = i;
  });

  // Fallback detection via content sampling
  const sample = rows.slice(headerIndex + 1, headerIndex + 101);
  if (codeIdx < 0) {
    // choose column with many 4-digit numeric values
    let best = { idx: -1, score: -1 };
    const width = Math.max(...sample.map(r => r.length));
    for (let c = 0; c < width; c++) {
      let hits = 0, total = 0;
      for (const r of sample) {
        const v = r[c]; if (v == null || String(v).trim() === '') continue; total++;
        if (normalizeCode(v)) hits++;
      }
      if (total > 0 && hits / total > best.score) best = { idx: c, score: hits / total };
    }
    if (best.score >= 0.5) codeIdx = best.idx;
  }
  if (nameIdx < 0) {
    let best = { idx: -1, score: -1 };
    const width = Math.max(...sample.map(r => r.length));
    for (let c = 0; c < width; c++) {
      let hits = 0, total = 0;
      for (const r of sample) {
        const v = r[c]; if (v == null || String(v).trim() === '') continue; total++;
        if (isJP(String(v))) hits++;
      }
      if (total > 0 && hits / total > best.score) best = { idx: c, score: hits / total };
    }
    if (best.score >= 0.5) nameIdx = best.idx;
  }

  return { headerIndex, codeIdx, nameIdx };
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source Excel not found: ${SRC}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(SRC);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const { headerIndex, codeIdx, nameIdx } = detectColumns(rows);
  if (codeIdx < 0 || nameIdx < 0) {
    console.error(`Failed to detect columns (codeIdx=${codeIdx}, nameIdx=${nameIdx}).`);
    process.exit(2);
  }

  const out = [];
  const seen = new Set();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const code = normalizeCode(r[codeIdx]);
    const name = String(r[nameIdx] || '').trim();
    if (!code || !name) continue;
    if (seen.has(code)) continue; seen.add(code);
    out.push({ code, name });
  }

  out.sort((a, b) => a.code.localeCompare(b.code));
  // Fetch Yahoo names for all codes; prefer Yahoo over Excel names
  console.log(`Fetching names from Yahoo Finance for ${out.length} codes (in chunks)...`);
  const updated = new Map(out.map(x => [x.code, x.name]));
  const codes = out.map(x => x.code);
  const chunks = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  const headers = { 'User-Agent': 'Mozilla/5.0 NewMyFinance/convert-jp-xls', 'Accept': 'application/json', 'Accept-Language': 'ja,en;q=0.9' };
  for (const ch of chunks) {
    const syms = ch.map(c => `${c}.T`).join(',');
    const u1 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`;
    let resp = await fetch(u1, { headers });
    let j = await resp.json();
    let list = j?.quoteResponse?.result;
    if (!Array.isArray(list) || list.length === 0) {
      const u2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`;
      resp = await fetch(u2, { headers });
      j = await resp.json();
      list = j?.quoteResponse?.result;
    }
    if (Array.isArray(list)) {
      for (const it of list) {
        const sym = String(it?.symbol || '');
        const code = sym.endsWith('.T') ? sym.slice(0, -2) : null;
        if (!code) continue;
        const name = it?.longName || it?.shortName || null;
        if (name) updated.set(code, String(name));
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  for (const o of out) { o.name = updated.get(o.code) || o.name; }

  fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${out.length} entries to ${path.relative(ROOT, DST)} (from sheet '${sheetName}').`);
}

main();
