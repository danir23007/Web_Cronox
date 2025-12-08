import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express'; // Para raw body (Stripe)
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  // Desactivamos el parser global para poder manejar raw en 1 ruta
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix('api');

  /**
   * STRIPE WEBHOOK
   * Necesita el body en RAW, sin parsear a JSON, para verificar la firma.
   * Esto solo se aplica a la ruta /webhooks/stripe
   */
  app.use(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }), // RAW → necesario para constructEvent
  );

  /**
   * RESTO DE LA API
   * Aquí usamos JSON normal como siempre.
   */
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  });

  /**
   * Swagger Docs
   */
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

  /**
   * Prisma Shutdown Hooks
   */
  const prismaService = app.get(PrismaService);
  if (prismaService?.enableShutdownHooks) {
    await prismaService.enableShutdownHooks(app);
  }

  /**
   * Listen
   */
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
