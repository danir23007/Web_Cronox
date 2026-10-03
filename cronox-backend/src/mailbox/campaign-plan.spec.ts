import { campaignAudience, missingCampaignVariables } from './campaign-plan';

describe('campaign family audience', () => {
  it('deduplicates canonical addresses only when their scalar circles agree', () => {
    const result = campaignAudience(
      [
        { email: 'One@example.test', circleLevel: 1, name: 'One' },
        { email: 'one@example.test', circleLevel: 1, name: 'One' },
        { email: 'two@example.test', circleLevel: 2 },
      ],
      [],
      [1],
    );
    expect(result.recipients).toEqual([
      { email: 'one@example.test', circle: 1, name: 'One' },
    ]);
    expect(result.blocked).toEqual([]);
  });
  it('blocks ambiguous membership even if the other circle is not selected', () => {
    const result = campaignAudience(
      [
        { email: 'One@example.test', circleLevel: 1 },
        { email: 'one@example.test', circleLevel: 5 },
      ],
      [],
      [1],
    );
    expect(result.recipients).toEqual([]);
    expect(result.blocked).toHaveLength(1);
  });
  it('excludes suppressions and refuses invented names from disagreeing accounts', () => {
    const result = campaignAudience(
      [
        { email: 'one@example.test', circleLevel: 1, name: 'A' },
        { email: 'ONE@example.test', circleLevel: 1, name: 'B' },
        { email: 'two@example.test', circleLevel: 1 },
      ],
      ['two@example.test'],
      [1],
    );
    expect(result.recipients).toEqual([
      { email: 'one@example.test', circle: 1, name: '' },
    ]);
  });
  it('detects missing variables before compilation can silently erase them', () => {
    expect(
      missingCampaignVariables(
        {
          subject: '{{subject}}',
          html: '{{customerFullName}} {{#if actionUrl}}go{{/if}}',
          text: '{{product.name}}',
        },
        {
          customerFullName: '',
          actionUrl: 'https://example.test',
          product: { name: 'Real' },
        },
      ),
    ).toEqual(['subject', 'customerFullName']);
  });
});
