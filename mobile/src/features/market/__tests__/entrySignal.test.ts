/** @jest-environment node */

import {
  goldSilverEntryVerdict,
  indexEntryVerdict,
} from '../entrySignal';

describe('goldSilverEntryVerdict', () => {
  it('marks a high ratio as a silver buy zone', () => {
    expect(goldSilverEntryVerdict('silver')).toMatchObject({
      label: 'Buy silver',
      tone: 'accent',
      icon: 'trending-up',
    });
  });

  it('marks a low ratio as a gold buy zone', () => {
    expect(goldSilverEntryVerdict('gold')).toMatchObject({
      label: 'Buy gold',
      tone: 'warning',
      icon: 'trending-up',
    });
  });

  it('keeps the middle band neutral', () => {
    expect(goldSilverEntryVerdict('balanced')).toMatchObject({
      label: 'Neutral',
      tone: 'neutral',
      icon: 'minus',
    });
  });
});

describe('indexEntryVerdict', () => {
  it('maps the cheapest quartile to a buy zone', () => {
    expect(indexEntryVerdict('cheap')).toMatchObject({
      label: 'Buy zone',
      tone: 'positive',
      icon: 'check-circle',
    });
  });

  it('maps the middle half to neutral', () => {
    expect(indexEntryVerdict('fair')).toMatchObject({
      label: 'Neutral',
      tone: 'neutral',
    });
  });

  it('warns when the index is in its most expensive quartile', () => {
    expect(indexEntryVerdict('expensive')).toMatchObject({
      label: 'Expensive',
      tone: 'warning',
      icon: 'alert-triangle',
    });
  });

  it('does not invent a signal without history', () => {
    expect(indexEntryVerdict('unknown')).toMatchObject({
      label: 'No signal',
      tone: 'neutral',
      icon: 'help-circle',
    });
  });
});
