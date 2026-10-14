import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { correosLocalDate, TrackpubContract } from './trackpub.contract';

const NUMBER = 'PQ1X2X1234567890123456X';
const event = (overrides: Record<string, unknown> = {}) => ({
  uniqueCode: 'A010000V',
  eventCode: 'A-E-001',
  eventDate: '14/10/2026',
  eventHours: '12:09:16',
  eventDes: 'Admitido',
  ...overrides,
});

describe('documented Correos local date representation', () => {
  it('retains day-first local calendar components without creating a UTC timestamp', () => {
    expect(correosLocalDate('14/10/2026', '12:09:16')).toEqual({
      local: '14/10/2026 12:09:16',
      sort: '2026-10-14T12:09:16',
    });
    expect(correosLocalDate('29/02/2024', '00:00:00')).not.toBeNull();
  });

  it.each([
    ['29/02/2025', '12:00:00'],
    ['31/04/2026', '12:00:00'],
    ['00/01/2026', '12:00:00'],
    ['14/00/2026', '12:00:00'],
    ['14/13/2026', '12:00:00'],
    ['2026-10-14', '12:00:00'],
    ['14/10/2026', '24:00:00'],
    ['14/10/2026', '12:60:00'],
    ['14/10/2026', '12:00:60'],
    ['14/10/2026', '12:09'],
    ['14/10/2026', '12:09:16Z'],
    [null, '12:09:16'],
    ['14/10/2026', null],
  ])('does not invent a valid timestamp for %s %s', (day, time) => {
    expect(correosLocalDate(day, time)).toBeNull();
  });
});

