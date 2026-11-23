import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import type { AllocationNode } from '@/src/features/portfolio/analytics';
import {
  buildAllocationTableRows,
  type AllocationTableRow,
} from '@/src/features/portfolio/allocationTable';
import type { PolicyEvaluation } from '@/src/features/portfolio/policy';
import {
  formatCompactINR,
  formatDriftPp,
  formatPercent,
} from '@/src/lib/format/money';
import {
  numeric,
  radius,
  space,
  type,
  type Palette,
} from '@/src/lib/theme/tokens';
import { useResponsiveLayout } from '@/src/lib/theme/responsive';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface TargetVsActualCardProps {
  evaluation: PolicyEvaluation;
  nodes: AllocationNode[];
  total: number;
  policyVersion: number;
  readOnly?: boolean;
  onManageTargets: () => void;
  onPlanRebalance?: () => void;
}

interface RowAction {
  label: string;
  phoneLabel: string;
  tone: string;
}

/**
 * The allocation home's primary surface. Root sleeves carry the target
 * comparison and the rupee gap; tapping a row reveals composition. Phones get
 * four columns plus a value/action line, tablets get the full seven columns.
 */
export function TargetVsActualCard({
  evaluation,
  nodes,
  total,
  policyVersion,
  readOnly = false,
  onManageTargets,
  onPlanRebalance,
}: TargetVsActualCardProps) {
  const { colors } = useTheme();
  const { isTablet } = useResponsiveLayout();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => buildAllocationTableRows(evaluation, nodes, total),
    [evaluation, nodes, total],
  );

  const needsTargets =
    evaluation.isTemplate ||
    !evaluation.isValid ||
    evaluation.targetedCount === 0;
  const actionable =
    !evaluation.isTemplate && evaluation.isValid && evaluation.targetedCount > 0;

  const severity = evaluation.isTemplate
    ? 'unset'
    : !evaluation.isValid || evaluation.targetedCount === 0
      ? 'invalid'
      : evaluation.breachCount > 0
        ? 'breach'
        : evaluation.watchCount > 0
          ? 'watch'
          : 'within';

  const statusTone =
    severity === 'breach'
      ? colors.negative
      : severity === 'watch'
        ? colors.warning
        : severity === 'within'
          ? colors.positive
          : severity === 'invalid'
            ? colors.warning
            : colors.muted;
  const statusSoft =
    severity === 'breach'
      ? colors.negativeSoft
      : severity === 'watch'
        ? colors.warningSoft
        : severity === 'within'
          ? colors.positiveSoft
          : severity === 'invalid'
            ? colors.warningSoft
            : colors.cardMuted;
  const statusIcon: ComponentProps<typeof Feather>['name'] =
    severity === 'breach'
      ? 'alert-triangle'
      : severity === 'watch'
        ? 'alert-circle'
        : severity === 'within'
          ? 'check-circle'
          : severity === 'invalid'
            ? 'alert-circle'
            : 'target';

  const statusHeadline =
    severity === 'unset'
      ? 'Using the default target template'
      : severity === 'invalid'
        ? `Targets total ${formatPercent(evaluation.targetSum)} — they must total 100%`
        : severity === 'breach'
          ? `${evaluation.breachCount} of ${evaluation.targetedCount} sleeves outside their band`
          : severity === 'watch'
            ? `${evaluation.watchCount} of ${evaluation.targetedCount} sleeves nearing their band`
            : 'Every sleeve is inside its band';

  const meta = evaluation.isTemplate
    ? 'Default target template · set targets to track drift'
    : !evaluation.isValid
      ? `Targets total ${formatPercent(evaluation.targetSum)} · must total 100%`
      : evaluation.targetedCount === 0
        ? 'No sleeve targets yet'
        : `Policy v${policyVersion} · ${evaluation.inToleranceCount}/${
            evaluation.targetedCount
          } in tolerance · ${evaluation.breachCount} outside band`;

  const segments = useMemo(
    () =>
      [...evaluation.sleeves, ...evaluation.unmanaged]
        .filter((slice) => slice.currentPercentage > 0)
        .map((slice) => ({
          key: slice.path,
          label: slice.label,
          percentage: slice.currentPercentage,
          color: slice.color,
        })),
    [evaluation],
  );

  const targetMarkers = useMemo(() => {
    if (!evaluation.isValid || evaluation.targetedCount === 0) return [];
    const markers: number[] = [];
    let cumulative = 0;
    for (const sleeve of evaluation.sleeves) {
      cumulative += sleeve.targetPercentage;
      if (cumulative > 0.5 && cumulative < 99.5) markers.push(cumulative);
    }
    return markers;
  }, [evaluation]);

  const mixLabel =
    segments.length > 0
      ? `Current allocation mix: ${segments
          .map(
            (segment) =>
              `${segment.label} ${formatPercent(segment.percentage, {
                precision: 1,
              })}`,
          )
          .join(', ')}.${
          targetMarkers.length > 0 ? ' Target markers show policy targets.' : ''
        }`
      : 'No current allocation to show.';

  const nextAction = nextPolicyAction(evaluation, readOnly);
  const toggle = (key: string) =>
    setExpanded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <View style={[styles.iconBubble, { backgroundColor: colors.accentSoft }]}>
              <Feather name="target" size={16} color={colors.accent} />
            </View>
            <Text
              style={[type.title, styles.title, { color: colors.text }]}
              numberOfLines={1}
            >
              Target vs Actual
            </Text>
          </View>
          <Text
            style={[type.caption, styles.meta, { color: colors.muted }]}
            numberOfLines={2}
          >
            {meta}
          </Text>
        </View>
        <Pressable
          onPress={onManageTargets}
          accessibilityRole="button"
          accessibilityLabel={
            readOnly ? 'View allocation targets' : 'Manage allocation targets'
          }
          hitSlop={8}
          style={styles.manage}
        >
          <Text style={[styles.manageText, { color: colors.accent }]}>
            {readOnly ? 'View' : 'Manage'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.barSection}>
        <View
          style={styles.barTrack}
          accessible
          accessibilityRole="image"
          accessibilityLabel={mixLabel}
        >
          <View style={[styles.bar, { backgroundColor: colors.cardMuted }]}>
            {segments.map((segment) => (
              <View
                key={segment.key}
                style={{
                  flex: segment.percentage,
                  backgroundColor: segment.color,
                }}
              />
            ))}
          </View>
          {targetMarkers.map((marker) => (
            <View
              key={marker}
              style={[
                styles.targetMarker,
                {
                  left: `${Math.min(100, Math.max(0, marker))}%`,
                  backgroundColor: colors.text,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.barCaption}>
          <Text style={[styles.barCaptionText, { color: colors.muted }]}>
            Current mix
          </Text>
          {targetMarkers.length > 0 ? (
            <View style={styles.targetKey}>
              <View
                style={[styles.targetKeyTick, { backgroundColor: colors.textSecondary }]}
              />
              <Text style={[styles.barCaptionText, { color: colors.muted }]}>
                Target
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View
        style={[
          styles.statusStrip,
          { backgroundColor: statusSoft },
        ]}
      >
        <Feather name={statusIcon} size={16} color={statusTone} />
        <View style={styles.statusText}>
          <Text style={[styles.statusHeadline, { color: colors.text }]}>
            {statusHeadline}
          </Text>
          <Text
            style={[styles.statusHint, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {needsTargets ? nextAction : `Next: ${nextAction}`}
          </Text>
        </View>
      </View>

      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          Add holdings to compare current allocation with targets.
        </Text>
      ) : (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.colLabel, styles.headerCategory]}>Category</Text>
            {isTablet ? (
              <>
                <Text style={[styles.colLabel, styles.tabletActual]}>Actual</Text>
                <Text style={[styles.colLabel, styles.tabletCurVal]}>Cur Val</Text>
                <Text style={[styles.colLabel, styles.tabletTarget]}>Target</Text>
                <Text style={[styles.colLabel, styles.tabletTgtVal]}>Tgt Val</Text>
                <Text style={[styles.colLabel, styles.tabletGap, styles.colNumber]}>
                  Gap
                </Text>
                <Text style={[styles.colLabel, styles.tabletAction, styles.colNumber]}>
                  Action
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.colLabel, styles.phoneActual]}>Actual</Text>
                <Text style={[styles.colLabel, styles.phoneTarget]}>Target</Text>
                <Text style={[styles.colLabel, styles.phoneGap, styles.colNumber]}>
                  Gap
                </Text>
              </>
            )}
          </View>

          {rows.map((row) => (
            <AllocationRow
              key={row.key}
              row={row}
              expanded={expanded}
              onToggle={toggle}
              isTablet={isTablet}
              actionable={actionable}
              onAction={
                row.kind === 'unmanaged'
                  ? onManageTargets
                  : onPlanRebalance
              }
            />
          ))}
        </>
      )}

      <View style={[styles.footer, isTablet && styles.footerTablet]}>
        <Text style={[styles.footerText, { color: colors.muted }]}>
          {needsTargets
            ? 'Targets come from the default template until you confirm a policy.'
            : 'Bands apply to each sleeve independently. Tap a row to inspect its holdings.'}
        </Text>
        {actionable && onPlanRebalance ? (
          <Button
            label="Build rebalance plan"
            icon="sliders"
            variant="secondary"
            size="sm"
            fullWidth={!isTablet}
            style={isTablet ? styles.footerButton : undefined}
            onPress={onPlanRebalance}
          />
        ) : (
          <Button
            label={
              readOnly
                ? 'View targets'
                : evaluation.isTemplate
                  ? 'Set targets'
                  : 'Fix targets'
            }
            icon="target"
            variant="secondary"
            size="sm"
            fullWidth={!isTablet}
            style={isTablet ? styles.footerButton : undefined}
            onPress={onManageTargets}
          />
        )}
      </View>
    </Card>
  );
}

interface AllocationRowProps {
  row: AllocationTableRow;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  isTablet: boolean;
  actionable: boolean;
  onAction?: () => void;
}

function AllocationRow({
  row,
  expanded,
  onToggle,
  isTablet,
  actionable,
  onAction,
}: AllocationRowProps) {
  const { colors } = useTheme();
  const open = Boolean(expanded[row.key]);
  const hasChildren = row.children.length > 0;
  const indent = row.depth * (isTablet ? space.xl : space.lg);
  const action = rowAction(row, actionable, Boolean(onAction), colors);
  const gapTone = gapToneFor(row, actionable);
  const accessibilityLabel = rowAccessibilityLabel(row, open, hasChildren);

  const gap =
    row.driftPp != null ? (
      <Badge
        label={formatDriftPp(row.driftPp, { signed: true })}
        tone={gapTone}
        style={styles.gapBadge}
      />
    ) : (
      <Text style={[styles.dash, { color: colors.muted }]}>—</Text>
    );

  return (
    <View>
      <View
        style={[
          styles.row,
          isTablet ? styles.rowTablet : styles.rowPhone,
          row.depth > 0 && { backgroundColor: colors.cardMuted },
          { borderTopColor: colors.border },
        ]}
      >
        {isTablet ? (
          <>
            <CategoryCell
              row={row}
              open={open}
              hasChildren={hasChildren}
              indent={indent}
              onToggle={onToggle}
              accessibilityLabel={accessibilityLabel}
            />
            <Text
              style={[styles.numCell, styles.tabletActual, { color: colors.text }]}
              numberOfLines={1}
            >
              {formatPercent(row.currentPercentage, { precision: 1 })}
            </Text>
            <Text
              style={[styles.valueCell, styles.tabletCurVal, { color: colors.muted }]}
              numberOfLines={1}
            >
              {formatCompactINR(row.currentValue)}
            </Text>
            <Text
              style={[
                styles.numCell,
                styles.tabletTarget,
                { color: colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {row.targetPercentage != null
                ? formatPercent(row.targetPercentage, { precision: 1 })
                : '—'}
            </Text>
            <Text
              style={[
                styles.valueCell,
                styles.tabletTgtVal,
                { color: colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {row.targetValue != null ? formatCompactINR(row.targetValue) : '—'}
            </Text>
            <View style={[styles.gapCell, styles.tabletGap]}>{gap}</View>
            <View style={[styles.actionCell, styles.tabletAction]}>
              {action && onAction ? (
                <ActionButton
                  label={action.label}
                  accessibilityLabel={
                    row.kind === 'unmanaged'
                      ? `Map ${row.label} to a policy sleeve`
                      : `${action.label} ${row.label}`
                  }
                  tone={action.tone}
                  onPress={onAction}
                />
              ) : (
                <Text style={[styles.dash, { color: colors.muted }]}>—</Text>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.phoneTop}>
              <CategoryCell
                row={row}
                open={open}
                hasChildren={hasChildren}
                indent={indent}
                onToggle={onToggle}
                accessibilityLabel={accessibilityLabel}
              />
              <Text
                style={[styles.numCell, styles.phoneActual, { color: colors.text }]}
                numberOfLines={1}
              >
                {formatPercent(row.currentPercentage, { precision: 1 })}
              </Text>
              <Text
                style={[
                  styles.numCell,
                  styles.phoneTarget,
                  { color: colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {row.targetPercentage != null
                  ? formatPercent(row.targetPercentage, { precision: 1 })
                  : '—'}
              </Text>
              <View style={[styles.gapCell, styles.phoneGap]}>{gap}</View>
            </View>

            <View style={[styles.phoneSubRow, { paddingLeft: indent + 34 }]}>
              <Text
                style={[styles.phoneSubText, { color: colors.muted }]}
                numberOfLines={1}
              >
                {phoneDetail(row)}
              </Text>
              {action && onAction ? (
                <ActionButton
                  label={action.phoneLabel}
                  accessibilityLabel={
                    row.kind === 'unmanaged'
                      ? `Map ${row.label} to a policy sleeve`
                      : `${action.label} ${row.label}`
                  }
                  tone={action.tone}
                  onPress={onAction}
                />
              ) : null}
            </View>
          </>
        )}
      </View>

      {open
        ? row.children.map((child) => (
            <AllocationRow
              key={child.key}
              row={child}
              expanded={expanded}
              onToggle={onToggle}
              isTablet={isTablet}
              actionable={actionable}
              onAction={onAction}
            />
          ))
        : null}
    </View>
  );
}

interface CategoryCellProps {
  row: AllocationTableRow;
  open: boolean;
  hasChildren: boolean;
  indent: number;
  onToggle: (key: string) => void;
  accessibilityLabel: string;
}

function CategoryCell({
  row,
  open,
  hasChildren,
  indent,
  onToggle,
  accessibilityLabel,
}: CategoryCellProps) {
  const content = (
    <CategoryLabel row={row} open={open} hasChildren={hasChildren} />
  );

  if (!hasChildren) {
    return (
      <View style={[styles.categoryColumn, { paddingLeft: indent }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onToggle(row.key)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={
        open
          ? 'Double tap to hide sub-categories and holdings'
          : 'Double tap to show sub-categories and holdings'
      }
      style={({ pressed }) => [
        styles.categoryColumn,
        { paddingLeft: indent },
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

interface ActionButtonProps {
  label: string;
  accessibilityLabel: string;
  tone: string;
  onPress: () => void;
}

function ActionButton({
  label,
  accessibilityLabel,
  tone,
  onPress,
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      <Text style={[styles.actionText, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

function rowAccessibilityLabel(
  row: AllocationTableRow,
  open: boolean,
  hasChildren: boolean,
): string {
  return `${row.label}, current ${formatPercent(row.currentPercentage, {
    precision: 1,
  })}${
    row.targetPercentage != null
      ? `, target ${formatPercent(row.targetPercentage, { precision: 1 })}`
      : ''
  }${
    row.driftPp != null
      ? `, drift ${formatDriftPp(row.driftPp, { signed: true })} against a ±${row.bandPp} pp band`
      : ''
  }${row.kind === 'unmanaged' ? ', outside policy' : ''}${
    hasChildren
      ? `, ${open ? 'expanded' : 'collapsed'}, ${row.holdingCount} ${
          row.holdingCount === 1 ? 'holding' : 'holdings'
        }`
      : ''
  }`;
}

interface CategoryLabelProps {
  row: AllocationTableRow;
  open: boolean;
  hasChildren: boolean;
}

function CategoryLabel({ row, open, hasChildren }: CategoryLabelProps) {
  const { colors } = useTheme();

  return (
    <>
      <View style={styles.chevronSlot}>
        {hasChildren ? (
          <Feather
            name={open ? 'chevron-down' : 'chevron-right'}
            size={14}
            color={colors.muted}
          />
        ) : null}
      </View>
      <View
        style={[
          styles.dot,
          row.kind === 'holding' && styles.holdingDot,
          { backgroundColor: row.color },
        ]}
      />
      <Text
        style={[
          styles.categoryLabel,
          row.kind === 'sleeve' && styles.sleeveLabel,
          row.kind === 'holding' && styles.holdingLabel,
          { color: row.kind === 'holding' ? colors.textSecondary : colors.text },
        ]}
        numberOfLines={1}
      >
        {row.label}
      </Text>
      {row.kind === 'subcategory' && row.holdingCount > 0 ? (
        <Text style={[styles.count, { color: colors.muted }]}>
          {row.holdingCount}
        </Text>
      ) : null}
    </>
  );
}

function phoneDetail(row: AllocationTableRow): string {
  const value = formatCompactINR(row.currentValue);
  if (row.kind === 'sleeve' && row.targetValue != null) {
    return `${value} · target ${formatCompactINR(row.targetValue)}`;
  }
  if (row.kind === 'unmanaged') return `${value} · outside policy`;
  if (row.kind === 'subcategory' && row.holdingCount > 0) {
    return `${value} · ${row.holdingCount} ${
      row.holdingCount === 1 ? 'holding' : 'holdings'
    }`;
  }
  return value;
}

function gapToneFor(row: AllocationTableRow, actionable: boolean): BadgeTone {
  if (!actionable || row.status == null) return 'neutral';
  if (row.status === 'within') return 'positive';
  if (row.status === 'watch') return 'warning';
  return 'negative';
}

function rowAction(
  row: AllocationTableRow,
  actionable: boolean,
  canPlan: boolean,
  colors: Palette,
): RowAction | null {
  if (row.kind === 'unmanaged') {
    return { label: 'Map', phoneLabel: 'Map', tone: colors.accent };
  }
  if (row.kind !== 'sleeve' || !actionable || !canPlan) return null;

  if (row.status === 'breach' && row.driftPp != null && row.driftValue != null) {
    const over = row.driftPp > 0;
    return {
      label: over ? 'Trim' : 'Add',
      phoneLabel: `${over ? 'Trim' : 'Add'} ${formatCompactINR(
        Math.abs(row.driftValue),
      )}`,
      tone: over ? colors.negative : colors.warning,
    };
  }
  if (row.status === 'watch') {
    return { label: 'Near band', phoneLabel: 'Near band', tone: colors.warning };
  }
  if (row.status === 'within') {
    return { label: 'On track', phoneLabel: 'On track', tone: colors.positive };
  }
  return null;
}

function nextPolicyAction(evaluation: PolicyEvaluation, readOnly: boolean): string {
  if (evaluation.isTemplate) {
    return readOnly
      ? 'Targets are read-only in this demo.'
      : 'Set targets to unlock add and trim guidance.';
  }
  if (!evaluation.isValid || evaluation.targetedCount === 0) {
    return 'Fix targets before rebalancing.';
  }

  const underweight = evaluation.sleeves
    .filter((sleeve) => sleeve.status === 'breach' && sleeve.driftPp < 0)
    .sort((a, b) => Math.abs(b.driftValue) - Math.abs(a.driftValue))[0];
  const overweight = evaluation.sleeves
    .filter((sleeve) => sleeve.status === 'breach' && sleeve.driftPp > 0)
    .sort((a, b) => Math.abs(b.driftValue) - Math.abs(a.driftValue))[0];
  const next = underweight ?? overweight;

  if (next) {
    const adding = next.driftPp < 0;
    return `${adding ? 'Add' : 'Trim'} ${formatCompactINR(
      Math.abs(next.driftValue),
    )} ${adding ? 'to' : 'from'} ${next.label}`;
  }

  const unmanagedValue = evaluation.unmanaged.reduce(
    (sum, slice) => sum + slice.currentValue,
    0,
  );
  if (unmanagedValue > 0) {
    return `Map ${formatCompactINR(unmanagedValue)} sitting outside policy.`;
  }
  if (evaluation.watchCount > 0) {
    return `No rebalance needed — ${evaluation.watchCount} sleeve${
      evaluation.watchCount === 1 ? '' : 's'
    } nearing the band.`;
  }
  return 'No action needed — every sleeve is inside its band.';
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  headerText: { flex: 1, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flexShrink: 1 },
  meta: { lineHeight: 16 },
  manage: { paddingTop: 5 },
  manageText: { fontSize: 12, fontWeight: '600' },
  barSection: { gap: 5, paddingHorizontal: space.lg, paddingTop: space.md },
  barTrack: {
    height: 14,
    justifyContent: 'center',
    position: 'relative',
  },
  bar: {
    height: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  targetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
  },
  barCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barCaptionText: { fontSize: 9.5 },
  targetKey: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  targetKeyTick: { width: 2, height: 8, borderRadius: 1 },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.md,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  statusText: { flex: 1, gap: 1 },
  statusHeadline: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  statusHint: { fontSize: 11, lineHeight: 16 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 7,
  },
  colLabel: {
    ...type.label,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  headerCategory: { flex: 1 },
  colNumber: { textAlign: 'right' },
  categoryColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  phoneActual: { width: 46, textAlign: 'right' },
  phoneTarget: { width: 46, textAlign: 'right' },
  phoneGap: { width: 64 },
  tabletActual: { width: 64, textAlign: 'right' },
  tabletCurVal: { width: 100, textAlign: 'right' },
  tabletTarget: { width: 64, textAlign: 'right' },
  tabletTgtVal: { width: 100, textAlign: 'right' },
  tabletGap: { width: 84 },
  tabletAction: { width: 96 },
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  rowPhone: { paddingVertical: space.sm, gap: 2 },
  rowTablet: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowPressed: { opacity: 0.72 },
  phoneTop: { flexDirection: 'row', alignItems: 'center' },
  chevronSlot: { width: 14, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  holdingDot: { width: 5, height: 5, opacity: 0.5 },
  categoryLabel: { flexShrink: 1, fontSize: 12.5 },
  sleeveLabel: { fontWeight: '600' },
  holdingLabel: { fontSize: 11.5 },
  count: { fontSize: 10, marginLeft: 1 },
  numCell: { ...numeric, fontSize: 11.5, fontWeight: '500' },
  valueCell: { ...numeric, fontSize: 11 },
  gapCell: { alignItems: 'flex-end' },
  gapBadge: { alignSelf: 'flex-end' },
  dash: { fontSize: 11 },
  actionCell: { alignItems: 'flex-end' },
  actionText: { fontSize: 11, fontWeight: '600' },
  phoneSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingRight: 0,
  },
  phoneSubText: { flex: 1, fontSize: 10 },
  empty: {
    ...type.body,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    textAlign: 'center',
  },
  footer: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  footerTablet: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  footerButton: { minWidth: 200 },
});
