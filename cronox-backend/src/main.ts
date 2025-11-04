import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express'; // [WEBHOOK]
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false }); // [WEBHOOK]

  app.use('/webhooks/stripe', express.raw({ type: 'application/json' })); // [WEBHOOK]
  app.use(express.json()); // [WEBHOOK]
  app.use(express.urlencoded({ extended: true })); // [WEBHOOK]
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('CRONOX API')
    .setDescription('API de la tienda CRONOX — productos, imágenes y más.')
    .setVersion('1.0')
    .addTag('Auth')
    .addTag('Products')
    .addTag('Orders') // [ORDERS] Documentar endpoints de pedidos
    .addTag('Payments / Stripe') // [DOC]
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Habilitar shutdown hooks para Prisma
  const prismaService = app.get(PrismaService);
  if (prismaService?.enableShutdownHooks) {
    await prismaService.enableShutdownHooks(app);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  // Opcional: console.log(`Server running on http://127.0.0.1:${port}`);
}
bootstrap();
