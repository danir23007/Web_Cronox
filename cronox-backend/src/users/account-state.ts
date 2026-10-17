import { BadRequestException } from '@nestjs/common';
import { UserAccountState } from '@prisma/client';

/** Enablement is persisted; credentials, consent and acquisition source are independent. */
export const ACCOUNT_STATE_LABELS: Record<UserAccountState, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

export function assertAccountState(value: unknown): asserts value is UserAccountState {
  if (value !== UserAccountState.ACTIVE && value !== UserAccountState.INACTIVE) {
    throw new BadRequestException('El estado debe ser Activo o Inactivo.');
  }
}
