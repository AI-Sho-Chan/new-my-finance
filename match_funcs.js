const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const idx=c.indexOf('<script type="module">');
const end=c.indexOf('</script>',idx);
const code=c.slice(idx+23,end);
const lines=code.split(/\r?\n/);
function balance(upto){ let b=0, bt=false,inS=false,inD=false,t=0; for(let li=0;li<upto;li++){ const line=lines[li]; for(let i=0;i<line.length;i++){ const ch=line[i],n=line[i+1]; if(!bt && !inS && !inD && ch==='\''){ inS=true; continue;} if(inS){ if(ch==='\\') i++; else if(ch==='\'') inS=false; continue;} if(!bt && !inS && !inD && ch==='\"'){ inD=true; continue;} if(inD){ if(ch==='\\') i++; else if(ch==='\"') inD=false; continue;} if(ch==='`' && !bt){ bt=true; continue;} if(ch==='`' && bt && t===0){ bt=false; continue;} if(bt){ if(ch==='$' && n==='{' ){ t++; i++; continue;} if(ch==='}' && t>0){ t--; continue;} continue;} if(ch==='{' ) b++; else if(ch==='}') b--; } } return b; }
const idxLoad = lines.findIndex(l=>/async\s+function\s+load\s*\(/.test(l));
const idxBuild = lines.findIndex(l=>/async\s+function\s+buildAndPersistBacktest/.test(l));
console.log('load at', idxLoad+1, 'balance at open', balance(idxLoad));
console.log('build at', idxBuild+1, 'balance at open', balance(idxBuild));
console.log('final balance', balance(lines.length));
