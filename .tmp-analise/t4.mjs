import { ImapFlow } from 'imapflow'
const client = new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||143),
  secure:String(process.env.IMAP_SECURE??'false')==='true',
  auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD},logger:false,socketTimeout:120000})
await client.connect()
for (const box of await client.list()) {
  if (/Trash|Spam|Drafts|Junk/i.test(box.path)) continue
  let lock; try { lock=await client.getMailboxLock(box.path,{readOnly:true}) } catch { continue }
  try {
    for (const termo of ['4306','4406']) {
      const uids = await client.search({body:termo},{uid:true})
      if (!uids?.length) continue
      const info=[]
      for await (const m of client.fetch(uids,{uid:true,envelope:true},{uid:true}))
        info.push(`uid=${m.uid} ${m.envelope.date?.toISOString?.().slice(0,10)} de=${m.envelope.from?.[0]?.address} | ${m.envelope.subject}`)
      console.log(`\n### "${termo}" em [${box.path}]: ${uids.length}`)
      info.forEach(i=>console.log('   ',i))
    }
  } finally { lock?.release() }
}
await client.logout()
