import React, { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import type { GroupRoom } from '../../lib/api';
import { ROOM_ICON } from '../../lib/groupChat/rooms';
import { resolveRoomAvatar } from '../../lib/groupChat/avatars';
import type { RoomProfile } from '../../lib/groupChat/avatars';

/**
 * Renders a group's avatar: server picture if there is one, otherwise the cached
 * one, otherwise the room-type emoji.
 *
 * `cache` is named for what it is — the subordinate fallback — rather than the
 * old `profilePictures`, which read like the source of truth it is no longer.
 *
 * THIS IS THE ONLY PLACE AN AVATAR IS RENDERED. It used to serve the room list
 * row alone, while the thread header and the group-info sheet each hand-rolled
 * their own `<Image>` from the same resolved value. Those two copies had no
 * `onError` and never reached for `localUri`, so an unreachable R2 URL left a
 * blank circle on exactly the two surfaces the offline fallback was built for,
 * while the list row two taps away degraded correctly. Sharing the resolver was
 * not enough — the failure walk has to be shared too, so all three now come
 * through here.
 *
 * `size` is the emoji font size and the image diameter is derived from it, which
 * held for the list row but not for the other two (38 px image beside a 15 pt
 * emoji in the header, 70 px beside 30 pt in the sheet). `imageSize` overrides
 * the derived diameter so those call sites keep their existing pixel values
 * instead of being nudged to fit a formula.
 */
function RoomAvatar({ room, cache, size = 17, imageSize, style }: {
  room: GroupRoom;
  cache: Record<string, RoomProfile>;
  size?: number;
  imageSize?: number;
  style?: any;
}) {
  const profile = resolveRoomAvatar(room, cache);
  // There are TWO fallback hops now, not one. `value` is a remote R2 URL, so it
  // needs the network and can fail on a flight or a dead signal; `localUri` is
  // this device's own copy and needs nothing. So a failed remote load tries the
  // local copy first, and only when that ALSO fails do we degrade to the
  // room-type emoji. Never an empty circle, which is what a single hop produced.
  // `onError` is the only signal RN gives at render time, hence the state.
  const [failedRemote, setFailedRemote] = useState(false);
  const [failedLocal, setFailedLocal] = useState(false);
  // Reset on either URI changing, so picking a new picture clears a previous
  // failure instead of inheriting it.
  useEffect(() => { setFailedRemote(false); setFailedLocal(false); }, [profile?.value, profile?.localUri]);

  const dimension = imageSize ?? size * 2.7;
  const imageStyle = [{ width: dimension, height: dimension, borderRadius: dimension / 2 }, style];

  if (!room.isUniversal && profile) {
    if (profile.type === 'image' && !failedRemote) {
      return (
        <Image
          source={{ uri: profile.value }}
          style={imageStyle}
          resizeMode="cover"
          onError={() => setFailedRemote(true)}
        />
      );
    }
    if (profile.type === 'image' && profile.localUri && !failedLocal) {
      return (
        <Image
          source={{ uri: profile.localUri }}
          style={imageStyle}
          resizeMode="cover"
          onError={() => setFailedLocal(true)}
        />
      );
    }
    if (profile.type === 'icon') {
      return <Text style={{ fontSize: size }}>{profile.value}</Text>;
    }
  }

  return (
    <Text style={{ fontSize: size }}>
      {room.isUniversal ? '🌐' : (ROOM_ICON[room.roomType] || '💬')}
    </Text>
  );
}

export default RoomAvatar;
