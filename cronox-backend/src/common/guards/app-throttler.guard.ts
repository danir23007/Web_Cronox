// src/common/guards/app-throttler.guard.ts
import { Injectable, Inject } from '@nestjs/common';
import {
  ThrottlerGuard,
  THROTTLER_MODULE_OPTIONS,
  THROTTLER_STORAGE,
  ThrottlerStorage,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(THROTTLER_MODULE_OPTIONS)
    protected readonly options: ThrottlerModuleOptions,
    @Inject(THROTTLER_STORAGE)
    protected readonly storageService: ThrottlerStorage,
    protected readonly reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }
}
