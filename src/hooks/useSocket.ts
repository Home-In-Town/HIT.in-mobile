// useSocket — connects to Socket.io and exposes helper methods for
// 1:1 chat and group chat events. Reconnects when the auth token changes.

import { useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '../lib/socket';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let mounted = true;
    getSocket().then(s => {
      if (mounted) socketRef.current = s;
    });
    return () => {
      mounted = false;
      // Don't disconnect on unmount — socket is shared across screens.
      // Call disconnectSocket() explicitly on logout instead.
    };
  }, []);

  // ── 1:1 Chat ─────────────────────────────────────────────
  const joinChat  = useCallback((sessionId: string) => socketRef.current?.emit('join_chat', sessionId), []);
  const leaveChat = useCallback((sessionId: string) => socketRef.current?.emit('leave_chat', sessionId), []);

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
  const joinGroup  = useCallback((roomId: string) => socketRef.current?.emit('join_group', roomId), []);
  const leaveGroup = useCallback((roomId: string) => socketRef.current?.emit('leave_group', roomId), []);

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

  return {
    // 1:1
    joinChat, leaveChat, sendMessage, sendTyping, markRead,
    onMessage, onTyping, onNotification,
    // Group
    joinGroup, leaveGroup, sendGroupMessage, sendGroupTyping,
    onGroupMessage, onGroupTyping, onMatchResults,
    // Raw socket access if needed
    socket: socketRef,
  };
}
