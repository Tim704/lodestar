// The notification bell (integration #7's read side).

import { useCallback, useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '@lodestar/shared';
import { api } from '../api';

export function Bell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ notifications: AppNotification[]; unread: number }>(
        '/api/notifications',
      );
      setItems(data.notifications);
      setUnread(data.unread);
    } catch {
      /* bell is best-effort */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 90_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const openAndRead = async () => {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      await api.post('/api/notifications/read');
      setUnread(0);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative !px-2.5" onClick={() => void openAndRead()} aria-label="Notifications">
        ◎
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-[#a13d2d] px-0.5 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto">
          <div className="border-b-2 border-ink px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Notifications
          </div>
          {items.length === 0 ? (
            <div className="p-4 text-sm text-muted">All quiet on this front.</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                className="block w-full border-b border-line px-3 py-2 text-left last:border-0 hover:bg-paper"
                onClick={() => {
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {DateTime.fromISO(n.created_at).toRelative({ style: 'narrow' })}
                  </span>
                </div>
                {n.body && <div className="mt-0.5 whitespace-pre-line text-xs text-muted">{n.body}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
