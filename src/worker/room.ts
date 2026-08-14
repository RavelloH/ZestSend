import { DurableObject } from "cloudflare:workers";

type SignalPayload = {
  candidate?: {
    candidate: string;
    sdpMLineIndex?: number | null;
    sdpMid?: string | null;
    usernameFragment?: string | null;
  };
  description?: {
    sdp?: string;
    type: "answer" | "offer" | "pranswer" | "rollback";
  };
};

type HelloMode = "new" | "resume-signaling" | "restart-peer";

type HelloMessage = {
  type: "hello";
  mode?: HelloMode;
  resumeToken?: string;
  token?: string;
};

type SocketAttachment = {
  phase: "pending" | "active" | "closing";
  connectionId: string;
  connectedAt: number;
  slotId?: string;
  peerSessionId?: string;
};

type SlotState = {
  slotId: string;
  peerSessionId: string;
  tokenHash: string;
  connectionId: string | null;
  disconnectedAt: number | null;
  leaseExpiresAt: number | null;
  lastSeenAt: number;
};

type RoomState = {
  version: 2;
  epoch: number;
  offererSlotId: string | null;
  slots: SlotState[];
};

type InactiveConnection = {
  connectionId: string;
  slot: SlotState;
};

type ParsedMessage = {
  type?: string;
  mode?: string;
  resumeToken?: unknown;
  token?: unknown;
  payload?: unknown;
  epoch?: unknown;
  peerSessionId?: unknown;
};

const MAX_PEERS = 2;
const MAX_PENDING_SOCKETS = 8;
const MAX_MESSAGE_BYTES = 128 * 1024;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const DISCONNECTED_LEASE_MS = 30_000;
const ACTIVE_SWEEP_INTERVAL_MS = 30_000;
const ACTIVE_HEARTBEAT_TIMEOUT_MS = 90_000;
const STORAGE_KEY = "room-state-v2";
const textEncoder = new TextEncoder();

function emptyState(): RoomState {
  return { version: 2, epoch: 0, offererSlotId: null, slots: [] };
}

function isHelloMode(value: unknown): value is HelloMode {
  return value === "new" || value === "resume-signaling" || value === "restart-peer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validSlot(value: unknown): value is SlotState {
  if (!isRecord(value)) return false;
  return typeof value.slotId === "string"
    && typeof value.peerSessionId === "string"
    && typeof value.tokenHash === "string"
    && (typeof value.connectionId === "string" || value.connectionId === null)
    && (typeof value.disconnectedAt === "number" || value.disconnectedAt === null)
    && (typeof value.leaseExpiresAt === "number" || value.leaseExpiresAt === null)
    && (value.lastSeenAt === undefined || typeof value.lastSeenAt === "number");
}

function normalizeState(value: unknown): RoomState {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.slots)) return emptyState();
  const now = Date.now();
  const slots = value.slots.filter(validSlot).slice(0, MAX_PEERS).map((slot) => ({
    ...slot,
    lastSeenAt: typeof slot.lastSeenAt === "number" && Number.isFinite(slot.lastSeenAt) ? slot.lastSeenAt : now,
  }));
  const offererSlotId = typeof value.offererSlotId === "string" && slots.some((slot) => slot.slotId === value.offererSlotId)
    ? value.offererSlotId
    : slots[0]?.slotId ?? null;
  return {
    version: 2,
    epoch: typeof value.epoch === "number" && Number.isFinite(value.epoch) ? Math.max(0, Math.floor(value.epoch)) : 0,
    offererSlotId,
    slots,
  };
}

function attachmentFor(socket: WebSocket): SocketAttachment | null {
  try {
    const value = socket.deserializeAttachment() as unknown;
    if (!isRecord(value)) return null;
    // Sockets accepted by a pre-lease deployment only have a peerId attachment.
    // Treat them as legacy active seats until their connection closes.
    if (typeof value.connectionId !== "string" && typeof value.peerId === "string") {
      return {
        phase: "active",
        connectionId: value.peerId,
        connectedAt: 0,
        slotId: value.peerId,
        peerSessionId: value.peerId,
      };
    }
    if (typeof value.connectionId !== "string") return null;
    if (value.phase !== "pending" && value.phase !== "active" && value.phase !== "closing") return null;
    if (typeof value.connectedAt !== "number") return null;
    return value as unknown as SocketAttachment;
  } catch {
    return null;
  }
}

