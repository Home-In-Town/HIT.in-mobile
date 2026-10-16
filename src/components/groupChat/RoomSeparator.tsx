import React from 'react';
import { View } from 'react-native';
import { colors } from '../../theme';

const RoomSeparator = () => (
  <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 64 }} />
);

export default RoomSeparator;
