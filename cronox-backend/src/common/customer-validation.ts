import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { RegisterDto } from '../auth/dto/register.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { NewsletterSubscribeDto } from '../newsletter/dto/newsletter-subscribe.dto';
import { PASSWORD_POLICY_MESSAGE } from './password-policy';

const messages: Record<string, string> = {
  email: 'Introduce un correo electrónico válido.',
  firstName: 'Introduce un nombre de hasta 25 caracteres, solo con letras y espacios.',
  lastName: 'Introduce un apellido de hasta 30 caracteres, solo con letras y espacios.',
  password: 'Introduce tu contraseña.',
  registrationSource: 'Recarga el formulario y vuelve a intentarlo.',
};
const constraints = new Set(['isEmail', 'isString', 'isNotEmpty', 'maxLength', 'minLength', 'matches', 'passwordPolicy', 'isIn', 'whitelistValidation']);
export class CustomerValidationException extends BadRequestException {
  readonly issues: { field: string; rules: string[] }[];
  constructor(errors: ValidationError[]) {
    // Never expose validation targets/values, supplied field names or messages
    // interpolated by validators. Both public copy and diagnostics are bounded.
    const issues = errors.slice(0, 12).map(error => ({
      field: Object.prototype.hasOwnProperty.call(messages, error.property) ? error.property : 'unexpected_field',
      rules: Object.keys(error.constraints || {}).filter(key => constraints.has(key)),
    }));
    const fieldErrors = Object.fromEntries(issues.map(issue => [issue.field,
      issue.field === 'unexpected_field' ? 'El formulario contiene datos no admitidos. Recarga la página y vuelve a intentarlo.'
        : issue.rules.includes('passwordPolicy') ? PASSWORD_POLICY_MESSAGE : messages[issue.field],
    ]));
    super({ statusCode: 400, code: 'FORM_VALIDATION_FAILED', message: Object.values(fieldErrors).join(' '), fieldErrors });
    this.issues = issues;
  }
}

export function createAppValidationPipe(isProduction: boolean) {
  const options = { whitelist: true, forbidNonWhitelisted: true, transform: true, disableErrorMessages: isProduction };
  const ordinary = new ValidationPipe(options);
  const customer = new ValidationPipe({ ...options, exceptionFactory: errors => new CustomerValidationException(errors) });
  const types = new Set<unknown>([RegisterDto, LoginDto, NewsletterSubscribeDto]);
  return { transform(value: unknown, metadata: ArgumentMetadata) {
    return (types.has(metadata.metatype) ? customer : ordinary).transform(value, metadata);
  } };
}
