/**
 * Towers × floors × units-per-floor form that produces a UnitSetup.
 *
 * Controlled and stateless so the same form serves both the Add Project screen
 * (setup sent with the create call) and the detail sheet's Setup/Edit Units
 * (sent to PUT /projects/:id/units). Inputs are kept as strings in the draft so
 * a half-typed number does not snap to 0; draftToSetup converts on submit.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { colors, radius } from '../../theme';
import type { UnitSetup } from '../../lib/api';
import { previewUnitSetup } from '../../lib/units';

export interface UnitSetupDraft {
  towers: { name: string; floors: string; unitsPerFloor: string }[];
  bhk: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function emptyUnitDraft(bhk = ''): UnitSetupDraft {
  return { towers: [{ name: 'A', floors: '', unitsPerFloor: '' }], bhk };
}

export function draftFromSetup(s: UnitSetup): UnitSetupDraft {
  return {
    towers: s.towers.map(t => ({ name: t.name, floors: String(t.floors), unitsPerFloor: String(t.unitsPerFloor) })),
    bhk: s.bhk || '',
  };
}

export function draftToSetup(d: UnitSetupDraft): UnitSetup {
  // Number('') is 0 and Number('4.5') is 4.5 — both are rejected by
  // previewUnitSetup / the server, which is what we want instead of rounding.
  return {
    towers: d.towers.map(t => ({ name: t.name.trim(), floors: Number(t.floors), unitsPerFloor: Number(t.unitsPerFloor) })),
    bhk: d.bhk.trim(),
  };
}

interface Props {
  value: UnitSetupDraft;
  onChange: (next: UnitSetupDraft) => void;
  bhkOptions?: string[];
}

export function UnitSetupForm({ value, onChange, bhkOptions = ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK'] }: Props) {
  const preview = previewUnitSetup(draftToSetup(value));
  const setTower = (i: number, patch: Partial<UnitSetupDraft['towers'][number]>) =>
    onChange({ ...value, towers: value.towers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const addTower = () => {
    const used = new Set(value.towers.map(t => t.name.trim().toUpperCase()));
    const next = [...LETTERS].find(l => !used.has(l)) || '';
    const last = value.towers[value.towers.length - 1];
    // Copy the previous tower's shape — most projects have identical towers.
    onChange({ ...value, towers: [...value.towers, { name: next, floors: last?.floors || '', unitsPerFloor: last?.unitsPerFloor || '' }] });
  };
  const removeTower = (i: number) => onChange({ ...value, towers: value.towers.filter((_, j) => j !== i) });
  const digits = (v: string) => v.replace(/[^0-9]/g, '');

  return (
    <View style={f.wrap}>
      <View style={f.headRow}>
        <Text style={[f.col, f.colName, f.head]}>Tower</Text>
        <Text style={[f.col, f.head]}>Floors</Text>
        <Text style={[f.col, f.head]}>Units / floor</Text>
        <View style={{ width: 28 }} />
      </View>

      {value.towers.map((t, i) => (
        <View key={i} style={f.row}>
          <TextInput
            style={[f.input, f.colName]}
            value={t.name}
            onChangeText={v => setTower(i, { name: v.slice(0, 10) })}
            placeholder="A"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            accessibilityLabel={`Tower ${i + 1} name`}
          />
          <TextInput
            style={[f.input, f.col]}
            value={t.floors}
            onChangeText={v => setTower(i, { floors: digits(v) })}
            placeholder="12"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            accessibilityLabel={`Tower ${t.name || i + 1} floors`}
          />
          <TextInput
            style={[f.input, f.col]}
            value={t.unitsPerFloor}
            onChangeText={v => setTower(i, { unitsPerFloor: digits(v) })}
            placeholder="4"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            accessibilityLabel={`Tower ${t.name || i + 1} units per floor`}
          />
          <Pressable
            onPress={() => removeTower(i)}
            disabled={value.towers.length <= 1}
            hitSlop={6}
            style={[f.iconBtn, value.towers.length <= 1 && { opacity: 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel={`Remove tower ${t.name || i + 1}`}
          >
            <Trash2 size={16} color={colors.red} />
          </Pressable>
        </View>
      ))}

      {value.towers.length < 26 ? (
        <Pressable onPress={addTower} style={f.addBtn} accessibilityRole="button" accessibilityLabel="Add tower">
          <Plus size={14} color={colors.brand} />
          <Text style={f.addText}>Add Tower</Text>
        </Pressable>
      ) : null}

      <Text style={f.head}>BHK (optional)</Text>
      <View style={f.chips}>
        {bhkOptions.map(b => {
          const on = value.bhk === b;
          return (
            <Pressable
              key={b}
              onPress={() => onChange({ ...value, bhk: on ? '' : b })}
              style={[f.chip, on && f.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[f.chipText, on && f.chipTextOn]}>{b}</Text>
            </Pressable>
          );
        })}
      </View>

      {preview.error ? (
        <Text style={f.error}>{preview.error}</Text>
      ) : (
        <Text style={f.preview}>Total {preview.total} units · {preview.first} … {preview.last}</Text>
      )}
    </View>
  );
}

export default UnitSetupForm;

const f = StyleSheet.create({
  wrap: { gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  head: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  col: { flex: 1 },
  colName: { flex: 0.8 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.ink, backgroundColor: colors.white },
  iconBtn: { width: 28, alignItems: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  addText: { fontSize: 13, fontWeight: '600', color: colors.brand },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12, color: colors.ink },
  chipTextOn: { color: colors.white, fontWeight: '600' },
  preview: { fontSize: 12, fontWeight: '600', color: colors.greenText },
  error: { fontSize: 12, fontWeight: '600', color: colors.redText },
});
