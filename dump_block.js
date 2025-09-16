const fs=require('fs');
const c=fs.readFileSync('analysis_served.html','utf8');
const idx = c.indexOf('<script type="module">');
const end = c.indexOf('</script>', idx);
const s = c.slice(idx+23, end);
const lines = s.split(/\r?\n/);
const from=95,to=110;
for(let i=from;i<=to;i++) console.log(String(i).padStart(3,'0')+': '+lines[i-1]);
