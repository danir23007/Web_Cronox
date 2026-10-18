'use strict';
// Additional received-message fixtures; no external accounts or transports.
module.exports = async ({ db, users, reader, sync, stores, pass }) => {
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { Readable } = require('node:stream');
  const { MockImapStore } = require('../../tests/mailbox/mock-imap.cjs');
  assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
  const actor = { id: users.superadmin.id, role: 'SUPERADMIN' };
  const base = await db.mailbox.findFirstOrThrow();
  for (const [slug, name] of [['info', 'Información'], ['no-reply', 'No-reply'], ['orders', 'Pedidos'], ['support', 'Soporte']]) {
    const box = await db.mailbox.create({ data: {
      ...base, id: randomUUID(), name: 'Lectura fixture: ' + name,
      address: 'reading-' + slug + '@example.test', username: 'reading-' + slug + '@example.test',
      active: true, notify: true, leaseToken: null, leaseUntil: null,
      nextSyncAt: new Date(), activatedAt: new Date(),
    } });
    const store = new MockImapStore();
    stores.set(box.id, store);
    const open = store.client.bind(store);
    store.client = () => {
      const client = open();
      client.download = async (uid, part) => {
        store.downloads.push({ uid: Number(uid), part });
        const text = part === '1'
          ? '<p>Café, conexión, ñ y €</p><script>parent.fixtureEscaped=true</script><a href="javascript:alert(1)">bloqueado</a>'
          : part === '2' ? '%PDF-four-boxes-synthetic' : 'Café, conexión, ñ y €';
        return { meta: { charset: 'utf-8' }, content: Readable.from(Buffer.from(text)) };
      };
      return client;
    };
    const old = store.message(1, 'Antiguo: ' + name, new Date('2020-01-01T00:00:00Z'));
    // Old message is plain text plus attachment; the new one also has HTML.
    old.bodyStructure.childNodes = old.bodyStructure.childNodes.filter(part => part.type !== 'text/html');
    store.folders.get('INBOX').rows.push(old);
    await sync.sync(box.id);
    assert.equal(await db.mailboxNotice.count({ where: { mailboxId: box.id } }), 0);
    store.folders.get('INBOX').rows.push(store.message(2, 'Nuevo: ' + name, new Date()));
    await sync.sync(box.id);
    const rows = await db.mailboxMessage.findMany({ where: { mailboxId: box.id, alive: true }, orderBy: { uid: 'asc' } });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const value = await reader.body(actor, row.id);
      assert.equal(value.body.text, 'Café, conexión, ñ y €');
      assert.equal(value.body.html.includes('<p>Café, conexión, ñ y €</p>'), row.uid === 2n);
      assert(!/<script|javascript:/.test(value.body.html));
      assert.equal(value.files.length, 1);
      const file = await reader.file(actor, value.files[0].id), chunks = [];
      for await (const chunk of file.stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), '%PDF-four-boxes-synthetic');
    }
    await sync.sync(box.id);
    assert.equal(await db.mailboxMessage.count({ where: { mailboxId: box.id, alive: true } }), 2);
    assert.equal(await db.mailboxFile.count({ where: { mailboxId: box.id } }), 2);
    assert.equal(await db.mailboxNotice.count({ where: { mailboxId: box.id } }), 1);
    assert.equal(await db.mailboxMessage.count({ where: { mailboxId: box.id, seen: true } }), 0);
  }
  pass('Four isolated mailboxes read old plain text and new sanitized HTML with UTF-8/attachments; repeated sync preserves unread flags and emits only four fresh notices without duplicates');
};
