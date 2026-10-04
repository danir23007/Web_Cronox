import { validate } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { generateInitialPassword, hashNewPassword, validPassword } from './password-policy';
import { RegisterDto } from '../auth/dto/register.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { ResetDto } from '../auth/dto/reset.dto';

describe('shared password policy', () => {
  it.each(['abcdefg', '1234567', '!!!!!!!', 'ABCDEFG', ' a b c ', 'longer password with spaces'])('accepts composition freely without changing %s', async password => {
    expect(validPassword(password)).toBe(true);
    const hash = await hashNewPassword(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    for (const Dto of [RegisterDto, ResetPasswordDto, ChangePasswordDto, ResetDto]) {
      const dto = Object.assign(new Dto(), { password, newPassword: password });
      expect((await validate(dto)).some(e => ['password', 'newPassword'].includes(e.property))).toBe(false);
    }
  });
  it.each(['abcdef', '123456', 'a'.repeat(73), '\u00e1'.repeat(37)])('rejects short passwords or bcrypt truncation', async password => {
    expect(validPassword(password)).toBe(false);
    await expect(hashNewPassword(password)).rejects.toThrow();
    for (const Dto of [RegisterDto, ResetPasswordDto, ChangePasswordDto, ResetDto]) {
      const dto = Object.assign(new Dto(), { password, newPassword: password });
      expect((await validate(dto)).some(e => ['password', 'newPassword'].includes(e.property))).toBe(true);
    }
  });
  it('generates diverse single lowercase invented words with cryptographic randomness', () => {
    const words = Array.from({ length: 1000 }, generateInitialPassword);
    expect(words.every(word => /^[a-z]{7,8}$/.test(word))).toBe(true);
    expect(new Set(words).size).toBeGreaterThan(990);
  });
});
