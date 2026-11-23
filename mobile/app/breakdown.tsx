import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import type { AllocationNode } from '@/src/features/portfolio/analytics';
import {
  buildCompositionTree,
  compositionCoverage,
  compositionPath,
  compositionSuggestions,
  compositionTargets,
  currentValueForPath,
  directChildPaths,
  effectiveTargetOfTotal,
  indexAllocationNodes,
  isChildPath,
  mergeCompositionTargets,
  targetRangeError,
  validateComposition,
  type CompositionNode,
} from '@/src/features/portfolio/breakdown';
import {
  DEFAULT_POLICY_BANDS,
  colorForSleeve,
  defaultBandFor,
  effectiveTargetMap,
  policySleevePaths,
  type PolicyConfig,
} from '@/src/features/portfolio/policy';
import { usePortfolioData, useSavePolicy } from '@/src/features/portfolio/queries';
import type { PolicyDecisionLevel } from '@/src/features/portfolio/types';
import {
  formatCompactINR,
  formatPercent,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const round2 = (value: number) => Math.round(value * 100) / 100;

const LEVELS: { key: PolicyDecisionLevel; label: string; hint: string }[] = [
  { key: 'composition', label: 'Composition', hint: 'Informational only' },
  { key: 'monitor', label: 'Monitor', hint: 'Range watched, no trades' },
  { key: 'policy', label: 'Policy', hint: 'Actionable compliance node' },
];

interface DraftEntry {
  target: string;
  min: string;
  max: string;
  level: PolicyDecisionLevel;
}

function initialEntries(
  config: PolicyConfig,
  roots: string[],
): Record<string, DraftEntry> {
  const targets = compositionTargets(config.targets, roots);
  const next: Record<string, DraftEntry> = {};
  for (const [path, value] of Object.entries(targets)) {
    const level = config.decisionLevels[path] ?? 'composition';
    const range = config.ranges[path];
    const band = config.bands[path] ?? defaultBandFor(path);
    const effective = effectiveTargetOfTotal(config.targets, path);
    next[path] = {
      target: String(round2(value)),
      min: String(round2(range?.min ?? Math.max(0, effective - band))),
      max: String(round2(range?.max ?? Math.min(100, effective + band))),
      level,
    };
  }
  return next;
}

function entryNumbers(entries: Record<string, DraftEntry>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [path, entry] of Object.entries(entries)) {
    const parsed = Number(entry.target);
    next[path] = Number.isFinite(parsed) ? parsed : 0;
  }
  return next;
}

