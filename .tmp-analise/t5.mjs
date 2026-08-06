import { ImapFlow } from 'imapflow'
import fs from 'fs'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:120000})
function coletar(no,out=[]){ if(!no) return out
  const nome=no.dispositionParameters?.filename??no.parameters?.name??''
  if(nome) out.push({part:no.part||'1',nome,tipo:`${no.type??''}`,size:no.size??0})
  for(const f of no.childNodes??[]) coletar(f,out); return out }
await client.connect()
const uids=[168475,172710,175255,175256]
const lock = await client.getMailboxLock('INBOX',{readOnly:true})
try {
  const pend=[]
  for await (const m of client.fetch(uids,{uid:true,envelope:true,bodyStructure:true},{uid:true}))
    pend.push({uid:m.uid,subj:m.envelope.subject,de:m.envelope.from?.[0]?.address,dt:m.envelope.date,anexos:coletar(m.bodyStructure)})
  for (const p of pend) {
    console.log(`\n══ uid=${p.uid} ${p.dt?.toISOString?.().slice(0,10)} de=${p.de}\n   ${p.subj}`)
    for (const a of p.anexos) console.log(`   • ${a.nome} (${a.tipo}, ${Math.round(a.size/1024)} KB)`)
    for (const a of p.anexos.filter(x=>/\.(pdf|xml)$/i.test(x.nome))) {
      const {content}=await client.download(String(p.uid),a.part,{uid:true})
      const b=[]; for await (const c of content) b.push(Buffer.from(c))
      fs.writeFileSync(`.tmp-analise/u${p.uid}_${a.nome.replace(/[\/\s]/g,'_')}`,Buffer.concat(b))
    }
  }
} finally { lock.release() }
await client.logout()
