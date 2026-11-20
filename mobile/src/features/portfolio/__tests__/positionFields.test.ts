import {
  applyPositionEdit,
  filledPositionFields,
  formatPositionValue,
  initialPositionState,
  parsePositionNumber,
  type PositionFieldState,
} from '../positionFields';

function state(overrides: Partial<PositionFieldState> = {}): PositionFieldState {
  return {
    quantity: '',
    entryPrice: '',
    investedAmount: '',
    autoField: 'investedAmount',
    ...overrides,
  };
}

describe('parsePositionNumber', () => {
  it('parses decimals, commas and blanks', () => {
    expect(parsePositionNumber('10')).toBe(10);
    expect(parsePositionNumber(' 10.5 ')).toBe(10.5);
    expect(parsePositionNumber('1,000')).toBe(1000);
    expect(parsePositionNumber('')).toBeNull();
    expect(parsePositionNumber('abc')).toBeNull();
  });
});

describe('formatPositionValue', () => {
  it('keeps small quantities and prices visible', () => {
    expect(formatPositionValue(0.00001234, 'quantity')).toBe('0.00001234');
    expect(formatPositionValue(0.00001234, 'entryPrice')).toBe('0.00001234');
  });

  it('trims trailing zeros and rounds money to paise', () => {
    expect(formatPositionValue(10.5, 'quantity')).toBe('10.5');
    expect(formatPositionValue(100, 'entryPrice')).toBe('100');
    expect(formatPositionValue(1000, 'investedAmount')).toBe('1000');
    expect(formatPositionValue(99999.999, 'investedAmount')).toBe('100000');
  });
});

describe('applyPositionEdit', () => {
  it('fills invested amount from quantity and price', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'entryPrice', '150.5');

    expect(next.quantity).toBe('10');
    expect(next.entryPrice).toBe('150.5');
    expect(next.investedAmount).toBe('1505');
    expect(next.autoField).toBe('investedAmount');
  });

  it('fills average price from quantity and invested amount', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'investedAmount', '1000');

    expect(next.investedAmount).toBe('1000');
    expect(next.entryPrice).toBe('100');
    expect(next.autoField).toBe('entryPrice');
  });

  it('fills quantity from average price and invested amount', () => {
    let next = applyPositionEdit(state(), 'entryPrice', '100');
    next = applyPositionEdit(next, 'investedAmount', '1500');

    expect(next.investedAmount).toBe('1500');
    expect(next.quantity).toBe('15');
    expect(next.autoField).toBe('quantity');
  });

  it('recomputes the derived field when another field changes', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'entryPrice', '100');
    next = applyPositionEdit(next, 'quantity', '20');

    expect(next.investedAmount).toBe('2000');
    expect(next.autoField).toBe('investedAmount');
  });

  it('switches derivation when the auto-filled field is edited', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'entryPrice', '100');
    next = applyPositionEdit(next, 'investedAmount', '2000');

    expect(next.entryPrice).toBe('200');
    expect(next.autoField).toBe('entryPrice');
  });

  it('does not clear the other values when the derived field is cleared', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'entryPrice', '100');
    next = applyPositionEdit(next, 'investedAmount', '');

    expect(next.quantity).toBe('10');
    expect(next.entryPrice).toBe('100');
    expect(next.investedAmount).toBe('');
    expect(next.autoField).toBeNull();
  });

  it('clears a derived value when its inputs become incomplete', () => {
    let next = applyPositionEdit(state(), 'quantity', '10');
    next = applyPositionEdit(next, 'entryPrice', '100');
    next = applyPositionEdit(next, 'quantity', '');

    expect(next.investedAmount).toBe('');
    expect(next.entryPrice).toBe('100');
  });
});

describe('initialPositionState', () => {
  it('starts empty with invested amount as the default derived field', () => {
    expect(initialPositionState()).toEqual({
      quantity: '',
      entryPrice: '',
      investedAmount: '',
      autoField: 'investedAmount',
    });
  });

  it('prefills all three values when editing an existing asset', () => {
    expect(initialPositionState({ quantity: 10, entryPrice: 150.5 })).toEqual({
      quantity: '10',
      entryPrice: '150.5',
      investedAmount: '1505',
      autoField: 'investedAmount',
    });
  });
});

describe('filledPositionFields', () => {
  it('counts usable numeric fields', () => {
    expect(filledPositionFields({ quantity: '', entryPrice: '', investedAmount: '' })).toBe(0);
    expect(filledPositionFields({ quantity: '10', entryPrice: '', investedAmount: '' })).toBe(1);
    expect(
      filledPositionFields({ quantity: '10', entryPrice: '100', investedAmount: '' }),
    ).toBe(2);
    expect(
      filledPositionFields({ quantity: '10', entryPrice: '100', investedAmount: '1000' }),
    ).toBe(3);
  });
});
