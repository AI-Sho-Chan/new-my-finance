const fs=require('fs');
const s = fs.readFileSync('analysis_served.html','utf8');
const start = s.indexOf('<script type="module">');
const end = s.indexOf('</script>', start);
const code = s.slice(start+23, end);
const lines = code.split(/\r?\n/);
let bal=0; let lastIndex=0;
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  for(const ch of line){ if(ch==='{' ) bal++; else if(ch==='}') bal--; }
  if(i%10===0 || i===lines.length-1) console.log('line',i+1,'balance', bal);
}
console.log('final balance', bal);
