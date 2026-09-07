// Socket.io client for HomeInTown Mobile.
// The server accepts the JWT via socket.handshake.auth.token (same token
// used for REST Bearer auth — no cookie needed on mobile).

import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';
import { tokenStorage } from './storage';

// Base URL = API_URL without the "/api" suffix
const WS_URL = API_URL.replace(/\/api$/, '');

let _socket: Socket | null = null;

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

  _socket.on('connect', () => console.log('[Socket] connected', _socket?.id));
  _socket.on('disconnect', (reason) => console.log('[Socket] disconnected', reason));
  _socket.on('error', (err) => console.warn('[Socket] error', err));

  return _socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
