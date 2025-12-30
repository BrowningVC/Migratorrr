import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectSocket(token: string): void {
  const s = getSocket();
  s.auth = { token };
  s.connect();
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
  }
}

export type SocketEventType =
  | 'sniper:created'
  | 'sniper:activated'
  | 'sniper:paused'
  | 'migration:detected'
  | 'migration:matched'
  | 'snipe:started'
  | 'snipe:submitted'
  | 'snipe:success'
  | 'snipe:failed'
  | 'snipe:retrying'
  | 'position:take_profit'
  | 'position:stop_loss'
  | 'position:trailing_stop'
  | 'position:closed'
  | 'price:update';

export interface SocketEventData {
  sniperId?: string;
  sniperName?: string;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenName?: string;
  signature?: string;
  tokenAmount?: number;
  solSpent?: number;
  currentPrice?: number;
  entryPrice?: number;
  pnlPct?: number;
  error?: string;
  attempt?: number;
  maxAttempts?: number;
  path?: string;
  timestamp?: string;
  [key: string]: unknown;
}
