import { useWindowDimensions } from 'react-native';

import { layout } from './tokens';

/**
 * Width-driven layout state. Phones stay on the four-column allocation table;
 * tablets (and landscape phones) get the full seven-column table.
 */
export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();

  return {
    width,
    height,
    isTablet: width >= layout.tabletMinWidth,
    isLandscape: width > height,
  };
}
