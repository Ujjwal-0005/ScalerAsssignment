#!/usr/bin/env node
/**
 * PII Redaction Tool - Node.js / JavaScript
 *
 * Dependency-light DOCX redactor. It uses regex/contextual detectors and
 * deterministic fake replacements. DOCX is a ZIP of XML files, so the tool
 * uses the system unzip/zip commands and edits WordprocessingML text nodes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TYPES = ['PERSON','EMAIL','PHONE','COMPANY','ADDRESS','SSN','CREDIT_CARD','DOB','IP_ADDRESS'];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IP_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RE = /(?<!\d)(?:\+?\s*91[\s-]*)?(?:(?:0?[2-9]\d[\s-]?\d{4}[\s-]?\d{4})|(?:[6-9]\d{9}))(?!\d)/g;
const CC_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const DOB_RE = /\b(?:date of birth|dob|born on|birth date)\s*[:\-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/gi;
const PIN_RE = /\b\d{3}\s?\d{3}\b/;
const ADDRESS_RE = /(?:(?:residential\s+address|mailing\s+address|registered\s+office|corporate\s+office|address\s+of\s+the\s+roc|correspondence\s+address|office|address|residing\s+at|located\s+at|mail\s+to|send\s+to)\s*[:\-]?\s*)?((?:\d{1,5}(?:\s*[-–]\s*\d{1,5})?[A-Za-z]?|Plot\s+No\.?|H\.?No\.?|A-\d+|C-\d+|S\.?\s*No\.?|[A-Z]\d{1,3})[^\n;]{5,260}?\b\d{3}\s?\d{3}\b(?:[^\n;]{0,50}\b(?:India|Maharashtra|Madhya Pradesh|Gujarat|Karnataka|Delhi|Rajasthan)\b)?)/gis;
const COMPANY_SUFFIX_RE = /\b(?:[A-Z][A-Za-z&.\-’]+(?:\s+[A-Z][A-Za-z&.\-’]+){0,7}\s+)(?:Private Limited|Limited Liability Partnership|Limited|LLP|Private Ltd\.?|Ltd\.?|Inc\.?|Corporation)\b/g;
const PERSON_CONTEXT_RE = /\b(?:customer|user|client|applicant|employee|owner|name|contact\s+person|being|namely|appointed\s+by\s+our\s+company,?\s+namely|promoter,?\s+chairman\s+and\s+executive\s+director)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})/g;
const PERSON_ROLE_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\s+(?:Chairman|Managing Director|Joint Managing Director|Whole-time Director|Independent Director|Executive Director|Chief Executive Officer|Chief Financial Officer|Company Secretary)\b/g;
const TITLE_PERSON_RE = /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Shri|Smt\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g;
const FULL_NAME_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g;

const STOP_PERSON = new Set([
  'Our','The','This','Company','Contact','Person','Chief','Executive','Financial','Officer','Compliance',
  'Indian','Government','Central','State','United','States','European','Union','Book','Running','Lead',
  'Anchor','Investor','Offer','Fresh','Issue','Promoter','Selling','Shareholders','Board','Independent',
  'Managing','Director','Whole-time','General','Information','Red','Herring','Prospectus','Securities',
  'Registrar','Stock','Exchange','National','Limited','Private','Family','Trust','Corporate','Office'
]);
const NAME_FIRST = new Set(('Aarav Aditi Aditya Akash Aman Amit Ananya Anil Anjali Arjun Arvind Ashish Ayush Deepak Deepika Gaurav Harsh Isha Karan Kavita Kiran Krishna Lalit Manish Meera Mohan Nandini Neha Nikhil Pankaj Pooja Prakash Priya Rahul Rajesh Rakesh Riya Rohit Sandeep Sandesh Sarthak Shanti Shreya Sneha Soham Sunil Suresh Varun Vikram Vinay Vishal Yash Kushal Pushpa Rakhi Kishan Abhijit Lokesh Soumavo Shanti').split(/\s+/));
const NAME_LAST = new Set(('Agarwal Bansal Bhagwat Diwan Dey Gopalkrishnan Hegde Iyer Joshi Kapoor Malvadkar Mehta Nair Patil Rastogi Rai Sarkar Sharma Shetty Singh Verma Shah').split(/\s+/));

const FAKE = {
  PERSON: ['Alex Morgan','Jordan Carter','Taylor Bennett','Casey Parker','Morgan Reed','Avery Collins','Riley Brooks','Jamie Foster','Cameron Hayes','Drew Mitchell','Sam Turner','Robin Cooper'],
  EMAIL: ['alex.morgan@example.com','jordan.carter@example.com','taylor.bennett@example.com','casey.parker@example.com','morgan.reed@example.com','avery.collins@example.com','riley.brooks@example.com','jamie.foster@example.com'],
  PHONE: ['+91 9876543210','+91 9123456789','+91 9988776655','+91 9012345678','+91 9345678901'],
  COMPANY: ['Acme Industries Private Limited','Northstar Technologies Limited','BlueRiver Solutions LLP','Pioneer Manufacturing Limited','Vertex Systems Private Limited','Summit Trading Corporation'],
  ADDRESS: ['101 Example Road, Sample Nagar, Pune - 411001, Maharashtra, India','42 Market Street, Central District, Mumbai - 400001, Maharashtra, India','17 Lake View Road, Green Park, Bengaluru - 560001, Karnataka, India'],
  SSN: ['482-19-7356','615-28-9041','731-64-2058','294-53-8176'],
  CREDIT_CARD: ['4111 1111 1111 1111','5555 5555 5555 4444','3782 822463 10005'],
  DOB: ['14 March 1988','22 July 1991','05 November 1986','19 January 1990'],
  IP_ADDRESS: ['203.0.113.10','198.51.100.22','192.0.2.45','203.0.113.77']
};

function xmlEscape(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function xmlUnescape(s) {
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function digits(s) { return s.replace(/\D/g,''); }
function validLuhn(value) {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, parity = d.length % 2;
  for (let i=0;i<d.length;i++) {
    let n = Number(d[i]);
    if (i % 2 === parity) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

class PIIRedactor {
  constructor(seed=2025) {
    this.seed = seed;
    this.maps = Object.fromEntries(TYPES.map(t => [t, new Map()]));
    this.used = new Set();
    this.counters = Object.fromEntries(TYPES.map(t => [t, 0]));
  }
  fakeFor(label, original) {
    if (this.maps[label].has(original)) return this.maps[label].get(original);
    const arr = FAKE[label];
    let i = this.counters[label]++ % arr.length;
    let fake = arr[i];
    // Make replacements deterministic but distinct when a pool is exhausted.
    if (this.maps[label].size >= arr.length) fake = `${arr[i]} ${this.maps[label].size + 1}`;
    this.maps[label].set(original, fake);
    return fake;
  }
  add(spans, re, label, priority, validator=null, group=0) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(this.currentText)) !== null) {
      const raw = group ? m[group] : m[0];
      if (validator && !validator(raw,m)) continue;
      const start = group ? m.index + m[0].indexOf(raw) : m.index;
      spans.push({start, end:start+raw.length, label, text:raw, priority});
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  detect(text) {
    this.currentText = text;
    const spans=[];
    this.add(spans, EMAIL_RE,'EMAIL',100);
    this.add(spans, IP_RE,'IP_ADDRESS',100);
    this.add(spans, SSN_RE,'SSN',100);
    this.add(spans, CC_RE,'CREDIT_CARD',100,(raw)=>validLuhn(raw));
    this.add(spans, DOB_RE,'DOB',95);
    this.add(spans, PHONE_RE,'PHONE',98,(raw,m)=>{
      let d=digits(raw); const before=text.slice(Math.max(0,m.index-30),m.index).toLowerCase(); const after=text.slice(m.index+m[0].length,m.index+m[0].length+30).toLowerCase();
      const explicit = raw.includes('+') || raw.trim().startsWith('91') || ['phone','telephone','tel','mobile','contact'].some(k=>(before+after).includes(k));
      if (d.startsWith('91') && d.length===12) d=d.slice(2); if (d.startsWith('0') && d.length===11) d=d.slice(1);
      return d.length===10 && '23456789'.includes(d[0]) && explicit;
    });

    ADDRESS_RE.lastIndex=0; let m;
    while ((m=ADDRESS_RE.exec(text))!==null) {
      const raw=m[1];
      if (PIN_RE.test(raw) && /\b(?:road|street|lane|plot|village|house|h\.no|apartment|society|nagar|pune|mumbai|bhopal|maharashtra|india|marg|building|floor|taluka|district)\b/i.test(raw)) {
        const start=m.index+m[0].indexOf(raw); spans.push({start,end:start+raw.length,label:'ADDRESS',text:raw,priority:80});
      }
    }

    this.add(spans, COMPANY_SUFFIX_RE,'COMPANY',70,null,0);
    for (const re of [PERSON_CONTEXT_RE,PERSON_ROLE_RE,TITLE_PERSON_RE]) {
      re.lastIndex=0; while((m=re.exec(text))!==null){
        const name=m[1].trim().replace(/^[ ,.;:]+|[ ,.;:]+$/g,''); const parts=name.split(/\s+/);
        if(parts.length>=2 && parts.length<=5 && parts.every(p=>!STOP_PERSON.has(p))){ const start=m.index+m[0].indexOf(name); spans.push({start,end:start+name.length,label:'PERSON',text:name,priority:75}); }
      }
    }
    FULL_NAME_RE.lastIndex=0; while((m=FULL_NAME_RE.exec(text))!==null){
      const name=m[0], parts=name.split(/\s+/);
      if(parts.length>=2 && parts.length<=4 && NAME_FIRST.has(parts[0]) && NAME_LAST.has(parts[parts.length-1]) && !parts.some(p=>STOP_PERSON.has(p))) spans.push({start:m.index,end:m.index+name.length,label:'PERSON',text:name,priority:65});
    }
    return this.resolve(spans);
  }
  resolve(spans){
    spans.sort((a,b)=>b.priority-a.priority || a.start-b.start || (b.end-b.start)-(a.end-a.start));
    const kept=[];
    for(const s of spans){ if(kept.some(k=>!(s.end<=k.start||s.start>=k.end))) continue; kept.push(s); }
    return kept.sort((a,b)=>a.start-b.start);
  }
  redactText(text){
    const spans=this.detect(text); let out='',pos=0;
    for(const s of spans){ out+=text.slice(pos,s.start)+this.fakeFor(s.label,s.text); pos=s.end; }
    return {text:out+text.slice(pos),spans};
  }
}

function walkParagraphs(xml, redactor, stats) {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, paragraph => {
    const nodes=[]; const nodeRe=/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g; let m;
    while((m=nodeRe.exec(paragraph))!==null) nodes.push({full:m[0], text:m[1], index:m.index, end:nodeRe.lastIndex});
    if(!nodes.length) return paragraph;
    const visible=nodes.map(n=>xmlUnescape(n.text)).join('');
    const result=redactor.redactText(visible);
    if(!result.spans.length) return paragraph;
    for(const s of result.spans) stats.push({label:s.label,text:s.text,replacement:redactor.maps[s.label].get(s.text)});
    let first=true;
    return paragraph.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full,content) => {
      const openEnd = full.indexOf('>') + 1;
      const openTag = full.slice(0, openEnd);
      if(first){ first=false; return openTag + xmlEscape(result.text) + '</w:t>'; }
      return openTag + '</w:t>';
    });
  });
}

function redactDocx(input, output, seed=2025) {
  if(!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pii-redact-'));
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile','-Command', `Expand-Archive -LiteralPath '${input.replace(/'/g,"''")}' -DestinationPath '${tmp.replace(/'/g,"''")}' -Force`]);
    } else {
      execFileSync('unzip',['-q',input,'-d',tmp]);
    }
    const redactor=new PIIRedactor(seed); const detections=[];
    const wordDir=path.join(tmp,'word');
    function processDir(dir){
      if(!fs.existsSync(dir)) return;
      for(const name of fs.readdirSync(dir)){
        const p=path.join(dir,name); if(!name.endsWith('.xml')) continue;
        let xml=fs.readFileSync(p,'utf8'); xml=walkParagraphs(xml,redactor,detections); fs.writeFileSync(p,xml);
      }
    }
    processDir(wordDir);
    // A final XML-level replacement catches repeated occurrences that are not
    // represented as a single paragraph text node (e.g. unusual Word runs).
    for(const name of fs.readdirSync(wordDir)){ if(!name.endsWith('.xml')) continue; const p=path.join(wordDir,name); let xml=fs.readFileSync(p,'utf8'); for(const [label,map] of Object.entries(redactor.maps)){ for(const [orig,fake] of map.entries()){ xml=xml.split(xmlEscape(orig)).join(xmlEscape(fake)); } } fs.writeFileSync(p,xml); }
    fs.mkdirSync(path.dirname(output),{recursive:true}); if(fs.existsSync(output)) fs.unlinkSync(output);
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile','-Command', `Compress-Archive -Path '${path.join(tmp,'*').replace(/'/g,"''")}' -DestinationPath '${output.replace(/'/g,"''")}' -Force`]);
    } else {
      execFileSync('zip',['-q','-r',output,'.'],{cwd:tmp});
    }
    return {detections,maps:Object.fromEntries(TYPES.map(t=>[t,Object.fromEntries(redactor.maps[t])]))};
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

function main(){
  const args=process.argv.slice(2); if(args.includes('--help')||args.length<2){ console.log('Usage: node redact_pii.js <input.docx> <output.docx> [seed]'); process.exit(args.length<2?1:0); }
  const [input,output,seedArg]=args; const result=redactDocx(input,output,Number(seedArg||2025));
  const counts={}; for(const d of result.detections) counts[d.label]=(counts[d.label]||0)+1;
  console.log(`Redacted DOCX written to ${output}`); console.log('Detections:',counts);
}

if(require.main===module) main();
module.exports={PIIRedactor,redactDocx,validLuhn};
