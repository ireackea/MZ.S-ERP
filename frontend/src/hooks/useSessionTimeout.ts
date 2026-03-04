// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SessionTimeoutOptions {
  timeoutMinutes?: number;
  warningMinutes?: number;
  onTimeout?: () => void;
}

const STORAGE_KEY_LAST_ACTIVITY = 'feed_factory_last_activity_at';

export const useSessionTimeout = (options?: SessionTimeoutOptions) => {
  const timeoutMs = (options?.timeoutMinutes ?? 30) * 60 * 1000;
  const warningMs = (options?.warningMinutes ?? 5) * 60 * 1000;
  const onTimeoutRef = useRef(options?.onTimeout);
  const [remainingMs, setRemainingMs] = useState(timeoutMs);

  onTimeoutRef.current = options?.onTimeout;

  const updateActivity = useCallback(() => {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(now));
  }, []);

  const getLastActivity = useCallback(() => {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(now));
      return now;
    }
    return value;
  }, []);

  const extendSession = useCallback(() => {
    updateActivity();
    setRemainingMs(timeoutMs);
  }, [timeoutMs, updateActivity]);

  useEffect(() => {
    const events: Array<keyof WindowEventMap> = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    const handler = () => updateActivity();
    events.forEach((eventName) => window.addEventListener(eventName, handler, { passive: true }));

    const timer = setInterval(() => {
      const elapsed = Date.now() - getLastActivity();
      const left = Math.max(0, timeoutMs - elapsed);
      setRemainingMs(left);

      if (left <= 0) {
        if (onTimeoutRef.current) onTimeoutRef.current();
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, handler));
    };
  }, [getLastActivity, timeoutMs, updateActivity]);

  const isExpiringSoon = remainingMs > 0 && remainingMs <= warningMs;

  const remainingSeconds = useMemo(() => Math.ceil(remainingMs / 1000), [remainingMs]);

  return {
    remainingSeconds,
    isExpiringSoon,
    extendSession,
  };
};
