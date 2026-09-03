import React from 'react';
import { formatCompact } from '@/lib/portfolio-utils';

interface Props {
  x: number;
  y: number;
  payload: { value: string };
  stackedBarData: any[];
  totalAllocationValue: number;
}

// SRP: extracted from calculation hook (was returning JSX from a hook — ISP violation)
export const CustomXAxisTick: React.FC<Props> = ({ x, y, payload, stackedBarData, totalAllocationValue }) => {
  if (!payload || !payload.value) return null;
  const capData = stackedBarData.find((d) => d.name === payload.value);
  const capTotal = capData ? Object.entries(capData).reduce((sum, [key, val]) => (key !== 'name' ? sum + (val as number) : sum), 0) : 0;
  const percent = totalAllocationValue > 0 ? ((capTotal / totalAllocationValue) * 100).toFixed(1) : '0.0';

  return React.createElement(
    'g',
    { transform: `translate(${x},${y})` },
    React.createElement('text', { x: 0, y: 0, dy: 16, textAnchor: 'middle', fill: '#6b7280', fontSize: 12, fontWeight: 600 }, payload.value),
    React.createElement('text', { x: 0, y: 0, dy: 32, textAnchor: 'middle', fill: '#9ca3af', fontSize: 11, fontWeight: 500 }, `${formatCompact(capTotal)} (${percent}%)`)
  );
};
