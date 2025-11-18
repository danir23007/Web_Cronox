import 'express';
import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      role: Role;
      name?: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
    interface Request {
      user?: User;
    }
  }
}

export {};
