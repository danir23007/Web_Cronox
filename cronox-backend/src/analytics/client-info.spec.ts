import { DeviceClass } from '@prisma/client';
import { parseClientInfo } from './client-info';

describe('parseClientInfo', () => {
  it('stores only coarse browser, OS and device properties', () => {
    const rawUserAgent = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36';
    const result = parseClientInfo({
      headers: {
        'user-agent': rawUserAgent,
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
      },
    } as any);

    expect(result).toEqual({
      browserFamily: 'Chrome',
      browserMajorVersion: '126',
      osFamily: 'Android',
      deviceClass: DeviceClass.MOBILE,
    });
    expect(JSON.stringify(result)).not.toContain(rawUserAgent);
    expect(result).not.toHaveProperty('ip');
  });
});