describe('TrackpubContract against the official object response contract', () => {
  const contract = new TrackpubContract();

  it.each([
    ['A010000V', 'ADMITTED'],
    ['H020000V', 'OUT_FOR_DELIVERY'],
    ['H250000V', 'OUT_FOR_DELIVERY'],
    ['I010000V', 'DELIVERED'],
    ['I020000V', 'RETURNED'],
    ['O07A010R', 'INCIDENT'],
    ['O07A030R', 'INCIDENT'],
  ])('classifies reviewed uniqueCode %s as %s', (uniqueCode, category) => {
    const [parsed] = contract.parse(
      { code: NUMBER, events: [event({ uniqueCode })] },
      NUMBER,
    );
    expect(parsed.category).toBe(category);
    expect(parsed.eventTime).toBeNull();
    expect(parsed.eventLocalDate).toBe('14/10/2026 12:09:16');
    expect(parsed.eventSortKey).toBe('2026-10-14T12:09:16');
  });

  it('accepts the literal official fixture without interpreting its contradictory sample text as delivery', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../docs/integrations/correos/search-response-official-example.json',
        ),
        'utf8',
      ),
    );
    const [parsed] = contract.parse(fixture, NUMBER);
    expect(parsed).toMatchObject({
      code: 'A01B234C',
      category: null,
      label: 'PRE-ADMISION',
      eventLocalDate: '25/03/2022 12:09:16',
      eventSortKey: '2022-03-25T12:09:16',
      eventTime: null,
    });
  });

  it.each(['UNREVIEWED', 'I01H230V', 'I01E410V', 'X400000R', 'i010000v'])(
    'preserves unreviewed code %s despite delivery phase/text',
    (uniqueCode) => {
      const [parsed] = contract.parse({
        events: [
          event({
            uniqueCode,
            eventCode: 'I-E-001',
            phase: '4',
            phaseDes: 'ENTREGADO',
            eventDes: 'Entregado',
            summaryText: 'Entregado',
            expandedText: 'Entregado',
          }),
        ],
      });
      expect(parsed).toMatchObject({
        code: uniqueCode,
        category: null,
        label: 'Entregado',
      });
    },
  );

  it('does not mistake broad eventCode or phase for the reviewed unique code', () => {
    const [parsed] = contract.parse({
      events: [
        event({
          uniqueCode: undefined,
          eventCode: 'I010000V',
          phase: '4',
          phaseDes: 'ENTREGADO',
        }),
      ],
    });
    expect(parsed.category).toBeNull();
    expect(parsed.code).toBeNull();
  });

  it('sorts actual calendar date/time across days/months/years rather than DD/MM text or input order', () => {
    const input = [
      event({ eventDate: '01/01/2027', eventHours: '09:00:00' }),
      event({ eventDate: '01/11/2026', eventHours: '10:00:00' }),
      event({ eventDate: '31/10/2026', eventHours: '23:59:59' }),
      event({ eventDate: '01/11/2026', eventHours: '09:00:00' }),
    ];
    expect(
      contract.parse({ events: input }).map((item) => item.eventSortKey),
    ).toEqual([
      '2026-10-31T23:59:59',
      '2026-11-01T09:00:00',
      '2026-11-01T10:00:00',
      '2027-01-01T09:00:00',
    ]);
  });

  it('removes repeated carrier events and retains the same fingerprint after a description correction', () => {
    const first = event();
    const corrected = event({ eventDes: 'Descripción corregida' });
    const single = contract.parse({ events: [first] });
    const correctedSingle = contract.parse({ events: [corrected] });
    const result = contract.parse({ events: [first, first, corrected] });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Descripción corregida');
    expect(result[0].fingerprint).toBe(single[0].fingerprint);
    expect(result[0].fingerprint).toBe(correctedSingle[0].fingerprint);
  });

  it('does not collapse separate occurrences or separate reason/situation/motive codes', () => {
    const input = [
      event(),
      event({ eventHours: '12:10:16' }),
      event({ razonCode: '8' }),
      event({ motiveCode: 'B' }),
      event({ situationCode: 'SR123ABC' }),
    ];
    expect(contract.parse({ events: input })).toHaveLength(5);
  });

  it('keeps invalid/missing date literals for review, without placing them after a dated event', () => {
    const result = contract.parse({
      events: [
        event(),
        event({
          uniqueCode: 'UNREVIEWED',
          eventDate: '31/02/2026',
          eventHours: '12:09:16',
        }),
      ],
    });
    expect(result[0]).toMatchObject({
      code: 'UNREVIEWED',
      eventTime: null,
      eventLocalDate: '31/02/2026 12:09:16',
      eventSortKey: null,
      category: null,
    });
    expect(result[1].eventSortKey).toBe('2026-10-14T12:09:16');
  });

  it('keeps a description-only unknown event with stable identity', () => {
    const [parsed] = contract.parse({
      events: [{ summaryText: 'Estado nuevo sin código' }],
    });
    expect(parsed).toMatchObject({
      code: null,
      category: null,
      label: 'Estado nuevo sin código',
      eventTime: null,
      eventLocalDate: null,
      eventSortKey: null,
    });
    expect(parsed.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([{ events: [] }, { error: [] }, { events: [], error: [] }])(
    'returns no replacement events for a documented empty container %j',
    (payload) => {
      expect(contract.parse(payload)).toEqual([]);
    },
  );

  it('does not derive an incident from an undocumented has_incidence value', () => {
    expect(contract.parse({ events: [], has_incidence: 'S' })).toEqual([]);
    expect(
      contract.parse({
        events: [event({ uniqueCode: 'UNKNOWN' })],
        has_incidence: 'S',
      })[0].category,
    ).toBeNull();
  });

  it('rejects a response for a different shipment and permits case differences in the identifier', () => {
    expect(() =>
      contract.parse({ code: 'OTHER123', events: [event()] }, NUMBER),
    ).toThrow('TRACKING_NUMBER_MISMATCH');
    expect(
      contract.parse({ code: NUMBER.toLowerCase(), events: [] }, NUMBER),
    ).toEqual([]);
  });

  it('turns provider-reported errors into synchronization errors, without exposing their description', () => {
    const payload = {
      code: NUMBER,
      events: [event()],
      error: [{ codError: '3', desError: 'private-provider-fixture' }],
    };
    expect(() => contract.parse(payload)).toThrow('TRACKPUB_REPORTED_3');
    try {
      contract.parse(payload);
    } catch (error) {
      expect(String(error)).not.toContain('private-provider-fixture');
    }
  });

  it('uses a generic synchronization error for an unsafe carrier error identifier', () => {
    expect(() =>
      contract.parse({ error: [{ codError: '<unsafe-provider-code>' }] }),
    ).toThrow('TRACKPUB_REPORTED_ERROR');
  });

  it.each([
    null,
    [],
    'string',
    123,
    {},
    { events: null },
    { events: {} },
    { error: {} },
  ])('rejects invalid root response %j', (payload) => {
    expect(() => contract.parse(payload)).toThrow('INVALID_TRACKPUB_RESPONSE');
  });

  it.each([null, [], 123, 'text', {}])(
    'rejects invalid/unidentifiable event %j',
    (item) => {
      expect(() => contract.parse({ events: [item] })).toThrow(
        'INVALID_TRACKPUB_EVENT',
      );
    },
  );

  it('bounds event count and stores no provider personal fields', () => {
    expect(() =>
      contract.parse({ events: Array.from({ length: 1001 }, () => event()) }),
    ).toThrow('INVALID_TRACKPUB_RESPONSE');
    const [parsed] = contract.parse({
      code: NUMBER,
      destiEmail: 'fixture@example.invalid',
      events: [
        event({
          receiverPhone: '000000000',
          desNipAgent: 'private-agent-fixture',
          coordinateX: '-1.23',
        }),
      ],
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'category',
      'code',
      'eventLocalDate',
      'eventSortKey',
      'eventTime',
      'fingerprint',
      'label',
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(
      /fixture@example|private-agent|000000000/,
    );
  });
});
