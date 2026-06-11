'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { buildWsUrl } from './api';
import { useToast } from '@/components/Toast';
import type { WsEvent, WsHotLead, WsSafetyWarning, WsDraftsReady } from './types';

type Listener = (event: WsEvent) => void;

interface WsContextValue {
  /** Subscribe to all websocket events; returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

export function WsProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const listenersRef = useRef<Set<Listener>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const closedRef = useRef(false);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const url = buildWsUrl();
      if (!url) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onmessage = (msg) => {
        let parsed: WsEvent;
        try {
          parsed = JSON.parse(msg.data as string) as WsEvent;
        } catch {
          return;
        }
        if (parsed.event === 'inbox.hot_lead') {
          const data = parsed.data as WsHotLead;
          const name =
            data.lead?.name ||
            [data.lead?.first_name, data.lead?.last_name].filter(Boolean).join(' ') ||
            'A prospect';
          toast.warning(
            `${name} is showing strong buying intent (priority ${Math.round(
              data.priority_score
            )}). Check the inbox.`,
            '🔥 Hot lead'
          );
        } else if (parsed.event === 'safety.warning') {
          const data = parsed.data as WsSafetyWarning;
          toast.error(
            `${data.message} (health score ${Math.round(data.health_score)})`,
            'Account safety warning'
          );
        } else if (parsed.event === 'drafts.ready') {
          const data = parsed.data as WsDraftsReady;
          toast.info(`${data.count} new drafts are ready for review.`, 'Drafts ready');
        }
        listenersRef.current.forEach((l) => {
          try {
            l(parsed);
          } catch {
            // ignore listener errors
          }
        });
      };

      ws.onclose = () => {
        wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(connect, 5000);
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWs must be used within WsProvider');
  return ctx;
}
