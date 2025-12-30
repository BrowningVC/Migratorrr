// Shared types and utilities for Migratorrr

// ============================================
// Socket.IO Event Types
// ============================================

export type SocketEventType =
  | 'sniper:created'
  | 'sniper:activated'
  | 'sniper:paused'
  | 'sniper:deleted'
  | 'migration:detected'
  | 'migration:matched'
  | 'snipe:started'
  | 'snipe:submitted'
  | 'snipe:success'
  | 'snipe:failed'
  | 'snipe:retrying'
  | 'position:opened'
  | 'position:update'
  | 'position:tp_triggered'
  | 'position:sl_triggered'
  | 'position:closed'
  | 'price:update';

export interface BaseSocketEvent {
  type: SocketEventType;
  timestamp: number;
  userId: string;
}

export interface MigrationDetectedEvent extends BaseSocketEvent {
  type: 'migration:detected';
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  poolAddress: string;
  initialLiquiditySol: number;
  detectedBy: 'pumpportal' | 'helius' | 'raydium';
}

export interface SnipeStartedEvent extends BaseSocketEvent {
  type: 'snipe:started';
  snipeId: string;
  sniperId: string;
  sniperName: string;
  tokenMint: string;
  tokenSymbol: string;
  amountSol: number;
}

export interface SnipeSuccessEvent extends BaseSocketEvent {
  type: 'snipe:success';
  snipeId: string;
  positionId: string;
  tokenMint: string;
  tokenSymbol: string;
  amountSol: number;
  tokensReceived: number;
  pricePerToken: number;
  txSignature: string;
}

export interface SnipeFailedEvent extends BaseSocketEvent {
  type: 'snipe:failed';
  snipeId: string;
  tokenMint: string;
  tokenSymbol: string;
  reason: string;
  attempt: number;
  maxAttempts: number;
}

export interface SnipeRetryingEvent extends BaseSocketEvent {
  type: 'snipe:retrying';
  snipeId: string;
  tokenSymbol: string;
  attempt: number;
  maxAttempts: number;
  path: 'jito' | 'helius' | 'direct';
  newTip: number;
}

export interface PositionUpdateEvent extends BaseSocketEvent {
  type: 'position:update';
  positionId: string;
  tokenMint: string;
  tokenSymbol: string;
  currentPrice: number;
  entryPrice: number;
  pnlPercent: number;
  pnlSol: number;
}

export interface PositionClosedEvent extends BaseSocketEvent {
  type: 'position:closed' | 'position:tp_triggered' | 'position:sl_triggered';
  positionId: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  exitPrice: number;
  entrySol: number;
  exitSol: number;
  pnlSol: number;
  pnlPercent: number;
  txSignature: string;
}

// ============================================
// API Types
// ============================================

export interface User {
  id: string;
  walletAddress: string;
  createdAt: Date;
  lastLogin: Date | null;
}

export interface Wallet {
  id: string;
  userId: string;
  publicKey: string;
  walletType: 'connected' | 'generated';
  label: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface SniperConfig {
  id: string;
  userId: string;
  walletId: string;
  name: string;
  isActive: boolean;
  config: SniperParameters;
  createdAt: Date;
  updatedAt: Date;
}

// Sniper parameters - flexible for user customization
export interface SniperParameters {
  // Core parameters
  snipeAmountSol: number;
  slippageBps: number;
  priorityFeeSol: number;

  // Take profit / Stop loss
  takeProfitPct?: number;
  stopLossPct?: number;
  trailingStopPct?: number;

  // Filters (optional - you can add more)
  maxMarketCapUsd?: number;
  minLiquiditySol?: number;
  namePatterns?: string[];
  excludedPatterns?: string[];
  creatorWhitelist?: string[];

  // Additional custom parameters can be added here
  [key: string]: unknown;
}

export interface Position {
  id: string;
  userId: string;
  walletId: string;
  sniperId: string | null;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  entryAmount: number;
  entrySol: number;
  currentAmount: number;
  status: 'open' | 'closed' | 'liquidated';
  tpPrice: number | null;
  slPrice: number | null;
  highestPrice: number | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface Transaction {
  id: string;
  userId: string;
  positionId: string | null;
  signature: string;
  txType: 'buy' | 'sell' | 'take_profit' | 'stop_loss';
  tokenMint: string;
  solAmount: number;
  tokenAmount: number;
  platformFee: number;
  jitoTip: number;
  status: 'pending' | 'confirmed' | 'failed';
  errorMessage: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  sniperId: string | null;
  eventType: SocketEventType;
  eventData: Record<string, unknown>;
  createdAt: Date;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================
// Auth Types
// ============================================

export interface AuthChallenge {
  nonce: string;
  message: string;
  expiresAt: number;
}

export interface AuthSession {
  userId: string;
  walletAddress: string;
  token: string;
  expiresAt: number;
}

// ============================================
// Constants
// ============================================

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const DEFAULT_SNIPER_CONFIG: Partial<SniperParameters> = {
  snipeAmountSol: 0.1,
  slippageBps: 500, // 5%
  priorityFeeSol: 0.001,
  takeProfitPct: 100, // 2x
  stopLossPct: 50, // -50%
};

// ============================================
// Utility Functions
// ============================================

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatPnl(pnlPercent: number): string {
  const sign = pnlPercent >= 0 ? '+' : '';
  return `${sign}${pnlPercent.toFixed(2)}%`;
}

export function formatSol(sol: number, decimals = 4): string {
  return `${sol.toFixed(decimals)} SOL`;
}
