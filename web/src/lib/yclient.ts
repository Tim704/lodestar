// Browser side of the Shared Notes engine: one Y.Doc per tab over a raw
// WebSocket speaking y-protocols sync + awareness, with auto-reconnect.
// (A hand-rolled y-websocket provider — same wire format as the server.)

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

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export class NotesConnection {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private ws: WebSocket | null = null;
  private destroyed = false;
  private retryMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  status: ConnStatus = 'connecting';

  constructor(
    private tabId: string,
    private onStatus: (s: ConnStatus) => void,
  ) {
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.connect();
  }

  private setStatus(s: ConnStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private connect() {
    if (this.destroyed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/notes/${this.tabId}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setStatus('connecting');

    ws.onopen = () => {
      this.retryMs = 1000;
      this.setStatus('connected');
      // sync step 1 + our awareness state
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      ws.send(encoding.toUint8Array(encoder));

      if (this.awareness.getLocalState() !== null) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          aw,
          encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        ws.send(encoding.toUint8Array(aw));
      }
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      } else if (messageType === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
      }
    };

    ws.onclose = () => {
      if (this.destroyed) return;
      this.setStatus('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
    };

    ws.onerror = () => ws.close();
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from the wire
    if (this.ws?.readyState === WebSocket.OPEN) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.ws.send(encoding.toUint8Array(encoder));
    }
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      const changed = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, changed));
      this.ws.send(encoding.toUint8Array(encoder));
    }
  };

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.awareness.destroy();
    this.ws?.close();
    this.doc.destroy();
  }
}

/** Apply a local textarea edit to a Y.Text with a minimal splice (common
 *  prefix/suffix diff) — the cheap-and-cheerful binding Shared Notes used. */
export function applyTextDiff(ytext: Y.Text, oldStr: string, newStr: string): void {
  if (oldStr === newStr) return;
  let start = 0;
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  ytext.doc?.transact(() => {
    if (oldEnd > start) ytext.delete(start, oldEnd - start);
    if (newEnd > start) ytext.insert(start, newStr.slice(start, newEnd));
  });
}
