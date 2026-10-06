// useSocket — connects to Socket.io and exposes helper methods for
// 1:1 chat and group chat events. Reconnects when the auth token changes.

import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import {
  getSocket,
  trackJoinGroup, trackLeaveGroup,
  trackJoinChat, trackLeaveChat,
} from '../lib/socket';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  // Bumped when the socket finishes resolving. Consumers put this in their
  // effect deps so a subscription registered BEFORE the socket existed (which
  // used to be a silent no-op, leaving the screen with no realtime updates
  // until it was remounted) is retried once it is available.
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let mounted = true;
    getSocket().then(s => {
      if (!mounted) return;
      socketRef.current = s;
      setReady(n => n + 1);
    }).catch(() => { /* offline — helpers stay inert until a later mount */ });
    return () => {
      mounted = false;
      // Don't disconnect on unmount — socket is shared across screens.
      // Call disconnectSocket() explicitly on logout instead.
    };
  }, []);

  // ── 1:1 Chat ─────────────────────────────────────────────
  // Joins go through the tracker so they are replayed after a reconnect.
  const joinChat  = useCallback((sessionId: string) => trackJoinChat(sessionId), []);
  const leaveChat = useCallback((sessionId: string) => trackLeaveChat(sessionId), []);

  const sendMessage = useCallback((payload: { sessionId: string; content: string; messageType?: string }) => {
    socketRef.current?.emit('send_message', { ...payload, messageType: payload.messageType || 'text' });
  }, []);

  const sendTyping = useCallback((sessionId: string, isTyping: boolean) => {
    socketRef.current?.emit('typing', { sessionId, isTyping });
  }, []);

  const markRead = useCallback((sessionId: string) => {
    socketRef.current?.emit('mark_read', { sessionId });
  }, []);

  const onMessage = useCallback((handler: (msg: any) => void) => {
    const s = socketRef.current;
    s?.on('receive_message', handler);
    return () => { s?.off('receive_message', handler); };
  }, []);

  const onTyping = useCallback((handler: (data: any) => void) => {
    const s = socketRef.current;
    s?.on('user_typing', handler);
    return () => { s?.off('user_typing', handler); };
  }, []);

  const onNotification = useCallback((handler: (n: any) => void) => {
    const s = socketRef.current;
    s?.on('notification', handler);
    return () => { s?.off('notification', handler); };
  }, []);

  // ── Group Chat ────────────────────────────────────────────
  const joinGroup  = useCallback((roomId: string) => trackJoinGroup(roomId), []);
  const leaveGroup = useCallback((roomId: string) => trackLeaveGroup(roomId), []);

  const sendGroupMessage = useCallback((payload: { roomId: string; messageType?: string; content?: string; requirementCard?: any; inventoryCard?: any }) => {
    socketRef.current?.emit('group_send_message', { ...payload, messageType: payload.messageType || 'text' });
  }, []);

  const sendGroupTyping = useCallback((roomId: string, isTyping: boolean) => {
    socketRef.current?.emit('group_typing', { roomId, isTyping });
  }, []);

  const onGroupMessage = useCallback((handler: (msg: any) => void) => {
    const s = socketRef.current;
    s?.on('group_message', handler);
    return () => { s?.off('group_message', handler); };
  }, []);

  const onGroupTyping = useCallback((handler: (data: any) => void) => {
    const s = socketRef.current;
    s?.on('group_user_typing', handler);
    return () => { s?.off('group_user_typing', handler); };
  }, []);

  const onMatchResults = useCallback((handler: (data: any) => void) => {
    const s = socketRef.current;
    s?.on('match_results', handler);
    return () => { s?.off('match_results', handler); };
  }, []);

  const onGroupDeleted = useCallback((handler: (data: { roomId: string; message?: string }) => void) => {
    const s = socketRef.current;
    s?.on('group_deleted', handler);
    return () => { s?.off('group_deleted', handler); };
  }, []);

  /** A single message was removed from a group (media taken down, etc.). */
  const onGroupMessageDeleted = useCallback((handler: (data: { roomId: string; messageId: string }) => void) => {
    const s = socketRef.current;
    s?.on('group_message_deleted', handler);
    return () => { s?.off('group_message_deleted', handler); };
  }, []);

  /**
   * A group's profile picture was changed or cleared by one of its admins.
   * `avatar: null` means cleared — fall back to the default room-type icon.
   *
   * The server emits this on the `group_<roomId>` channel, which trackJoinGroup
   * already joins for the room the user currently has open. So this covers live
   * updates for THAT room only and is NOT a substitute for the `avatar` field
   * on the room payload: rows for every other group in the list are not
   * subscribed, and their authoritative value still arrives with GET /rooms.
   */
  const onGroupAvatarUpdated = useCallback((handler: (data: { roomId: string; avatar: { type: 'icon' | 'image'; value: string; key?: string | null } | null }) => void) => {
    const s = socketRef.current;
    s?.on('group_avatar_updated', handler);
    return () => { s?.off('group_avatar_updated', handler); };
  }, []);

  return {
    // 1:1
    joinChat, leaveChat, sendMessage, sendTyping, markRead,
    onMessage, onTyping, onNotification,
    // Group
    joinGroup, leaveGroup, sendGroupMessage, sendGroupTyping,
    onGroupMessage, onGroupTyping, onMatchResults, onGroupDeleted, onGroupMessageDeleted,
    onGroupAvatarUpdated,
    // Increments once the underlying socket is available. Include it in the deps
    // of any effect that subscribes, so the subscription is (re)attached rather
    // than silently no-op'ing when the socket wasn't ready on first run.
    ready,
    // Raw socket access if needed
    socket: socketRef,
  };
}
