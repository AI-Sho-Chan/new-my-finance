#!/usr/bin/env node
// Synchronize J-Quants data locally (calendar, EOD, events) with graceful fallbacks
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data', 'jq');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function readJSON(file, fallback=null){ try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return fallback; } }
function writeJSON(file, obj){ ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj,null,2), 'utf8'); }
function today(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function fromYearsAgo(n){ const d=new Date(); d.setFullYear(d.getFullYear()-n); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function codeFromSymbol(sym){ if(/\.T$/.test(sym)) return sym.replace(/\.T$/,''); return null; }

async function jqFetchWrap(p){
  // Lazy import to avoid hard dep if offline
  const { jqFetch } = await import('./jq-client.mjs');
  return jqFetch(p);
}

async function syncCalendar({ from, to }){
  try {
    const pathName = `/v1/markets/trading_calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const j = await jqFetchWrap(pathName);
    const out = { days: Array.isArray(j?.data) ? j.data : (Array.isArray(j?.calendar)? j.calendar: []) };
    writeJSON(path.join(OUT_DIR, 'calendar.json'), out);
    console.log('Saved calendar:', out.days.length);
  } catch (e) {
    console.warn('calendar sync failed:', e?.message||e);
  }
}

async function syncSymbol(sym, { from, to }){
  const code = codeFromSymbol(sym);
  const file = path.join(OUT_DIR, `${sym}.json`);
  const out = readJSON(file, { symbol: sym, code, daily: [], events: {} });
  try {
    if (code) {
      // Daily quotes
      try {
        const u = `/v1/prices/daily_quotes?code=${encodeURIComponent(code)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const j = await jqFetchWrap(u);
        const arr = Array.isArray(j?.daily_quotes) ? j.daily_quotes : (Array.isArray(j?.data)? j.data: []);
        out.daily = arr.map(x=>({
          date: x.Date || x.date || x.BaseDate || x.base_date || null,
          open: Number(x.Open||x.open||x.OpenPrice||x.open_price||x.OpeningPrice||x.opening_price||null) || null,
          high: Number(x.High||x.high||x.HighPrice||x.high_price||null) || null,
          low: Number(x.Low||x.low||x.LowPrice||x.low_price||null) || null,
          close: Number(x.Close||x.close||x.ClosePrice||x.close_price||null) || null,
          volume: Number(x.Volume||x.volume||x.TradingVolume||x.trading_volume||0) || 0,
        })).filter(r=>r.date);
      } catch(e){ console.warn(sym, 'daily sync failed:', e?.message||e); }
      // Earnings schedule (best-effort; J-Quants endpoints differ by plan)
      try {
        const u2 = `/v1/fins/announcements?code=${encodeURIComponent(code)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const j2 = await jqFetchWrap(u2);
        const arr2 = Array.isArray(j2?.data) ? j2.data : [];
        const toSec = (d)=>{ try{ const t = Date.parse(d); return Math.floor(t/1000); }catch{ return null; } };
        out.events = out.events || {};
        out.events.earnings = arr2.filter(x=>/決算|業績/i.test(String(x?.title||''))).map(x=>({ date: x.date || x.disclosedDate || x.disclosed_date || null, title: x.title||'', time: toSec(x.date || x.disclosedDate || x.disclosed_date) })).filter(x=>x.date && x.time);
      } catch(e){ /* optional */ }
    }
  } finally {
    writeJSON(file, out);
    console.log('Saved symbol:', sym, 'daily:', out.daily?.length||0, 'earn:', out.events?.earnings?.length||0);
  }
}

async function main(){
  const args = process.argv.slice(2);
  const opt = { from: fromYearsAgo(5), to: today(), doCal: true, symbols: [] };
  for (let i=0;i<args.length;i++){
    const a=args[i];
    if (a==='--from') opt.from = args[++i];
    else if (a==='--to') opt.to = args[++i];
    else if (a==='--no-calendar') opt.doCal = false;
    else if (a==='--symbols') { const s=args[++i]||''; opt.symbols = s.split(',').map(x=>x.trim()).filter(Boolean); }
  }
  ensureDir(OUT_DIR);
  if (opt.doCal) await syncCalendar({ from: opt.from, to: opt.to });
  for (const sym of opt.symbols){ await syncSymbol(sym, { from: opt.from, to: opt.to }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e=>{ console.error(e?.message||e); process.exit(1); });
}

export default main;
