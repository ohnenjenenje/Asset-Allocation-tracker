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
  portfolioTargetFromRelative,
  relativeTargetFromPortfolio,
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
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

type TargetBasis = 'parent' | 'portfolio';

const LEVELS: { key: PolicyDecisionLevel; label: string; hint: string }[] = [
  { key: 'composition', label: 'Composition', hint: 'Informational only' },
  { key: 'monitor', label: 'Monitor', hint: 'Range watched, no trades' },
  { key: 'policy', label: 'Policy', hint: 'Actionable compliance node' },
];

const NEW_LEVEL_KEY = '@new';

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
  onBlur,
  suffix,
  decimal = true,
  disabled = false,
  error = false,
  placeholder,
  autoCapitalize,
  accessibilityLabel,
  align = 'left',
  onLabelPress,
  labelActionDisabled = false,
  labelActionAccessibilityLabel,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  suffix?: string;
  decimal?: boolean;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  accessibilityLabel?: string;
  align?: 'left' | 'right';
  onLabelPress?: () => void;
  labelActionDisabled?: boolean;
  labelActionAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const labelColor = error
    ? colors.negative
    : onLabelPress && !labelActionDisabled
      ? colors.accent
      : colors.muted;

  return (
    <View style={[styles.field, style]}>
      {onLabelPress ? (
        <Pressable
          onPress={onLabelPress}
          disabled={labelActionDisabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={labelActionAccessibilityLabel ?? label}
          accessibilityState={{ disabled: labelActionDisabled }}
          style={styles.fieldLabelAction}
        >
          <Text
            style={[
              styles.fieldLabel,
              { color: labelColor },
              !labelActionDisabled ? styles.fieldLabelActionText : null,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Pressable>
      ) : (
        <Text
          style={[styles.fieldLabel, { color: labelColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
      <View
        style={[
          styles.fieldBox,
          {
            backgroundColor: colors.cardMuted,
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
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={accessibilityLabel ?? label}
          style={[
            styles.fieldInput,
            numeric,
            {
              color: disabled ? colors.muted : colors.text,
              textAlign: align,
            },
          ]}
        />
        {suffix ? (
          <Text style={[styles.fieldSuffix, { color: colors.muted }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

function levelFor(key: PolicyDecisionLevel) {
  return LEVELS.find((option) => option.key === key) ?? LEVELS[0];
}

function LevelPill({
  value,
  open,
  onPress,
  disabled = false,
}: {
  value: PolicyDecisionLevel;
  open: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const level = levelFor(value);
  const dotColor =
    value === 'policy'
      ? colors.accent
      : value === 'monitor'
        ? colors.warning
        : colors.muted;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Level: ${level.label}`}
      accessibilityHint={level.hint}
      accessibilityState={{ expanded: open, disabled }}
      style={({ pressed }) => [
        styles.levelPill,
        {
          backgroundColor: colors.cardMuted,
          borderColor: open ? colors.accent : colors.border,
        },
        disabled ? styles.optionDisabled : null,
        pressed && !disabled ? styles.rowPressed : null,
      ]}
    >
      <View style={[styles.levelDot, { backgroundColor: dotColor }]} />
      <Text
        style={[styles.levelPillText, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {level.label}
      </Text>
      <Feather
        name={open ? 'chevron-up' : 'chevron-down'}
        size={11}
        color={colors.muted}
      />
    </Pressable>
  );
}

function LevelMenu({
  value,
  onChange,
}: {
  value: PolicyDecisionLevel;
  onChange: (level: PolicyDecisionLevel) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.levelMenuWrap}>
      <View
        style={[
          styles.levelMenu,
          { backgroundColor: colors.cardMuted, borderColor: colors.border },
        ]}
      >
        {LEVELS.map((option) => {
          const selected = option.key === value;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key)}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}: ${option.hint}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.levelOption,
                selected && { backgroundColor: colors.accentSoft },
                pressed ? styles.rowPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.levelOptionText,
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
      <Text style={[styles.levelHint, { color: colors.muted }]}>
        {levelFor(value).hint}
      </Text>
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
          eyebrow="Portfolio policy"
          title="Sleeve composition"
          subtitle="Tap a target label to enter % of parent or % of portfolio; ranges stay % of portfolio."
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
  const [levelMenuPath, setLevelMenuPath] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newTargetBasis, setNewTargetBasis] = useState<TargetBasis>('parent');
  const [newLevel, setNewLevel] = useState<PolicyDecisionLevel>('composition');
  const [addError, setAddError] = useState<string | null>(null);
  const [targetBasis, setTargetBasis] = useState<Record<string, TargetBasis>>({});
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

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
    setLevelMenuPath(null);
    setNewName('');
    setNewTarget('');
    setNewTargetBasis('parent');
    setNewLevel('composition');
    setAddError(null);
  };

  const closeAdd = () => {
    setAddingAt(null);
    setLevelMenuPath(null);
    setNewName('');
    setNewTarget('');
    setNewTargetBasis('parent');
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

    const typed = Number(newTarget);
    if (newTarget.trim() === '' || !Number.isFinite(typed)) {
      setAddError('Enter a target percentage.');
      return;
    }

    const parentEffective =
      effective[parentPath] ?? config.rootTargets[parentPath] ?? 0;
    const usePortfolioBasis =
      newTargetBasis === 'portfolio' && parentEffective > 0;
    const relative = usePortfolioBasis
      ? relativeTargetFromPortfolio(typed, parentEffective)
      : typed;
    if (relative === null) {
      setAddError('Set the parent target before using % of portfolio.');
      return;
    }
    if (relative <= 0) {
      setAddError('Use a target above 0.');
      return;
    }
    if (relative > 100) {
      setAddError(
        usePortfolioBasis
          ? `The parent target is only ${formatPercent(parentEffective, {
              precision: 1,
            })}.`
          : 'Use a target at most 100%.',
      );
      return;
    }

    const effectiveTarget = (parentEffective * relative) / 100;
    const band = DEFAULT_POLICY_BANDS[path.split(' > ').pop() ?? ''] ?? 3;

    setEntries((current) => ({
      ...current,
      [path]: {
        target: String(round4(relative)),
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
            setLevelMenuPath(null);
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
  const compositionStatusLabel = !compositionReady
    ? 'Needs fixes'
    : totalDefined === 0
      ? 'Not set'
      : 'Valid';
  const compositionStatusColor = !compositionReady
    ? colors.warning
    : totalDefined === 0
      ? colors.muted
      : colors.positive;

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

      <Card padded={false}>
        <View style={styles.summaryStrip}>
          <View style={styles.summaryMetric}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              Sub-categories
            </Text>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {totalDefined}
            </Text>
          </View>

          <View style={[styles.statRule, { backgroundColor: colors.border }]} />

          <View style={styles.summaryMetric}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              Sleeves covered
            </Text>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {sleevesWithComposition}
              <Text style={[styles.summaryValueMuted, { color: colors.muted }]}>
                /{roots.length}
              </Text>
            </Text>
          </View>

          <View style={styles.summaryStatus}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Status</Text>
            <View style={styles.statusLine}>
              <Feather
                name={
                  !compositionReady
                    ? 'alert-circle'
                    : totalDefined === 0
                      ? 'minus-circle'
                      : 'check-circle'
                }
                size={12}
                color={compositionStatusColor}
              />
              <Text style={[styles.statusText, { color: compositionStatusColor }]}>
                {compositionStatusLabel}
              </Text>
            </View>
          </View>
        </View>

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
          <View style={styles.optionText}>
            <Text style={[styles.optionTitle, { color: colors.text }]}>
              Allow unallocated remainder
            </Text>
            <Text style={[styles.optionHint, { color: colors.muted }]}>
              Parents may total under 100%; remainder saved.
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
          min: Math.max(
            0,
            rootTarget - (config.bands[root] ?? defaultBandFor(root)),
          ),
          max: Math.min(
            100,
            rootTarget + (config.bands[root] ?? defaultBandFor(root)),
          ),
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
        const coverageWidth = `${
          Number.isFinite(coverage) ? Math.min(100, Math.max(0, coverage)) : 0
        }%` as DimensionValue;
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
                  <Text
                    style={[styles.sleeveName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {root}
                  </Text>
                  <Text
                    style={[styles.sleeveMeta, { color: colors.muted }]}
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
                  <Feather name="plus" size={12} color={colors.accent} />
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
                  <Text
                    style={[styles.sleeveStatValue, numeric, { color: colors.text }]}
                  >
                    {formatPercent(rootCurrentPct, { precision: 1 })}
                  </Text>
                  <Text
                    style={[styles.sleeveStatSub, numeric, { color: colors.muted }]}
                  >
                    {formatCompactINR(rootCurrentValue)}
                  </Text>
                </View>
                <View
                  style={[styles.sleeveStatRule, { backgroundColor: colors.border }]}
                />
                <View style={styles.sleeveStat}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>
                    Target
                  </Text>
                  <Text
                    style={[styles.sleeveStatValue, numeric, { color: colors.text }]}
                  >
                    {formatPercent(rootTarget, { precision: 1 })}
                  </Text>
                  <Text
                    style={[styles.sleeveStatSub, numeric, { color: colors.muted }]}
                  >
                    {formatCompactINR((totalValue * rootTarget) / 100)}
                  </Text>
                </View>
                <View
                  style={[styles.sleeveStatRule, { backgroundColor: colors.border }]}
                />
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

              <View
                style={[styles.coverageTrack, { backgroundColor: colors.cardMuted }]}
              >
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
                    <Feather name="layers" size={14} color={colors.muted} />
                    <Text style={[styles.emptyText, { color: colors.muted }]}>
                      {isDemo
                        ? 'No sub-categories defined for this sleeve.'
                        : 'No sub-categories. Add the groups that implement this sleeve.'}
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
                      size={11}
                      color={sumColor}
                    />
                    <Text style={[styles.sumLabel, { color: sumColor }]}>
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
                  <Text style={[styles.sumCount, { color: colors.muted }]}>
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
          size="md"
        />
        <Text style={[styles.saveHint, { color: colors.muted }]}>
          {isDemo
            ? 'Demo composition is read-only. Nothing is written to the server.'
            : 'Saving creates a new policy version. Root targets, bands and the rebalance planner stay unchanged.'}
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
    const effectiveValue = effective[node.path] ?? node.effectiveTarget;
    const parentPath = node.path.split(' > ').slice(0, -1).join(' > ');
    const parentEffectiveTarget = effective[parentPath] ?? 0;
    const basis: TargetBasis =
      (targetBasis[node.path] ?? 'parent') === 'portfolio' &&
      parentEffectiveTarget > 0
        ? 'portfolio'
        : 'parent';
    const targetDraft = targetDrafts[node.path];
    const targetValue =
      basis === 'portfolio'
        ? (targetDraft ??
          (entry.target.trim() === '' ? '' : String(round4(effectiveValue))))
        : entry.target;
    const childError =
      entry.target.trim() === ''
        ? 'Required'
        : basis === 'portfolio' &&
            validation.childErrors[node.path] === 'Cannot exceed 100%'
          ? `Cannot exceed the parent target (${formatPercent(
              parentEffectiveTarget,
              { precision: 1 },
            )})`
          : validation.childErrors[node.path];
    const sumColor = parentError
      ? colors.negative
      : unallocated
        ? colors.warning
        : colors.positive;

    const clearTargetDraft = () => {
      setTargetDrafts((current) => {
        if (current[node.path] === undefined) return current;
        const next = { ...current };
        delete next[node.path];
        return next;
      });
    };

    const changeTarget = (value: string) => {
      if (basis === 'parent') {
        updateEntry(node.path, { target: value });
        return;
      }

      setTargetDrafts((current) => ({ ...current, [node.path]: value }));
      if (value.trim() === '') {
        updateEntry(node.path, { target: '' });
        return;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const relative = relativeTargetFromPortfolio(parsed, parentEffectiveTarget);
      if (relative === null) return;
      updateEntry(node.path, { target: String(relative) });
    };

    const toggleTargetBasis = () => {
      if (parentEffectiveTarget <= 0) return;
      clearTargetDraft();
      setTargetBasis((current) => ({
        ...current,
        [node.path]: basis === 'portfolio' ? 'parent' : 'portfolio',
      }));
    };

    return (
      <View key={node.path} style={styles.node}>
        <View style={styles.nodeHeader}>
          <View style={styles.nodeTitle}>
            <Text style={[styles.nodeName, { color: colors.text }]} numberOfLines={1}>
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
              <Text style={[styles.nodeMeta, { color: colors.muted }]} numberOfLines={1}>
                {node.hasHoldings
                  ? `${formatPercent(node.currentOfParent, {
                      precision: 1,
                    })} of parent · ${formatCompactINR(node.currentValue)}`
                  : 'Not detected'}
                {' · '}
                <Text style={{ color: colors.textSecondary }}>
                  target {formatPercent(effectiveValue, { precision: 1 })} of portfolio
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
                <Feather name="plus" size={13} color={colors.muted} />
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
                <Feather name="trash-2" size={13} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.controlsRow}>
          <MiniField
            label={basis === 'portfolio' ? '% of portfolio' : '% of parent'}
            value={targetValue}
            onChangeText={changeTarget}
            onBlur={basis === 'portfolio' ? clearTargetDraft : undefined}
            onLabelPress={isDemo ? undefined : toggleTargetBasis}
            labelActionDisabled={parentEffectiveTarget <= 0}
            labelActionAccessibilityLabel={
              basis === 'portfolio'
                ? `Switch ${node.label} target input to percent of parent`
                : `Switch ${node.label} target input to percent of portfolio`
            }
            suffix="%"
            disabled={isDemo}
            error={Boolean(childError)}
            accessibilityLabel={`${node.label} target percentage of ${
              basis === 'portfolio' ? 'portfolio' : 'parent'
            }`}
            align="right"
            style={styles.targetField}
          />
          {entry.level === 'composition' ? (
            <View style={styles.rangeCell}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Range</Text>
              <View style={styles.rangeEmpty}>
                <Text style={[styles.rangeEmptyText, { color: colors.muted }]}>—</Text>
              </View>
            </View>
          ) : (
            <>
              <MiniField
                label="Min"
                value={entry.min}
                onChangeText={(value) => updateEntry(node.path, { min: value })}
                suffix="%"
                disabled={isDemo}
                error={Boolean(rangeIssue)}
                accessibilityLabel={`${node.label} range minimum`}
                align="right"
                style={styles.rangeField}
              />
              <MiniField
                label="Max"
                value={entry.max}
                onChangeText={(value) => updateEntry(node.path, { max: value })}
                suffix="%"
                disabled={isDemo}
                error={Boolean(rangeIssue)}
                accessibilityLabel={`${node.label} range maximum`}
                align="right"
                style={styles.rangeField}
              />
            </>
          )}
          <View style={styles.levelCell}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Level</Text>
            <LevelPill
              value={entry.level}
              open={levelMenuPath === node.path}
              onPress={() =>
                setLevelMenuPath(levelMenuPath === node.path ? null : node.path)
              }
              disabled={isDemo}
            />
          </View>
        </View>

        {levelMenuPath === node.path ? (
          <LevelMenu
            value={entry.level}
            onChange={(level) => {
              updateEntry(node.path, { level });
              setLevelMenuPath(null);
            }}
          />
        ) : null}

        {childError ? (
          <Text style={[styles.rowError, { color: colors.negative }]}>
            {childError}
          </Text>
        ) : null}
        {rangeIssue ? (
          <Text style={[styles.rowError, { color: colors.negative }]}>
            {rangeIssue}
          </Text>
        ) : null}

        {addingAt === node.path ? renderAddForm(node.path) : null}

        {node.children.length > 0 ? (
          <View style={[styles.children, { borderLeftColor: colors.border }]}>
            {node.children.map((child, childIndex) => (
              <View
                key={child.path}
                style={
                  childIndex > 0
                    ? {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      }
                    : null
                }
              >
                {renderRow(child)}
              </View>
            ))}
            <View style={styles.subSum}>
              <Feather
                name={
                  parentError
                    ? 'alert-circle'
                    : unallocated
                      ? 'alert-triangle'
                      : 'check-circle'
                }
                size={11}
                color={sumColor}
              />
              <Text style={[styles.sumLabel, { color: sumColor }]}>
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
    const parentEffective =
      effective[parentPath] ?? config.rootTargets[parentPath] ?? 0;
    const addBasis: TargetBasis =
      newTargetBasis === 'portfolio' && parentEffective > 0
        ? 'portfolio'
        : 'parent';

    const toggleNewTargetBasis = () => {
      if (parentEffective <= 0) return;
      const typed = Number(newTarget);
      if (newTarget.trim() !== '' && Number.isFinite(typed)) {
        const converted =
          addBasis === 'portfolio'
            ? relativeTargetFromPortfolio(typed, parentEffective)
            : portfolioTargetFromRelative(typed, parentEffective);
        if (converted !== null) setNewTarget(String(round4(converted)));
      }
      setNewTargetBasis(addBasis === 'portfolio' ? 'parent' : 'portfolio');
      setAddError(null);
    };

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
              style={[styles.addParent, { color: colors.text }]}
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
            size={28}
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

        <View style={styles.addFields}>
          <MiniField
            label={addBasis === 'portfolio' ? '% of portfolio' : '% of parent'}
            placeholder="0"
            value={newTarget}
            onChangeText={(value) => {
              setNewTarget(value);
              setAddError(null);
            }}
            onLabelPress={isDemo ? undefined : toggleNewTargetBasis}
            labelActionDisabled={parentEffective <= 0}
            labelActionAccessibilityLabel={
              addBasis === 'portfolio'
                ? 'Switch new target input to percent of parent'
                : 'Switch new target input to percent of portfolio'
            }
            suffix="%"
            disabled={isDemo}
            align="right"
            style={styles.addTargetField}
          />
          <View style={styles.levelCell}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Level</Text>
            <LevelPill
              value={newLevel}
              open={levelMenuPath === NEW_LEVEL_KEY}
              onPress={() =>
                setLevelMenuPath(
                  levelMenuPath === NEW_LEVEL_KEY ? null : NEW_LEVEL_KEY,
                )
              }
              disabled={isDemo}
            />
          </View>
        </View>

        {levelMenuPath === NEW_LEVEL_KEY ? (
          <LevelMenu
            value={newLevel}
            onChange={(level) => {
              setNewLevel(level);
              setLevelMenuPath(null);
            }}
          />
        ) : null}

        {addError ? (
          <Text style={[styles.rowError, { color: colors.negative }]}>{addError}</Text>
        ) : null}

        <View style={styles.addActions}>
          <Button
            label="Add"
            onPress={() => addChild(parentPath)}
            variant="primary"
            size="sm"
            icon="plus"
            disabled={isDemo}
          />
          <Button label="Cancel" onPress={closeAdd} variant="ghost" size="sm" />
        </View>
      </View>
    );
  }
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },

  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  summaryMetric: { flex: 1, gap: 2 },
  summaryValue: { fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  summaryValueMuted: { fontSize: 12, fontWeight: '500' },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statRule: { width: StyleSheet.hairlineWidth, height: 30 },
  summaryStatus: { alignItems: 'flex-end', gap: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },

  unallocatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 9,
  },
  optionText: { flex: 1, gap: 1 },
  optionTitle: { fontSize: 12, fontWeight: '500' },
  optionHint: { fontSize: 10, lineHeight: 14 },
  optionDisabled: { opacity: 0.55 },
  switchTrack: {
    width: 40,
    height: 24,
    borderRadius: radius.full,
    padding: 2,
    justifyContent: 'center',
  },
  switchThumb: { width: 20, height: 20, borderRadius: radius.full },

  sleeve: { gap: 6 },
  sleeveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xxs,
  },
  sleeveTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sleeveTitleText: { flex: 1, minWidth: 0, gap: 1 },
  sleeveDot: { width: 8, height: 8, borderRadius: radius.full },
  sleeveName: { fontSize: 13, fontWeight: '600' },
  sleeveMeta: { fontSize: 10, lineHeight: 13 },
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  addActionText: { fontSize: 11, fontWeight: '600' },
  sleeveCard: { overflow: 'hidden' },

  sleeveStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  sleeveStat: { flex: 1, gap: 1 },
  sleeveStatRule: { width: StyleSheet.hairlineWidth, marginHorizontal: 10 },
  sleeveStatValue: { fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },
  sleeveStatSub: { fontSize: 10 },
  coverageTrack: { height: 2, flexDirection: 'row' },

  tree: { paddingHorizontal: space.md },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
  },
  emptyText: { flex: 1, fontSize: 10, lineHeight: 14 },

  node: { paddingVertical: space.sm, gap: 6 },
  nodeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  nodeTitle: { flex: 1, minWidth: 0, gap: 1 },
  nodeName: { fontSize: 12, fontWeight: '600', lineHeight: 15 },
  nodeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: { width: 5, height: 5, borderRadius: radius.full },
  nodeMeta: { flex: 1, fontSize: 10, lineHeight: 13 },
  nodeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -2,
  },
  nodeAction: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  rowPressed: { opacity: 0.55 },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    maxWidth: 560,
  },
  targetField: { width: 76, minWidth: 0 },
  rangeField: { width: 54, minWidth: 0 },
  rangeCell: { width: 114, gap: 3 },
  rangeEmpty: { height: 30, alignItems: 'center', justifyContent: 'center' },
  rangeEmptyText: { fontSize: 12, fontWeight: '500' },
  levelCell: { width: 96, gap: 3 },
  field: { gap: 3, minWidth: 0 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  fieldLabelAction: { alignSelf: 'flex-start' },
  fieldLabelActionText: { textDecorationLine: 'underline' },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    minWidth: 0,
    overflow: 'hidden',
  },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    width: 0,
    height: 28,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 12,
    fontWeight: '500',
  },
  fieldSuffix: { fontSize: 10, fontWeight: '500', marginLeft: 1 },
  rowError: { fontSize: 10, lineHeight: 13 },

  levelPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    maxWidth: 110,
    paddingHorizontal: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
  },
  levelDot: { width: 5, height: 5, borderRadius: radius.full },
  levelPillText: { fontSize: 10, fontWeight: '500', flexShrink: 1 },
  levelMenuWrap: { gap: 4, maxWidth: 560 },
  levelMenu: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  levelOption: {
    flex: 1,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  levelOptionText: { fontSize: 10, letterSpacing: 0.1 },
  levelHint: { fontSize: 10, lineHeight: 13 },

  children: {
    marginTop: space.xxs,
    marginLeft: 6,
    paddingLeft: 14,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  subSum: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    paddingBottom: 2,
  },

  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
    paddingHorizontal: space.md,
  },
  sumText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  sumLabel: { fontSize: 10, lineHeight: 14, flexShrink: 1 },
  sumCount: { fontSize: 10 },

  addForm: {
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 6,
    marginBottom: space.sm,
    maxWidth: 600,
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  addTitle: { flex: 1, gap: 1 },
  addEyebrow: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  addParent: { fontSize: 12, fontWeight: '500' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  addFields: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  addTargetField: { flex: 1, minWidth: 0 },
  addActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  saveBlock: { gap: space.sm, marginTop: space.xxs },
  saveHint: { fontSize: 10, lineHeight: 14, textAlign: 'center' },
});
