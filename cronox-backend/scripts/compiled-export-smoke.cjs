'use strict';
// Test-only bootstrap for compiled route discovery. The real global limiter,
// authentication and CSRF guards remain installed; only its persistence is
// replaced with Nest's in-memory test provider. Production imports no test code.
const { installTestEnvironment } = require('../test/test-environment.cjs');
const port = Number(process.env.PORT || 43119);
installTestEnvironment({ force: true, overrides: {
  PORT: String(port), HOST: '127.0.0.1', CRONOX_ROUTE_SMOKE_MODE: 'true',
  EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false',
  NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
} });
(async () => {
  const { Test } = require('@nestjs/testing');
  const { getStorageToken, ThrottlerStorageService } = require('@nestjs/throttler');
  const { AppModule } = require('../dist/app.module');
  const { createAppValidationPipe } = require('../dist/common/customer-validation');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getStorageToken()).useClass(ThrottlerStorageService).compile();
  const app = module.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.use(require('cookie-parser')());
  app.useGlobalPipes(createAppValidationPipe(true));
  await app.listen(port, '127.0.0.1');
  process.once('SIGTERM', () => { void app.close().then(() => process.exit(0)); });
})().catch(() => { console.error('Compiled export test bootstrap failed'); process.exitCode = 1; });
