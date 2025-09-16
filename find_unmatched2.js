const fs=require('fs');
const s=fs.readFileSync('analysis_served.html','utf8');
const start=s.indexOf('<script type="module">');
const end=s.indexOf('</script>',start);
const code=s.slice(start+23,end);
let bal=0; let bt=false; let inS=false, inD=false; let stack=[]; let iLine=1;
for(let i=0;i<code.length;i++){
  const ch=code[i]; const nxt=code[i+1];
  if(ch==='\n') iLine++;
  if(!bt && !inS && !inD && ch==='\'' ) { inS=true; continue; }
  if(inS){ if(ch==='\\' && code[i+1]) i++; else if(ch==='\'') inS=false; continue; }
  if(!bt && !inS && !inD && ch==='\"') { inD=true; continue; }
  if(inD){ if(ch==='\\' && code[i+1]) i++; else if(ch==='\"') inD=false; continue; }
  if(ch==='`' && !bt) { bt=true; continue; }
  if(ch==='`' && bt) { bt=false; continue; }
  if(bt){ // inside template
    if(ch==='$' && nxt==='{' ){ stack.push('{'); i++; continue; }
    if(ch==='}' && stack.length){ stack.pop(); continue; }
    continue;
  }
  if(ch==='{' ){ bal++; stack.push('N'); }
  else if(ch==='}'){ bal--; stack.pop(); }
}
console.log('balance', bal, 'stack size', stack.length);
