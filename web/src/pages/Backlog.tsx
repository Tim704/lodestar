// Backlog — the Hoard port: seven domains, five statuses, 1–10 ratings,
// external search (OpenLibrary/Jikan/TMDB), and the AI critic.

import { useCallback, useEffect, useState } from 'react';
import type { MediaDomain, MediaItem, MediaSearchResult, MediaStatus } from '@lodestar/shared';
import { MEDIA_DOMAINS } from '@lodestar/shared';
import { api } from '../api';
import { EmptyState, ErrorNote, Modal, Spinner, Telegram } from '../components/ui';

const DOMAIN_META: Record<MediaDomain, { icon: string; label: string }> = {
  book: { icon: '📖', label: 'Books' },
  movie: { icon: '🎬', label: 'Movies' },
  tv: { icon: '📺', label: 'TV' },
  anime: { icon: '✨', label: 'Anime' },
  manga: { icon: '📚', label: 'Manga' },
  game: { icon: '🎮', label: 'Games' },
  music: { icon: '💿', label: 'Music' },
};

const STATUS_LABEL: Record<MediaStatus, string> = {
  PLANNED: 'Planned',
  CONSUMING: 'In progress',
  COMPLETED: 'Done',
  DROPPED: 'Dropped',
  ON_HOLD: 'On hold',
};

