export const MEDIA_SLOT_IDS = [
  "camera-audio",
  "camera-video",
  "screen-audio",
  "screen-video",
  "playback-audio",
  "playback-video",
] as const;

export type MediaSlotId = typeof MEDIA_SLOT_IDS[number];
export type MediaSlotKind = "audio" | "video";
export type MediaSlotState = "idle" | "live" | "paused" | "ended" | "failed";

export type MediaSlotSnapshot = {
  id: MediaSlotId;
  kind: MediaSlotKind;
  localState: MediaSlotState;
  remoteState: MediaSlotState;
  remoteStream?: MediaStream;
  traffic: MediaTraffic;
};

export type MediaTraffic = {
  received: number;
  receivedRate: number;
  sent: number;
  sentRate: number;
};

export type MediaSlotControlMessage = {
  slot: MediaSlotId;
  state: MediaSlotState;
  type: "media-slot-update";
};

type MediaSlotRuntime = MediaSlotSnapshot & {
  lastReceivedBytes: number | null;
  lastSentBytes: number | null;
  lastStatsAt: number | null;
  localTrack: MediaStreamTrack | null;
  sender: RTCRtpSender | null;
  transceiver: RTCRtpTransceiver | null;
};

type RemoteTrackEvent = {
  streams: readonly MediaStream[];
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
};

const MEDIA_SLOT_KINDS: Record<MediaSlotId, MediaSlotKind> = {
  "camera-audio": "audio",
  "camera-video": "video",
  "screen-audio": "audio",
  "screen-video": "video",
  "playback-audio": "audio",
  "playback-video": "video",
};

function createSlot(id: MediaSlotId): MediaSlotRuntime {
  return {
    id,
    kind: MEDIA_SLOT_KINDS[id],
    localState: "idle",
    localTrack: null,
    remoteState: "idle",
    sender: null,
    traffic: { received: 0, receivedRate: 0, sent: 0, sentRate: 0 },
    lastReceivedBytes: null,
    lastSentBytes: null,
    lastStatsAt: null,
    transceiver: null,
  };
}

function isMediaSlotId(value: unknown): value is MediaSlotId {
  return typeof value === "string" && MEDIA_SLOT_IDS.includes(value as MediaSlotId);
}

function isMediaSlotState(value: unknown): value is MediaSlotState {
  return value === "idle" || value === "live" || value === "paused" || value === "ended" || value === "failed";
}

/**
 * Owns the six fixed RTP slots used by voice, camera, screen share, and shared playback.
 * Slots are negotiated once with the initial offer; feature switches use replaceTrack().
 */
export class MediaTransport {
  private readonly slots = new Map<MediaSlotId, MediaSlotRuntime>(MEDIA_SLOT_IDS.map((id) => [id, createSlot(id)]));
  private readonly listeners = new Set<(slots: MediaSlotSnapshot[]) => void>();
  private pendingRemoteTracks: RemoteTrackEvent[] = [];
  private peer: RTCPeerConnection | null = null;
  private statsTimer: number | undefined;

  constructor(
    private readonly sendControl: (message: MediaSlotControlMessage) => boolean,
    private readonly onUpdate?: (slots: MediaSlotSnapshot[]) => void,
    private readonly onTraffic?: (traffic: MediaTraffic) => void,
  ) {}

  get snapshots(): MediaSlotSnapshot[] {
    return MEDIA_SLOT_IDS.map((id) => {
      const { localTrack: _localTrack, sender: _sender, transceiver: _transceiver, lastReceivedBytes: _lastReceivedBytes, lastSentBytes: _lastSentBytes, lastStatsAt: _lastStatsAt, ...snapshot } = this.slots.get(id)!;
      return snapshot;
    });
  }

  get traffic(): MediaTraffic {
    return [...this.slots.values()].reduce<MediaTraffic>((total, slot) => ({
      received: total.received + slot.traffic.received,
      receivedRate: total.receivedRate + slot.traffic.receivedRate,
      sent: total.sent + slot.traffic.sent,
      sentRate: total.sentRate + slot.traffic.sentRate,
    }), { received: 0, receivedRate: 0, sent: 0, sentRate: 0 });
  }

