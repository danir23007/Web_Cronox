import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { EmailService } from '../common/email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const FIRST_ORDER_DISCOUNT_PERCENT = 10;

interface SubscriptionResult {
  status: 'ok' | 'already_subscribed' | 'already_registered';
  httpStatus: number;
  code?: string;
}

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly bcryptSaltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? '10');

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async subscribe(email: string): Promise<SubscriptionResult> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email: normalizedEmail } });
      const existingDiscount = existingUser
        ? await this.findFirstOrderDiscount(tx, existingUser.id)
        : null;

      if (existingUser) {
        const alreadySubscribed = existingUser.newsletterSubscribed;
        const alreadyHasCode = Boolean(
          existingDiscount || existingUser.firstOrderDiscountCode || existingUser.firstOrderDiscountUsed,
        );

        if (alreadySubscribed && alreadyHasCode) {
          return { status: 'already_registered', httpStatus: 409, code: existingDiscount?.code };
        }

        const code = existingDiscount?.code ?? (await this.createFirstOrderDiscount(tx, existingUser.id));

        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            newsletterSubscribed: true,
            firstOrderDiscountCode: code,
            firstOrderDiscountUsed: existingUser.firstOrderDiscountUsed ?? false,
          },
        });

        return {
          status: alreadySubscribed && alreadyHasCode ? 'already_subscribed' : 'ok',
          httpStatus: alreadySubscribed && alreadyHasCode ? 200 : 201,
          code,
        } as SubscriptionResult;
      }

      const passwordHash = await this.hashRandomPassword();
      const memberCode = await this.generateMemberCode(tx);
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName: null,
          lastName: null,
          newsletterSubscribed: true,
          firstOrderDiscountUsed: false,
          memberCode,
          role: Role.USER,
        },
      });

      const code = await this.createFirstOrderDiscount(tx, newUser.id);

      await tx.user.update({
        where: { id: newUser.id },
        data: { firstOrderDiscountCode: code },
      });

      return { status: 'ok', httpStatus: 201, code } as SubscriptionResult;
    });

    if (result.code && result.status === 'ok') {
      await this.safeSendDiscountEmail(normalizedEmail, result.code);
    }

    return result;
  }

  private async hashRandomPassword(): Promise<string> {
    const randomPassword = randomBytes(16).toString('hex');
    return bcrypt.hash(randomPassword, this.bcryptSaltRounds);
  }

  private async generateMemberCode(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let exists = true;

    while (exists) {
      const random = Array.from({ length: 6 })
        .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
        .join('');

      code = `CRX-${random}`;

      const found = await tx.user.findUnique({
        where: { memberCode: code },
        select: { id: true },
      });

      exists = Boolean(found);
    }

    return code;
  }

  private async generateDiscountCode(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let exists = true;

    while (exists) {
      const random = Array.from({ length: 6 })
        .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
        .join('');

      code = `CRX10-${random}`;

      const found = await tx.discountCode.findUnique({
        where: { code },
        select: { id: true },
      });

      exists = Boolean(found);
    }

    return code;
  }

  private async createFirstOrderDiscount(tx: Prisma.TransactionClient, userId: number): Promise<string> {
    const code = await this.generateDiscountCode(tx);

    await tx.discountCode.create({
      data: {
        code,
        type: 'FIRST_ORDER',
        percent: FIRST_ORDER_DISCOUNT_PERCENT,
        used: false,
        userId,
      },
    });

    return code;
  }

  private findFirstOrderDiscount(tx: Prisma.TransactionClient, userId: number) {
    return tx.discountCode.findFirst({
      where: { userId, type: 'FIRST_ORDER' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async safeSendDiscountEmail(email: string, code: string) {
    try {
      await this.emailService.sendFirstOrderDiscount(email, code);
    } catch (error) {
      this.logger.error('No se pudo enviar el email de descuento', error as Error);
    }
  }
}