export default function BacklogPage() {
  const [domain, setDomain] = useState<MediaDomain>('book');
  const [status, setStatus] = useState<MediaStatus | ''>('');
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);
  const [critiqueBusy, setCritiqueBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ domain });
      if (status) params.set('status', status);
      const d = await api.get<{ items: MediaItem[] }>(`/api/media?${params}`);
      setItems(d.items);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [domain, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (id: string, patch: Partial<MediaItem>) => {
    await api.patch(`/api/media/${id}`, patch);
    void load();
  };

  const runCritic = async () => {
    setCritiqueBusy(true);
    try {
      const d = await api.post<{ critique: string }>('/api/media/critic', { domain });
      setCritique(d.critique);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCritiqueBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="h-display text-3xl">
          <span className="mr-1 text-m-backlog">☰</span>Backlog
        </h1>
        <button className="btn-ghost !py-1 text-xs" onClick={() => void runCritic()} disabled={critiqueBusy}>
          {critiqueBusy ? 'Judging…' : '🔥 Consult the critic'}
        </button>
      </div>
      <p className="mb-4 text-sm text-muted">
        Everything you mean to read, watch and play — tracked, rated, and gently roasted.
      </p>

      <ErrorNote error={error} />

      {critique && (
        <div className="card mb-4 border-m-backlog p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="h-display text-lg">The critic files a note</h2>
            <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setCritique(null)}>
              ✕
            </button>
          </div>
          <Telegram md={critique} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {MEDIA_DOMAINS.map((d) => (
          <button
            key={d}
            className={`chip cursor-pointer ${d === domain ? 'bg-m-backlog text-white' : ''}`}
            onClick={() => setDomain(d)}
          >
            {DOMAIN_META[d].icon} {DOMAIN_META[d].label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          className={`chip cursor-pointer ${status === '' ? 'bg-ink text-paper' : ''}`}
          onClick={() => setStatus('')}
        >
          all
        </button>
        {(Object.keys(STATUS_LABEL) as MediaStatus[]).map((s) => (
          <button
            key={s}
            className={`chip cursor-pointer ${status === s ? 'bg-ink text-paper' : ''}`}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button className="btn-primary ml-auto !py-1 text-xs" onClick={() => setAdding(true)}>
          + Add {DOMAIN_META[domain].label.replace(/s$/, '').toLowerCase()}
        </button>
      </div>

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={DOMAIN_META[domain].icon}
          title={`No ${DOMAIN_META[domain].label.toLowerCase()} here`}
          hint="Suspiciously virtuous. Add something."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((m) => (
            <div key={m.id} className="card-flat flex gap-3 p-3">
              {m.image_url ? (
                <img src={m.image_url} alt="" className="h-24 w-16 shrink-0 border border-ink object-cover" />
              ) : (
                <div className="flex h-24 w-16 shrink-0 items-center justify-center border border-ink bg-paper text-2xl">
                  {DOMAIN_META[m.domain].icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{m.title}</div>
                    <div className="truncate text-xs text-muted">
                      {[m.creator, m.year].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    className={`shrink-0 text-lg ${m.favorite ? 'text-gold' : 'text-line hover:text-gold'}`}
                    title="Favourite"
                    onClick={() => void update(m.id, { favorite: !m.favorite })}
                  >
                    ✦
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <select
                    className="input !w-auto !px-1.5 !py-0.5 text-xs"
                    value={m.status}
                    onChange={(e) => void update(m.id, { status: e.target.value as MediaStatus })}
                  >
                    {(Object.keys(STATUS_LABEL) as MediaStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <select
                    className="input !w-auto !px-1.5 !py-0.5 text-xs"
                    value={m.rating ?? ''}
                    onChange={(e) =>
                      void update(m.id, { rating: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    <option value="">☆ rate</option>
                    {Array.from({ length: 10 }, (_, i) => 10 - i).map((r) => (
                      <option key={r} value={r}>{r}/10</option>
                    ))}
                  </select>
                  <button
                    className="ml-auto text-xs text-muted hover:text-[#a13d2d]"
                    onClick={() => {
                      if (confirm(`Remove "${m.title}"?`)) void api.del(`/api/media/${m.id}`).then(load);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddModal
          domain={domain}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddModal({
  domain,
  onClose,
  onAdded,
}: {
  domain: MediaDomain;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MediaSearchResult[] | null>(null);
  const [manualOnly, setManualOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCreator, setManualCreator] = useState('');
  const [manualYear, setManualYear] = useState('');

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.get<{ results: MediaSearchResult[]; manual_only: boolean }>(
        `/api/media/search?domain=${domain}&q=${encodeURIComponent(q.trim())}`,
      );
      setResults(d.results);
      setManualOnly(d.manual_only);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (r: MediaSearchResult) => {
    setError(null);
    try {
      await api.post('/api/media', r);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addManual = async () => {
    setError(null);
    try {
      await api.post('/api/media', {
        domain,
        title: manualTitle,
        creator: manualCreator || null,
        year: manualYear ? Number(manualYear) : null,
      });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={`Add ${DOMAIN_META[domain].label.toLowerCase()}`} onClose={onClose} wide>
      <ErrorNote error={error} />
      <div className="mb-3 flex gap-2">
        <input
          className="input"
          placeholder={`Search ${DOMAIN_META[domain].label.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          autoFocus
        />
        <button className="btn-primary" onClick={() => void search()} disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
      </div>

      {manualOnly && (
        <p className="mb-3 text-xs text-muted">
          No search source for this domain (games/music need API keys) — add it manually below.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="mb-4 max-h-64 space-y-1.5 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.external_source}:${r.external_id}`}
              className="card-flat flex w-full items-center gap-2 p-2 text-left hover:shadow-almanac-sm"
              onClick={() => void add(r)}
            >
              {r.image_url ? (
                <img src={r.image_url} alt="" className="h-14 w-10 border border-ink object-cover" />
              ) : (
                <div className="flex h-14 w-10 items-center justify-center border border-ink bg-paper">
                  {DOMAIN_META[domain].icon}
                </div>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {[r.creator, r.year].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="btn-ghost ml-auto !px-2 !py-0.5 text-xs">add</span>
            </button>
          ))}
        </div>
      )}
      {results && results.length === 0 && !manualOnly && (
        <p className="mb-3 text-sm text-muted">Nothing found — add it manually:</p>
      )}

      <div className="border-t border-line pt-3">
        <div className="label">Manual add</div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-40 flex-1"
            placeholder="Title"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
          />
          <input
            className="input !w-40"
            placeholder="Creator"
            value={manualCreator}
            onChange={(e) => setManualCreator(e.target.value)}
          />
          <input
            className="input !w-24"
            placeholder="Year"
            value={manualYear}
            onChange={(e) => setManualYear(e.target.value)}
          />
          <button className="btn-primary" onClick={() => void addManual()} disabled={!manualTitle.trim()}>
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}