function signalPayload(value: unknown): value is SignalPayload {
  if (!isRecord(value)) return false;
  if (value.description !== undefined) {
    if (!isRecord(value.description) || typeof value.description.type !== "string") return false;
    if (value.description.sdp !== undefined && typeof value.description.sdp !== "string") return false;
  }
  if (value.candidate !== undefined) {
    if (!isRecord(value.candidate) || typeof value.candidate.candidate !== "string") return false;
  }
  return value.description !== undefined || value.candidate !== undefined;
}

/** A room owns the two logical WebRTC seats and their short-lived leases. */
export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connectionId = crypto.randomUUID();
    const connectedAt = Date.now();

    let accepted = false;
    await this.ctx.blockConcurrencyWhile(async () => {
      const pending = this.ctx.getWebSockets().reduce((count, socket) => {
        return count + (attachmentFor(socket)?.phase === "pending" ? 1 : 0);
      }, 0);
      if (pending >= MAX_PENDING_SOCKETS) return;

      server.serializeAttachment({ phase: "pending", connectionId, connectedAt } satisfies SocketAttachment);
      this.ctx.acceptWebSocket(server);
      accepted = true;
      await this.scheduleAlarm(connectedAt + HANDSHAKE_TIMEOUT_MS);
    });

    if (!accepted) {
      server.accept();
      this.sendErrorAndClose(server, "room-busy", "Too many pending connections.", 4_010);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const byteLength = typeof message === "string" ? textEncoder.encode(message).byteLength : message.byteLength;
    if (byteLength > MAX_MESSAGE_BYTES) {
      this.sendErrorAndClose(socket, "message-too-large", "Signaling message is too large.", 4_011);
      return;
    }
    if (typeof message !== "string") return;

    let parsed: ParsedMessage;
    try {
      const value = JSON.parse(message) as unknown;
      if (!isRecord(value)) throw new Error("message is not an object");
      parsed = value as ParsedMessage;
    } catch {
      this.sendErrorAndClose(socket, "invalid-message", "Invalid signaling message.", 4_012);
      return;
    }

    await this.ctx.blockConcurrencyWhile(async () => {
      const attachment = attachmentFor(socket);
      if (!attachment) {
        this.sendErrorAndClose(socket, "invalid-connection", "Unknown signaling connection.", 4_013);
        return;
      }

      if (attachment.phase === "pending") {
        // Older clients send a JSON ping immediately after opening the socket.
        if (parsed.type === "ping") {
          const admitted = await this.admit(socket, "new", null, attachment);
          if (admitted) this.send(socket, { type: "pong" });
          return;
        }
        if (parsed.type === "hello") {
          const mode = isHelloMode(parsed.mode) ? parsed.mode : "new";
          const resumeToken = asString(parsed.resumeToken ?? parsed.token, 512);
          await this.admit(socket, mode, resumeToken, attachment);
          return;
        }
        // Preserve clients that raced their first signal ahead of the legacy ping.
        if (parsed.type === "signal") {
          const admitted = await this.admit(socket, "new", null, attachment);
          if (admitted) await this.forwardSignal(socket, parsed);
          return;
        }
        this.sendErrorAndClose(socket, "hello-required", "Send a hello message first.", 4_014);
        return;
      }

      const current = await this.currentSlot(socket, attachment);
      if (!current) return;
      current.slot.lastSeenAt = Date.now();
      await this.saveState(current.state, true);

      if (parsed.type === "ping") {
        this.send(socket, { type: "pong" });
        return;
      }
      if (parsed.type === "leave") {
        await this.leave(socket, attachment, current.slot);
        return;
      }
      if (parsed.type === "hello") {
        this.sendErrorAndClose(socket, "already-admitted", "This connection is already admitted.", 4_015);
        return;
      }
      if (parsed.type === "signal") {
        await this.forwardSignal(socket, parsed, current.slot);
      }
    });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const attachment = attachmentFor(socket);
      if (!attachment || attachment.phase !== "active" || !attachment.slotId) return;

      const { state, changed } = await this.loadState();
      const slot = state.slots.find((candidate) => candidate.slotId === attachment.slotId);
      // A delayed close from a replaced socket must not evict the new connection.
      if (!slot || slot.connectionId !== attachment.connectionId) return;

      const now = Date.now();
      // Prevent a still-visible closing socket from being reconciled back into
      // the slot while the lease update is being persisted.
      this.markClosing(socket);
      slot.connectionId = null;
      slot.disconnectedAt = now;
      slot.leaseExpiresAt = now + DISCONNECTED_LEASE_MS;
      state.epoch += 1;
      await this.saveState(state, true);
      this.broadcastToActive(state, {
        type: "peer-disconnected",
        epoch: state.epoch,
        slotId: slot.slotId,
        peerId: slot.slotId,
        peerSessionId: slot.peerSessionId,
        retryAfterMs: DISCONNECTED_LEASE_MS,
      });
      await this.scheduleAlarm();
    });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    try {
      socket.close(4_016, "Signaling error");
    } catch {
      // The runtime may already have closed the socket.
    }
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const pendingToClose: WebSocket[] = [];
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = attachmentFor(socket);
        if (attachment?.phase === "pending" && attachment.connectedAt + HANDSHAKE_TIMEOUT_MS <= now) {
          pendingToClose.push(socket);
        }
      }
      for (const socket of pendingToClose) {
        this.sendErrorAndClose(socket, "hello-timeout", "Hello handshake timed out.", 4_017);
      }

      const { state, changed } = await this.loadState();
      const inactive = this.removeInactiveConnections(state, now);
      for (const inactiveConnection of inactive) {
        const { slot, connectionId } = inactiveConnection;
        const staleSocket = this.socketForConnection(slot.slotId, connectionId);
        if (staleSocket) {
          this.markClosing(staleSocket);
          try {
            staleSocket.close(4_021, "Heartbeat timed out");
          } catch {
            // The runtime may already have closed the socket.
          }
        }
        this.broadcastToActive(state, {
          type: "peer-disconnected",
          epoch: state.epoch,
          slotId: slot.slotId,
          peerId: slot.slotId,
          peerSessionId: slot.peerSessionId,
          retryAfterMs: DISCONNECTED_LEASE_MS,
        });
      }
      const expired = this.removeExpiredLeases(state, now);
      if (expired.length > 0 || inactive.length > 0) {
        await this.saveState(state, true);
        for (const slot of expired) {
          this.broadcastToActive(state, {
            type: "peer-left",
            epoch: state.epoch,
            slotId: slot.slotId,
            peerId: slot.slotId,
            peerSessionId: slot.peerSessionId,
          });
        }
      } else if (changed) {
        await this.saveState(state, true);
      }
      await this.scheduleAlarm();
    });
  }

  private async admit(
    socket: WebSocket,
    requestedMode: HelloMode,
    resumeToken: string | null,
    pendingAttachment: SocketAttachment,
  ): Promise<boolean> {
    let resumeTokenForClient: string | null = null;
    const now = Date.now();
    const loaded = await this.loadState();
    const state = loaded.state;
    const expired = this.removeExpiredLeases(state, now);
    if (expired.length > 0) {
      for (const slot of expired) {
        this.broadcastToActive(state, {
          type: "peer-left",
          epoch: state.epoch,
          slotId: slot.slotId,
          peerId: slot.slotId,
          peerSessionId: slot.peerSessionId,
        });
      }
    }

    let mode = requestedMode;
    let slot: SlotState | undefined;
    let replacedSocket: WebSocket | undefined;
    let resumed = false;

    if (mode !== "new") {
      if (!resumeToken) {
        this.sendErrorAndClose(socket, "resume-invalid", "A resume token is required.", 4_018);
        return false;
      }
      const hash = await tokenHash(resumeToken);
      slot = state.slots.find((candidate) => candidate.tokenHash !== "" && candidate.tokenHash === hash);
      if (!slot || (slot.leaseExpiresAt !== null && slot.leaseExpiresAt <= now)) {
        this.sendErrorAndClose(socket, "resume-invalid", "The resume token is invalid or expired.", 4_018);
        return false;
      }
      resumed = true;
      if (slot.connectionId) {
        replacedSocket = this.socketForSlot(slot);
        state.epoch += 1;
      }
      if (mode === "restart-peer") {
        slot.peerSessionId = crypto.randomUUID();
        state.epoch += 1;
      }
    } else {
      const hasDisconnectedLease = state.slots.some((candidate) => candidate.connectionId === null && candidate.leaseExpiresAt !== null);
      if (state.slots.length >= MAX_PEERS) {
        if (hasDisconnectedLease) {
          const retryAfterMs = this.retryAfterMs(state, now);
          this.sendErrorAndClose(socket, "room-reserved", "A participant is reconnecting to this room.", 4_019, retryAfterMs);
        } else {
          this.sendErrorAndClose(socket, "room-full", "Room is full.", 4_003);
        }
        return false;
      }
      const token = randomToken();
      slot = {
        slotId: crypto.randomUUID(),
        peerSessionId: crypto.randomUUID(),
        tokenHash: await tokenHash(token),
        connectionId: pendingAttachment.connectionId,
        disconnectedAt: null,
        leaseExpiresAt: null,
        lastSeenAt: now,
      };
      state.slots.push(slot);
      if (!state.offererSlotId) state.offererSlotId = slot.slotId;
      state.epoch += 1;
      resumeTokenForClient = token;
    }

    if (!slot) return false;
    if (resumed) {
      const token = randomToken();
      slot.tokenHash = await tokenHash(token);
      resumeTokenForClient = token;
    }
    slot.connectionId = pendingAttachment.connectionId;
    slot.disconnectedAt = null;
    slot.leaseExpiresAt = null;
    slot.lastSeenAt = now;
    if (!state.offererSlotId || !state.slots.some((candidate) => candidate.slotId === state.offererSlotId)) {
      state.offererSlotId = state.slots[0]?.slotId ?? null;
    }

    const activeSlots = state.slots.filter((candidate) => candidate.connectionId !== null);
    const attachment: SocketAttachment = {
      phase: "active",
      connectionId: pendingAttachment.connectionId,
      connectedAt: pendingAttachment.connectedAt,
      slotId: slot.slotId,
      peerSessionId: slot.peerSessionId,
    };
    socket.serializeAttachment(attachment);
    await this.saveState(state, true);
    await this.scheduleAlarm();

    if (replacedSocket && replacedSocket !== socket) {
      this.markClosing(replacedSocket);
      this.send(replacedSocket, { type: "replaced", epoch: state.epoch, slotId: slot.slotId });
      try {
        replacedSocket.close(4_020, "Connection replaced");
      } catch {
        // The old connection may already be closed.
      }
    }

    this.send(socket, {
      type: "welcome",
      peerId: slot.slotId,
      slotId: slot.slotId,
      peerSessionId: slot.peerSessionId,
      resumeToken: resumeTokenForClient,
      epoch: state.epoch,
      offererSlotId: state.offererSlotId,
      isInitiator: state.offererSlotId === slot.slotId,
      peerCount: activeSlots.length,
      resumed,
    });

    if (resumed && mode === "resume-signaling") {
      this.broadcastToActive(state, {
        type: "peer-reconnected",
        epoch: state.epoch,
        slotId: slot.slotId,
        peerId: slot.slotId,
        peerSessionId: slot.peerSessionId,
      }, socket);
    } else if (activeSlots.length > 1) {
      this.broadcastToActive(state, {
        type: "peer-ready",
        epoch: state.epoch,
        slotId: slot.slotId,
        peerId: slot.slotId,
        peerSessionId: slot.peerSessionId,
        offererSlotId: state.offererSlotId,
      }, socket);
      this.sendNegotiation(state, activeSlots, slot.slotId);
    }
    return true;
  }

  private async forwardSignal(socket: WebSocket, parsed: ParsedMessage, sender?: SlotState): Promise<void> {
    const attachment = attachmentFor(socket);
    if (!attachment?.slotId || !sender || sender.connectionId !== attachment.connectionId) return;
    if (!signalPayload(parsed.payload)) {
      this.send(socket, { type: "error", code: "invalid-signal", message: "Invalid signaling payload." });
      return;
    }
    if (typeof parsed.epoch === "number" && parsed.epoch !== (await this.loadState()).state.epoch) return;
    if (parsed.peerSessionId !== undefined && parsed.peerSessionId !== sender.peerSessionId) return;

    const state = (await this.loadState()).state;
    this.broadcastToActive(state, {
      type: "signal",
      from: sender.slotId,
      fromSlotId: sender.slotId,
      peerId: sender.slotId,
      peerSessionId: sender.peerSessionId,
      epoch: state.epoch,
      offererSlotId: state.offererSlotId,
      payload: parsed.payload,
    }, socket);
  }

  private async currentSlot(socket: WebSocket, attachment: SocketAttachment): Promise<{ state: RoomState; slot: SlotState } | null> {
    if (!attachment.slotId) return null;
    const state = (await this.loadState()).state;
    const slot = state.slots.find((candidate) => candidate.slotId === attachment.slotId && candidate.connectionId === attachment.connectionId);
    return slot ? { state, slot } : null;
  }

  private async leave(socket: WebSocket, attachment: SocketAttachment, slot: SlotState): Promise<void> {
    const loaded = await this.loadState();
    const state = loaded.state;
    const current = state.slots.find((candidate) => candidate.slotId === slot.slotId && candidate.connectionId === attachment.connectionId);
    if (!current) return;
    state.slots = state.slots.filter((candidate) => candidate.slotId !== slot.slotId);
    state.epoch += 1;
    if (state.offererSlotId === slot.slotId) state.offererSlotId = state.slots[0]?.slotId ?? null;
    await this.saveState(state, true);
    this.markClosing(socket);
    this.send(socket, { type: "left", epoch: state.epoch, slotId: slot.slotId });
    this.broadcastToActive(state, {
      type: "peer-left",
      epoch: state.epoch,
      slotId: slot.slotId,
      peerId: slot.slotId,
      peerSessionId: slot.peerSessionId,
    }, socket);
    await this.scheduleAlarm();
    try {
      socket.close(1000, "Left room");
    } catch {
      // The client may have closed the socket already.
    }
  }

  private async loadState(): Promise<{ state: RoomState; changed: boolean }> {
    const stored = await this.ctx.storage.get<unknown>(STORAGE_KEY);
    const state = normalizeState(stored);
    let changed = stored === undefined || JSON.stringify(stored) !== JSON.stringify(state);
    const live = new Map<string, SocketAttachment[]>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentFor(socket);
      if (attachment?.phase === "active" && attachment.slotId) {
        const entries = live.get(attachment.slotId) ?? [];
        entries.push(attachment);
        live.set(attachment.slotId, entries);
      }
    }

    for (const attachments of live.values()) {
      const attachment = attachments[0];
      if (!attachment?.slotId) continue;
      const slot = state.slots.find((candidate) => candidate.slotId === attachment.slotId);
      if (!slot) {
        state.slots.push({
          slotId: attachment.slotId!,
          peerSessionId: attachment.peerSessionId ?? attachment.slotId!,
          tokenHash: "",
          connectionId: attachment.connectionId,
          disconnectedAt: null,
          leaseExpiresAt: null,
          lastSeenAt: Date.now(),
        });
        state.epoch += 1;
        if (!state.offererSlotId) state.offererSlotId = attachment.slotId!;
        changed = true;
      } else if (!attachments.some((candidate) => candidate.connectionId === slot.connectionId)) {
        // Keep the connection selected by the admission transaction if an old
        // socket and its replacement briefly coexist in getWebSockets().
        const replacement = attachments[attachments.length - 1];
        if (!replacement) continue;
        slot.connectionId = replacement.connectionId;
        slot.disconnectedAt = null;
        slot.leaseExpiresAt = null;
        changed = true;
      }
    }

    for (const slot of state.slots) {
      if (!slot.connectionId || live.has(slot.slotId)) continue;
      const now = Date.now();
      slot.connectionId = null;
      slot.disconnectedAt ??= now;
      slot.leaseExpiresAt ??= now + DISCONNECTED_LEASE_MS;
      state.epoch += 1;
      changed = true;
    }
    if (state.slots.length > MAX_PEERS) {
      state.slots = state.slots.slice(0, MAX_PEERS);
      changed = true;
    }
    if (!state.offererSlotId || !state.slots.some((slot) => slot.slotId === state.offererSlotId)) {
      state.offererSlotId = state.slots[0]?.slotId ?? null;
      changed = true;
    }
    if (changed) await this.ctx.storage.put(STORAGE_KEY, state);
    return { state, changed };
  }

  private async saveState(state: RoomState, changed: boolean): Promise<void> {
    if (state.slots.length === 0) {
      await this.ctx.storage.delete(STORAGE_KEY);
      return;
    }
    if (changed) await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private removeExpiredLeases(state: RoomState, now: number): SlotState[] {
    const expired = state.slots.filter((slot) => slot.connectionId === null && slot.leaseExpiresAt !== null && slot.leaseExpiresAt <= now);
    if (expired.length === 0) return [];
    const expiredIds = new Set(expired.map((slot) => slot.slotId));
    state.slots = state.slots.filter((slot) => !expiredIds.has(slot.slotId));
    state.epoch += 1;
    if (!state.offererSlotId || expiredIds.has(state.offererSlotId)) state.offererSlotId = state.slots[0]?.slotId ?? null;
    return expired;
  }

  private removeInactiveConnections(state: RoomState, now: number): InactiveConnection[] {
    const inactive = state.slots.filter((slot) => {
      return slot.connectionId !== null && now - slot.lastSeenAt > ACTIVE_HEARTBEAT_TIMEOUT_MS;
    }).map((slot) => ({ slot: { ...slot }, connectionId: slot.connectionId as string }));
    if (inactive.length === 0) return [];
    const inactiveIds = new Set(inactive.map(({ slot }) => slot.slotId));
    for (const slot of state.slots) {
      if (!inactiveIds.has(slot.slotId)) continue;
      slot.connectionId = null;
      slot.disconnectedAt = now;
      slot.leaseExpiresAt = now + DISCONNECTED_LEASE_MS;
    }
    state.epoch += 1;
    return inactive;
  }

  private retryAfterMs(state: RoomState, now: number): number {
    const expiry = state.slots
      .filter((slot) => slot.connectionId === null && slot.leaseExpiresAt !== null)
      .map((slot) => slot.leaseExpiresAt as number)
      .sort((left, right) => left - right)[0];
    return expiry ? Math.max(250, Math.min(DISCONNECTED_LEASE_MS, expiry - now)) : DISCONNECTED_LEASE_MS;
  }

  private socketForSlot(slot: SlotState): WebSocket | undefined {
    if (!slot.connectionId) return undefined;
    return this.socketForConnection(slot.slotId, slot.connectionId);
  }

  private socketForConnection(slotId: string, connectionId: string): WebSocket | undefined {
    return this.ctx.getWebSockets().find((socket) => {
      const attachment = attachmentFor(socket);
      return attachment?.phase === "active" && attachment.slotId === slotId && attachment.connectionId === connectionId;
    });
  }

  private markClosing(socket: WebSocket): void {
    const attachment = attachmentFor(socket);
    if (!attachment || attachment.phase === "closing") return;
    try {
      socket.serializeAttachment({ ...attachment, phase: "closing" } satisfies SocketAttachment);
    } catch {
      // Ignore sockets that are already detached from the hibernation runtime.
    }
  }

  private async scheduleAlarm(explicitTime?: number): Promise<void> {
    const now = Date.now();
    let next = explicitTime ?? Number.POSITIVE_INFINITY;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentFor(socket);
      if (attachment?.phase === "pending") next = Math.min(next, attachment.connectedAt + HANDSHAKE_TIMEOUT_MS);
    }
    const state = normalizeState(await this.ctx.storage.get<unknown>(STORAGE_KEY));
    if (state.slots.some((slot) => slot.connectionId !== null)) {
      next = Math.min(next, now + ACTIVE_SWEEP_INTERVAL_MS);
    }
    for (const slot of state.slots) {
      if (slot.connectionId === null && slot.leaseExpiresAt !== null) next = Math.min(next, slot.leaseExpiresAt);
    }
    if (!Number.isFinite(next)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(now + 50, next));
  }

  private broadcastToActive(state: RoomState, payload: object, except?: WebSocket): void {
    const activeIds = new Set(state.slots.filter((slot) => slot.connectionId !== null).map((slot) => `${slot.slotId}:${slot.connectionId}`));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      const attachment = attachmentFor(socket);
      if (!attachment?.slotId || !activeIds.has(`${attachment.slotId}:${attachment.connectionId}`)) continue;
      this.send(socket, payload);
    }
  }

  /** Send recipient-relative metadata so each client treats the other seat as remote. */
  private sendNegotiation(state: RoomState, activeSlots: SlotState[], changedSlotId: string): void {
    const peers = activeSlots.map((candidate) => ({ slotId: candidate.slotId, peerSessionId: candidate.peerSessionId }));
    for (const recipient of activeSlots) {
      const remote = activeSlots.find((candidate) => candidate.slotId !== recipient.slotId);
      const recipientSocket = this.socketForSlot(recipient);
      if (!remote || !recipientSocket) continue;
      this.send(recipientSocket, {
        type: "negotiate",
        epoch: state.epoch,
        slotId: remote.slotId,
        peerId: remote.slotId,
        peerSessionId: remote.peerSessionId,
        offererSlotId: state.offererSlotId,
        changedSlotId,
        peers,
      });
    }
  }

  private send(socket: WebSocket, payload: object): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      try {
        socket.close(1011, "Unable to deliver signaling message");
      } catch {
        // Ignore already-closed sockets.
      }
    }
  }

  private sendErrorAndClose(socket: WebSocket, code: string, message: string, closeCode: number, retryAfterMs?: number): void {
    const payload: Record<string, unknown> = { type: "error", code, message };
    if (retryAfterMs !== undefined) payload.retryAfterMs = retryAfterMs;
    this.send(socket, payload);
    try {
      socket.close(closeCode, message.slice(0, 123));
    } catch {
      // Ignore already-closed sockets.
    }
  }

}
