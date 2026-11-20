/**
 * Three-way sync for the position fields. Quantity × average price = invested
 * amount, so entering any two values fills the third. `autoField` remembers
 * which value was derived; editing that value switches the derivation instead
 * of overwriting the user's latest input.
 */

export type PositionField = 'quantity' | 'entryPrice' | 'investedAmount';

export interface PositionFieldValues {
  quantity: string;
  entryPrice: string;
  investedAmount: string;
}

export interface PositionFieldState extends PositionFieldValues {
  /** Field currently derived from the other two, or null when none is derived. */
  autoField: PositionField | null;
}

const POSITION_FIELDS: readonly PositionField[] = [
  'quantity',
  'entryPrice',
  'investedAmount',
];

export function parsePositionNumber(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimTrailingZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** Formats a derived value without turning small crypto quantities into zero. */
export function formatPositionValue(value: number, field: PositionField): string {
  if (!Number.isFinite(value) || value < 0) return '';
  if (field === 'investedAmount') return trimTrailingZeros(value.toFixed(2));
  if (field === 'quantity') return trimTrailingZeros(value.toFixed(8));
  return trimTrailingZeros(value.toFixed(value > 0 && value < 1 ? 8 : 4));
}

function deriveField(
  field: PositionField,
  values: PositionFieldValues,
): number | null {
  const quantity = parsePositionNumber(values.quantity);
  const entryPrice = parsePositionNumber(values.entryPrice);
  const investedAmount = parsePositionNumber(values.investedAmount);

  switch (field) {
    case 'investedAmount':
      return quantity != null && quantity > 0 && entryPrice != null && entryPrice >= 0
        ? quantity * entryPrice
        : null;
    case 'entryPrice':
      return investedAmount != null &&
        investedAmount >= 0 &&
        quantity != null &&
        quantity > 0
        ? investedAmount / quantity
        : null;
    case 'quantity':
      return investedAmount != null &&
        investedAmount >= 0 &&
        entryPrice != null &&
        entryPrice > 0
        ? investedAmount / entryPrice
        : null;
  }
}

function nextAutoField(
  state: PositionFieldState,
  edited: PositionField,
  editedValue: number | null,
): PositionField | null {
  // Keep the existing derivation unless the user is editing that field.
  if (state.autoField && state.autoField !== edited) return state.autoField;

  // Clearing a field should not wipe another value the user can still see.
  if (editedValue == null) return null;

  const quantity = parsePositionNumber(state.quantity);
  const entryPrice = parsePositionNumber(state.entryPrice);
  const investedAmount = parsePositionNumber(state.investedAmount);

  switch (edited) {
    case 'investedAmount':
      if (quantity != null && quantity > 0) return 'entryPrice';
      if (entryPrice != null && entryPrice > 0) return 'quantity';
      return null;
    case 'quantity':
      if (entryPrice != null && entryPrice >= 0) return 'investedAmount';
      if (investedAmount != null && investedAmount >= 0) return 'entryPrice';
      return null;
    case 'entryPrice':
      if (quantity != null && quantity > 0) return 'investedAmount';
      if (investedAmount != null && investedAmount >= 0) return 'quantity';
      return null;
  }
}

export function applyPositionEdit(
  state: PositionFieldState,
  field: PositionField,
  text: string,
): PositionFieldState {
  const next: PositionFieldState = { ...state, [field]: text };
  const editedValue = parsePositionNumber(text);
  const autoField = nextAutoField(state, field, editedValue);

  if (!autoField) return { ...next, autoField: null };

  const derived = deriveField(autoField, next);
  return {
    ...next,
    autoField,
    [autoField]: derived == null ? '' : formatPositionValue(derived, autoField),
  };
}

export function initialPositionState(initial?: {
  quantity?: number;
  entryPrice?: number;
}): PositionFieldState {
  if (!initial) {
    return {
      quantity: '',
      entryPrice: '',
      investedAmount: '',
      autoField: 'investedAmount',
    };
  }

  const quantity = initial.quantity ?? 0;
  const entryPrice = initial.entryPrice ?? 0;

  return {
    quantity: formatPositionValue(quantity, 'quantity'),
    entryPrice: formatPositionValue(entryPrice, 'entryPrice'),
    investedAmount: formatPositionValue(quantity * entryPrice, 'investedAmount'),
    autoField: 'investedAmount',
  };
}

/** Counts fields that contain a usable number, for the "any two" validation. */
export function filledPositionFields(values: PositionFieldValues): number {
  return POSITION_FIELDS.filter(
    (field) => parsePositionNumber(values[field]) != null,
  ).length;
}
