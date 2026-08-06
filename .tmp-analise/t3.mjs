import { ImapFlow } from 'imapflow'
import fs from 'fs'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:60000})
function coletar(no,out=[]){ if(!no) return out
  const nome=no.dispositionParameters?.filename??no.parameters?.name??''
  if(nome) out.push({part:no.part||'1',nome,tipo:`${no.type??''}`,size:no.size??0})
  for(const f of no.childNodes??[]) coletar(f,out); return out }
await client.connect()
const alvo=/(^|\D)(4306|4406)(\D|$)/
let n=0
for (const box of await client.list()) {
  if (/Trash|Spam|Drafts|Junk/i.test(box.path)) continue
  let lock; try { lock=await client.getMailboxLock(box.path,{readOnly:true}) } catch { continue }
  try {
    const uids = await client.search({from:'tecnia'},{uid:true})
    if(!uids?.length) continue
    const pend=[]
    for await (const m of client.fetch(uids,{uid:true,envelope:true,bodyStructure:true},{uid:true})) {
      const anexos = coletar(m.bodyStructure)
      if (anexos.some(a=>alvo.test(a.nome)) || alvo.test(m.envelope.subject||''))
        pend.push({uid:m.uid, subj:m.envelope.subject, dt:m.envelope.date, anexos})
    }
    for (const p of pend) {
      console.log(`\n[${box.path}] uid=${p.uid} ${p.dt?.toISOString?.().slice(0,10)} | ${p.subj}`)
      for (const a of p.anexos) {
        console.log(`   anexo: ${a.nome} (${a.tipo}, ${Math.round(a.size/1024)} KB)`)
        if (alvo.test(a.nome) && /\.(pdf|xml)$/i.test(a.nome)) {
          const {content}=await client.download(String(p.uid),a.part,{uid:true})
          const b=[]; for await (const c of content) b.push(Buffer.from(c))
          fs.writeFileSync(`.tmp-analise/${a.nome.replace(/\//g,'_')}`,Buffer.concat(b)); n++
        }
      }
    }
  } finally { lock?.release() }
}
console.log('\nbaixados:',n); await client.logout()
