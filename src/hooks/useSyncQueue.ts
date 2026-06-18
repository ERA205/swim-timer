import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncEvent, SyncKind } from '../../shared/types';

function createSyncId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useSyncQueue() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const removeEvent = useCallback(
    (id: string, delayMs = 2500) => {
      setTimeout(() => {
        setEvents((prev) => prev.filter((e) => e.id !== id));
        clearTimer(id);
      }, delayMs);
    },
    [clearTimer],
  );

  const startProgress = useCallback((id: string) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const progress = Math.min(90, 12 + elapsed / 40);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id && e.state === 'sending' ? { ...e, progress } : e,
        ),
      );
    }, 80);
    timersRef.current.set(id, timer);
  }, []);

  const beginSync = useCallback(
    (kind: SyncKind, label: string, recordedLocally = false): string => {
      const id = createSyncId();
      setEvents((prev) => [
        ...prev,
        { id, kind, label, state: 'sending', progress: 12, recordedLocally },
      ]);
      startProgress(id);
      return id;
    },
    [startProgress],
  );

  const trackSync = useCallback(
    (id: string, kind: SyncKind, label: string): void => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === id)) return prev;
        return [
          ...prev,
          { id, kind, label, state: 'sending', progress: 12, recordedLocally: false },
        ];
      });
      startProgress(id);
    },
    [startProgress],
  );

  const confirmSync = useCallback(
    (id: string) => {
      clearTimer(id);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, state: 'confirmed', progress: 100 } : e,
        ),
      );
      removeEvent(id);
    },
    [clearTimer, removeEvent],
  );

  const failSync = useCallback(
    (id: string) => {
      clearTimer(id);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, state: 'failed', progress: 100 } : e,
        ),
      );
      removeEvent(id, 4000);
    },
    [clearTimer, removeEvent],
  );

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearInterval(timer));
    timersRef.current.clear();
    setEvents([]);
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearInterval(timer));
      timersRef.current.clear();
    };
  }, []);

  return { events, beginSync, trackSync, confirmSync, failSync, clearAll };
}
