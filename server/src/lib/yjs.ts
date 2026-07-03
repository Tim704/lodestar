// Yjs room manager — the Shared Notes port (CONTRACT §9). One Y.Doc per note
// tab, synced over WebSocket with the standard y-protocols sync + awareness
// messages, persisted (debounced) into note_tabs.ydoc as a merged update, with
// a plain-text projection refreshed into note_index for search/promotion.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import { query, queryOne } from '../db.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PERSIST_DEBOUNCE_MS = 2_000;

interface Room {
  tabId: string;
  doc: Y.Doc;
  awareness: Awareness;
  conns: Set<WebSocket>;
  persistTimer: NodeJS.Timeout | null;
  dirty: boolean;
}

const rooms = new Map<string, Room>();

function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState === 0 || conn.readyState === 1) {
    conn.send(message, (err) => {
      if (err) conn.close();
    });
  }
}

async function loadRoom(tabId: string): Promise<Room> {
  const existing = rooms.get(tabId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const row = await queryOne<{ ydoc: Buffer | null }>(
    'SELECT ydoc FROM note_tabs WHERE id = $1',
    [tabId],
  );
  if (row?.ydoc) Y.applyUpdate(doc, new Uint8Array(row.ydoc));

  const room: Room = {
    tabId,
    doc,
    awareness: new Awareness(doc),
    conns: new Set(),
    persistTimer: null,
    dirty: false,
  };

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of room.conns) {
      if (conn !== origin) send(conn, message);
    }
    room.dirty = true;
    schedulePersist(room);
  });

  room.awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(room.awareness, changed));
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns) send(conn, message);
    },
  );

  rooms.set(tabId, room);
  return room;
}

function schedulePersist(room: Room): void {
  if (room.persistTimer) return;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void persistRoom(room);
  }, PERSIST_DEBOUNCE_MS);
}

async function persistRoom(room: Room): Promise<void> {
  if (!room.dirty) return;
  room.dirty = false;
  try {
    const update = Buffer.from(Y.encodeStateAsUpdate(room.doc));
    await query('UPDATE note_tabs SET ydoc = $2, updated_at = now() WHERE id = $1', [
      room.tabId,
      update,
    ]);
    await refreshNoteIndex(room.tabId, room.doc);
  } catch (err) {
    room.dirty = true; // retry on the next update
    console.error('[yjs] persist failed:', (err as Error).message);
  }
}

/** Plain-text projection of a tab's notes for search & task promotion. */
async function refreshNoteIndex(tabId: string, doc: Y.Doc): Promise<void> {
  const notes = doc.getMap<Y.Map<unknown>>('notes');
  const rows: Array<{ note_id: string; title: string; snippet: string; is_checklist: boolean }> =
    [];
  notes.forEach((note, noteId) => {
    if (!(note instanceof Y.Map)) return;
    const title = typeof note.get('title') === 'string' ? (note.get('title') as string) : '';
    const body = note.get('body');
    const items = note.get('items');
    let text = body instanceof Y.Text ? body.toString() : '';
    if (items instanceof Y.Array) {
      const itemTexts: string[] = [];
      items.forEach((item) => {
        if (item instanceof Y.Map && typeof item.get('text') === 'string') {
          itemTexts.push(item.get('text') as string);
        }
      });
      if (itemTexts.length) text = itemTexts.join(' · ');
    }
    rows.push({
      note_id: noteId,
      title: title.slice(0, 200),
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 200),
      is_checklist: note.get('isChecklist') === true,
    });
  });

  await query('DELETE FROM note_index WHERE tab_id = $1', [tabId]);
  for (const r of rows) {
    await query(
      `INSERT INTO note_index (note_id, tab_id, title, snippet, is_checklist, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (note_id) DO UPDATE
       SET tab_id = $2, title = $3, snippet = $4, is_checklist = $5, updated_at = now()`,
      [r.note_id, tabId, r.title, r.snippet, r.is_checklist],
    );
  }
}

async function closeRoomIfEmpty(room: Room): Promise<void> {
  if (room.conns.size > 0) return;
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
  }
  await persistRoom(room);
  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(room.tabId);
}

/** Wire one authorized WebSocket into a tab's room. */
export async function handleNotesSocket(conn: WebSocket, tabId: string): Promise<void> {
  const room = await loadRoom(tabId);
  room.conns.add(conn);
  const controlledIds = new Set<number>();

  // handshake: sync step 1 + current awareness states
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(conn, encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      send(conn, encoding.toUint8Array(aw));
    }
  }

  conn.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const buf: Uint8Array = Array.isArray(data)
        ? new Uint8Array(Buffer.concat(data))
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
        if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
      } else if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        // track which awareness client ids this socket controls (for cleanup)
        try {
          const idDecoder = decoding.createDecoder(update);
          const len = decoding.readVarUint(idDecoder);
          for (let i = 0; i < len; i++) {
            const clientId = decoding.readVarUint(idDecoder);
            decoding.readVarUint(idDecoder); // clock
            const state = decoding.readVarString(idDecoder);
            if (state === 'null') controlledIds.delete(clientId);
            else controlledIds.add(clientId);
          }
        } catch {
          /* tracking is best-effort */
        }
        applyAwarenessUpdate(room.awareness, update, conn);
      }
    } catch (err) {
      console.error('[yjs] message handling failed:', (err as Error).message);
      conn.close();
    }
  });

  conn.on('close', () => {
    room.conns.delete(conn);
    removeAwarenessStates(room.awareness, [...controlledIds], null);
    void closeRoomIfEmpty(room);
  });
}

/**
 * Server-side note creation (integration #4: watcher → card on the board).
 * Applies a transaction to the live room when open, else load-mutate-persist.
 */
export async function addServerNote(
  tabId: string,
  args: { title: string; body: string; color?: string },
): Promise<void> {
  const room = await loadRoom(tabId);
  const noteId = `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  room.doc.transact(() => {
    const notes = room.doc.getMap<Y.Map<unknown>>('notes');
    const note = new Y.Map<unknown>();
    note.set('title', args.title);
    const body = new Y.Text();
    body.insert(0, args.body);
    note.set('body', body);
    note.set('items', new Y.Array());
    note.set('isChecklist', false);
    note.set('color', args.color ?? null);
    note.set('order', -Date.now()); // newest first
    note.set('createdAt', Date.now());
    notes.set(noteId, note);
  });
  // doc.on('update') marked it dirty; make sure a headless room is flushed + freed
  if (room.conns.size === 0) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    await persistRoom(room);
    await closeRoomIfEmpty(room);
  }
}

/** Flush every dirty room — called on graceful shutdown. */
export async function flushAllRooms(): Promise<void> {
  for (const room of rooms.values()) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    await persistRoom(room);
  }
}
