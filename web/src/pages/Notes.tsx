// Notes — the Shared Notes port: tabs of live-synced sticky notes (Yjs CRDT,
// character-by-character), checklists whose items promote to scored tasks
// (integration #3), colors, and presence dots.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { NoteTab } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorNote, Spinner } from '../components/ui';
import { NotesConnection, applyTextDiff, type ConnStatus } from '../lib/yclient';

const SWATCHES = ['#f6e7a9', '#f3c5a8', '#c9e4c5', '#b8d8e8', '#dcc8e8', '#e8c8c8', ''];

export default function NotesPage() {
  const { user } = useAuth();
  const [tabs, setTabs] = useState<NoteTab[] | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(
    () => localStorage.getItem('lodestar-notes-tab'),
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [peers, setPeers] = useState<Array<{ name: string; color: string }>>([]);
  const connRef = useRef<NotesConnection | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const loadTabs = useCallback(async () => {
    try {
      const d = await api.get<{ tabs: NoteTab[] }>('/api/notes/tabs');
      setTabs(d.tabs);
      setActiveTab((cur) => {
        const next = cur && d.tabs.some((t) => t.id === cur) ? cur : (d.tabs[0]?.id ?? null);
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadTabs();
  }, [loadTabs]);

  // (re)connect when the active tab changes
  useEffect(() => {
    if (!activeTab) return;
    localStorage.setItem('lodestar-notes-tab', activeTab);
    const conn = new NotesConnection(activeTab, setStatus);
    connRef.current = conn;
    conn.awareness.setLocalState({ name: user?.display_name, color: user?.color });
    const onDoc = () => rerender();
    const onAwareness = () => {
      const others: Array<{ name: string; color: string }> = [];
      conn.awareness.getStates().forEach((state, clientId) => {
        if (clientId === conn.doc.clientID) return;
        if (state && typeof state.name === 'string') {
          others.push({ name: state.name, color: String(state.color ?? '#888') });
        }
      });
      setPeers(others);
    };
    conn.doc.on('update', onDoc);
    conn.awareness.on('change', onAwareness);
    return () => {
      conn.doc.off('update', onDoc);
      conn.awareness.off('change', onAwareness);
      conn.destroy();
      connRef.current = null;
      setPeers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const addTab = async () => {
    const name = prompt('Tab name?');
    if (!name?.trim()) return;
    await api.post('/api/notes/tabs', { name: name.trim() });
    await loadTabs();
  };

  const renameTab = async (tab: NoteTab) => {
    const name = prompt('Rename tab', tab.name);
    if (!name?.trim() || name === tab.name) return;
    await api.patch(`/api/notes/tabs/${tab.id}`, { name: name.trim() });
    await loadTabs();
  };

  const deleteTab = async (tab: NoteTab) => {
    if (!confirm(`Delete tab "${tab.name}" and all its notes?`)) return;
    await api.del(`/api/notes/tabs/${tab.id}`);
    await loadTabs();
  };

  const conn = connRef.current;
  const notesMap = conn?.doc.getMap<Y.Map<unknown>>('notes');

  const addNote = (checklist: boolean) => {
    if (!conn) return;
    const id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    conn.doc.transact(() => {
      const note = new Y.Map<unknown>();
      note.set('title', '');
      note.set('body', new Y.Text());
      note.set('items', new Y.Array());
      note.set('isChecklist', checklist);
      note.set('color', null);
      note.set('order', -Date.now());
      note.set('createdAt', Date.now());
      conn.doc.getMap<Y.Map<unknown>>('notes').set(id, note);
    });
  };

  // sorted [id, note] pairs
  const noteEntries: Array<[string, Y.Map<unknown>]> = [];
  notesMap?.forEach((note, id) => {
    if (note instanceof Y.Map) noteEntries.push([id, note]);
  });
  noteEntries.sort(
    (a, b) => Number(a[1].get('order') ?? 0) - Number(b[1].get('order') ?? 0),
  );

  if (!tabs) return <Spinner />;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="h-display text-3xl">
          <span className="mr-1 text-m-notes">❏</span>Notes
        </h1>
        <div className="flex items-center gap-1.5">
          {peers.map((p, i) => (
            <span
              key={i}
              title={`${p.name} is here`}
              className="inline-block h-3 w-3 rounded-full border border-ink"
              style={{ background: p.color }}
            />
          ))}
          <span
            className={`chip ${status === 'connected' ? 'border-m-habits text-m-habits' : 'border-[#a13d2d] text-[#a13d2d]'}`}
          >
            {status === 'connected' ? 'live' : status}
          </span>
        </div>
      </div>
      <p className="mb-3 text-sm text-muted">
        Shared corkboard — everyone sees keystrokes land live. Double-click a tab to rename.
      </p>

      <ErrorNote error={error} />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`chip cursor-pointer ${t.id === activeTab ? 'bg-m-notes text-ink' : ''}`}
            onClick={() => setActiveTab(t.id)}
            onDoubleClick={() => void renameTab(t)}
          >
            {t.name}
            {t.group_id && ' ⁂'}
            {t.id === activeTab && tabs.length > 1 && (
              <span
                className="ml-1 cursor-pointer opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteTab(t);
                }}
              >
                ✕
              </span>
            )}
          </button>
        ))}
        <button className="chip cursor-pointer" onClick={() => void addTab()}>
          + tab
        </button>
      </div>

      {!activeTab ? (
        <EmptyState icon="❏" title="No tabs yet" hint="Create one — Ideas, Shopping, Plans…" />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button className="btn-primary" onClick={() => addNote(false)}>
              + Note
            </button>
            <button className="btn-ghost" onClick={() => addNote(true)}>
              + Checklist
            </button>
          </div>
          {noteEntries.length === 0 ? (
            <EmptyState icon="✎" title="An empty corkboard" hint="Pin the first note." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {noteEntries.map(([id, note]) => (
                <NoteCard
                  key={id}
                  noteId={id}
                  note={note}
                  tabId={activeTab}
                  onDelete={() => {
                    conn?.doc.transact(() => {
                      conn.doc.getMap('notes').delete(id);
                    });
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NoteCard({
  noteId,
  note,
  tabId,
  onDelete,
}: {
  noteId: string;
  note: Y.Map<unknown>;
  tabId: string;
  onDelete: () => void;
}) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [promoted, setPromoted] = useState<string | null>(null);

  // observe THIS note deeply (title/body/items)
  useEffect(() => {
    const observer = () => rerender();
    note.observeDeep(observer);
    return () => note.unobserveDeep(observer);
  }, [note]);

  const title = typeof note.get('title') === 'string' ? (note.get('title') as string) : '';
  const body = note.get('body') instanceof Y.Text ? (note.get('body') as Y.Text) : null;
  const items = note.get('items') instanceof Y.Array ? (note.get('items') as Y.Array<Y.Map<unknown>>) : null;
  const isChecklist = note.get('isChecklist') === true;
  const color = typeof note.get('color') === 'string' ? (note.get('color') as string) : '';

  const promote = async (text: string) => {
    if (!text.trim()) return;
    await api.post('/api/notes/promote', { tab_id: tabId, note_id: noteId, text: text.trim() });
    setPromoted(text.trim());
    setTimeout(() => setPromoted(null), 1500);
  };

  const addItem = () => {
    note.doc?.transact(() => {
      const item = new Y.Map<unknown>();
      item.set('id', `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
      item.set('text', '');
      item.set('checked', false);
      items?.push([item]);
    });
  };

  return (
    <div className="card note-paper p-3" style={{ ['--note-color' as string]: color || undefined }}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          className="w-full bg-transparent font-display text-base font-bold focus:outline-none"
          placeholder="Title…"
          value={title}
          onChange={(e) => note.set('title', e.target.value)}
        />
        <button
          className="tap text-xs text-muted hover:text-ink"
          title={isChecklist ? 'Turn into prose' : 'Turn into checklist'}
          onClick={() => note.set('isChecklist', !isChecklist)}
        >
          {isChecklist ? '¶' : '☑'}
        </button>
        <button className="tap text-xs text-muted hover:text-[#a13d2d]" title="Delete note" onClick={onDelete}>
          ✕
        </button>
      </div>

      {isChecklist ? (
        <div>
          {items &&
            items.map((item, idx) => {
              const text = typeof item.get('text') === 'string' ? (item.get('text') as string) : '';
              const checked = item.get('checked') === true;
              return (
                <div key={String(item.get('id') ?? idx)} className="group mb-1 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => item.set('checked', e.target.checked)}
                  />
                  <input
                    className={`w-full bg-transparent text-sm focus:outline-none ${checked ? 'line-through opacity-60' : ''}`}
                    value={text}
                    placeholder="item…"
                    onChange={(e) => item.set('text', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addItem();
                      if (e.key === 'Backspace' && text === '') {
                        e.preventDefault();
                        note.doc?.transact(() => items.delete(idx, 1));
                      }
                    }}
                  />
                  <button
                    className="invisible text-xs text-m-tasks group-hover:visible"
                    title="Promote to scored task"
                    onClick={() => void promote(text)}
                  >
                    ◈→
                  </button>
                </div>
              );
            })}
          <button className="mt-1 text-xs text-muted hover:text-ink" onClick={addItem}>
            + item
          </button>
        </div>
      ) : (
        body && (
          <textarea
            className="min-h-[90px] w-full resize-y bg-transparent text-sm leading-relaxed focus:outline-none"
            placeholder="Write… (syncs live)"
            value={body.toString()}
            onChange={(e) => applyTextDiff(body, body.toString(), e.target.value)}
          />
        )
      )}

      <div className="mt-2 flex items-center gap-1 border-t border-line/60 pt-2">
        {SWATCHES.map((c) => (
          <button
            key={c || 'none'}
            className={`h-4 w-4 rounded-full border border-ink ${color === c ? 'ring-2 ring-gold' : ''}`}
            style={{ background: c || 'var(--panel)' }}
            title={c ? 'Tint' : 'No tint'}
            onClick={() => note.set('color', c || null)}
          />
        ))}
        {promoted && <span className="ml-auto text-xs text-m-tasks">→ task filed ✦</span>}
      </div>
    </div>
  );
}
