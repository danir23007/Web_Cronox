import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS abierto para desarrollo
  app.enableCors({ origin: true, credentials: false });

  await app.listen(3000);
}
bootstrap();
