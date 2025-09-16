const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const startLine = 86, endLine = 239; // skip the <script> line
const lines = c.split(/\r?\n/).slice(startLine-1, endLine-1);
let ok=0; for(let i=1;i<=lines.length;i++){
  const s = lines.slice(0,i).join('\n');
  try{ new Function(s); ok=i; }
  catch(e){ console.log('fail at', i, e.message); console.log('LINE', lines[i-1]); console.log('PREV', lines[i-2]); break; }
}
console.log('ok', ok, 'of', lines.length);
