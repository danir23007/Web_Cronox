import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientInitializationError,
)
export class DatabaseAvailabilityFilter extends BaseExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  catch(
    error:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientInitializationError,
    host: ArgumentsHost,
  ) {
    const code = 'code' in error ? error.code : error.errorCode;
    if (
      !['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(
        code || '',
      )
    ) {
      return super.catch(error, host);
    }
    const response = host.switchToHttp().getResponse();
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(response, 'Retry-After', '5');
    adapter.setHeader(response, 'Cache-Control', 'no-store');
    adapter.reply(
      response,
      {
        statusCode: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Servicio temporalmente no disponible. Inténtalo de nuevo.',
      },
      503,
    );
  }
}
