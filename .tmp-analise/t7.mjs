import { ImapFlow } from 'imapflow'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:60000})
function coletar(no,out=[]){ if(!no) return out
  const nome=no.dispositionParameters?.filename??no.parameters?.name??''
  if(nome) out.push(nome)
  for(const f of no.childNodes??[]) coletar(f,out); return out }
await client.connect()
console.log('── pastas ──'); for (const b of await client.list()) console.log('  ', b.path)
for (const pasta of ['Sent','INBOX']) {
  let lock; try { lock=await client.getMailboxLock(pasta,{readOnly:true}) } catch { console.log('sem',pasta); continue }
  try {
    const uids = await client.search({subject:'Transferência de Material'},{uid:true})
    console.log(`\n── [${pasta}] "Transferência de Material": ${uids?.length||0} msgs`)
    for await (const m of client.fetch(uids||[],{uid:true,envelope:true,bodyStructure:true},{uid:true})) {
      const nfs = coletar(m.bodyStructure).filter(n=>/\.(pdf|xml)$/i.test(n))
      console.log(`  uid=${m.uid} ${m.envelope.date?.toISOString?.().slice(0,10)} de=${m.envelope.from?.[0]?.address}`)
      console.log(`     ${m.envelope.subject}`)
      console.log(`     ${nfs.join(' | ') || '(sem pdf/xml)'}`)
    }
  } finally { lock?.release() }
}
await client.logout()
