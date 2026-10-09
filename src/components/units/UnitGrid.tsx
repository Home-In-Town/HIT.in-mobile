/**
 * GitHub-contributions-style unit grid for a flat project.
 *
 * One small square per unit, coloured by status; one row per floor (top floor
 * first) and one block per tower. Tapping a cell selects it and shows its
 * details in a strip under the grid. Editors also get the four status chips in
 * that strip — kept inline instead of a second Modal, because this grid lives
 * inside the property detail Modal and stacked Modals are unreliable on Android.
 */
import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme';
import type { ProjectUnit, UnitStatus } from '../../lib/api';
import { UNIT_STATUS, UNIT_STATUSES, groupUnits, statusMeta, summarizeUnits } from '../../lib/units';

const CELL = 18;
const GAP = 4;

interface Props {
  units: ProjectUnit[];
  canEdit: boolean;
  /** Resolves when the server accepted the change; rejects to keep the old status. */
  onChangeStatus?: (unit: ProjectUnit, status: UnitStatus) => Promise<void>;
  busyUnitId?: string | null;
}

function UnitGridInner({ units, canEdit, onChangeStatus, busyUnitId }: Props) {
  const towers = useMemo(() => groupUnits(units), [units]);
  const counts = useMemo(() => summarizeUnits(units), [units]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Look the selection up in the live array so a socket update re-renders the strip.
  const selected = useMemo(() => units.find(u => u._id === selectedId) || null, [units, selectedId]);

  if (!units.length) return null;

  const legend: { status: UnitStatus; n: number }[] = [
    { status: 'available', n: counts.available },
    { status: 'booked', n: counts.booked },
    { status: 'sold', n: counts.sold },
    { status: 'on-hold', n: counts.onHold },
  ];

  return (
    <View style={g.wrap}>
      <View style={g.headRow}>
        <Text style={g.title}>Unit Availability</Text>
        <Text style={g.total}>{counts.available}/{counts.total} vacant</Text>
      </View>

      <View style={g.legend}>
        {legend.map(l => (
          <View key={l.status} style={g.legendItem}>
            <View style={[g.legendDot, { backgroundColor: UNIT_STATUS[l.status].color }]} />
            <Text style={g.legendText}>{UNIT_STATUS[l.status].label} {l.n}</Text>
          </View>
        ))}
      </View>

      {towers.map(t => (
        <View key={t.tower} style={g.tower}>
          <Text style={g.towerName}>Tower {t.tower}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {t.floors.map(f => (
                <View key={f.floor} style={g.floorRow}>
                  <Text style={g.floorLabel}>{f.floor}</Text>
                  {f.units.map(u => {
                    const meta = statusMeta(u.status);
                    const isSel = u._id === selectedId;
                    return (
                      <Pressable
                        key={u._id}
                        onPress={() => setSelectedId(isSel ? null : u._id)}
                        hitSlop={2}
                        style={[g.cell, { backgroundColor: meta.color }, isSel && g.cellSel]}
                        accessibilityRole="button"
                        accessibilityLabel={`${u.label}, ${meta.label}`}
                        accessibilityState={{ selected: isSel }}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ))}

      {selected ? (
        <View style={g.detail}>
          <View style={g.detailHead}>
            <Text style={g.detailLabel}>{selected.label}</Text>
            {selected.bhk ? <Text style={g.detailSub}>· {selected.bhk}</Text> : null}
            <Text style={g.detailSub}>· Floor {selected.floor}</Text>
            <View style={{ flex: 1 }} />
            <View style={[g.pill, { backgroundColor: statusMeta(selected.status).color }]}>
              <Text style={g.pillText}>{statusMeta(selected.status).label}</Text>
            </View>
          </View>

          {canEdit && onChangeStatus ? (
            <View style={g.chips}>
              {UNIT_STATUSES.map(s => {
                const active = selected.status === s;
                const busy = busyUnitId === selected._id;
                return (
                  <Pressable
                    key={s}
                    disabled={active || busy}
                    onPress={() => { onChangeStatus(selected, s).catch(() => {}); }}
                    style={[g.chip, active && { backgroundColor: UNIT_STATUS[s].color, borderColor: UNIT_STATUS[s].color }, busy && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${selected.label} ${UNIT_STATUS[s].label}`}
                    accessibilityState={{ selected: active, disabled: active || busy }}
                  >
                    {!active ? <View style={[g.legendDot, { backgroundColor: UNIT_STATUS[s].color }]} /> : null}
                    <Text style={[g.chipText, active && { color: colors.white }]}>{UNIT_STATUS[s].label}</Text>
                  </Pressable>
                );
              })}
              {busyUnitId === selected._id ? <ActivityIndicator size="small" color={colors.brand} /> : null}
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={g.hint}>{canEdit ? 'Tap a box to change its status' : 'Tap a box to see the unit'}</Text>
      )}
    </View>
  );
}

export const UnitGrid = memo(UnitGridInner);
export default UnitGrid;

const g = StyleSheet.create({
  wrap: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  total: { fontSize: 12, fontWeight: '600', color: colors.greenText },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.muted2 },
  tower: { gap: 4 },
  towerName: { fontSize: 12, fontWeight: '700', color: colors.muted2 },
  floorRow: { flexDirection: 'row', alignItems: 'center', gap: GAP, marginBottom: GAP },
  floorLabel: { width: 22, fontSize: 10, color: colors.muted, textAlign: 'right', marginRight: 2 },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  cellSel: { borderWidth: 2, borderColor: colors.ink },
  detail: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 8 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  detailSub: { fontSize: 12, color: colors.muted2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  hint: { fontSize: 11, color: colors.muted },
});
