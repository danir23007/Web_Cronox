import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

export const PRODUCT_IMAGE_TOO_LARGE_MESSAGE =
  'Cada imagen puede pesar como m\u00e1ximo 25 MB.';

@Catch(PayloadTooLargeException)
export class ProductImageUploadSizeExceptionFilter
  implements ExceptionFilter<PayloadTooLargeException>
{
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(413).json({
      statusCode: 413,
      message: PRODUCT_IMAGE_TOO_LARGE_MESSAGE,
      error: 'Payload Too Large',
    });
  }
}
