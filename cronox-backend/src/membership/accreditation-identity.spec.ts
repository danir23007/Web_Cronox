import {
  accreditationName,
  accreditationPayload,
  assertUsableAccreditation,
  parseAccreditationPayload,
} from './accreditation-identity';
import { getPublicApiUrl } from '../common/config/environment';

describe('Persistent accreditation payloads', () => {
  const token = 'a'.repeat(32);
  it.each([
    [undefined, ''],
    [null, ''],
    ['', ''],
    ['  ', ''],
    ['Daniel', 'Daniel'],
    ['Daniel Rivas Cruz', 'Daniel Rivas'],
    [' \t Daniel   Rivas \n Cruz ', 'Daniel Rivas'],
    ['<script> x y', '<script> x'],
  ])('formats only the actual firstName field %s', (input, expected) => {
    expect(accreditationName(input)).toBe(expected);
  });
  it('accepts compact versioned and canonical legacy payloads only', () => {
    expect(parseAccreditationPayload(accreditationPayload(token))).toBe(token);
    expect(
      parseAccreditationPayload(`${getPublicApiUrl()}/api/m/${token}`),
    ).toBe(token);
  });
  it.each([
    'www.cronox.es',
    'CRX:PREVIEW:INVALID',
    'CRX:2:' + token,
    'CRX:1:12',
    ' CRX:1:' + token,
    'https://evil.test/api/m/' + token,
    'javascript:alert(1)',
    `${getPublicApiUrl()}/api/m/${token}?userId=1`,
    `${getPublicApiUrl()}/api/m/${token}#x`,
    `${getPublicApiUrl()}/api/m/%61${token.slice(1)}`,
    `${getPublicApiUrl()}/api/m/${token}/`,
    `${getPublicApiUrl()}/api/m/../m/${token}`,
  ])('rejects foreign or noncanonical payload %s', (content) => {
    expect(() => parseAccreditationPayload(content)).toThrow();
  });
  it.each([0, 6, -1, 1.5, NaN])(
    'does not turn invalid circle %s into a valid card',
    (circleLevel) => {
      expect(() =>
        assertUsableAccreditation({ accountState: 'ACTIVE', circleLevel }),
      ).toThrow();
    },
  );
  it('does not accept inactive accounts', () => {
    expect(() =>
      assertUsableAccreditation({ accountState: 'INACTIVE', circleLevel: 1 }),
    ).toThrow();
  });
});
