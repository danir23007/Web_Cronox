// Isolated fixtures only. Called by review-mailbox.cjs; never loads a real .env.
module.exports = async ({ db, service, users, reader, leases, sync, provider, stores, pass }) => {
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { Readable } = require('node:stream');
  const { MockImapStore } = require('../../tests/mailbox/mock-imap.cjs');
  const actor = { id: users.superadmin.id, role: 'SUPERADMIN' };
  const base = await db.mailbox.findFirst();
  const box = await db.mailbox.create({data: {...base, id:randomUUID(), address:'reading@example.test', name:'Reading fixture', active:true, leaseToken:null, leaseUntil:null}});
  const store = new MockImapStore(); stores.set(box.id, store);
  store.folders.get('INBOX').rows.push(store.message(1, 'Reading fixture'));
  await sync.sync(box.id);
  const message = await db.mailboxMessage.findFirst({where:{mailboxId:box.id,alive:true}});
  const original = provider.imap;
  let unlock, reached;
  const locked = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { unlock = resolve; });
  let first = true, connected = 0, maximum = 0;
  provider.imap = async current => {
    if (current.id !== box.id) return original(current);
    const client = store.client(); connected++; maximum = Math.max(maximum, connected);
    const select = client.getMailboxLock, logout = client.logout;
    client.getMailboxLock = async (...args) => {
      if(first) { first=false; reached(); await gate; }
      return select(...args);
    };
    client.logout = async () => { connected--; return logout(); };
    return client;
  };
  try {
    const background = sync.sync(box.id); await locked;
    let downloaded = false;
    const open = reader.body(actor,message.id).then(value => {downloaded=true;return value;});
    const duplicate = reader.body(actor,message.id);
    const read = reader.action(actor,message.id,'read');
    await new Promise(resolve => setTimeout(resolve,80));
    assert.equal(downloaded,false);
    await assert.rejects(leases.run(box.id,async()=>{}, {waitMs:60}),/MAILBOX_BUSY/);
    unlock();
    await background;
    const [body, body2] = await Promise.all([open,duplicate]); await read;
    assert.equal(body.body.text,body2.body.text);
    assert.equal(store.downloads.length,2,'duplicate opens share the persisted body');
    assert.equal(maximum,1,'sync, downloads and flags never overlap IMAP sessions in a mailbox');
    assert.equal((await db.mailboxMessage.findUnique({where:{id:message.id}})).seen,true);
    assert.equal((await db.mailbox.findUnique({where:{id:box.id}})).leaseToken,null);
    pass('Interactive operations wait for sync, duplicate downloads coalesce, timeout is bounded and leases release');
  } finally {provider.imap=original; unlock();}

  const previousIdles=store.idles;
  const idleSync=sync.sync(box.id,true);
  const deadline=Date.now()+5000;
  while(store.idles===previousIdles && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
  assert(store.idles>previousIdles,'worker entered IDLE');
  const start=Date.now();
  await reader.action(actor,message.id,'unread'); await idleSync;
  assert(Date.now()-start<3000,'interactive waiter ends IDLE instead of waiting ten seconds');
  pass('Interactive requests interrupt idle polling through NOOP and resume without overlapping IMAP operations');

  // Broken STORE must not change the cached seen flag or prevent cached content access.
  await reader.action(actor,message.id,'unread');
  provider.imap = async current => {
    const client = await original(current);
    if(current.id===box.id) client.messageFlagsAdd=async()=>{throw Error('synthetic STORE failure');};
    return client;
  };
  try {
    await assert.rejects(reader.action(actor,message.id,'read'),/synthetic STORE failure/);
    assert.equal((await db.mailboxMessage.findUnique({where:{id:message.id}})).seen,false);
    assert((await reader.body(actor,message.id)).body.text.length);
    assert.equal((await db.mailbox.findUnique({where:{id:box.id}})).leaseToken,null);
  } finally {provider.imap=original;}
  pass('A failed read-state update preserves content and cached unread state; its lease is released');

  store.folders.get('INBOX').rows.push(store.message(2,'Failed download fixture'),store.message(3,'Gone fixture'),store.message(4,'Charset fixture'));
  store.folders.get('INBOX').rows[3].bodyStructure.childNodes.find(p=>p.type==='text/plain').parameters.charset='iso-8859-1';
  await sync.sync(box.id);
  const rows = await db.mailboxMessage.findMany({where:{mailboxId:box.id,alive:true}});
  const failed=rows.find(m=>m.uid===2n), gone=rows.find(m=>m.uid===3n), charset=rows.find(m=>m.uid===4n);
  provider.imap=async current=>{
    const client=await original(current);
    if(current.id===box.id) client.download=async()=>({});
    return client;
  };
  try {await assert.rejects(reader.body(actor,failed.id),/MAILBOX_CONTENT_DOWNLOAD_FAILED/);}
  finally {provider.imap=original;}
  assert.equal((await db.mailboxMessage.findUnique({where:{id:failed.id}})).bodyState,'FAILED');
  assert((await reader.body(actor,failed.id)).body.text.length);
  store.folders.get('INBOX').rows=store.folders.get('INBOX').rows.filter(m=>m.uid!==3);
  await assert.rejects(reader.body(actor,gone.id),/MAILBOX_MESSAGE_UNAVAILABLE/);
  assert.equal((await db.mailboxMessage.findUnique({where:{id:gone.id}})).alive,false);
  provider.imap=async current=>{
    const client=await original(current), download=client.download;
    client.download=async(uid,part)=>part==='3'?{meta:{charset:'utf-8'},content:Readable.from(Buffer.from('Caf\u00e9 y conexi\u00f3n'))}:download(uid,part);
    return client;
  };
  try {assert.equal((await reader.body(actor,charset.id)).body.text,'Caf\u00e9 y conexi\u00f3n');}
  finally {provider.imap=original;}
  pass('Missing MIME content fails explicitly and retries; disappeared UIDs are distinguished; decoded UTF-8 stays intact');

  const cached=await db.mailboxMessage.findUnique({where:{id:message.id}});
  await reader.files.remove(cached.bodyKey);
  const restored=await reader.body(actor,message.id);
  assert(restored.body.text.length);
  assert.equal(restored.files.length,1,'cache repair does not duplicate attachment metadata');
  pass('A missing private cache file is downloaded again without duplicate attachments');

  await db.mailboxMessage.update({where:{id:message.id},data:{envelope:{from:[{address:'from@example.test'}],replyTo:[{address:'one@example.test'},{address:'two@example.test'}],to:[{address:'other@example.test'}],cc:[{address:'cc@example.test'}]}}});
  const input={mailboxId:box.id,messageId:message.id,mode:'reply'};
  await assert.rejects(service.createDraft(actor,input),/MAILBOX_REPLY_CHOOSE_ONE/);
  await assert.rejects(service.createDraft(actor,{...input,replyRecipient:'other@example.test'}),/MAILBOX_REPLY_CHOOSE_ONE/);
  await assert.rejects(service.createDraft(actor,{...input,mailboxId:base.id,replyRecipient:'one@example.test'}),/MAILBOX_REPLY_MUST_USE_ORIGINAL_BOX/);
  const draft=await service.createDraft(actor,{...input,replyRecipient:'two@example.test'});
  assert.equal(draft.to,'two@example.test'); assert.equal(draft.cc,''); assert.equal(draft.bcc,'');
  assert.equal(draft.singleReply,true); assert.equal(draft.mailboxId,box.id);
  const persisted=await db.mailboxDraft.findUnique({where:{id:draft.id}});
  assert(persisted.references.includes('<earlier@example.test>'));
  // This source deliberately lacks Message-ID: mode still enforces an individual reply.
  assert.equal(persisted.inReplyTo,null);
  await assert.rejects(service.saveDraft(actor,draft.id,{...draft,cc:'cc@example.test'}),/MAILBOX_REPLY_SINGLE_RECIPIENT_REQUIRED/);
  await assert.rejects(service.saveDraft(actor,draft.id,{...draft,to:'one@example.test,two@example.test'}),/MAILBOX_REPLY_SINGLE_RECIPIENT_REQUIRED/);
  await db.mailboxDraft.update({where:{id:draft.id},data:{bcc:'hidden@example.test'}});
  await assert.rejects(service.enqueue(actor,draft.id,{revision:draft.revision,requestKey:randomUUID()},{}),/MAILBOX_REPLY_SINGLE_RECIPIENT_REQUIRED/);
  await db.mailboxDraft.update({where:{id:draft.id},data:{bcc:''}});
  const forward=await service.createDraft(actor,{...input,mode:'forward'});
  assert.equal(forward.to,''); assert.equal(forward.cc,''); assert.equal(forward.status,'DRAFT');
  assert.equal(await db.mailboxSend.count({where:{draftId:forward.id}}),0);
  pass('Reply requires one permitted address and original mailbox, preserves thread references, blocks CC/BCC at save/send; forwarding stays unsent');

  // Provider attributes take precedence over a second folder with a conventional name.
  const bin=await db.mailboxFolder.findFirst({where:{mailboxId:box.id,path:'Trash'}});
  const remoteBin=store.folders.get('Trash');
  store.folders.delete('Trash'); store.folders.set('Provider bin',remoteBin);
  await db.mailboxFolder.update({where:{id:bin.id},data:{path:'Provider bin'}});
  await db.mailboxFolder.create({data:{...bin,id:randomUUID(),specialUse:null,uidValidity:'600'}});
  store.folders.set('Trash',{specialUse:null,validity:600,rows:[]});
  await reader.action(actor,message.id,'trash');
  assert.equal((await db.mailboxMessage.findUnique({where:{id:message.id},include:{folder:true}})).folder.path,'Provider bin');
  await reader.action(actor,message.id,'restore');
  // With no Trash special-use metadata, use the real conventional path.
  await db.mailboxFolder.update({where:{id:bin.id},data:{specialUse:'\\Archive'}});
  await reader.action(actor,message.id,'trash');
  assert.equal((await db.mailboxMessage.findUnique({where:{id:message.id},include:{folder:true}})).folder.path,'Trash');
  assert.equal(store.folders.get('Trash').rows.length,1);
  pass('Trash uses the real provider folder with a path fallback and never permanently deletes');
};
