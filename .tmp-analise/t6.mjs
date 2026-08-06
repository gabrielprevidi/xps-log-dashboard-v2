import { ImapFlow } from 'imapflow'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:180000})
function coletar(no,out=[]){ if(!no) return out
  const nome=no.dispositionParameters?.filename??no.parameters?.name??''
  if(nome) out.push(nome)
  for(const f of no.childNodes??[]) coletar(f,out); return out }
await client.connect()
const alvo=/(^|\D)(4306|4406)(\D|$)/
for (const box of [{path:'INBOX'}]) {
  if (/Trash|Spam|Drafts|Junk/i.test(box.path)) continue
  let lock; try { lock=await client.getMailboxLock(box.path,{readOnly:true}) } catch { continue }
  try {
    const uids = await client.search({since:new Date('2026-05-01')},{uid:true})
    if(!uids?.length) continue
    let achou=0
    for await (const m of client.fetch(uids,{uid:true,envelope:true,bodyStructure:true},{uid:true})) {
      const nomes = coletar(m.bodyStructure).filter(n=>alvo.test(n))
      if (!nomes.length) continue
      achou++
      console.log(`[${box.path}] uid=${m.uid} ${m.envelope.date?.toISOString?.().slice(0,10)} de=${m.envelope.from?.[0]?.address}`)
      console.log(`   assunto: ${m.envelope.subject}`)
      console.log(`   anexos:  ${nomes.join(' | ')}`)
    }
    console.error(`  (${box.path}: ${uids.length} msgs, ${achou} com anexo alvo)`)
  } finally { lock?.release() }
}
await client.logout()
