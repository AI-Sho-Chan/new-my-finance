const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const idx=c.indexOf('<script type="module">');
const end=c.indexOf('</script>',idx);
const code=c.slice(idx+23,end);
const lines=code.split(/\r?\n/);
let bal=0; let bt=false,inS=false,inD=false; let tStack=0; // ${ nesting
function stepLine(line){
  for(let i=0;i<line.length;i++){
    const ch=line[i], nxt=line[i+1];
    if(!bt && !inS && !inD && ch==='\'') { inS=true; continue; }
    if(inS){ if(ch==='\\') i++; else if(ch==='\'') inS=false; continue; }
    if(!bt && !inS && !inD && ch==='\"') { inD=true; continue; }
    if(inD){ if(ch==='\\') i++; else if(ch==='\"') inD=false; continue; }
    if(ch==='`' && !bt) { bt=true; continue; }
    if(ch==='`' && bt && tStack===0) { bt=false; continue; }
    if(bt){ if(ch==='$' && nxt==='{' ){ tStack++; i++; continue; } if(ch==='}' && tStack>0){ tStack--; continue; } continue; }
    if(ch==='{' ) bal++; else if(ch==='}') bal--; 
  }
}
for(let i=0;i<lines.length;i++){ stepLine(lines[i]); if((i+1)%10===0 || i===lines.length-1) console.log(i+1, bal); }
