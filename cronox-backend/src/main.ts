import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import express from 'express';
import type { CookieOptions } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { createContentSecurityPolicy } from './common/config/content-security-policy';
import {
  getCorsOrigins,
  getTrustedProxyHops,
  isCorsOriginAllowed,
  isProductionEnvironment,
} from './common/config/environment';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type CsrfTokenRequest,
} from './common/guards/csrf-protection.guard';
import { PrismaService } from './prisma/prisma.service';
import { KeyScreenService } from './key-screen/key-screen.service';
import { AuthService } from './auth/auth.service';
import { createPublicHtmlGateMiddleware } from './common/routing/public-html-gate.middleware';
import {
  canonicalPathForRequest,
  cleanPageForPath,
  legacyRedirectTarget,
  normalizePublicPath,
  prelaunchSitemapXml,
  robotsText,
} from './common/routing/public-pages';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const isProduction = isProductionEnvironment();
  const trustedProxyHops = getTrustedProxyHops();
  const allowedCorsOrigins = getCorsOrigins();
  const frontendRoot = join(__dirname, '..', '..', 'cronox-front');
  const contentSecurityPolicy = createContentSecurityPolicy(frontendRoot);
  const csrfCookieOptions: CookieOptions = {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  };

  app.setGlobalPrefix('api');
  const expressApp = app.getHttpAdapter().getInstance() as express.Application;
  expressApp.disable('x-powered-by');

  if (trustedProxyHops > 0) {
    expressApp.set('trust proxy', trustedProxyHops);
  }

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=()',
    );

    if (isProduction) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    next();
  });

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
  app.use('/api/admin/mail-templates', express.json({ limit: '256kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const csrfRequest = req as CsrfTokenRequest;
    const existingToken = req.cookies?.[CSRF_COOKIE_NAME];
    const csrfToken =
      typeof existingToken === 'string' && existingToken.length >= 32
        ? existingToken
        : randomBytes(32).toString('base64url');

    csrfRequest.csrfToken = csrfToken;
    if (csrfToken !== existingToken) {
      res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions);
    }
    next();
  });

  // Enforced before Nest registers the static storefront handlers. The gate
  // page, legal pages and every Admin surface remain explicitly reachable.
  const keyScreen = app.get(KeyScreenService);
  const authService = app.get(AuthService);

  app.use('/robots.txt', async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.type('text/plain');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(robotsText(await keyScreen.shouldGatePublicHtml()));
  });

  app.use('/sitemap.xml', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.type('application/xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(prelaunchSitemapXml());
  });

  app.use(
    createPublicHtmlGateMiddleware({
      authService,
      keyScreen,
      frontendRoot,
    }),
  );

  // Old public filenames remain valid bookmarks but converge permanently on
  // one clean, canonical URL. Query strings are retained by the mapper.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const target = legacyRedirectTarget(req.path, req.originalUrl);
    return target ? res.redirect(308, target) : next();
  });

  // Clean public routes internally reuse the existing HTML entry points, so a
  // direct request or refresh never depends on an Nginx rewrite or SPA fallback.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = normalizePublicPath(req.path);
    const page = cleanPageForPath(pathname);
    if (!page) return next();
    if (req.path.length > 1 && req.path.endsWith('/')) {
      const queryIndex = req.originalUrl.indexOf('?');
      const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
      return res.redirect(308, `${pathname}${query}`);
    }
    res.setHeader(
      'Link',
      `<${canonicalPathForRequest(pathname)}>; rel="canonical"`,
    );
    return res.sendFile(join(frontendRoot, page));
  });

  // Keep the extensionless Admin entry point independent from the public SPA.
  // The protected Admin shell resolves its existing cookie session next.
  app.use(['/admin', '/admin/'], (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.redirect(307, '/admin.html');
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: isProduction,
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      callback(
        null,
        !origin || isCorsOriginAllowed(origin, allowedCorsOrigins),
      );
    },
    credentials: true,
    exposedHeaders: ['X-Session-Idle-Expires', 'Content-Disposition'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      CSRF_HEADER_NAME,
      'Idempotency-Key',
    ],
    maxAge: 600,
  });

  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
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
  }

  const prismaService = app.get(PrismaService);
  if (prismaService?.enableShutdownHooks) {
    await prismaService.enableShutdownHooks(app);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
