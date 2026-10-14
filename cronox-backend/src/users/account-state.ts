import { BadRequestException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';

/** Enablement is persisted; credentials, consent and acquisition source are independent. */
export const ACCOUNT_STATE_LABELS: Record<UserAccountState, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

/** Preserve the existing public signup completion flow without extending it to guest/admin accounts. */
export function canCompletePublicRegistration(user: {
  accountState: UserAccountState; role: Role; password: string | null; registrationClaimable: boolean;
}): boolean {
  return user.accountState === UserAccountState.ACTIVE && user.registrationClaimable && user.password === null &&
    (user.role === Role.USER || user.role === Role.FRIEND);
}

export function assertAccountState(value: unknown): asserts value is UserAccountState {
  if (value !== UserAccountState.ACTIVE && value !== UserAccountState.INACTIVE) {
    throw new BadRequestException('El estado debe ser Activo o Inactivo.');
  }
}