  getLocalTrack(id: MediaSlotId): MediaStreamTrack | null {
    return this.slots.get(id)!.localTrack;
  }

  getRemoteStream(id: MediaSlotId): MediaStream | undefined {
    return this.slots.get(id)!.remoteStream;
  }

  getSnapshot(id: MediaSlotId): MediaSlotSnapshot {
    return this.snapshots.find((slot) => slot.id === id)!;
  }

  /** Subscribe to slot changes without coupling the transport to a UI framework. */
  subscribe(listener: (slots: MediaSlotSnapshot[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshots);
    return () => this.listeners.delete(listener);
  }

  /** Creates 3 audio + 3 video sendrecv m-lines before the first offer. */
  prepareOffer(peer: RTCPeerConnection): void {
    this.peer = peer;
    for (const id of MEDIA_SLOT_IDS) {
      const slot = this.slots.get(id)!;
      const transceiver = peer.addTransceiver(slot.kind, { direction: "sendrecv" });
      this.bindSlot(slot, transceiver);
    }
    void this.restoreLocalTracks();
    this.startStatsCollection();
    this.emit();
  }

  /** Binds the responder's transceivers created from the initiator's fixed offer. */
  bindIncomingPeer(peer: RTCPeerConnection): void {
    this.peer = peer;
    const transceivers = peer.getTransceivers();
    for (const [index, id] of MEDIA_SLOT_IDS.entries()) {
      const transceiver = transceivers[index];
      const slot = this.slots.get(id)!;
      if (!transceiver || transceiver.receiver.track.kind !== slot.kind) {
        slot.localState = "failed";
        continue;
      }
      this.bindSlot(slot, transceiver);
    }
    this.flushPendingRemoteTracks();
    void this.restoreLocalTracks();
    this.startStatsCollection();
    this.emit();
  }

  handleRemoteTrack(event: RTCTrackEvent): void {
    const remoteEvent: RemoteTrackEvent = {
      streams: event.streams,
      track: event.track,
      transceiver: event.transceiver,
    };
    if (!this.assignRemoteTrack(remoteEvent)) this.pendingRemoteTracks.push(remoteEvent);
  }

  handleControlMessage(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<MediaSlotControlMessage>;
    if (message.type !== "media-slot-update" || !isMediaSlotId(message.slot) || !isMediaSlotState(message.state)) return false;
    const slot = this.slots.get(message.slot)!;
    slot.remoteState = message.state;
    this.emit();
    return true;
  }

  async replaceLocalTrack(id: MediaSlotId, track: MediaStreamTrack | null, state: MediaSlotState = track ? "live" : "idle"): Promise<boolean> {
    const slot = this.slots.get(id)!;
    if (track && track.kind !== slot.kind) throw new TypeError(`${id} only accepts ${slot.kind} tracks.`);
    if (!slot.sender) return false;

    try {
      await slot.sender.replaceTrack(track);
      slot.localTrack = track;
      slot.localState = state;
      this.sendControl({ slot: id, state, type: "media-slot-update" });
      this.emit();
      return true;
    } catch {
      slot.localState = "failed";
      this.sendControl({ slot: id, state: "failed", type: "media-slot-update" });
      this.emit();
      return false;
    }
  }

  async setLocalState(id: MediaSlotId, state: Extract<MediaSlotState, "live" | "paused" | "ended">): Promise<void> {
    const slot = this.slots.get(id)!;
    if (!slot.localTrack) return;
    slot.localTrack.enabled = state === "live";
    slot.localState = state;
    this.sendControl({ slot: id, state, type: "media-slot-update" });
    this.emit();
  }

  detachPeer(): void {
    this.peer = null;
    this.stopStatsCollection();
    this.pendingRemoteTracks = [];
    for (const slot of this.slots.values()) {
      slot.sender = null;
      slot.transceiver = null;
      slot.remoteState = "idle";
      slot.remoteStream = undefined;
      slot.lastReceivedBytes = null;
      slot.lastSentBytes = null;
      slot.lastStatsAt = null;
    }
    this.emit();
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      slot.localTrack?.stop();
      slot.localTrack = null;
      slot.localState = "ended";
    }
    this.detachPeer();
  }

