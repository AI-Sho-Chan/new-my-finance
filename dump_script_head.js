const fs=require('fs');
const c=fs.readFileSync('analysis.html','utf8');
const idx = c.indexOf('<script type="module">');
console.log('idx', idx);
if(idx<0){ console.log('no script module'); process.exit(1); }
const end = c.indexOf('</script>', idx);
const s = c.slice(idx+23, end);
const lines = s.split(/\r?\n/);
for(let i=0;i<Math.min(40, lines.length); i++){
  console.log(String(i+1).padStart(3,'0')+': '+lines[i]);
}
try{ new Function(s); console.log('PARSE_OK'); }catch(e){ console.log('PARSE_ERR', e.message); }
