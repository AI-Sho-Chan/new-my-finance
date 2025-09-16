const fs=require('fs');
const s = fs.readFileSync('analysis_served.html','utf8');
const start = s.indexOf('<script type="module">');
const end = s.indexOf('</script>', start);
const code = s.slice(start+23, end);
let openB=0, openP=0;
for(let i=0;i<code.length;i++){
  const ch=code[i];
  if(ch==='{' ) openB++;
  else if(ch==='}') openB--;
  else if(ch==='(') openP++;
  else if(ch===')') openP--;
}
console.log('brace-balance', openB, 'paren-balance', openP);
