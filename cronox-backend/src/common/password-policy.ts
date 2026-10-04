import { BadRequestException } from '@nestjs/common';
import { registerDecorator } from 'class-validator';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { getBcryptSaltRounds } from './config/environment';

export const PASSWORD_POLICY_MESSAGE = 'La contrase\u00f1a debe tener al menos 7 caracteres y no superar 72 bytes UTF-8.';
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 7 && Buffer.byteLength(value, 'utf8') <= 72;
}
export function PasswordPolicy() {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'passwordPolicy', target: object.constructor, propertyName,
    validator: { validate: validPassword, defaultMessage: () => PASSWORD_POLICY_MESSAGE },
  });
}
export async function hashNewPassword(value: string): Promise<string> {
  if (!validPassword(value)) throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
  return bcrypt.hash(value, getBcryptSaltRounds());
}
// Pronounceable invented words sampled independently, never from a fixed word list.
export function generateInitialPassword(): string {
  const length = randomInt(7, 9);
  const consonants = 'bcdfghjklmnpqrstvwxyz', vowels = 'aeiou';
  return Array.from({ length }, (_, i) => {
    const alphabet = i % 2 ? vowels : consonants;
    return alphabet[randomInt(alphabet.length)];
  }).join('');
}
