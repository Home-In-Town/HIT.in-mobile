import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

// Style keys read from BOTH sides of a phase-2 extraction. A child component must
// never import a style object out of GroupChatEmbedded.tsx (circular import), and
// duplicating a key would let the two copies drift, so anything with a reader on
// each side of the split lives here.

/** The property-card icon tile and price text. PostCard renders them, and so does
 *  the View Property detail sheet still inside GroupChatEmbedded. */
export const propertyCardShared = StyleSheet.create({
  cardIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  cardPrice: { fontSize: 14, fontWeight: '800', color: colors.brand },
});

/** Verbatim move of the component-local `cs` block out of GroupChatEmbedded.tsx:
 *  every one of these five keys was read only by Chips and SelectRow, which are
 *  now separate modules, and the parent reads none of them. Moving the block
 *  intact was lower risk than splitting four keys here and one module-local, and
 *  keeping the export named `cs` leaves both consumers' JSX unchanged. */
export const cs = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  chipTextOn: { color: '#fff' },
  selLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
});
