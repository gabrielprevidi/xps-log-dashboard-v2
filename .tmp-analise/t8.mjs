import { ImapFlow } from 'imapflow'
import fs from 'fs'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:120000})
function coletar(no,out=[]){ if(!no) return out
  const nome=no.dispositionParameters?.filename??no.parameters?.name??''
  if(nome) out.push({part:no.part||'1',nome})
  for(const f of no.childNodes??[]) coletar(f,out); return out }
// casa "NF 4306", "…000000430 6…" (chave: 9 dígitos do número da NF)
const alvo = (n) => /(^|\D)(4306|4406)(\D|$)/.test(n) || /\d{25}(000004306|000004406)/.test(n.replace(/\D/g,''))
await client.connect()
const lock = await client.getMailboxLock('Sent',{readOnly:true})
let n=0
try {
  const uids = await client.search({since:new Date('2026-06-01')},{uid:true})
  console.log('Sent desde 01/06:', uids.length, 'mensagens')
  const pend=[]
  for await (const m of client.fetch(uids,{uid:true,envelope:true,bodyStructure:true},{uid:true})) {
    const hits = coletar(m.bodyStructure).filter(a=>alvo(a.nome))
    if (hits.length) pend.push({uid:m.uid,subj:m.envelope.subject,dt:m.envelope.date,hits})
  }
  for (const p of pend) {
    console.log(`\nuid=${p.uid} ${p.dt?.toISOString?.().slice(0,10)} | ${p.subj}`)
    for (const a of p.hits) {
      console.log('   •', a.nome)
      const {content}=await client.download(String(p.uid),a.part,{uid:true})
      const b=[]; for await (const c of content) b.push(Buffer.from(c))
      fs.writeFileSync(`.tmp-analise/tec_${a.nome.replace(/[\/\s]/g,'_')}`,Buffer.concat(b)); n++
    }
  }
} finally { lock.release() }
console.log('\nbaixados:',n); await client.logout()
