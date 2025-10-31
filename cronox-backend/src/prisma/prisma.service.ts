import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    // Prisma 5 ya no usa this.$on('beforeExit'), usamos el hook global de Node
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
