const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const idx = c.indexOf('<script type="module">');
const end = c.indexOf('</script>', idx);
const s = c.slice(idx+23, end);
const lines = s.split(/\r?\n/);
for(let i=111;i<=130;i++) console.log(String(i).padStart(3,'0')+': '+lines[i-1]);
