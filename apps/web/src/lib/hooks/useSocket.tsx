'use client';

import { useEffect, useCallback } from 'react';
import { getSocket, connectSocket, disconnectSocket, SocketEventType, SocketEventData } from '../socket';
import { useActivityStore } from '../stores/activity';
import { usePositionsStore } from '../stores/positions';
import { useMigrationsStore } from '../stores/migrations';
import toast from 'react-hot-toast';
import { Bell, Target, Pause, OctagonX, TrendingDown } from 'lucide-react';

const toastConfig = {
  duration: 4000,
  position: 'top-right' as const,
};

// Icon style for toast icons
const iconProps = { size: 18, strokeWidth: 2 };

export function useSocket(token: string | null) {
  const addActivity = useActivityStore((state) => state.addEntry);
  const addPosition = usePositionsStore((state) => state.addPosition);
  const updatePosition = usePositionsStore((state) => state.updatePosition);
  const removePosition = usePositionsStore((state) => state.removePosition);
  const updatePrice = usePositionsStore((state) => state.updatePrice);
  const addMigration = useMigrationsStore((state) => state.addMigration);
  const updateMigrationSnipeStatus = useMigrationsStore((state) => state.updateMigrationSnipeStatus);
  const updateMigrationMetadata = useMigrationsStore((state) => state.updateMigrationMetadata);

  const handleEvent = useCallback(
    (eventType: SocketEventType, data: SocketEventData) => {
      // Add to activity log (but NOT price updates - they're too frequent)
      if (eventType !== 'price:update') {
        addActivity({
          eventType,
          eventData: data,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }

      // Show toast based on event type
      const toastId = data.sniperId || eventType;

      switch (eventType) {
        case 'sniper:created':
          toast.success(`Sniper "${data.sniperName}" created`, {
            ...toastConfig,
            id: toastId,
          });
          break;

        case 'sniper:activated':
          toast.success(`Sniper "${data.sniperName}" activated`, {
            ...toastConfig,
            id: toastId,
          });
          break;

        case 'sniper:paused':
          toast(`Sniper "${data.sniperName}" paused`, {
            ...toastConfig,
            id: toastId,
            icon: <Pause {...iconProps} />,
          });
          break;

        case 'migration:detected':
          // Add to migrations store for tracking
          if (data.tokenMint) {
            addMigration({
              tokenMint: data.tokenMint,
              tokenSymbol: data.tokenSymbol || null,
              tokenName: data.tokenName || null,
              poolAddress: data.poolAddress,
              detectionLatencyMs: data.latencyMs || data.detectionLatencyMs,
              source: data.detectedBy || data.source || 'unknown',
              timestamp: data.timestamp || new Date().toISOString(),
            });
          }
          toast(`New migration: $${data.tokenSymbol || data.tokenMint?.slice(0, 8)}`, {
            ...toastConfig,
            id: `migration-${data.tokenMint}`,
            icon: <Bell {...iconProps} />,
          });
          break;

        case 'migration:matched':
          // Update migration with matched sniper info
          if (data.tokenMint) {
            updateMigrationSnipeStatus(data.tokenMint, {
              sniped: true,
              sniperId: data.sniperId,
              sniperName: data.sniperName,
            });
          }
          toast(`Migration matches sniper "${data.sniperName}"`, {
            ...toastConfig,
            id: `match-${data.tokenMint}`,
            icon: <Target {...iconProps} />,
          });
          break;

        case 'migration:update':
          // Update migration metadata (token symbol/name fetched asynchronously)
          if (data.tokenMint && (data.tokenSymbol || data.tokenName)) {
            updateMigrationMetadata(data.tokenMint, {
              tokenSymbol: data.tokenSymbol as string | undefined,
              tokenName: data.tokenName as string | undefined,
            });
          }
          break;

        case 'snipe:started':
          toast.loading(`Executing snipe for $${data.tokenSymbol}...`, {
            ...toastConfig,
            id: toastId,
          });
          break;

        case 'snipe:submitted':
          toast.loading(`Transaction submitted via ${data.path}...`, {
            ...toastConfig,
            id: toastId,
          });
          break;

        case 'snipe:success':
          // Update migration with success status
          if (data.tokenMint) {
            updateMigrationSnipeStatus(data.tokenMint, {
              sniped: true,
              snipeSuccess: true,
            });
          }
          toast.success(
            `Bought ${data.tokenAmount?.toLocaleString()} $${data.tokenSymbol} for ${data.solSpent} SOL`,
            {
              ...toastConfig,
              id: toastId,
              duration: 6000,
            }
          );
          break;

        case 'snipe:failed':
          // Update migration with failure status
          if (data.tokenMint) {
            updateMigrationSnipeStatus(data.tokenMint, {
              sniped: true,
              snipeSuccess: false,
              snipeError: data.error,
            });
          }
          toast.error(`Snipe failed: ${data.error}`, {
            ...toastConfig,
            id: toastId,
          });
          break;

        case 'snipe:retrying':
          toast.loading(
            `Retrying (${data.attempt}/${data.maxAttempts}) via ${data.path}...`,
            {
              ...toastConfig,
              id: toastId,
            }
          );
          break;

        case 'position:take_profit':
          toast.success(`Take profit hit! Selling $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `tp-${data.tokenMint}`,
            duration: 6000,
          });
          break;

        case 'position:stop_loss':
          toast(`Stop loss triggered for $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `sl-${data.tokenMint}`,
            icon: <OctagonX {...iconProps} />,
          });
          break;

        case 'position:trailing_stop':
          toast(`Trailing stop triggered for $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `ts-${data.tokenMint}`,
            icon: <TrendingDown {...iconProps} />,
          });
          break;

        case 'position:opened':
          // Add new position to store when a snipe succeeds
          if (data.id && data.tokenMint) {
            addPosition({
              id: data.id as string,
              tokenMint: data.tokenMint,
              tokenSymbol: data.tokenSymbol || null,
              tokenName: data.tokenName as string | undefined,
              entrySol: data.entrySol as number,
              entryPrice: data.entryPrice as number,
              entryMarketCap: data.entryMarketCap as number | null | undefined,
              entryTokenAmount: data.entryTokenAmount as number,
              currentTokenAmount: data.currentTokenAmount as number,
              status: 'open',
              createdAt: data.createdAt as string || new Date().toISOString(),
            });
            toast.success(`Position opened: $${data.tokenSymbol || data.tokenMint.slice(0, 8)}`, {
              ...toastConfig,
              id: `opened-${data.tokenMint}`,
            });
          }
          break;

        case 'position:manual_sell':
          toast.success(`Manually sold $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `manual-${data.tokenMint}`,
            duration: 6000,
          });
          break;

        case 'position:closed':
          // Only show toast if not manual (manual_sell already shows a toast)
          if (data.reason !== 'manual') {
            toast.success(`Position closed: $${data.tokenSymbol}`, {
              ...toastConfig,
              id: `closed-${data.tokenMint}`,
            });
          }
          if (data.positionId) {
            // Remove the position from the store when it's closed
            removePosition(data.positionId as string);
          }
          break;

        case 'price:update':
          // Silent - just update the store
          if (data.tokenMint && typeof data.currentPrice === 'number') {
            updatePrice(data.tokenMint, data.currentPrice);
          }
          break;
      }
    },
    [addActivity, addPosition, removePosition, updatePosition, updatePrice, addMigration, updateMigrationSnipeStatus, updateMigrationMetadata]
  );

  useEffect(() => {
    if (!token) return;

    connectSocket(token);
    const socket = getSocket();

    // Register event listeners
    const events: SocketEventType[] = [
      'sniper:created',
      'sniper:activated',
      'sniper:paused',
      'migration:detected',
      'migration:matched',
      'migration:update',
      'snipe:started',
      'snipe:submitted',
      'snipe:success',
      'snipe:failed',
      'snipe:retrying',
      'position:opened',
      'position:take_profit',
      'position:stop_loss',
      'position:trailing_stop',
      'position:manual_sell',
      'position:closed',
      'price:update',
    ];

    events.forEach((event) => {
      socket.on(event, (data: SocketEventData) => handleEvent(event, data));
    });

    socket.on('connect', () => {
      // Connection established silently
    });

    socket.on('disconnect', () => {
      // Disconnected - socket will auto-reconnect
    });

    socket.on('error', () => {
      toast.error('Connection error. Reconnecting...');
    });

    return () => {
      events.forEach((event) => {
        socket.off(event);
      });
      socket.off('connect');
      socket.off('disconnect');
      socket.off('error');
      disconnectSocket();
    };
  }, [token, handleEvent]);
}
