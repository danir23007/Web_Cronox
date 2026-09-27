import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError, HttpException)
export class MailExceptionFilter implements ExceptionFilter {
  catch(
    error: Prisma.PrismaClientKnownRequestError | HttpException,
    host: ArgumentsHost,
  ) {
    let status = 409,
      message =
        'La operación entra en conflicto con otro registro. Recarga y comprueba el nombre y las relaciones.';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse() as { message?: string | string[] };
      message =
        typeof body.message === 'string' &&
        !body.message.startsWith('Validation')
          ? body.message
          : 'Datos no válidos. Revisa los campos y sus límites.';
      if (status === 429) message = 'Has realizado demasiadas pruebas seguidas. Espera un minuto antes de volver a intentarlo.';
    } else if (error.code === 'P2021' || error.code === 'P2022') {
      status = 503;
      message =
        'La biblioteca de correo necesita la migración de base de datos antes de abrirse.';
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message });
  }
}
