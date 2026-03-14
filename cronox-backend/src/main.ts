import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix('api');

  /**
   * STRIPE WEBHOOK
   * Necesita el body en RAW, sin parsear a JSON, para verificar la firma.
   * Rutas finales con prefijo global:
   * - /api/webhooks/stripe
   * - /api/payments/webhook (alias retrocompatible para Stripe CLI)
   */
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

  /**
   * RESTO DE LA API
   */
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('CRONOX API')
    .setDescription('API de la tienda CRONOX — productos, imágenes y más.')
    .setVersion('1.0')
    .addTag('Auth')
    .addTag('Products')
    .addTag('Orders')
    .addTag('Payments / Stripe')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const prismaService = app.get(PrismaService);
  if (prismaService?.enableShutdownHooks) {
    await prismaService.enableShutdownHooks(app);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
