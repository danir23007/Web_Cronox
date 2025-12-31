import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HistorialService } from './historial.service';

@Module({
  imports: [PrismaModule],
  providers: [HistorialService],
  exports: [HistorialService],
})
export class HistorialModule {}
