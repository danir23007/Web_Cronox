// cronox-backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`✅ Backend listo en puerto ${port}`);
}
bootstrap();
