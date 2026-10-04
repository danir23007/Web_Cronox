/** IMAP special-use is authoritative; conventional provider paths are a fallback. */
export function mailboxFolderKind(folder: { specialUse?: string | null; path?: string }) {
  if (folder.specialUse) return folder.specialUse;
  const path = (folder.path || '').replace(/^INBOX[./]/i, '');
  if (/^INBOX$/i.test(path)) return '\\Inbox';
  if (/^(Sent|Sent Items|Sent Messages)$/i.test(path)) return '\\Sent';
  if (/^(Drafts|Draft)$/i.test(path)) return '\\Drafts';
  return null;
}
