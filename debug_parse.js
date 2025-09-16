const fs=require('fs');
const c=fs.readFileSync('analysis.html','utf8');
const parts=c.split('<script type="module">');
if(parts.length<2){ console.log('no module script'); process.exit(1); }
const s=parts[1].split('</script>')[0];
const lines=s.split('\n');
let ok=0;
for(let i=1;i<=lines.length;i++){
  const code = lines.slice(0,i).join('\n');
  try{ new Function(code); ok=i; }
  catch(e){ console.log('fail at line', i, e.message); console.log('LINE', lines[i-1]); console.log('PREV', lines[i-2]); break; }
}
console.log('ok lines', ok, 'of', lines.length);
