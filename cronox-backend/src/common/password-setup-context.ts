export type PasswordSetupScenario = 'NEW_ACCOUNT' | 'EXISTING_PASSWORDLESS' | 'NOT_NEEDED';
export type PasswordSetupContext = { scenario: PasswordSetupScenario; orderId: number };
export function passwordSetupScenario(value: unknown): value is PasswordSetupScenario {
  return ['NEW_ACCOUNT', 'EXISTING_PASSWORDLESS', 'NOT_NEEDED'].includes(String(value));
}
