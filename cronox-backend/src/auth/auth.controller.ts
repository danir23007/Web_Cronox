import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { RegisterAuthDto } from './dto/register-auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Registrar un nuevo usuario' })
  @ApiBody({
    type: RegisterAuthDto,
    examples: {
      customer: {
        summary: 'Registro de cliente',
        value: { email: 'cliente@example.com', password: 'ClaveSegura123' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Usuario registrado correctamente.' })
  @ApiConflictResponse({ description: 'El email ya está registrado.' })
  register(@Body() dto: RegisterAuthDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión y obtener un JWT' })
  @ApiBody({
    type: LoginAuthDto,
    examples: {
      default: {
        summary: 'Inicio de sesión',
        value: { email: 'cliente@example.com', password: 'ClaveSegura123' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Login correcto.',
    schema: {
      example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas.' })
  login(@Body() dto: LoginAuthDto) {
    return this.authService.login(dto);
  }
}
