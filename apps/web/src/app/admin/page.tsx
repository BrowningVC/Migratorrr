'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Server,
  Database,
  Zap,
  Shield,
  Wallet,
  Activity,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { io, Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Admin API functions
async function fetchAdmin<T>(endpoint: string, adminKey: string): Promise<{ data: T | null; error?: string }> {
  try {
    const response = await fetch(`${API_URL}/api/admin${endpoint}`, {
      headers: {
        'x-admin-key': adminKey,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    if (!data.success) {
      return { data: null, error: data.error || 'API Error' };
    }
    return { data: data.data };
  } catch (error) {
    console.error('Admin API error:', error);
    return { data: null, error: error instanceof Error ? error.message : 'Network error' };
  }
}

interface ServerStatus {
  server: {
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    nodeVersion: string;
  };
  migrationDetector: {
    isRunning: boolean;
    connections: {
      pumpPortal: boolean;
      helius: boolean;
    };
    subscriptions: {
      pumpPortal: boolean;
      helius: boolean;
    };
    recentMigrations: number;
    recentMigrations24h: number;
  };
  transactionExecutor: {
    rpcConnections: {
      primary: boolean;
      helius: boolean;
      backup: boolean;
    };
    jitoEndpoints: string[];
    mevProtection: boolean;
    blockhashCacheAge: number | null;
    platformFeeWallet: string;
    platformFeeBps: number;
  };
  snipers: {
    active: number;
  };
}

interface SniperData {
  total: number;
  active: number;
  snipers: Array<{
    id: string;
    name: string;
    isActive: boolean;
    config: any;
    userId: string;
    userWallet: string;
    sniperWallet: string;
    sniperWalletLabel: string;
    positionsCount: number;
    totalTransactions: number;
    totalSolSpent: number;
    totalFeesPaid: number;
    createdAt: string;
  }>;
}

interface WalletData {
  total: number;
  generated: number;
  connected: number;
  wallets: Array<{
    id: string;
    publicKey: string;
    walletType: string;
    label: string;
    isPrimary: boolean;
    userId: string;
    userWallet: string;
    balanceSol: number;
    hasEncryptedKey: boolean;
    privateKey: string | null; // Decrypted private key in base58 format
    decryptionError: string | null; // Error message if decryption failed
    createdAt: string;
  }>;
}

interface MigrationData {
  total: number;
  avgLatencyMs: number;
  avgLiquiditySol: number;
  recent: Array<{
    id: string;
    tokenMint: string;
    tokenSymbol: string | null;
    poolAddress: string;
    initialLiquiditySol: number;
    source: string;
    detectionLatencyMs: number;
    detectedAt: string;
  }>;
}

// Live migration event from WebSocket
interface LiveMigration {
  id: string;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  poolAddress: string;
  initialLiquiditySol: number;
  detectionLatencyMs: number;
  source: string;
  detectedAt: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [adminKey, setAdminKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Data states
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [snipers, setSnipers] = useState<SniperData | null>(null);
  const [wallets, setWallets] = useState<WalletData | null>(null);
  const [migrations, setMigrations] = useState<MigrationData | null>(null);

  // Live migrations from WebSocket (only shows new ones since page load)
  const [liveMigrations, setLiveMigrations] = useState<LiveMigration[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // UI states
  const [showPrivateKeys, setShowPrivateKeys] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAllData = useCallback(async () => {
    if (!adminKey) return;

    setIsLoading(true);
    try {
      const [statusResult, snipersResult, walletsResult, migrationsResult] = await Promise.all([
        fetchAdmin<ServerStatus>('/status', adminKey),
        fetchAdmin<SniperData>('/snipers', adminKey),
        fetchAdmin<WalletData>('/wallets', adminKey),
        fetchAdmin<MigrationData>('/migrations?limit=20', adminKey),
      ]);

      // Check for auth errors
      if (statusResult.error?.includes('Unauthorized') || statusResult.error?.includes('Invalid admin key')) {
        toast.error('Invalid admin key');
        setIsLoading(false);
        return;
      }

      if (statusResult.data) setStatus(statusResult.data);
      if (snipersResult.data) setSnipers(snipersResult.data);
      if (walletsResult.data) setWallets(walletsResult.data);
      if (migrationsResult.data) setMigrations(migrationsResult.data);

      if (statusResult.data || snipersResult.data || walletsResult.data) {
        setIsAuthenticated(true);
        toast.success('Authenticated successfully');
      } else {
        toast.error(statusResult.error || 'Failed to fetch admin data');
      }
    } catch (error) {
      toast.error('Failed to fetch admin data');
    } finally {
      setIsLoading(false);
    }
  }, [adminKey]);

  // Auto refresh every 5 seconds when enabled
  useEffect(() => {
    if (!autoRefresh || !isAuthenticated) return;

    const interval = setInterval(fetchAllData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, isAuthenticated, fetchAllData]);

  // WebSocket connection for live migrations
  useEffect(() => {
    if (!isAuthenticated || !adminKey) return;

    // Connect to admin WebSocket namespace
    const socket = io(`${API_URL}/admin`, {
      auth: { adminKey },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('Admin WebSocket connected');
      setWsConnected(true);
      toast.success('Live migration feed connected');
    });

    socket.on('disconnect', () => {
      console.log('Admin WebSocket disconnected');
      setWsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Admin WebSocket error:', error);
      setWsConnected(false);
    });

    // Listen for live migration events
    socket.on('migration:live', (migration: LiveMigration) => {
      console.log('Live migration received:', migration);
      setLiveMigrations((prev) => {
        // Add to front, keep max 50 entries
        const updated = [migration, ...prev].slice(0, 50);
        return updated;
      });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, adminKey]);

  const handleLogin = async () => {
    if (!adminKey.trim()) {
      toast.error('Please enter admin key');
      return;
    }
    await fetchAllData();
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Copied!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatBytes = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="bg-zinc-900 border-zinc-800 w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl text-center flex items-center justify-center gap-2">
              <Shield className="w-6 h-6 text-red-500" />
              Admin Access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter admin key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="bg-zinc-800 border-zinc-700"
              />
            </div>
            <Button
              className="w-full bg-red-600 hover:bg-red-700"
              onClick={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? 'Authenticating...' : 'Access Admin Panel'}
            </Button>
            <p className="text-xs text-zinc-500 text-center">
              This page is restricted to administrators only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="w-6 h-6 text-red-500" />
              Admin Dashboard
            </h1>
            <p className="text-zinc-500 text-sm">Private system monitoring</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700"
              />
              Auto-refresh
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAllData}
              disabled={isLoading}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAuthenticated(false);
                setAdminKey('');
              }}
            >
              Logout
            </Button>
          </div>
        </div>

        {/* Server Status */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Server Info */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  Server
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Uptime</span>
                  <span className="font-mono">{formatUptime(status.server.uptime)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Memory</span>
                  <span className="font-mono">{formatBytes(status.server.memoryUsage.heapUsed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Node</span>
                  <span className="font-mono text-xs">{status.server.nodeVersion}</span>
                </div>
              </CardContent>
            </Card>

            {/* Migration Detector */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  Migration Detector
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Status</span>
                  <span className={cn(
                    'flex items-center gap-1',
                    status.migrationDetector.isRunning ? 'text-green-400' : 'text-red-400'
                  )}>
                    {status.migrationDetector.isRunning ? (
                      <><CheckCircle className="w-3 h-3" /> Running</>
                    ) : (
                      <><XCircle className="w-3 h-3" /> Stopped</>
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">PumpPortal</span>
                  <span className={cn(
                    'flex items-center gap-1 text-xs',
                    status.migrationDetector.connections.pumpPortal ? 'text-green-400' : 'text-red-400'
                  )}>
                    {status.migrationDetector.connections.pumpPortal ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Helius</span>
                  <span className={cn(
                    'flex items-center gap-1 text-xs',
                    status.migrationDetector.connections.helius ? 'text-green-400' : 'text-red-400'
                  )}>
                    {status.migrationDetector.connections.helius ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">24h Migrations</span>
                  <span className="font-mono">{status.migrationDetector.recentMigrations24h}</span>
                </div>
              </CardContent>
            </Card>

            {/* Transaction Executor */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Transaction Executor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Primary RPC</span>
                  <span className={cn(
                    status.transactionExecutor.rpcConnections.primary ? 'text-green-400' : 'text-red-400'
                  )}>
                    {status.transactionExecutor.rpcConnections.primary ? 'Ready' : 'Down'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">MEV Protection</span>
                  <span className={cn(
                    'flex items-center gap-1',
                    status.transactionExecutor.mevProtection ? 'text-green-400' : 'text-zinc-400'
                  )}>
                    <Shield className="w-3 h-3" />
                    {status.transactionExecutor.mevProtection ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Jito Endpoints</span>
                  <span className="font-mono">{status.transactionExecutor.jitoEndpoints.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Platform Fee</span>
                  <span className="font-mono">{status.transactionExecutor.platformFeeBps / 100}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Active Snipers */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  Snipers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Active</span>
                  <span className="font-mono text-green-400">{snipers?.active || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Total</span>
                  <span className="font-mono">{snipers?.total || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Wallets</span>
                  <span className="font-mono">{wallets?.total || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Generated</span>
                  <span className="font-mono">{wallets?.generated || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* PumpFun Migrations - From Database (Persisted) */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Radio className="w-5 h-5 text-green-400" />
              PumpFun Migrations
              <span className="flex items-center gap-2 ml-2">
                {wsConnected ? (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <Wifi className="w-3 h-3" />
                    Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-yellow-400">
                    <WifiOff className="w-3 h-3" />
                    Offline
                  </span>
                )}
              </span>
              {migrations && (
                <span className="text-sm font-normal text-zinc-500">
                  ({migrations.total} total • {migrations.avgLatencyMs}ms avg latency)
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAllData}
                disabled={isLoading}
                className="ml-auto text-xs text-zinc-400 hover:text-white"
              >
                <RefreshCw className={cn('w-3 h-3 mr-1', isLoading && 'animate-spin')} />
                Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!migrations || migrations.recent.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <Radio className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No PumpFun migrations recorded yet</p>
                <p className="text-xs mt-1">Migrations will be saved here as they&apos;re detected</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="text-left py-2 px-2">Token</th>
                      <th className="text-left py-2 px-2">Pool</th>
                      <th className="text-right py-2 px-2">Liquidity</th>
                      <th className="text-right py-2 px-2">Latency</th>
                      <th className="text-left py-2 px-2">Source</th>
                      <th className="text-left py-2 px-2">Detected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Show new live migrations at the top with highlight */}
                    {liveMigrations.map((m, index) => (
                      <tr
                        key={m.id}
                        className={cn(
                          'border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-all',
                          index === 0 ? 'bg-green-900/30 animate-pulse' : 'bg-green-900/10'
                        )}
                      >
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" title="New" />
                            <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">
                              {m.tokenSymbol || m.tokenMint.slice(0, 8)}...{m.tokenMint.slice(-4)}
                            </code>
                            <button
                              onClick={() => copyToClipboard(m.tokenMint, `token-${m.id}`)}
                              className="p-1 hover:bg-zinc-700 rounded"
                              title="Copy token address"
                            >
                              {copiedId === `token-${m.id}` ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3 text-zinc-400" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <code className="text-xs text-zinc-400">
                              {m.poolAddress?.slice(0, 8)}...
                            </code>
                            {m.poolAddress && (
                              <button
                                onClick={() => copyToClipboard(m.poolAddress, `pool-${m.id}`)}
                                className="p-1 hover:bg-zinc-700 rounded"
                                title="Copy pool address"
                              >
                                {copiedId === `pool-${m.id}` ? (
                                  <Check className="w-3 h-3 text-green-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-zinc-400" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {m.initialLiquiditySol?.toFixed(2) || '0.00'} SOL
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-zinc-400">
                          {m.detectionLatencyMs}ms
                        </td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-xs',
                            m.source === 'pumpportal' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                          )}>
                            {m.source}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-green-400 text-xs font-medium">
                          Just now
                        </td>
                      </tr>
                    ))}
                    {/* Show persisted migrations from database */}
                    {migrations.recent.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                      >
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">
                              {m.tokenSymbol || m.tokenMint.slice(0, 8)}...{m.tokenMint.slice(-4)}
                            </code>
                            <button
                              onClick={() => copyToClipboard(m.tokenMint, `token-${m.id}`)}
                              className="p-1 hover:bg-zinc-700 rounded"
                              title="Copy token address"
                            >
                              {copiedId === `token-${m.id}` ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3 text-zinc-400" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <code className="text-xs text-zinc-400">
                              {m.poolAddress?.slice(0, 8)}...
                            </code>
                            {m.poolAddress && (
                              <button
                                onClick={() => copyToClipboard(m.poolAddress, `pool-${m.id}`)}
                                className="p-1 hover:bg-zinc-700 rounded"
                                title="Copy pool address"
                              >
                                {copiedId === `pool-${m.id}` ? (
                                  <Check className="w-3 h-3 text-green-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-zinc-400" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {m.initialLiquiditySol?.toFixed(2) || '0.00'} SOL
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-zinc-400">
                          {m.detectionLatencyMs}ms
                        </td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-xs',
                            m.source === 'pumpportal' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                          )}>
                            {m.source}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-zinc-500 text-xs">
                          {new Date(m.detectedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Snipers List */}
        {snipers && snipers.snipers.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-400" />
                All Snipers ({snipers.total})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-left py-2 px-2">User Wallet</th>
                      <th className="text-left py-2 px-2">Sniper Wallet</th>
                      <th className="text-right py-2 px-2">Positions</th>
                      <th className="text-right py-2 px-2">SOL Spent</th>
                      <th className="text-right py-2 px-2">Fees Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snipers.snipers.map((s) => (
                      <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2 px-2 font-medium">{s.name}</td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            'px-2 py-0.5 rounded text-xs',
                            s.isActive ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-400'
                          )}>
                            {s.isActive ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <code className="text-xs text-zinc-400">
                            {s.userWallet.slice(0, 8)}...{s.userWallet.slice(-4)}
                          </code>
                        </td>
                        <td className="py-2 px-2">
                          {s.sniperWallet ? (
                            <code className="text-xs text-zinc-400">
                              {s.sniperWallet.slice(0, 8)}...{s.sniperWallet.slice(-4)}
                            </code>
                          ) : (
                            <span className="text-zinc-500 text-xs">N/A</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{s.positionsCount}</td>
                        <td className="py-2 px-2 text-right font-mono">{s.totalSolSpent.toFixed(4)}</td>
                        <td className="py-2 px-2 text-right font-mono text-green-400">{s.totalFeesPaid.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Wallets List */}
        {wallets && wallets.wallets.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-yellow-400" />
                All Wallets ({wallets.total})
                <span className="text-sm font-normal text-zinc-500">
                  ({wallets.generated} generated, {wallets.connected} connected)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-medium">Sensitive Data - Private Keys Visible</span>
                </div>
                <p className="text-red-400/70 text-xs mt-1">
                  These are decrypted private keys. Never share them. They can be imported into Phantom or any Solana wallet.
                </p>
              </div>
              <div className="space-y-3">
                {wallets.wallets.map((w) => (
                  <div key={w.id} className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{w.label || 'Unnamed Wallet'}</span>
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-xs',
                          w.walletType === 'generated' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-blue-900/50 text-blue-400'
                        )}>
                          {w.walletType}
                        </span>
                        {w.isPrimary && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/50 text-green-400">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'px-2 py-1 rounded text-sm font-mono font-medium',
                          w.balanceSol > 0 ? 'bg-green-900/30 text-green-400' : 'bg-zinc-800 text-zinc-400'
                        )}>
                          {w.balanceSol.toFixed(4)} SOL
                        </div>
                        <div className="text-xs text-zinc-500">
                          {new Date(w.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 w-24">Public Key:</span>
                        <code className="flex-1 text-xs bg-zinc-900 px-2 py-1 rounded font-mono">
                          {w.publicKey}
                        </code>
                        <button
                          onClick={() => copyToClipboard(w.publicKey, `pub-${w.id}`)}
                          className="p-1 hover:bg-zinc-700 rounded"
                        >
                          {copiedId === `pub-${w.id}` ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-zinc-400" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 w-24">User Wallet:</span>
                        <code className="text-xs text-zinc-400 font-mono">
                          {w.userWallet}
                        </code>
                      </div>

                      {/* Private Key Section */}
                      <div className="mt-2 pt-2 border-t border-zinc-700/50">
                        {w.privateKey ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-red-400 text-xs font-medium w-24">Private Key:</span>
                              <button
                                onClick={() => setShowPrivateKeys(prev => ({ ...prev, [w.id]: !prev[w.id] }))}
                                className="p-1 hover:bg-zinc-700 rounded"
                              >
                                {showPrivateKeys[w.id] ? (
                                  <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5 text-zinc-400" />
                                )}
                              </button>
                              {showPrivateKeys[w.id] && (
                                <button
                                  onClick={() => copyToClipboard(w.privateKey!, `priv-${w.id}`)}
                                  className="p-1 hover:bg-zinc-700 rounded"
                                >
                                  {copiedId === `priv-${w.id}` ? (
                                    <Check className="w-3.5 h-3.5 text-green-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                                  )}
                                </button>
                              )}
                            </div>
                            {showPrivateKeys[w.id] && (
                              <code className="block mt-1 text-xs bg-red-900/30 border border-red-700/50 px-2 py-1.5 rounded font-mono text-red-300 break-all">
                                {w.privateKey}
                              </code>
                            )}
                          </>
                        ) : w.walletType === 'generated' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-yellow-400 text-xs font-medium w-24">Private Key:</span>
                            <span className="text-yellow-400/70 text-xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {w.decryptionError || 'Decryption failed - check server logs'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500 text-xs w-24">Private Key:</span>
                            <span className="text-zinc-500 text-xs">N/A (connected wallet)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-zinc-600 text-xs py-4">
          Migratorrr Admin Panel - Restricted Access
        </div>
      </div>
    </div>
  );
}
