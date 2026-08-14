import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";

import type { NativeWebRTCSession } from "./webrtc";

const enum CollaborationFrame {
  Awareness = 2,
  StateVector = 0,
  Update = 1,
}

export type CollaborationStatus = "offline" | "syncing" | "synced";

function encodeFrame(type: CollaborationFrame, payload: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(payload.byteLength + 1);
  frame[0] = type;
  frame.set(payload, 1);
  return frame.buffer;
}

function decodeFrame(frame: ArrayBuffer): { payload: Uint8Array; type: CollaborationFrame } | null {
  const bytes = new Uint8Array(frame);
  const type = bytes[0];
  if (bytes.byteLength < 1 || (type !== CollaborationFrame.StateVector && type !== CollaborationFrame.Update && type !== CollaborationFrame.Awareness)) return null;
  return { payload: bytes.subarray(1), type };
}

/**
 * A minimal Yjs provider that keeps collaboration traffic on ZestSend's
 * dedicated WebRTC data channel. It intentionally has no server persistence.
 */
export class P2PCollaborationProvider {
  readonly awareness: Awareness;
  readonly document: Y.Doc;

  private awarenessTimer: number | undefined;
  private connected = false;
  private destroyed = false;
  private status: CollaborationStatus = "offline";
  private statusListeners = new Set<(status: CollaborationStatus) => void>();
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeTransport: (() => void) | null = null;

  constructor(private readonly session: NativeWebRTCSession) {
    this.document = new Y.Doc();
    this.awareness = new Awareness(this.document);
    this.document.on("update", this.handleDocumentUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    this.unsubscribeMessage = session.subscribeCollaboration(this.handleMessage);
    this.unsubscribeTransport = session.subscribeCollaborationStatus(this.handleTransportStatus);
    this.awarenessTimer = window.setInterval(this.broadcastPresence, 15_000);
  }

  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.awarenessTimer !== undefined) window.clearInterval(this.awarenessTimer);
    this.unsubscribeMessage?.();
    this.unsubscribeTransport?.();
    this.document.off("update", this.handleDocumentUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.setLocalState(null);
    this.awareness.destroy();
    this.document.destroy();
    this.statusListeners.clear();
  }

  private broadcastPresence = (): void => {
    if (!this.connected || this.destroyed) return;
    this.send(CollaborationFrame.Awareness, encodeAwarenessUpdate(this.awareness, [this.document.clientID]));
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; removed: number[]; updated: number[] },
    origin: unknown,
  ): void => {
    if (origin === this || this.destroyed || !this.connected) return;
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length) this.send(CollaborationFrame.Awareness, encodeAwarenessUpdate(this.awareness, clients));
  };

  private handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this || this.destroyed || !this.connected) return;
    this.send(CollaborationFrame.Update, update);
  };

  private handleMessage = (frame: ArrayBuffer): void => {
    if (this.destroyed) return;
    const message = decodeFrame(frame);
    if (!message) return;

    if (message.type === CollaborationFrame.StateVector) {
      this.send(CollaborationFrame.Update, Y.encodeStateAsUpdate(this.document, message.payload));
      this.setStatus("synced");
      return;
    }
    if (message.type === CollaborationFrame.Update) {
      Y.applyUpdate(this.document, message.payload, this);
      this.setStatus("synced");
      return;
    }
    applyAwarenessUpdate(this.awareness, message.payload, this);
  };

  private handleTransportStatus = (connected: boolean): void => {
    if (this.destroyed) return;
    this.connected = connected;
    if (!connected) {
      const remoteClients = [...this.awareness.getStates().keys()].filter((clientId) => clientId !== this.document.clientID);
      if (remoteClients.length) removeAwarenessStates(this.awareness, remoteClients, this);
      this.setStatus("offline");
      return;
    }
    this.setStatus("syncing");
    this.send(CollaborationFrame.StateVector, Y.encodeStateVector(this.document));
    this.broadcastPresence();
  };

  private send(type: CollaborationFrame, payload: Uint8Array): void {
    this.session.sendCollaboration(encodeFrame(type, payload));
  }

  private setStatus(status: CollaborationStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
