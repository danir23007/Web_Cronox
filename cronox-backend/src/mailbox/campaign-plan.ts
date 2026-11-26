import { canonicalRecipient } from './mailbox-campaign-policy';

/** User.circleLevel is scalar. Case-equivalent accounts must still agree. */
export function campaignAudience(
  users: any[],
  suppressed: (string | { email: string; reason: string })[],
  selected: number[],
) {
  const groups = new Map<string, any[]>(),
    blocked: string[] = [];
  const suppressions = new Map(suppressed.map(s => typeof s === 'string' ? [s, 'SUPPRESSED'] : [s.email.trim().toLowerCase(), s.reason]));
  const excluded: { email: string; circle: number; reason: string; accountId?: number }[] = [];
  const exclude = (user: any, reason: string) => { if (selected.includes(user.circleLevel)) excluded.push({ email: user.email, circle: user.circleLevel, reason, accountId: user.id }); };
  for (const user of users) {
    const email = canonicalRecipient(user.email);
    if (!email) { exclude(user, 'INVALID_EMAIL'); continue; }
    if (user.accountState !== undefined && user.accountState !== 'ACTIVE') { exclude(user, 'ACCOUNT_' + user.accountState); continue; }
    if (suppressions.has(email)) { exclude(user, 'SUPPRESSION_' + suppressions.get(email)); continue; }
    if (user.newsletterSubscribed === false) { exclude(user, 'NO_SUBSCRIPTION_EVIDENCE'); continue; }
    groups.set(email, [...(groups.get(email) || []), user]);
  }
  const recipients: { email: string; circle: number; name: string }[] = [];
  for (const [email, accounts] of groups) {
    const levels = [...new Set<number>(accounts.map((u) => u.circleLevel))];
    if (!levels.some((c) => selected.includes(c))) continue;
    if (levels.length !== 1) {
      accounts.forEach(u => exclude(u, 'AMBIGUOUS_CIRCLE'));
      blocked.push(
        'Una dirección pertenece a círculos distintos. Revisa las cuentas antes de confirmar.',
      );
      continue;
    }
    const names = [
      ...new Set<string>(accounts.map((u) => (u.name || '').trim())),
    ];
    recipients.push({
      email,
      circle: levels[0],
      name: names.length === 1 ? names[0] : '',
    });
    accounts.slice(1).forEach(u => exclude(u, 'DUPLICATE_EMAIL'));
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));
  return { recipients, blocked: [...new Set(blocked)], totalUsers: users.filter(u => selected.includes(u.circleLevel)).length,
    excluded, exclusionCounts: excluded.reduce<Record<string, number>>((counts, row) => { counts[row.reason] = (counts[row.reason] || 0) + 1; return counts; }, {}) };
}

export function missingCampaignVariables(
  source: { subject: string; html: string; text: string },
  data: Record<string, unknown>,
) {
  const paths = [
    ...new Set(
      [
        ...`${source.subject}\n${source.html}\n${source.text}`.matchAll(
          /\{\{(?:#(?:if|each)\s+)?([\w.]+)\}\}/g,
        ),
      ]
        .map((m) => m[1])
        .filter((p) => p !== 'else'),
    ),
  ];
  return paths.filter((p) => {
    const value = p
      .split('.')
      .reduce<any>(
        (o, k) =>
          o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined,
        data,
      );
    return value === undefined || value === null || value === '';
  });
}
