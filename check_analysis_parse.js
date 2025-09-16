const fs=require('fs');
const c=fs.readFileSync('analysis.html','utf8');
const s=c.split('<script type="module">')[1].split('</script>')[0];
try{ new Function(s); console.log('PARSE_OK'); }
catch(e){ console.log('PARSE_ERR'); console.log(e.message); const m=e.stack && e.stack.match(/<anonymous>:(\d+):(\d+)/); if(m){ const n=+m[1]; const lines=s.split('\n'); console.log('LINE', n, lines[n-1]); console.log('PREV', lines[n-2]); console.log('NEXT', lines[n]); } }