function MiniField({
  label,
  value,
  onChangeText,
  suffix,
  decimal = true,
  disabled = false,
  error = false,
  errorText,
  placeholder,
  autoCapitalize,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  suffix?: string;
  decimal?: boolean;
  disabled?: boolean;
  error?: boolean;
  errorText?: string;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, style]}>
      <Text
        style={[styles.fieldLabel, { color: error ? colors.negative : colors.muted }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View
        style={[
          styles.fieldBox,
          {
            backgroundColor: disabled ? colors.cardMuted : colors.bg,
            borderColor: error ? colors.negative : focused ? colors.accent : colors.border,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={decimal ? 'decimal-pad' : 'default'}
          inputMode={decimal ? 'decimal' : 'text'}
          selectTextOnFocus={decimal}
          autoCapitalize={autoCapitalize}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.fieldInput,
            numeric,
            { color: disabled ? colors.muted : colors.text },
          ]}
        />
        {suffix ? (
          <Text style={[styles.fieldSuffix, { color: colors.muted }]}>{suffix}</Text>
        ) : null}
      </View>
      {errorText ? (
        <Text style={[styles.fieldError, { color: colors.negative }]} numberOfLines={2}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

function LevelControl({
  value,
  onChange,
  disabled = false,
  style,
}: {
  value: PolicyDecisionLevel;
  onChange: (level: PolicyDecisionLevel) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.segment,
        { backgroundColor: colors.cardMuted, borderColor: colors.border },
        disabled && styles.segmentDisabled,
        style,
      ]}
    >
      {LEVELS.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${option.label} level`}
            accessibilityHint={option.hint}
            accessibilityState={{ selected, disabled }}
            style={[
              styles.segmentOption,
              selected && { backgroundColor: colors.accentSoft },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color: selected ? colors.accent : colors.muted,
                  fontWeight: selected ? '600' : '500',
                },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  const { colors, scheme } = useTheme();

  return (
    <View
      style={[
        styles.switchTrack,
        { backgroundColor: on ? colors.accent : colors.border },
      ]}
    >
      <View
        style={[
          styles.switchThumb,
          {
            backgroundColor:
              scheme === 'dark' ? colors.textSecondary : colors.card,
            transform: [{ translateX: on ? 16 : 0 }],
          },
        ]}
      />
    </View>
  );
}

export default function BreakdownScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    analytics,
    policyConfig,
    isLoading,
    error,
    isDemo,
    refetch,
  } = usePortfolioData();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          eyebrow="Institutional allocation"
          title="Sleeve composition"
          subtitle="Set how each sleeve is built without changing the root policy."
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close sleeve composition"
            />
          }
        />

        {error ? (
          <Card>
            <Text style={[type.body, { color: colors.negative }]}>
              {error instanceof Error ? error.message : 'The portfolio could not be loaded.'}
            </Text>
            <Button label="Retry" onPress={refetch} variant="secondary" size="sm" />
          </Card>
        ) : isLoading ? (
          <Card>
            <Text style={[type.body, { color: colors.muted }]}>Loading composition…</Text>
          </Card>
        ) : (
          <BreakdownEditor
            key={`${policyConfig.policy.id}:${policyConfig.policy.version}:${policyConfig.policy.updatedAt}`}
            config={policyConfig}
            nodes={analytics.allocationAnalysis}
            totalValue={analytics.totals.portfolio}
            isDemo={isDemo}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function BreakdownEditor({
  config,
  nodes,
  totalValue,
  isDemo,
}: {
  config: PolicyConfig;
  nodes: AllocationNode[];
  totalValue: number;
  isDemo: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const save = useSavePolicy();

  const roots = useMemo(
    () =>
      policySleevePaths(config.rootTargets, nodes).filter(
        (path) => (config.rootTargets[path] ?? 0) > 0,
      ),
    [config.rootTargets, nodes],
  );

  const [entries, setEntries] = useState<Record<string, DraftEntry>>(() =>
    initialEntries(config, roots),
  );
  const [allowUnallocated, setAllowUnallocated] = useState(
    config.policy.allowUnallocated ?? false,
  );
  const [addingAt, setAddingAt] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newLevel, setNewLevel] = useState<PolicyDecisionLevel>('composition');
  const [addError, setAddError] = useState<string | null>(null);

  const index = useMemo(() => indexAllocationNodes(nodes), [nodes]);

  const draftTargets = useMemo(() => {
    const rootSet = new Set(roots);
    const next: Record<string, number> = { ...config.targets };
    for (const path of Object.keys(next)) {
      if (!isChildPath(path)) continue;
      if (!rootSet.has(path.split(' > ')[0])) continue;
      delete next[path];
    }
    for (const [path, entry] of Object.entries(entries)) {
      const parsed = Number(entry.target);
      next[path] = Number.isFinite(parsed) ? parsed : 0;
    }
    return next;
  }, [config.targets, entries, roots]);

  const effective = useMemo(() => effectiveTargetMap(draftTargets), [draftTargets]);
  const numericTargets = useMemo(() => entryNumbers(entries), [entries]);
  const validation = useMemo(
    () => validateComposition(numericTargets, { allowUnallocated }),
    [allowUnallocated, numericTargets],
  );

  const childRanges = useMemo(() => {
    const next: Record<string, { min: number; max: number }> = {};
    for (const [path, entry] of Object.entries(entries)) {
      if (entry.level === 'composition') continue;
      const min = Number(entry.min);
      const max = Number(entry.max);
      if (Number.isFinite(min) && Number.isFinite(max)) next[path] = { min, max };
    }
    return next;
  }, [entries]);

  const rangeIssues = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [path, entry] of Object.entries(entries)) {
      if (entry.level === 'composition') continue;
      const error = targetRangeError(entry.min, entry.max);
      if (error) {
        next[path] = error;
        continue;
      }
      const target = effective[path] ?? 0;
      const min = Number(entry.min);
      const max = Number(entry.max);
      if (target < min || target > max) {
        next[path] = `Effective target ${formatPercent(target)} is outside the allowed range.`;
      }
    }
    return next;
  }, [effective, entries]);

  const levelMap = useMemo(() => {
    const next: Record<string, PolicyDecisionLevel> = {};
    for (const [path, entry] of Object.entries(entries)) {
      if (entry.level !== 'composition') next[path] = entry.level;
    }
    return next;
  }, [entries]);

  const positiveChildren = useMemo(() => {
    const next: Record<string, number> = {};
    for (const [path, value] of Object.entries(numericTargets)) {
      if (value > 0) next[path] = value;
    }
    return next;
  }, [numericTargets]);

  const savedTargets = useMemo(
    () => mergeCompositionTargets(config.targets, roots, positiveChildren),
    [config.targets, positiveChildren, roots],
  );

  const explicitRanges = useMemo(() => {
    const next = { ...(config.policy.ranges ?? {}) };
    for (const path of Object.keys(entries)) delete next[path];
    for (const [path, range] of Object.entries(childRanges)) next[path] = range;
    return next;
  }, [childRanges, config.policy.ranges, entries]);

  const dirty = useMemo(() => {
    const existingChildren = compositionTargets(config.targets, roots);
    const existingKeys = Object.keys(existingChildren).sort();
    const nextKeys = Object.keys(positiveChildren).sort();
    if (existingKeys.join('|') !== nextKeys.join('|')) return true;
    if (
      nextKeys.some(
        (path) =>
          round2(existingChildren[path] ?? 0) !== round2(positiveChildren[path] ?? 0),
      )
    ) {
      return true;
    }

    for (const path of nextKeys) {
      const entry = entries[path];
      if ((config.decisionLevels[path] ?? 'composition') !== entry.level) return true;
      if (entry.level === 'composition') continue;
      const stored = config.ranges[path];
      if (!stored) return true;
      if (
        round2(Number(entry.min)) !== round2(stored.min) ||
        round2(Number(entry.max)) !== round2(stored.max)
      ) {
        return true;
      }
    }

    for (const [path, level] of Object.entries(config.decisionLevels)) {
      if (level === 'composition') continue;
      if (!entries[path] && isChildPath(path)) return true;
    }

    return allowUnallocated !== (config.policy.allowUnallocated ?? false);
  }, [
    allowUnallocated,
    config.decisionLevels,
    config.policy.allowUnallocated,
    config.ranges,
    config.targets,
    entries,
    positiveChildren,
    roots,
  ]);

  const hasRangeIssues = Object.keys(rangeIssues).length > 0;
  const canSave =
    !isDemo &&
    !config.isTemplate &&
    config.isValid &&
    validation.isValid &&
    !hasRangeIssues &&
    dirty &&
    !save.isPending;

  const saveLabel = isDemo
    ? 'Read-only in demo'
    : config.isTemplate
      ? 'Confirm sleeve targets first'
      : !config.isValid
        ? 'Root policy must total 100%'
        : !validation.isValid
          ? 'Resolve composition errors'
          : hasRangeIssues
            ? 'Resolve range errors'
            : !dirty
              ? 'No changes to save'
              : save.isPending
                ? 'Saving composition…'
                : 'Save composition';

  const updateEntry = (path: string, patch: Partial<DraftEntry>) => {
    setEntries((current) => ({
      ...current,
      [path]: {
        ...current[path],
        ...patch,
      },
    }));
  };

  const openAdd = (parentPath: string) => {
    setAddingAt(parentPath);
    setNewName('');
    setNewTarget('');
    setNewLevel('composition');
    setAddError(null);
  };

  const closeAdd = () => {
    setAddingAt(null);
    setNewName('');
    setNewTarget('');
    setAddError(null);
  };

  const addChild = (parentPath: string) => {
    const name = newName.trim();
    if (!name) {
      setAddError('Enter a sub-category name.');
      return;
    }
    if (name.includes('>')) {
      setAddError('Use one name per level; do not type “>”.');
      return;
    }

    const path = compositionPath(parentPath, name);
    const siblings = new Set(
      directChildPaths(draftTargets, parentPath).map((sibling) => sibling.toLowerCase()),
    );
    if (siblings.has(path.toLowerCase())) {
      setAddError('That sub-category already exists under this parent.');
      return;
    }

    const value = Number(newTarget);
    if (newTarget.trim() === '' || !Number.isFinite(value)) {
      setAddError('Enter a target percentage.');
      return;
    }
    if (value <= 0 || value > 100) {
      setAddError('Use a target above 0 and at most 100.');
      return;
    }

    const parentEffective =
      effective[parentPath] ?? config.rootTargets[parentPath] ?? 0;
    const effectiveTarget = (parentEffective * value) / 100;
    const band = DEFAULT_POLICY_BANDS[path.split(' > ').pop() ?? ''] ?? 3;

    setEntries((current) => ({
      ...current,
      [path]: {
        target: String(round2(value)),
        min: String(round2(Math.max(0, effectiveTarget - band))),
        max: String(round2(Math.min(100, effectiveTarget + band))),
        level: newLevel,
      },
    }));
    closeAdd();
  };

  const confirmRemove = (path: string) => {
    Alert.alert(
      'Remove sub-category?',
      `“${path.split(' > ').pop()}” and every level beneath it will be removed when you save.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setEntries((current) => {
              const next: Record<string, DraftEntry> = {};
              for (const [entryPath, entry] of Object.entries(current)) {
                if (
                  entryPath === path ||
                  entryPath.startsWith(`${path} > `)
                ) {
                  continue;
                }
                next[entryPath] = entry;
              }
              return next;
            });
            if (addingAt === path || addingAt?.startsWith(`${path} > `)) {
              closeAdd();
            }
          },
        },
      ],
    );
  };

  const submit = () => {
    if (!canSave) return;
    save.mutate(
      {
        targets: savedTargets,
        bands: config.bands,
        reviewCadence: config.policy.reviewCadence,
        ranges: explicitRanges,
        decisionLevels: levelMap,
        benchmarks: config.policy.benchmarks,
        sectorTargets: config.policy.sectorTargets,
        sectorRanges: config.policy.sectorRanges,
        riskBudget: config.policy.riskBudget,
        riskModel: config.policy.riskModel,
        currencyPolicy: config.policy.currencyPolicy,
        liquidityPolicy: config.policy.liquidityPolicy,
        allowUnallocated,
        notes: config.policy.notes,
        approvedBy: config.policy.approvedBy,
        changeNote: config.policy.changeNote,
      },
      { onSuccess: () => router.back() },
    );
  };

  const totalDefined = Object.keys(entries).length;
  const sleevesWithComposition = roots.filter((root) =>
    directChildPaths(draftTargets, root).length > 0,
  ).length;
  const compositionReady = config.isValid && validation.isValid && !hasRangeIssues;

  return (
    <View style={styles.stack}>
      {isDemo ? (
        <Banner
          tone="warning"
          icon="play-circle"
          message="Composition editing is read-only in demo mode. Sign in to save targets."
        />
      ) : null}

      {!isDemo && config.isTemplate ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message="Confirm the root sleeve targets first. Composition targets are saved with a confirmed policy."
        />
      ) : null}

      {save.isError ? (
        <Banner
          tone="error"
          icon="alert-circle"
          message={
            save.error instanceof Error
              ? save.error.message
              : 'The composition could not be saved.'
          }
        />
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Sub-categories
              </Text>
              <Text style={[styles.statValue, numeric, { color: colors.text }]}>
                {totalDefined}
              </Text>
            </View>
            <View style={[styles.statRule, { backgroundColor: colors.border }]} />
            <View style={styles.summaryStat}>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Sleeves covered
              </Text>
              <Text style={[styles.statValue, numeric, { color: colors.text }]}>
                {sleevesWithComposition}
                <Text style={[styles.statValueMuted, { color: colors.muted }]}>
                  /{roots.length}
                </Text>
              </Text>
            </View>
          </View>
          <Badge
            label={compositionReady ? 'Valid' : 'Needs attention'}
            tone={compositionReady ? 'positive' : 'warning'}
          />
        </View>

        <Text style={[styles.summaryCopy, { color: colors.muted }]}>
          Each target is a % of its immediate parent; roots stay the only policy level.
          Composition is informational, Monitor watches the range, Policy is actionable.
        </Text>

        <Pressable
          onPress={isDemo ? undefined : () => setAllowUnallocated((value) => !value)}
          disabled={isDemo}
          accessibilityRole="switch"
          accessibilityLabel="Allow unallocated remainder"
          accessibilityState={{ checked: allowUnallocated, disabled: isDemo }}
          style={({ pressed }) => [
            styles.unallocatedRow,
            { borderTopColor: colors.border },
            pressed && !isDemo ? styles.rowPressed : null,
            isDemo ? styles.optionDisabled : null,
          ]}
        >
          <View
            style={[
              styles.optionIcon,
              {
                backgroundColor: allowUnallocated
                  ? colors.warningSoft
                  : colors.cardMuted,
              },
            ]}
          >
            <Feather
              name="pie-chart"
              size={15}
              color={allowUnallocated ? colors.warning : colors.muted}
            />
          </View>
          <View style={styles.optionText}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>
              Allow unallocated
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Parents may total under 100%; the remainder is saved explicitly.
            </Text>
          </View>
          <ToggleSwitch on={allowUnallocated} />
        </Pressable>
      </Card>

      {roots.map((root, indexValue) => {
        const rootTarget = config.rootTargets[root] ?? 0;
        const rootCurrentValue = currentValueForPath(index, root);
        const rootCurrentPct =
          totalValue > 0 ? (rootCurrentValue / totalValue) * 100 : 0;
        const range = config.ranges[root] ?? {
          min: Math.max(0, rootTarget - (config.bands[root] ?? defaultBandFor(root))),
          max: Math.min(100, rootTarget + (config.bands[root] ?? defaultBandFor(root))),
        };
        const tree = buildCompositionTree({
          targets: draftTargets,
          nodes,
          rootPath: root,
          totalValue,
          decisionLevels: levelMap,
        });
        const coverage = compositionCoverage(tree, rootCurrentValue);
        const coverageTone =
          coverage >= 95
            ? colors.positive
            : coverage > 0
              ? colors.warning
              : colors.muted;
        const coverageWidth = `${Number.isFinite(coverage)
          ? Math.min(100, Math.max(0, coverage))
          : 0}%` as DimensionValue;
        const parentError = validation.parentErrors[root];
        const sum = validation.sumByParent[root];
        const unallocated = validation.unallocatedByParent[root];
        const sumColor = parentError
          ? colors.negative
          : unallocated
            ? colors.warning
            : colors.positive;

        return (
          <View key={root} style={styles.sleeve}>
            <View style={styles.sleeveHeader}>
              <View style={styles.sleeveTitle}>
                <View
                  style={[
                    styles.sleeveDot,
                    { backgroundColor: colorForSleeve(root, indexValue) },
                  ]}
                />
                <View style={styles.sleeveTitleText}>
                  <Text style={[type.title, { color: colors.text }]} numberOfLines={1}>
                    {root}
                  </Text>
                  <Text
                    style={[type.caption, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    Band {formatPercent(range.min, { precision: 1 })}–
                    {formatPercent(range.max, { precision: 1 })} ·{' '}
                    {tree.length === 0
                      ? 'No groups'
                      : `${tree.length} ${tree.length === 1 ? 'group' : 'groups'}`}
                  </Text>
                </View>
              </View>
              {!isDemo ? (
                <Pressable
                  onPress={() => openAdd(root)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add sub-category to ${root}`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.addAction,
                    pressed ? styles.rowPressed : null,
                  ]}
                >
                  <Feather name="plus" size={14} color={colors.accent} />
                  <Text style={[styles.addActionText, { color: colors.accent }]}>
                    Add
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <Card padded={false} style={styles.sleeveCard}>
              <View style={styles.sleeveStats}>
                <View style={styles.sleeveStat}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>
                    Current
                  </Text>
                  <Text style={[styles.sleeveStatValue, numeric, { color: colors.text }]}>
                    {formatPercent(rootCurrentPct, { precision: 1 })}
                  </Text>
                  <Text style={[styles.sleeveStatSub, numeric, { color: colors.muted }]}>
                    {formatCompactINR(rootCurrentValue)}
                  </Text>
                </View>
                <View style={[styles.sleeveStatRule, { backgroundColor: colors.border }]} />
                <View style={styles.sleeveStat}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>
                    Target
                  </Text>
                  <Text style={[styles.sleeveStatValue, numeric, { color: colors.text }]}>
                    {formatPercent(rootTarget, { precision: 1 })}
                  </Text>
                  <Text style={[styles.sleeveStatSub, numeric, { color: colors.muted }]}>
                    {formatCompactINR((totalValue * rootTarget) / 100)}
                  </Text>
                </View>
                <View style={[styles.sleeveStatRule, { backgroundColor: colors.border }]} />
                <View style={styles.sleeveStat}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>
                    Covered
                  </Text>
                  <Text
                    style={[
                      styles.sleeveStatValue,
                      numeric,
                      { color: coverageTone },
                    ]}
                  >
                    {formatPercent(coverage, { precision: 1 })}
                  </Text>
                  <Text style={[styles.sleeveStatSub, { color: colors.muted }]}>
                    of sleeve value
                  </Text>
                </View>
              </View>

              <View style={[styles.coverageTrack, { backgroundColor: colors.cardMuted }]}>
                <View
                  style={{
                    width: coverageWidth,
                    height: '100%',
                    backgroundColor: coverageTone,
                  }}
                />
              </View>

              <View style={styles.tree}>
                {tree.length === 0 ? (
                  <View style={styles.empty}>
                    <Feather name="layers" size={16} color={colors.muted} />
                    <Text style={[type.caption, styles.emptyText, { color: colors.muted }]}>
                      No sub-categories yet. Add the groups you use to implement this
                      sleeve.
                    </Text>
                  </View>
                ) : (
                  tree.map((node, nodeIndex) => (
                    <View
                      key={node.path}
                      style={
                        nodeIndex > 0
                          ? {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: colors.border,
                            }
                          : null
                      }
                    >
                      {renderRow(node)}
                    </View>
                  ))
                )}

                {addingAt === root ? renderAddForm(root) : null}
              </View>

              {tree.length > 0 ? (
                <View style={[styles.sumRow, { borderTopColor: colors.border }]}>
                  <View style={styles.sumText}>
                    <Feather
                      name={
                        parentError
                          ? 'alert-circle'
                          : unallocated
                            ? 'alert-triangle'
                            : 'check-circle'
                      }
                      size={12}
                      color={sumColor}
                    />
                    <Text style={[type.caption, { color: sumColor, flex: 1 }]}>
                      {parentError
                        ? parentError
                        : unallocated
                          ? `Children ${formatPercent(sum, {
                              precision: 1,
                            })} · ${formatPercent(unallocated, {
                              precision: 1,
                            })} unallocated`
                          : `Children total ${formatPercent(sum, { precision: 1 })}`}
                    </Text>
                  </View>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {tree.length} {tree.length === 1 ? 'group' : 'groups'}
                  </Text>
                </View>
              ) : null}
            </Card>
          </View>
        );
      })}

      {!validation.isValid ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message={
            Object.values(validation.childErrors)[0] ??
            Object.values(validation.parentErrors)[0] ??
            'Fix the composition inputs before saving.'
          }
        />
      ) : null}

      <View style={styles.saveBlock}>
        <Button
          label={saveLabel}
          onPress={submit}
          disabled={!canSave}
          loading={save.isPending}
          icon={config.isTemplate ? 'check' : 'save'}
          fullWidth
          size="lg"
        />
        <Text style={[styles.saveHint, { color: colors.muted }]}>
          Saving creates a new policy version. Root targets, bands and the rebalance
          planner stay unchanged.
        </Text>
      </View>
    </View>
  );

  function renderRow(node: CompositionNode) {
    const entry = entries[node.path];
    if (!entry) return null;
    const parentError = validation.parentErrors[node.path];
    const sum = validation.sumByParent[node.path];
    const unallocated = validation.unallocatedByParent[node.path];
    const rangeIssue = rangeIssues[node.path];
    const childError =
      entry.target.trim() === '' ? 'Required' : validation.childErrors[node.path];
    const effectiveValue = effective[node.path] ?? node.effectiveTarget;
    const sumColor = parentError
      ? colors.negative
      : unallocated
        ? colors.warning
        : colors.positive;

    return (
      <View key={node.path} style={styles.node}>
        <View style={styles.nodeHeader}>
          <View style={styles.nodeTitle}>
            <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {node.label}
            </Text>
            <View style={styles.nodeMetaRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: node.hasHoldings
                      ? colors.positive
                      : colors.border,
                  },
                ]}
              />
              <Text style={[styles.nodeMeta, { color: colors.muted }]}>
                {node.hasHoldings
                  ? `${formatPercent(node.currentOfParent, {
                      precision: 1,
                    })} of parent · ${formatCompactINR(node.currentValue)}`
                  : 'Not detected'}
                {' · '}
                <Text style={{ color: colors.textSecondary }}>
                  {formatPercent(effectiveValue, { precision: 1 })} portfolio
                </Text>
              </Text>
            </View>
          </View>

          {!isDemo ? (
            <View style={styles.nodeActions}>
              <Pressable
                onPress={() => openAdd(node.path)}
                accessibilityRole="button"
                accessibilityLabel={`Add sub-category under ${node.label}`}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.nodeAction,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <Feather name="plus" size={15} color={colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => confirmRemove(node.path)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${node.label}`}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.nodeAction,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <Feather name="trash-2" size={15} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.controlsRow}>
          <MiniField
            label="Target (% parent)"
            value={entry.target}
            onChangeText={(value) => updateEntry(node.path, { target: value })}
            suffix="%"
            disabled={isDemo}
            error={Boolean(childError)}
            errorText={childError}
            style={styles.targetField}
          />
          {entry.level !== 'composition' ? (
            <>
              <MiniField
                label="Min %"
                value={entry.min}
                onChangeText={(value) => updateEntry(node.path, { min: value })}
                suffix="%"
                disabled={isDemo}
                error={Boolean(rangeIssue)}
                style={styles.rangeField}
              />
              <MiniField
                label="Max %"
                value={entry.max}
                onChangeText={(value) => updateEntry(node.path, { max: value })}
                suffix="%"
                disabled={isDemo}
                error={Boolean(rangeIssue)}
                style={styles.rangeField}
              />
            </>
          ) : null}
        </View>

        {rangeIssue ? (
          <Text style={[styles.rowError, { color: colors.negative }]}>
            {rangeIssue}
          </Text>
        ) : null}

        <View style={styles.levelRow}>
          <Text style={[styles.levelLabel, { color: colors.muted }]}>Level</Text>
          <LevelControl
            value={entry.level}
            onChange={(level) => updateEntry(node.path, { level })}
            disabled={isDemo}
            style={styles.levelControl}
          />
        </View>

        {addingAt === node.path ? renderAddForm(node.path) : null}

        {node.children.length > 0 ? (
          <View style={[styles.children, { borderLeftColor: colors.border }]}>
            {node.children.map((child) => renderRow(child))}
            <View style={styles.subSum}>
              <Feather
                name={
                  parentError
                    ? 'alert-circle'
                    : unallocated
                      ? 'alert-triangle'
                      : 'check-circle'
                }
                size={12}
                color={sumColor}
              />
              <Text style={[type.caption, { color: sumColor, flex: 1 }]}>
                {parentError
                  ? parentError
                  : unallocated
                    ? `Children ${formatPercent(sum, {
                        precision: 1,
                      })} · ${formatPercent(unallocated, {
                        precision: 1,
                      })} unallocated`
                    : `Children total ${formatPercent(sum, { precision: 1 })}`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  function renderAddForm(parentPath: string) {
    const suggestions = compositionSuggestions(nodes, parentPath, draftTargets).slice(0, 6);
    return (
      <View
        style={[
          styles.addForm,
          { backgroundColor: colors.cardMuted, borderColor: colors.border },
        ]}
      >
        <View style={styles.addHeader}>
          <View style={styles.addTitle}>
            <Text style={[styles.addEyebrow, { color: colors.muted }]}>
              New sub-category
            </Text>
            <Text
              style={[type.bodyMedium, { color: colors.text }]}
              numberOfLines={2}
            >
              {parentPath.split(' > ').join(' › ')}
            </Text>
          </View>
          <IconButton
            icon="x"
            onPress={closeAdd}
            accessibilityLabel="Cancel adding sub-category"
            variant="plain"
            size={30}
          />
        </View>

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <Chip
                key={suggestion.path}
                label={`${suggestion.label}${suggestion.detected ? ' · detected' : ''}`}
                selected={newName === suggestion.label}
                onPress={() => setNewName(suggestion.label)}
              />
            ))}
          </View>
        ) : null}

        <MiniField
          label="Name"
          placeholder="e.g. Domestic equity"
          value={newName}
          onChangeText={(value) => {
            setNewName(value);
            setAddError(null);
          }}
          decimal={false}
          autoCapitalize="words"
          disabled={isDemo}
        />

        <MiniField
          label="Target (% parent)"
          placeholder="0"
          value={newTarget}
          onChangeText={(value) => {
            setNewTarget(value);
            setAddError(null);
          }}
          suffix="%"
          disabled={isDemo}
        />

        <View style={styles.levelRow}>
          <Text style={[styles.levelLabel, { color: colors.muted }]}>Level</Text>
          <LevelControl
            value={newLevel}
            onChange={setNewLevel}
            disabled={isDemo}
            style={styles.levelControl}
          />
        </View>

        {addError ? (
          <Text style={[styles.rowError, { color: colors.negative }]}>{addError}</Text>
        ) : null}

        <View style={styles.addActions}>
          <Button
            label="Add sub-category"
            onPress={() => addChild(parentPath)}
            variant="primary"
            size="sm"
            icon="plus"
            disabled={isDemo}
          />
          <Button
            label="Cancel"
            onPress={closeAdd}
            variant="ghost"
            size="sm"
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.xl },

  summaryCard: { gap: space.md },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    flex: 1,
  },
  summaryStat: { gap: 2 },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  statValueMuted: { fontSize: 14, fontWeight: '500' },
  statRule: { width: StyleSheet.hairlineWidth, height: 28 },
  summaryCopy: { fontSize: 12, lineHeight: 18, maxWidth: 680 },
  unallocatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionDisabled: { opacity: 0.55 },
  switchTrack: {
    width: 40,
    height: 24,
    borderRadius: radius.full,
    padding: 2,
    justifyContent: 'center',
  },
  switchThumb: { width: 20, height: 20, borderRadius: radius.full },

  sleeve: { gap: space.sm },
  sleeveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xs,
  },
  sleeveTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  sleeveTitleText: { flex: 1, gap: 2 },
  sleeveDot: { width: 9, height: 9, borderRadius: radius.full },
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: space.xs,
    paddingHorizontal: space.xxs,
  },
  addActionText: { fontSize: 13, fontWeight: '600' },
  sleeveCard: { overflow: 'hidden' },

  sleeveStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  sleeveStat: { flex: 1, gap: 2 },
  sleeveStatRule: { width: StyleSheet.hairlineWidth, marginHorizontal: space.md },
  sleeveStatValue: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2 },
  sleeveStatSub: { fontSize: 11 },
  coverageTrack: { height: 2, flexDirection: 'row' },

  tree: { paddingHorizontal: space.lg },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  emptyText: { flex: 1, lineHeight: 17 },

  node: { paddingVertical: space.md, gap: space.sm },
  nodeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  nodeTitle: { flex: 1, gap: 2 },
  nodeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: radius.full },
  nodeMeta: { flex: 1, lineHeight: 16 },
  nodeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    marginTop: -3,
  },
  nodeAction: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  rowPressed: { opacity: 0.55 },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    maxWidth: 560,
  },
  targetField: { flex: 1.35, minWidth: 0 },
  rangeField: { flex: 1, minWidth: 0 },
  field: { gap: 4, minWidth: 0 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minWidth: 0,
  },
  fieldInput: {
    flex: 1,
    flexShrink: 1,
    height: 36,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 14,
    fontWeight: '500',
  },
  fieldSuffix: { fontSize: 12, fontWeight: '500', marginLeft: 2 },
  fieldError: { fontSize: 10, lineHeight: 13 },
  rowError: { fontSize: 11, lineHeight: 15 },

  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 560,
  },
  levelLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  levelControl: { flex: 1 },
  segment: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  segmentOption: {
    flex: 1,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: space.xs,
  },
  segmentText: { fontSize: 11, letterSpacing: 0.1 },
  segmentDisabled: { opacity: 0.6 },

  children: {
    marginTop: space.xs,
    marginLeft: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  subSum: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: space.xs,
  },

  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  sumText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },

  addForm: {
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.xs,
    marginBottom: space.md,
    maxWidth: 640,
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  addTitle: { flex: 1, gap: 2 },
  addEyebrow: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  addActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  saveBlock: { gap: space.md, marginTop: space.sm },
  saveHint: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
