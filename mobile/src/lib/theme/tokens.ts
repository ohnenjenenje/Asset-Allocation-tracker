/**
 * Design tokens — the single source of truth for the mobile UI.
 * Mirrors the web app's zinc + blue design language (8pt spacing grid).
 */
export type ColorScheme = 'light' | 'dark';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Palette {
  bg: string;
  card: string;
  cardMuted: string;
  border: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  overlay: string;
}

export const palette: Record<ColorScheme, Palette> = {
  light: {
    bg: '#FAFAFA',
    card: '#FFFFFF',
    cardMuted: '#F4F4F5',
    border: '#E4E4E7',
    text: '#18181B',
    textSecondary: '#3F3F46',
    muted: '#71717A',
    accent: '#2563EB',
    accentText: '#FFFFFF',
    accentSoft: '#EFF6FF',
    positive: '#059669',
    positiveSoft: '#ECFDF5',
    negative: '#DC2626',
    negativeSoft: '#FEF2F2',
    warning: '#D97706',
    warningSoft: '#FFFBEB',
    overlay: 'rgba(9, 9, 11, 0.45)',
  },
  dark: {
    bg: '#09090B',
    card: '#18181B',
    cardMuted: '#1F1F23',
    border: '#27272A',
    text: '#FAFAFA',
    textSecondary: '#D4D4D8',
    muted: '#A1A1AA',
    accent: '#3B82F6',
    accentText: '#FFFFFF',
    accentSoft: 'rgba(59, 130, 246, 0.14)',
    positive: '#34D399',
    positiveSoft: 'rgba(16, 185, 129, 0.14)',
    negative: '#F87171',
    negativeSoft: 'rgba(239, 68, 68, 0.14)',
    warning: '#FBBF24',
    warningSoft: 'rgba(245, 158, 11, 0.14)',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
};

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

/**
 * Responsive layout thresholds. Android-first: one breakpoint switches the
 * allocation table from the four-column phone layout to the full table.
 */
export const layout = {
  tabletMinWidth: 720,
  contentMaxWidth: 1040,
} as const;

/** Four-step type scale: display / title / body / caption. */
export const type = {
  display: { fontSize: 28, fontWeight: '600' as const, letterSpacing: -0.6 },
  value: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.3 },
  title: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  bodyMedium: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
} as const;

/** Fixed-width digits keep financial columns aligned and stable. */
export const numeric = { fontVariant: ['tabular-nums' as const] };

export const duration = { fast: 150, normal: 220 } as const;
