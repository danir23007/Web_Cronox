// Test-only deterministic IMAP adapter. No sockets or provider credentials.
const { Readable } = require("node:stream");
class MockImapStore {
  constructor() {
    this.downloads = [];
    this.readChanges = 0;
    this.fail = false;
    this.appendFail = false;
    this.appends = 0;
    this.idles = 0;
    this.folders = new Map([
      ["INBOX", { specialUse: "\\Inbox", validity: 100, rows: [] }],
      ["Sent", { specialUse: "\\Sent", validity: 200, rows: [] }],
      ["Drafts", { specialUse: "\\Drafts", validity: 300, rows: [] }],
      ["Spam", { specialUse: "\\Junk", validity: 400, rows: [] }],
      ["Trash", { specialUse: "\\Trash", validity: 500, rows: [] }],
    ]);
  }
  message(uid, subject = "Mensaje de prueba", date = new Date("2020-01-01")) {
    return {
      uid,
      envelope: {
        subject,
        messageId: uid === 1 ? undefined : "<duplicate@example.test>",
        from: [{ name: "Remitente de prueba", address: "from@example.test" }],
        to: [
          { address: "support@example.test" },
          { address: "other@example.test" },
        ],
        cc: [{ address: "third@example.test" }],
        replyTo: [{ address: "reply@example.test" }],
        date,
      },
      internalDate: date,
      size: 1000,
      flags: new Set(),
      headers: Buffer.from(
        "Message-ID: <duplicate@example.test>\r\nReferences: <earlier@example.test>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n",
      ),
      bodyStructure: {
        type: "multipart/mixed",
        childNodes: [
          {
            part: "1",
            type: "text/html",
            parameters: { charset: "utf-8" },
            size: 300,
          },
          {
            part: "2",
            type: "application/pdf",
            disposition: "attachment",
            dispositionParameters: { filename: "prueba.pdf" },
            size: 25,
          },
          {
            part: "3",
            type: "text/plain",
            parameters: { charset: "utf-8" },
            size: 50,
          },
        ],
      },
    };
  }
  client() {
    if (this.fail)
      throw Object.assign(Error("synthetic failure"), { code: "ECONNREFUSED" });
    const store = this;
    let path = "INBOX",
      idleDone;
    const rows = () =>
      store.folders
        .get(path)
        .rows.slice()
        .sort((a, b) => a.uid - b.uid);
    const selected = (range, uid) => {
      const all = rows();
      if (range.includes(",")) {
        const ids = range.split(",").map(Number);
        return all.filter((r) =>
          ids.includes(uid ? r.uid : all.indexOf(r) + 1),
        );
      }
      const [lo, hi] = range
        .split(":")
        .map((v) => (v === "*" ? Infinity : Number(v)));
      return all.filter(
        (r, i) =>
          (uid ? r.uid : i + 1) >= lo && (uid ? r.uid : i + 1) <= (hi ?? lo),
      );
    };
    return {
      capabilities: new Set(["IDLE", "MOVE", "UIDPLUS"]),
      get mailbox() {
        const folder = store.folders.get(path),
          all = rows();
        return {
          uidValidity: BigInt(folder.validity),
          uidNext: (all.at(-1)?.uid || 0) + 1,
          exists: all.length,
          path,
        };
      },
      async list() {
        return [...store.folders].map(([path, f]) => ({
          path,
          specialUse: f.specialUse,
          flags: new Set(),
        }));
      },
      async getMailboxLock(name) {
        path = name;
        return { release() {} };
      },
      async fetchAll(range, _query, options) {
        return selected(range, options?.uid).map((r) => ({
          ...r,
          flags: new Set(r.flags),
        }));
      },
      async fetchOne(seq, _query, options) {
        return options?.uid
          ? rows().find((r) => r.uid === Number(seq))
          : rows()[Number(seq) - 1];
      },
      async status() {
        return { unseen: rows().filter((r) => !r.flags.has("\\Seen")).length };
      },
      async download(uid, part) {
        store.downloads.push({ uid: Number(uid), part });
        const value =
          part === "1"
            ? '<p>Contenido HTML legible</p><script>window.top.location="evil"</script><form><input></form><img src="https://tracker.example.test/pixel"><a href="javascript:alert(1)">peligroso</a><a href="https://example.test">enlace seguro</a>'
            : part === "2"
              ? "%PDF-test-only-attachment"
              : "Texto de prueba: café y conexión.";
        return { content: Readable.from(Buffer.from(value)) };
      },
      async messageFlagsAdd(uid, flags) {
        const msg = rows().find((m) => m.uid === Number(uid));
        if (!msg) return false;
        flags.forEach((f) => msg.flags.add(f));
        store.readChanges++;
        return true;
      },
      async messageFlagsRemove(uid, flags) {
        const msg = rows().find((m) => m.uid === Number(uid));
        if (!msg) return false;
        flags.forEach((f) => msg.flags.delete(f));
        store.readChanges++;
        return true;
      },
      async messageMove(uid, destination) {
        const folder = store.folders.get(path),
          index = folder.rows.findIndex((m) => m.uid === Number(uid));
        if (index < 0) return false;
        const [msg] = folder.rows.splice(index, 1),
          target = store.folders.get(destination),
          newUid = (target.rows.at(-1)?.uid || 0) + 1;
        target.rows.push({ ...msg, uid: newUid });
        return {
          uidValidity: BigInt(target.validity),
          uidMap: new Map([[Number(uid), newUid]]),
        };
      },
      async search(query) {
        if (query.all) return rows().map(r => r.uid);
        return rows()
          .filter((r) => r.envelope.messageId === query.header["Message-ID"])
          .map((r) => r.uid);
      },
      async messageDelete(range, options) {
        if (!options?.uid) throw Error('Test requires exact UIDs');
        const ids = range.split(',').map(Number);
        const folder = store.folders.get(path);
        folder.rows = folder.rows.filter(row => !ids.includes(row.uid));
        return true;
      },
      async append(destination, raw) {
        if (store.appendFail) throw Error("synthetic append failure");
        store.appends++;
        const target = store.folders.get(destination),
          messageId = raw
            .toString()
            .match(/^Message-ID:\s*(.+)$/im)?.[1]
            ?.trim();
        target.rows.push({
          ...store.message(
            (target.rows.at(-1)?.uid || 0) + 1,
            "Enviado",
            new Date(),
          ),
          envelope: { messageId },
        });
        return true;
      },
      async idle() {
        store.idles++;
        return new Promise((resolve) => {
          idleDone = resolve;
        });
      },
      async noop() {
        idleDone?.(true);
      },
      async logout() {
        idleDone?.(true);
      },
      close() {
        idleDone?.(true);
      },
    };
  }
}
module.exports = { MockImapStore };
