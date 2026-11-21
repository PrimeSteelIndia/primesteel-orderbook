
const fs=require('fs');
const src=fs.readFileSync('web/worker.js','utf8');
const s=src.indexOf('function calcItemEntry(');
const e=src.indexOf('\nfunction cartTotals(',s);
fs.writeFileSync('tools/_calc.js', src.slice(s,e)+'\nmodule.exports={calcItemEntry};\n');
const {calcItemEntry}=require('./_calc.js');
const items=JSON.parse(fs.readFileSync('tools/_items.json','utf8'));
const out=[];
const units=['pcs','kg','feet','inch','m'];
for(const it of items){
  for(const u of units){
    for(const q of [1,3,10]){
      let r;
      try{ r=calcItemEntry(it,q,u);}catch(err){ out.push({id:it.id,u,q,err:String(err)}); continue; }
      out.push({id:it.id,u,q,amt:r.amount,wt:r.weight,pcs:r.pcs,main:r.mainQty});
    }
  }
}
process.stdout.write(JSON.stringify(out));
