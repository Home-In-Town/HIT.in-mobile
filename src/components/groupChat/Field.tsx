import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';

function Field({ label, required, flex, children }: { label: string; required?: boolean; flex?: boolean; children: React.ReactNode }) {
  return (
    <View style={[{ gap: 7 }, flex && { flex: 1 }]}>
      <Text style={sh.label}>{label}{required ? <Text style={{ color: colors.red }}> *</Text> : null}</Text>
      {children}
    </View>
  );
}

// Kept the object name `sh` so the JSX body above is unchanged from when this
// lived in GroupChatEmbedded.tsx. `label` was the only `sh` key this component
// read (measured 1 reference), so it is module-local here; every other `sh` key
// belongs to RequirementSheet / InventorySheet, which stay in the parent.
const sh = StyleSheet.create({
  label: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
});

export default Field;
