import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';

export const WEBSITE_MEDIA_UPLOAD_TOO_LARGE_MESSAGE =
  'El archivo supera el tamaño máximo permitido de 100 MB.';

@Catch(MulterError)
export class WebsiteMediaUploadSizeExceptionFilter
  implements ExceptionFilter<MulterError>
{
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: WEBSITE_MEDIA_UPLOAD_TOO_LARGE_MESSAGE,
        error: 'Bad Request',
      });
      return;
    }
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'No se pudo procesar el archivo multimedia.',
      error: 'Bad Request',
    });
  }
}
