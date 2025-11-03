import 'express';
import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      role: Role;
    }
  }
}
export {};
