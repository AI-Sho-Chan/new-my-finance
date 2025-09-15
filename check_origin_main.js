const fs=require('fs');
const esbuild=require('esbuild');
const s=fs.readFileSync('_origin_main_NMY.html','utf8');
const tag='<script type="text/babel">';
const i=s.indexOf(tag);
if(i<0){ console.log('NO_BABEL'); process.exit(0); }
const j=s.indexOf('</script>', i+tag.length);
if(j<0){ console.log('NO_ENDSCRIPT'); process.exit(0); }
const src=s.slice(i+tag.length,j);
try{ esbuild.transformSync(src,{loader:'jsx',jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}); console.log('PARSE_OK'); }
catch(e){ console.log('PARSE_ERR'); if(e.errors){ for(const er of e.errors){ console.log(er.text, er.location? (er.location.line+':'+er.location.column):''); } } }
