import { fulfillmentEvidence, shippedNoticeDecision } from './fulfillment-policy';
import { TrackpubContract } from './trackpub.contract';

const contract = new TrackpubContract();
const parse = (...codes: string[]) => contract.parse({ events: codes.map((uniqueCode, i) => ({ uniqueCode,
  eventDate: '20/10/2026', eventHours: `1${i}:00:00` })) });
describe('physical admission and historical notification cutover', () => {
  const cutoff = new Date('2026-10-18T16:00:00Z');
  it('never interprets a label, free text or unknown code as physical admission', () => {
    const events = contract.parse({ events: [{ uniqueCode: 'PRE_ADMISION', eventDes: 'Admitido entregado en reparto' }] });
    expect(fulfillmentEvidence(events).physical).toBe(false);
  });
  it.each(['A010000V', 'A050000V', 'A050020V', 'C010000V', 'G010000V', 'H020000V', 'I010000V'])('%s is exact reviewed physical evidence', code => {
    expect(fulfillmentEvidence(parse(code)).physical).toBe(true);
  });
  it('finds the admission in advanced, unordered history and keeps local dates without inventing UTC', () => {
    const history = parse('I010000V', 'A010000V', 'H020000V').reverse();
    const result = fulfillmentEvidence(history);
    expect(result.delivered).toBe(true); expect(result.admission?.code).toBe('A010000V');
    expect(result.admission?.eventTime).toBeNull(); expect(result.admission?.eventLocalDate).toBe('20/10/2026 11:00:00');
  });
  it('allows an unambiguously new admission on an older order', () => {
    expect(shippedNoticeDecision(parse('A010000V')[0], cutoff)).toBeNull();
  });
  it('retains historical admissions and missing or ambiguous dates for review', () => {
    const admission = parse('A010000V')[0];
    expect(shippedNoticeDecision({ ...admission, eventSortKey: '2026-10-14T09:00:00' }, cutoff)).toBe('HISTORICAL_ADMISSION');
    expect(shippedNoticeDecision({ ...admission, eventSortKey: '2026-10-18T18:00:00' }, cutoff)).toBe('ADMISSION_TIMEZONE_AMBIGUOUS');
    expect(shippedNoticeDecision({ ...admission, eventSortKey: null }, cutoff)).toBe('ADMISSION_DATE_MISSING');
    expect(shippedNoticeDecision(admission, null)).toBe('CUTOFF_NOT_ESTABLISHED');
    expect(shippedNoticeDecision(undefined, cutoff)).toBe('ADMISSION_DATE_MISSING');
  });
  it('permits confirmed admission on orders created and linked after cutover without assigning a false UTC date', () => {
    const admission = { ...parse('A010000V')[0], eventSortKey: '2026-10-18T18:00:00' };
    const order = { createdAt: new Date('2026-10-18T16:01:00Z'), trackingAttachedAt: new Date('2026-10-18T16:05:00Z') };
    expect(shippedNoticeDecision(admission, cutoff, order)).toBeNull();
    expect(shippedNoticeDecision({ ...admission, eventSortKey: '2026-10-14T10:00:00' }, cutoff, order)).toBe('HISTORICAL_ADMISSION');
  });
  it('does not confuse returns, incidents or intermediate delivery with delivery to recipient', () => {
    expect(fulfillmentEvidence(parse('I020000V', 'I01E410V', 'O07A010R')).delivered).toBe(false);
  });
});
