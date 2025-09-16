const fs=require('fs');
const s=fs.readFileSync('analysis_served.html','utf8');
const start=s.indexOf('<script type="module">');
const end=s.indexOf('</script>',start);
const code=s.slice(start+23,end);
const lines=code.split(/\r?\n/);
let stack=[];
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  for(let j=0;j<line.length;j++){
    const ch=line[j];
    if(ch==='{' ) stack.push({i:i+1,j:j+1});
    else if(ch==='}') stack.pop();
  }
}
console.log('unmatched opens', stack);
