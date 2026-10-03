import { canonicalRecipient } from './mailbox-campaign-policy';

/** User.circleLevel is scalar. Case-equivalent accounts must still agree. */
export function campaignAudience(
  users: any[],
  suppressed: string[],
  selected: number[],
) {
  const groups = new Map<string, any[]>(),
    blocked: string[] = [];
  for (const user of users) {
    const email = canonicalRecipient(user.email);
    if (!email || suppressed.includes(email)) continue;
    groups.set(email, [...(groups.get(email) || []), user]);
  }
  const recipients: { email: string; circle: number; name: string }[] = [];
  for (const [email, accounts] of groups) {
    const levels = [...new Set<number>(accounts.map((u) => u.circleLevel))];
    if (!levels.some((c) => selected.includes(c))) continue;
    if (levels.length !== 1) {
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
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));
  return { recipients, blocked: [...new Set(blocked)] };
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
