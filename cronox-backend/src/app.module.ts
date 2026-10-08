// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // [STRIPE]
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { UserNumberingGateModule } from './users/user-numbering-gate.module';
import { UserNumberingCompletion } from './users/user-numbering.middleware';
import { ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReadinessService } from './readiness.service';
import { DatabaseAvailabilityFilter } from './common/filters/database-availability.filter';
import { ExpiringThrottlerStorage } from './common/guards/expiring-throttler.storage';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { EmailModule } from './email/email.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { CsrfProtectionGuard } from './common/guards/csrf-protection.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';
import { UsersModule } from './users/users.module';
import { AddressesModule } from './addresses/addresses.module';
import { OrdersModule } from './orders/orders.module'; // [ORDERS]
import { PaymentsModule } from './payments/payments.module'; // [STRIPE]
import { AdminModule } from './admin/admin.module';
import { ShippingMethodsModule } from './shipping-methods/shipping-methods.module';
import { CategoriesModule } from './categories/categories.module';
import { FavoritesModule } from './favorites/favorites.module';
import { MeModule } from './me/me.module';
import { MembershipModule } from './membership/membership.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GalleryModule } from './gallery/gallery.module';
import { MediaFramingModule } from './media-framing/media-framing.module';
import { KeyScreenModule } from './key-screen/key-screen.module';
import { ImagesModule } from './images/images.module';
import { FooterModule } from './footer/footer.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { LiveStatsModule } from './live-stats/live-stats.module';
import { MailboxModule } from './mailbox/mailbox.module';
import {
  getRateLimitMax,
  getRateLimitTtlMs,
  validateEnvironment,
} from './common/config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.CRONOX_ENV_FILE || '.env',
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: getRateLimitTtlMs(), limit: getRateLimitMax() }],
        storage: new ExpiringThrottlerStorage(),
      }),
    }),
    ServeStaticModule.forRoot(
      {
        // Archivos estáticos globales (favicon, etc.) en cronox-front/public
        rootPath: join(__dirname, '..', '..', 'cronox-front', 'public'),
        serveRoot: '/',
        exclude: ['/api', '/docs', '/webhooks'],
      },
      {
        // cronox-backend/../.. = carpeta padre donde está cronox-front
        rootPath: join(__dirname, '..', '..', 'cronox-front'),
        serveRoot: '/',
        renderPath: '/',
        // solo cadenas simples; /api y compañía se reservan para la API
        exclude: ['/api', '/docs', '/webhooks'],
        serveStaticOptions: { index: 'index.html' },
      },
    ),
    PrismaModule,
    UserNumberingGateModule,
    ImagesModule,
    FooterModule,
    WaitlistModule,
    LiveStatsModule,
    MailboxModule,
    EmailModule,
    AuthModule,
    CartModule,
    ProductModule,
    UsersModule,
    AddressesModule,
    ShippingMethodsModule,
    CategoriesModule,
    FavoritesModule,
    MeModule,
    MembershipModule,
    NewsletterModule,
    AnalyticsModule,
    GalleryModule,
    MediaFramingModule,
    KeyScreenModule,
    OrdersModule, // [ORDERS] Registro del módulo de pedidos
    PaymentsModule, // [STRIPE]
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: UserNumberingCompletion },
    ReadinessService,
    { provide: APP_FILTER, useClass: DatabaseAvailabilityFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfProtectionGuard },
  ],
})
export class AppModule {}
