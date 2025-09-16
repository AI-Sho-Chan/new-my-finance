const fs=require('fs');
const lines = fs.readFileSync('analysis_served.html','utf8').split(/\r?\n/);
for(let i=85;i<95;i++){ console.log(String(i+1).padStart(4,'0')+': '+lines[i]); }
