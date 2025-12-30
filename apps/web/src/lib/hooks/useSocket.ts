'use client';

import { useEffect, useCallback } from 'react';
import { getSocket, connectSocket, disconnectSocket, SocketEventType, SocketEventData } from '../socket';
import { useActivityStore } from '../stores/activity';
import { usePositionsStore } from '../stores/positions';
import toast from 'react-hot-toast';

const toastConfig = {
  duration: 4000,
  position: 'top-right' as const,
};

export function useSocket(token: string | null) {
  const addActivity = useActivityStore((state) => state.addEntry);
  const updatePosition = usePositionsStore((state) => state.updatePosition);
  const updatePrice = usePositionsStore((state) => state.updatePrice);

  const handleEvent = useCallback(
    (eventType: SocketEventType, data: SocketEventData) => {
      // Add to activity log
      addActivity({
        eventType,
        eventData: data,
        timestamp: data.timestamp || new Date().toISOString(),
      });

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
            icon: '⏸️',
          });
          break;

        case 'migration:detected':
          toast(`New migration: $${data.tokenSymbol || data.tokenMint?.slice(0, 8)}`, {
            ...toastConfig,
            id: `migration-${data.tokenMint}`,
            icon: '🔔',
          });
          break;

        case 'migration:matched':
          toast(`Migration matches sniper "${data.sniperName}"`, {
            ...toastConfig,
            id: `match-${data.tokenMint}`,
            icon: '🎯',
          });
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
            icon: '🛑',
          });
          break;

        case 'position:trailing_stop':
          toast(`Trailing stop triggered for $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `ts-${data.tokenMint}`,
            icon: '📉',
          });
          break;

        case 'position:closed':
          toast.success(`Position closed: $${data.tokenSymbol}`, {
            ...toastConfig,
            id: `closed-${data.tokenMint}`,
          });
          if (data.positionId) {
            updatePosition(data.positionId as string, { status: 'closed' });
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
    [addActivity, updatePosition, updatePrice]
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
      'snipe:started',
      'snipe:submitted',
      'snipe:success',
      'snipe:failed',
      'snipe:retrying',
      'position:take_profit',
      'position:stop_loss',
      'position:trailing_stop',
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