  private bindSlot(slot: MediaSlotRuntime, transceiver: RTCRtpTransceiver): void {
    // The responder receives these m-lines without a local track. Keep them
    // bidirectional so a later replaceTrack() needs no renegotiation.
    if (transceiver.direction !== "stopped") transceiver.direction = "sendrecv";
    slot.transceiver = transceiver;
    slot.sender = transceiver.sender;
  }

  private assignRemoteTrack(event: RemoteTrackEvent): boolean {
    const slot = [...this.slots.values()].find((candidate) => candidate.transceiver === event.transceiver);
    if (!slot) return false;
    slot.remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    slot.remoteState = "live";
    event.track.addEventListener("ended", () => {
      if (slot.remoteStream?.getTracks().includes(event.track)) {
        slot.remoteState = "ended";
        this.emit();
      }
    }, { once: true });
    this.emit();
    return true;
  }

  private flushPendingRemoteTracks(): void {
    const pending = this.pendingRemoteTracks;
    this.pendingRemoteTracks = [];
    for (const event of pending) if (!this.assignRemoteTrack(event)) this.pendingRemoteTracks.push(event);
  }

  private async restoreLocalTracks(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (!slot.localTrack || !slot.sender) continue;
      try {
        await slot.sender.replaceTrack(slot.localTrack);
      } catch {
        slot.localState = "failed";
      }
    }
    this.emit();
  }

  private startStatsCollection(): void {
    this.stopStatsCollection();
    void this.collectStats();
    this.statsTimer = window.setInterval(() => void this.collectStats(), 1_000);
  }

  private stopStatsCollection(): void {
    if (this.statsTimer !== undefined) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async collectStats(): Promise<void> {
    if (!this.peer) return;
    const now = performance.now();
    await Promise.all([...this.slots.values()].map(async (slot) => {
      if (!slot.sender || !slot.transceiver) return;
      try {
        const [senderStats, receiverStats] = await Promise.all([slot.sender.getStats(), slot.transceiver.receiver.getStats()]);
        const sent = [...senderStats.values()].find((report) => report.type === "outbound-rtp" && !report.isRemote && report.kind === slot.kind)?.bytesSent;
        const received = [...receiverStats.values()].find((report) => report.type === "inbound-rtp" && !report.isRemote && report.kind === slot.kind)?.bytesReceived;
        const elapsedSeconds = slot.lastStatsAt === null ? 0 : Math.max(0.001, (now - slot.lastStatsAt) / 1_000);
        this.updateCounter(slot, "sent", typeof sent === "number" ? sent : null, elapsedSeconds);
        this.updateCounter(slot, "received", typeof received === "number" ? received : null, elapsedSeconds);
        slot.lastStatsAt = now;
      } catch {
        // Browser statistics are optional. Keep the last known values.
      }
    }));
    this.onTraffic?.(this.traffic);
    this.emit();
  }

  private updateCounter(slot: MediaSlotRuntime, direction: "sent" | "received", value: number | null, elapsedSeconds: number): void {
    if (value === null) return;
    const lastKey = direction === "sent" ? "lastSentBytes" : "lastReceivedBytes";
    const rateKey = direction === "sent" ? "sentRate" : "receivedRate";
    const previous = slot[lastKey];
    const delta = previous === null || value < previous ? 0 : value - previous;
    slot[lastKey] = value;
    slot.traffic[direction] += delta;
    slot.traffic[rateKey] = elapsedSeconds > 0 ? delta / elapsedSeconds : 0;
  }

  private emit(): void {
    const snapshots = this.snapshots;
    this.onUpdate?.(snapshots);
    for (const listener of this.listeners) listener(snapshots);
  }
}
