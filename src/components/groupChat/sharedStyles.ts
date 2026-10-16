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
