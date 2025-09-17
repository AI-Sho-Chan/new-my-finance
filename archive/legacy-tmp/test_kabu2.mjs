import https from 'node:https';
import http from 'node:http';
function fetchUrl(u, headers={}){ return new Promise((res,rej)=>{ const mod = u.startsWith('https')? https: http; const req = mod.request(u,{headers},resp=>{ let d=''; resp.setEncoding('utf8'); resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode, text:d}));}); req.on('error',rej); req.end(); }); }
(async()=>{
  const code='6702';
  const h = { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ja,en;q=0.9' };
  const r1 = await fetchUrl(`https://kabutan.jp/stock/?code=${code}`, h);
  const r2 = await fetchUrl(`https://kabutan.jp/stock/finance?code=${code}`, h);
  const html1 = r1.text; const html2 = r2.text;
  console.log('status', r1.status, r2.status);
  console.log('has stockinfo_i3', html1.includes('stockinfo_i3'));
  console.log('has PER', html1.includes('PER'));
  console.log('len1', html1.length, 'len2', html2.length);
})();
