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
  View,
} from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { TextField } from '@/src/components/ui/TextField';
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

function levelTone(level: PolicyDecisionLevel): 'neutral' | 'accent' | 'warning' {
  if (level === 'policy') return 'accent';
  if (level === 'monitor') return 'warning';
  return 'neutral';
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
          subtitle="Optional targets inside each sleeve. Root policy and rebalance stay unchanged."
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
        <View style={styles.summaryHeader}>
          <View style={styles.summaryText}>
            <Text style={[type.label, { color: colors.muted }]}>Composition model</Text>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {totalDefined} {totalDefined === 1 ? 'sub-category' : 'sub-categories'}
            </Text>
          </View>
          <View style={styles.summaryBadges}>
            <Badge
              label={`${sleevesWithComposition}/${roots.length} sleeves`}
              tone="accent"
            />
            <Badge
              label={validation.isValid ? 'Valid' : 'Needs attention'}
              tone={validation.isValid ? 'positive' : 'warning'}
            />
          </View>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          Roots decide the portfolio. Children explain how each sleeve is built and only
          trigger compliance when promoted. Target inputs are % of the immediate parent.
        </Text>

        <Pressable
          onPress={isDemo ? undefined : () => setAllowUnallocated((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ selected: allowUnallocated, disabled: isDemo }}
          style={[
            styles.modeRow,
            {
              backgroundColor: allowUnallocated ? colors.warningSoft : colors.cardMuted,
              borderColor: allowUnallocated ? colors.warning : colors.border,
            },
          ]}
        >
          <Feather
            name={allowUnallocated ? 'toggle-right' : 'toggle-left'}
            size={18}
            color={allowUnallocated ? colors.warning : colors.muted}
          />
          <View style={styles.modeText}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>
              {allowUnallocated ? 'Explicit Unallocated remainder' : 'Require 100% per parent'}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {allowUnallocated
                ? 'A parent may sum below 100%; the remainder is shown and saved explicitly.'
                : 'Every parent with children must total 100% before saving.'}
            </Text>
          </View>
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
        const parentError = validation.parentErrors[root];
        const sum = validation.sumByParent[root];
        const unallocated = validation.unallocatedByParent[root];

        return (
          <View key={root}>
            <SectionHeader
              title={root}
              subtitle={`${formatPercent(rootTarget)} of portfolio · range ${formatPercent(
                range.min,
              )}–${formatPercent(range.max)}`}
              actionLabel="Add sub-category"
              onAction={isDemo ? undefined : () => openAdd(root)}
            />

            <Card style={styles.sleeveCard}>
              <View style={styles.sleeveHeader}>
                <View
                  style={[
                    styles.sleeveDot,
                    { backgroundColor: colorForSleeve(root, indexValue) },
                  ]}
                />
                <View style={styles.sleeveTitle}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>
                    Current {formatPercent(rootCurrentPct)}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatCompactINR(rootCurrentValue)} · target{' '}
                    {formatCompactINR((totalValue * rootTarget) / 100)}
                  </Text>
                </View>
                <Badge
                  label={`${formatPercent(coverage, {})} covered`}
                  tone={coverage >= 95 ? 'positive' : coverage > 0 ? 'warning' : 'neutral'}
                />
              </View>

              {tree.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    No sub-categories yet. Add the groups you use to implement this sleeve;
                    nothing is created automatically.
                  </Text>
                </View>
              ) : (
                <View style={styles.tree}>
                  {tree.map((node) => renderRow(node))}
                </View>
              )}

              {addingAt === root ? renderAddForm(root) : null}

              {tree.length > 0 ? (
                <View style={[styles.sumRow, { borderTopColor: colors.border }]}>
                  <Text
                    style={[
                      type.caption,
                      {
                        color: parentError
                          ? colors.negative
                          : unallocated
                            ? colors.warning
                            : colors.positive,
                      },
                    ]}
                  >
                    {parentError
                      ? parentError
                      : unallocated
                        ? `Children ${formatPercent(sum)} · ${formatPercent(
                            unallocated,
                          )} explicit Unallocated`
                        : `Children total ${formatPercent(sum)} ✓`}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {tree.length} direct {tree.length === 1 ? 'group' : 'groups'}
                  </Text>
                </View>
              ) : null}
            </Card>
          </View>
        );
      })}

      <Card style={styles.footerCard}>
        <Text style={[type.bodyMedium, { color: colors.text }]}>What saving changes</Text>
        <Text style={[type.caption, { color: colors.muted }]}>
          The app creates a new policy version with the composition tree, explicit ranges
          and decision levels. Sleeve targets, bands, review cadence and the rebalance
          planner stay exactly as they are. Composition never creates a second risk budget
          unless you promote a node.
        </Text>
      </Card>

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
          Saving creates a new version. The allocation tab, donut, health card and
          rebalance planner remain root-only.
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
    const label = LEVELS.find((option) => option.key === entry.level);

    return (
      <View
        key={node.path}
        style={[
          styles.row,
          {
            borderLeftColor:
              entry.level === 'policy'
                ? colors.accent
                : entry.level === 'monitor'
                  ? colors.warning
                  : colors.border,
            marginLeft: Math.min(28, (node.depth - 1) * 12),
          },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={styles.rowTitle}>
            <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {node.label}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
              {node.hasHoldings
                ? `Current ${formatPercent(node.currentOfParent)} of parent · ${formatCompactINR(
                    node.currentValue,
                  )}`
                : 'Not detected in current holdings'}
            </Text>
          </View>
          <Badge
            label={node.hasHoldings ? label?.label ?? 'Composition' : 'Not detected'}
            tone={node.hasHoldings ? levelTone(entry.level) : 'neutral'}
          />
        </View>

        <View style={styles.weights}>
          <Text style={[type.caption, { color: colors.textSecondary }]}>
            Target {formatPercent(node.target)} of parent
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            = {formatPercent(effective[node.path] ?? node.effectiveTarget)} of portfolio
          </Text>
        </View>

        <View style={styles.rowInputs}>
          <View style={styles.inputGrow}>
            <TextField
              label="Target % of parent"
              value={entry.target}
              onChangeText={(value) => updateEntry(node.path, { target: value })}
              keyboardType="decimal-pad"
              inputMode="decimal"
              selectTextOnFocus
              editable={!isDemo}
              error={
                entry.target.trim() === ''
                  ? 'Required'
                  : validation.childErrors[node.path] && entry.target.trim() !== ''
                    ? validation.childErrors[node.path]
                    : undefined
              }
            />
          </View>
          {entry.level !== 'composition' ? (
            <>
              <View style={styles.inputThird}>
                <TextField
                  label="Min %"
                  value={entry.min}
                  onChangeText={(value) => updateEntry(node.path, { min: value })}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  selectTextOnFocus
                  editable={!isDemo}
                  error={rangeIssue && !rangeIssue.includes('outside') ? rangeIssue : undefined}
                />
              </View>
              <View style={styles.inputThird}>
                <TextField
                  label="Max %"
                  value={entry.max}
                  onChangeText={(value) => updateEntry(node.path, { max: value })}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  selectTextOnFocus
                  editable={!isDemo}
                  error={rangeIssue && !rangeIssue.includes('outside') ? rangeIssue : undefined}
                />
              </View>
            </>
          ) : null}
        </View>

        {rangeIssue ? (
          <Text style={[type.caption, { color: colors.negative }]}>{rangeIssue}</Text>
        ) : null}

        <View style={styles.levelRow}>
          {LEVELS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={entry.level === option.key}
              onPress={
                isDemo ? undefined : () => updateEntry(node.path, { level: option.key })
              }
            />
          ))}
        </View>
        <Text style={[type.caption, { color: colors.muted }]}>
          {label?.hint}. Ranges are effective % of the total portfolio.
        </Text>

        <View style={styles.actions}>
          <Button
            label="Add sub-category"
            onPress={() => openAdd(node.path)}
            variant="ghost"
            size="sm"
            icon="plus"
            disabled={isDemo}
          />
          <Button
            label="Remove"
            onPress={() => confirmRemove(node.path)}
            variant="ghost"
            size="sm"
            icon="trash-2"
            disabled={isDemo}
          />
        </View>

        {addingAt === node.path ? renderAddForm(node.path) : null}

        {node.children.length > 0 ? (
          <View style={styles.childTree}>
            {node.children.map((child) => renderRow(child))}
            <View style={styles.subSum}>
              <Text
                style={[
                  type.caption,
                  {
                    color: parentError
                      ? colors.negative
                      : unallocated
                        ? colors.warning
                        : colors.positive,
                  },
                ]}
              >
                {parentError
                  ? parentError
                  : unallocated
                    ? `Children ${formatPercent(sum)} · ${formatPercent(
                        unallocated,
                      )} explicit Unallocated`
                    : `Children total ${formatPercent(sum)} ✓`}
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
      <View style={[styles.addForm, { backgroundColor: colors.cardMuted }]}>
        <Text style={[type.label, { color: colors.muted }]}>
          New group under {parentPath.split(' > ').pop()}
        </Text>
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
        <TextField
          label="Sub-category name"
          placeholder="e.g. Domestic Equity"
          value={newName}
          onChangeText={(value) => {
            setNewName(value);
            setAddError(null);
          }}
          autoCapitalize="words"
          editable={!isDemo}
        />
        <TextField
          label="Target % of parent"
          placeholder="0"
          value={newTarget}
          onChangeText={(value) => {
            setNewTarget(value);
            setAddError(null);
          }}
          keyboardType="decimal-pad"
          inputMode="decimal"
          editable={!isDemo}
        />
        <View style={styles.levelRow}>
          {LEVELS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={newLevel === option.key}
              onPress={() => setNewLevel(option.key)}
            />
          ))}
        </View>
        {addError ? (
          <Text style={[type.caption, { color: colors.negative }]}>{addError}</Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Add group"
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
  summaryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  summaryText: { flex: 1, gap: 2 },
  summaryValue: { fontSize: 26, fontWeight: '600', letterSpacing: -0.4 },
  summaryBadges: { alignItems: 'flex-end', gap: space.xs },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  modeText: { flex: 1, gap: 2 },
  sleeveCard: { gap: space.md, padding: space.md },
  sleeveHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sleeveDot: { width: 8, height: 8, borderRadius: radius.full },
  sleeveTitle: { flex: 1, gap: 2 },
  empty: { paddingVertical: space.sm },
  tree: { gap: space.sm },
  row: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    gap: space.sm,
  },
  childTree: { gap: space.sm, marginTop: space.xs },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  rowTitle: { flex: 1, gap: 2 },
  weights: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rowInputs: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  inputGrow: { flex: 1.5 },
  inputThird: { flex: 1 },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sumRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  subSum: { paddingTop: space.xs },
  addForm: { gap: space.md, borderRadius: radius.lg, padding: space.md },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  footerCard: { gap: space.sm },
  saveBlock: { gap: space.md },
  saveHint: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
