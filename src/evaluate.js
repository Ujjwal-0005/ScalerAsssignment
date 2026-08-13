#!/usr/bin/env node
const fs = require('fs');
const { PIIRedactor } = require('./redact_pii');

const benchmarkPath = process.argv[2] || 'evaluation/eval_benchmark.json';
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath,'utf8'));
const redactor = new PIIRedactor(2025);
const perType = {};
for (const type of ['PERSON','EMAIL','PHONE','ADDRESS','COMPANY','SSN','CREDIT_CARD','DOB','IP_ADDRESS']) perType[type] = {tp:0,fp:0,fn:0};

function overlap(a,b){ return a.start < b.end && b.start < a.end; }

const details=[];
for (const item of benchmark){
  const pred = redactor.detect(item.text);
  const gold = item.gold.map(([text,label])=>{
    const start=item.text.indexOf(text); return {start,end:start+text.length,label,text};
  }).filter(x=>x.start>=0);
  const matchedGold=new Set(); const matchedPred=new Set();
  for(let i=0;i<pred.length;i++){
    let best=-1;
    for(let j=0;j<gold.length;j++){
      if(matchedGold.has(j)) continue;
      if(pred[i].label===gold[j].label && overlap(pred[i],gold[j])) { best=j; break; }
    }
    if(best>=0){ matchedPred.add(i); matchedGold.add(best); perType[pred[i].label].tp++; }
  }
  pred.forEach((p,i)=>{if(!matchedPred.has(i)) perType[p.label].fp++;});
  gold.forEach((g,j)=>{if(!matchedGold.has(j)) perType[g.label].fn++;});
  details.push({text:item.text,gold,pred});
}

let tp=0,fp=0,fn=0; for(const x of Object.values(perType)){tp+=x.tp;fp+=x.fp;fn+=x.fn;}
const precision=tp/(tp+fp)||0, recall=tp/(tp+fn)||0;
// For entity extraction, we report span-level accuracy as the same correctly
// classified detections over all predicted/gold entity decisions. This makes
// the denominator explicit instead of pretending this is token classification.
const accuracy=tp/(tp+fp+fn)||0;
for(const x of Object.values(perType)){x.precision=x.tp/(x.tp+x.fp)||0;x.recall=x.tp/(x.tp+x.fn)||0;x.accuracy=x.tp/(x.tp+x.fp+x.fn)||0;}
const out={items:benchmark.length,gold_spans:tp+fn,predicted_spans:tp+fp,overall:{tp,fp,fn,precision,recall,accuracy},per_type:Object.fromEntries(Object.entries(perType).map(([k,v])=>[k,[v.tp,v.fp,v.fn,v.precision,v.recall,v.accuracy]]))};
console.log(JSON.stringify(out,null,2));
fs.writeFileSync('eval_results_js.json',JSON.stringify(out,null,2));
