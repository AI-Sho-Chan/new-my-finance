import https from 'node:https';
import http from 'node:http';
function fetchUrl(u, headers={}){ return new Promise((res,rej)=>{ const mod = u.startsWith('https')? https: http; const req = mod.request(u,{headers},resp=>{ let d=''; resp.setEncoding('utf8'); resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode, text:d}));}); req.on('error',rej); req.end(); }); }
(async()=>{
  const code='6702';
  const h = { 'User-Agent':'Mozilla/5.0', 'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ja,en;q=0.9' };
  const r1 = await fetchUrl(`https://kabutan.jp/stock/?code=${code}`, h);
  const html1 = r1.text;
  const m = html1.match(/stockinfo_i3[\s\S]*?<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/);
  console.log('m?', !!m);
  const row = m? m[1] : '';
  const cells = Array.from(row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)).map(x=>x[1]);
  console.log('cells raw', cells);
})();
