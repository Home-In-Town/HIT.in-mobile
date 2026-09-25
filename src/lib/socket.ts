// Socket.io client for HomeInTown Mobile.
// The server accepts the JWT via socket.handshake.auth.token (same token
// used for REST Bearer auth — no cookie needed on mobile).

import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';
import { tokenStorage } from './storage';

// Base URL = API_URL without the "/api" suffix
const WS_URL = API_URL.replace(/\/api$/, '');

let _socket: Socket | null = null;

// Rooms this client believes it is in.
//
// Server-side room membership belongs to the SOCKET, not the user — so after any
// reconnect the new socket is in no rooms at all. Nothing used to re-emit
// join_group/join_chat, which meant that after a brief network blip incoming
// messages stopped arriving for the rest of the session while the UI still
// looked healthy (REST sends kept working, so it read as "my messages send but
// I never receive"). Tracking membership here and replaying it on every
// 'connect' fixes it once for every consumer.
const joinedGroups = new Set<string>();
const joinedChats = new Set<string>();

function rejoinAll(s: Socket) {
  for (const roomId of joinedGroups) s.emit('join_group', roomId);
  for (const sessionId of joinedChats) s.emit('join_chat', sessionId);
}

/** Record + emit a group join, so it survives reconnects. */
export function trackJoinGroup(roomId: string) {
  if (!roomId) return;
  joinedGroups.add(roomId);
  _socket?.emit('join_group', roomId);
}

export function trackLeaveGroup(roomId: string) {
  if (!roomId) return;
  joinedGroups.delete(roomId);
  _socket?.emit('leave_group', roomId);
}

export function trackJoinChat(sessionId: string) {
  if (!sessionId) return;
  joinedChats.add(sessionId);
  _socket?.emit('join_chat', sessionId);
}

export function trackLeaveChat(sessionId: string) {
  if (!sessionId) return;
  joinedChats.delete(sessionId);
  _socket?.emit('leave_chat', sessionId);
}

export async function getSocket(): Promise<Socket> {
  if (_socket && _socket.connected) return _socket;

  const token = await tokenStorage.get();

  if (_socket) {
    // Update auth token and reconnect
    _socket.auth = { token };
    _socket.connect();
    return _socket;
  }

  _socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    timeout: 20000,
  });

  _socket.on('connect', () => {
    console.log('[Socket] connected', _socket?.id);
    // Fires on the initial connect AND on every automatic reconnect.
    if (_socket) rejoinAll(_socket);
  });
  _socket.on('disconnect', (reason) => console.log('[Socket] disconnected', reason));
  _socket.on('error', (err) => console.warn('[Socket] error', err));

  return _socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
  joinedGroups.clear();
  joinedChats.clear();
}
