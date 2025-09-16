const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const idx=c.indexOf('<script type="module">');
const end=c.indexOf('</script>',idx);
const code=c.slice(idx+23,end);
const lines=code.split(/\r?\n/);
const from=101, to=116;
let b=0; let bt=false,inS=false,inD=false,t=0;
for(let ln=from; ln<=to; ln++){
  const line=lines[ln-1];
  for(let i=0;i<line.length;i++){
    const ch=line[i], n=line[i+1];
    if(!bt && !inS && !inD && ch==='\''){ inS=true; continue; }
    if(inS){ if(ch==='\\') i++; else if(ch==='\'') inS=false; continue; }
    if(!bt && !inS && !inD && ch==='\"'){ inD=true; continue; }
    if(inD){ if(ch==='\\') i++; else if(ch==='\"') inD=false; continue; }
    if(ch==='`' && !bt){ bt=true; continue; }
    if(ch==='`' && bt && t===0){ bt=false; continue; }
    if(bt){ if(ch==='$' && n==='{' ){ t++; i++; continue; } if(ch==='}' && t>0){ t--; continue; } continue; }
    if(ch==='{' ) b++; else if(ch==='}') b--; 
  }
  console.log(ln, b, line);
}
