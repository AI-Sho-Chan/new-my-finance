import https from 'node:https';
import http from 'node:http';

function fetchUrl(u, headers={}){ return new Promise((res,rej)=>{ const mod = u.startsWith('https')? https: http; const req = mod.request(u,{headers},resp=>{ let d=''; resp.setEncoding('utf8'); resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode, text:d}));}); req.on('error',rej); req.end(); }); }

(async()=>{
  const code='6702';
  const h = { 'User-Agent':'Mozilla/5.0', 'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ja,en;q=0.9' };
  const r1 = await fetchUrl(`https://kabutan.jp/stock/?code=${code}`, h);
  const r2 = await fetchUrl(`https://kabutan.jp/stock/finance?code=${code}`, h);
  const html1 = r1.text; const html2 = r2.text;
  const toNum = (s)=>{ const v=String(s||'').replace(/,/g,''); const n=Number(v); return Number.isFinite(n)? n : null; };
  const m = html1.match(/stockinfo_i3[\s\S]*?<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/);
  if (m && m[1]) {
    const row = m[1];
    const cells = Array.from(row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)).map(x=>toNum(x[1])).filter(v=>v!=null);
    console.log('cells', cells.slice(0,3));
  } else { console.log('no m'); }
  const rows = Array.from(html2.matchAll(/<tr\s*>\s*<th[^>]*>[^<]*?\d{4}\.\d{2}[^<]*?<\/th>([\s\S]*?)<\/tr>/g)).map(m=>m[1]);
  console.log('rows', rows.length);
  const epsSeries = [];
  for (const cellsHtml of rows) {
    const nums = Array.from(cellsHtml.matchAll(/<td[^>]*>([\d,.]+)<\/td>/g)).map(x=>toNum(x[1])).filter(v=>v!=null);
    if (nums.length >= 6 && Number.isFinite(nums[4])) epsSeries.push(nums[4]);
  }
  console.log('epsSeries', epsSeries.slice(-3));
})();
