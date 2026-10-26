import { Body, Controller, Logger, Post, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import express from 'express';
import request from 'supertest';
import { RegisterDto } from '../auth/dto/register.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { NewsletterSubscribeDto } from '../newsletter/dto/newsletter-subscribe.dto';
import { createAppValidationPipe } from './customer-validation';
import { CustomerBadRequestFilter, customerBodyParserError, customerRequestDiagnostics } from './customer-request-diagnostics';

@Controller('auth')
class FormController {
  @Post('register') register(@Body() _dto: RegisterDto) { return { saved: true }; }
}

describe('customer validation in production', () => {
  const dto = { email: 'person@example.test', firstName: 'Persona', lastName: 'Prueba', password: 'FakePassword1!' };
  const metadata = { type: 'body' as const, metatype: RegisterDto };
  it('reproduces the published generic Bad Request independently of throttling', async () => {
    await expect(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, disableErrorMessages: true }).transform({ ...dto, firstName: '123' }, metadata)).rejects.toThrow('Bad Request');
  });
  it.each([
    [RegisterDto, { ...dto, firstName: '123' }, 'nombre'],
    [RegisterDto, { ...dto, lastName: '' }, 'apellido'],
    [RegisterDto, { ...dto, password: 'short' }, '7 caracteres'],
    [LoginDto, { email: 'invalid', password: 'FakePassword1!' }, 'correo'],
    [NewsletterSubscribeDto, { email: 'invalid' }, 'correo'],
  ])('returns useful messages without returning submitted values', async (metatype, value, expected) => {
    try { await createAppValidationPipe(true).transform(value, { type: 'body', metatype }); throw Error('Expected rejection'); }
    catch (error: any) {
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse().message).toContain(expected);
      expect(JSON.stringify(error.getResponse())).not.toContain('FakePassword1!');
      expect(JSON.stringify(error.getResponse())).not.toContain('person@example.test');
    }
  });
  it('accepts mandatory-account newsletter DTO and the ordinary registration DTO', async () => {
    const pipe = createAppValidationPipe(true);
    expect(await pipe.transform(dto, metadata)).toMatchObject(dto);
    expect(await pipe.transform({ email: dto.email, firstName: dto.firstName, password: dto.password, registrationSource: 'newsletter' }, metadata)).toMatchObject({ registrationSource: 'newsletter' });
  });
  it('logs correlation and rule categories, without values or attacker supplied field names', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(value => { logs.push(String(value)); });
    const module = await Test.createTestingModule({ controllers: [FormController], providers: [{ provide: APP_FILTER, useClass: CustomerBadRequestFilter }] }).compile();
    const app = module.createNestApplication({ bodyParser: false, logger: false });
    app.setGlobalPrefix('api'); app.use(customerRequestDiagnostics); app.use(express.json()); app.use(customerBodyParserError);
    app.useGlobalPipes(createAppValidationPipe(true)); await app.init();
    try {
      const res = await request(app.getHttpServer()).post('/api/auth/register').send({ ...dto, firstName: 'SensitiveName123', 'secret-person@example.test': dto.password }).expect(400);
      expect(res.body.code).toBe('FORM_VALIDATION_FAILED');
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
      const malformed = await request(app.getHttpServer()).post('/api/auth/register').set('Content-Type','application/json').send('{"password":"FakePassword1!", invalid }').expect(400);
      expect(malformed.body.code).toBe('FORM_FORMAT_INVALID');
      expect(logs.join()).toContain('form_validation'); expect(logs.join()).toContain('invalid_json');
      const serialized = JSON.stringify([res.body, malformed.body, logs]);
      for (const secret of ['FakePassword1!', 'person@example.test', 'SensitiveName123']) expect(serialized).not.toContain(secret);
      expect(logs.join()).toContain('unexpected_field');
    } finally { await app.close(); spy.mockRestore(); }
  });
});
