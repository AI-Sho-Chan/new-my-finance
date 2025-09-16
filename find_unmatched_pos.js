const fs=require('fs');
const s=fs.readFileSync('analysis_served.html','utf8');
const start=s.indexOf('<script type="module">');
const end=s.indexOf('</script>',start);
const code=s.slice(start+23,end);
let bt=false, inS=false, inD=false; let stack=[]; let line=1, col=0;
for(let i=0;i<code.length;i++){
  const ch=code[i]; const nxt=code[i+1];
  if(ch==='\n'){ line++; col=0; continue; } else col++;
  if(!bt && !inS && !inD && ch==='\'' ) { inS=true; continue; }
  if(inS){ if(ch==='\\' && code[i+1]) i++; else if(ch==='\'') inS=false; continue; }
  if(!bt && !inS && !inD && ch==='\"') { inD=true; continue; }
  if(inD){ if(ch==='\\' && code[i+1]) i++; else if(ch==='\"') inD=false; continue; }
  if(ch==='`' && !bt) { bt=true; continue; }
  if(ch==='`' && bt) { bt=false; continue; }
  if(bt){ if(ch==='$' && nxt==='{' ){ stack.push({line, col}); i++; col++; continue; } if(ch==='}' && stack.length){ stack.pop(); } continue; }
  if(ch==='{' ){ stack.push({line, col}); }
  else if(ch==='}'){ stack.pop(); }
}
console.log('unmatched', stack[stack.length-1]);
