export type ConnectionState = "pending" | "checking" | "ready" | "active" | "error";

export type ConnectionStep = {
  channels?: number;
  detail: string;
  latency?: number;
  state: ConnectionState;
  transferred?: {
    received: number;
    sent: number;
  };
};

export type ConnectionProgress = {
  dataChannel: ConnectionStep;
  p2p: ConnectionStep;
  resource: ConnectionStep;
  stun: ConnectionStep;
  turn: ConnectionStep;
  websocket: ConnectionStep;
};

export type ConnectionRoute = "direct" | "relay";

export type WebRTCTransportDiagnostics = {
  availableOutgoingBitrate: number | null;
  bufferedAmount: Record<DataChannelName, number | null>;
  bytesReceived: number | null;
  bytesSent: number | null;
  currentRoundTripTime: number | null;
  localCandidateType: string | null;
  localProtocol: string | null;
  packetsRetransmitted: number | null;
  packetsDiscardedOnSend: number | null;
  remoteCandidateType: string | null;
  remoteProtocol: string | null;
  relayProtocol: string | null;
  sctpCongestionWindow: number | null;
  sctpReceiverWindow: number | null;
  sctpSmoothedRoundTripTime: number | null;
  sctpState: string | null;
};

import type { FileTransferManager, FileTransferSnapshot } from "./file-transfer";
import { MediaTransport, type MediaSlotControlMessage } from "./media-transport";

type SignalMessage = {
  epoch?: number;
  fromSlotId?: string;
  peerSessionId?: string;
  payload?: {
    candidate?: RTCIceCandidateInit;
    description?: RTCSessionDescriptionInit;
  };
  type: "signal";
};

export type SessionStatus = {
  detail?: string;
  retryAfterMs?: number;
  state: "connecting" | "connected" | "reconnecting" | "reserved" | "closed";
};

type DataChannelPingMessage = {
  id: string;
  type: "zestsend-ping" | "zestsend-pong";
};

type ChatReceiptStatus = "received" | "read";

type ChatReceiptMessage = {
  id: string;
  type: "chat-received" | "chat-read";
};

type ChatTypingMessage = {
  type: "chat-typing";
};

type DataChannelControlMessage = DataChannelPingMessage | ChatReceiptMessage | ChatTypingMessage | MediaSlotControlMessage;

export type InteractiveMessage = {
  id: string;
  text: string;
  type: "chat";
};

type DataChannelName = "bulk" | "control" | "interactive";

const DATA_CHANNEL_NAMES: DataChannelName[] = ["control", "interactive", "bulk"];
const DATA_CHANNEL_COUNT = DATA_CHANNEL_NAMES.length;
const textEncoder = new TextEncoder();

function isDataChannelName(label: string): label is DataChannelName {
  return DATA_CHANNEL_NAMES.includes(label as DataChannelName);
}

function isInteractiveMessage(value: unknown): value is InteractiveMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<InteractiveMessage>;
  return message.type === "chat"
    && typeof message.id === "string"
    && message.id.length > 0
    && message.id.length <= 128
    && typeof message.text === "string"
    && message.text.length > 0
    && message.text.length <= 4_000;
}

function dataSize(data: unknown): number {
  if (typeof data === "string") return textEncoder.encode(data).byteLength;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

type ServerMessage =
  | {
      epoch?: number;
      isInitiator: boolean;
      offererSlotId?: string;
      peerCount: number;
      peerId?: string;
      peerSessionId?: string;
      resumed?: boolean;
      resumeToken?: string;
      slotId?: string;
      type: "welcome";
    }
  | { epoch?: number; offererSlotId?: string; peerId?: string; peerSessionId?: string; slotId?: string; type: "peer-ready" }
  | {
      epoch?: number;
      offererSlotId?: string;
      peerId?: string;
      peerSessionId?: string;
      peers?: Array<{ peerSessionId?: string; slotId?: string }>;
      slotId?: string;
      type: "negotiate";
    }
  | { epoch?: number; offererSlotId?: string; peerId?: string; peerSessionId?: string; slotId?: string; type: "peer-disconnected" | "peer-reconnected" | "replaced" }
  | { epoch?: number; peerId?: string; peerSessionId?: string; slotId?: string; type: "peer-left" }
  | SignalMessage
  | { code?: "room-full" | "room-reserved" | "resume-invalid"; message: string; retryAfterMs?: number; type: "error" }
  | { type: "left" }
  | { type: "pong" };

type TurnResponse = { error?: string; iceServers?: RTCIceServer[] };
type CloudflareIceResponse = TurnResponse & { latency: number };

type StunCandidate = {
  provider: string;
  server: RTCIceServer;
};

const PUBLIC_STUN_CANDIDATES: StunCandidate[] = [
  { provider: "google", server: { urls: "stun:stun.l.google.com:19302" } },
  { provider: "google", server: { urls: "stun:stun1.l.google.com:19302" } },
  { provider: "google", server: { urls: "stun:stun2.l.google.com:19302" } },
  { provider: "google", server: { urls: "stun:stun3.l.google.com:19302" } },
  { provider: "google", server: { urls: "stun:stun4.l.google.com:19302" } },
  { provider: "nextcloud", server: { urls: "stun:stun.nextcloud.com:443" } },
  { provider: "antisip", server: { urls: "stun:stun.antisip.com:3478" } },
  { provider: "freeswitch", server: { urls: "stun:stun.freeswitch.org:3478" } },
  { provider: "metered", server: { urls: "stun:stun.relay.metered.ca:80" } },
];

type IceProbeResult = { latency: number; provider?: string; server: RTCIceServer } | null;

export type IceDiagnosticEntry = {
  detail?: string;
  kind: "stun" | "turn";
  latency?: number;
  provider: string;
  selected: boolean;
  state: "ready" | "error";
  url: string;
};

export type IcePreparationResult = {
  completedAt: number;
  diagnostics: IceDiagnosticEntry[];
  duration: number;
  resource: ConnectionStep;
  servers: RTCIceServer[];
  stun: IceProbeResult;
  turn: IceProbeResult;
  turnError?: string;
};

type IceConnectionPreparationResult = {
  servers: RTCIceServer[];
};

type IcePreparationStep = "resource" | "stun" | "turn";
type IcePreparationListener = (step: IcePreparationStep, status: ConnectionStep) => void;

const pendingStep = (detail: string): ConnectionStep => ({ state: "pending", detail });

const initialProgress = (): ConnectionProgress => ({
  websocket: pendingStep("Waiting for signaling socket"),
  resource: pendingStep("Waiting to request Cloudflare resources"),
  stun: pendingStep("Checking STUN server"),
  turn: pendingStep("Checking TURN server"),
  p2p: pendingStep("Waiting for the other participant to join the room"),
  dataChannel: { channels: 0, ...pendingStep("Waiting for data channel"), transferred: { received: 0, sent: 0 } },
});

function websocketUrl(roomId: string): string {
  const url = new URL(`/api/rooms/${roomId}/ws`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function asCandidate(candidate: RTCIceCandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function iceServerUrl(server: RTCIceServer): string {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls[0] ?? "Unknown ICE server";
}

async function probeIceServer(
  server: RTCIceServer,
  candidateType: "srflx" | "relay",
  timeoutMs = 4_500,
  provider?: string,
): Promise<{ latency: number; provider?: string; server: RTCIceServer } | null> {
  const startedAt = performance.now();
  const peer = new RTCPeerConnection({ iceServers: [server] });
  peer.createDataChannel("probe");

  try {
    const discovered = await new Promise<boolean>(async (resolve) => {
      const timeout = window.setTimeout(() => resolve(false), timeoutMs);
      peer.onicecandidate = ({ candidate }) => {
        if (candidate?.candidate.includes(` typ ${candidateType} `)) {
          window.clearTimeout(timeout);
          resolve(true);
        }
      };
      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState === "complete") {
          window.clearTimeout(timeout);
          resolve(false);
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
    });

    return discovered ? { server, provider, latency: Math.round(performance.now() - startedAt) } : null;
  } catch {
    return null;
  } finally {
    peer.close();
  }
}

let icePreparationPromise: Promise<IcePreparationResult> | null = null;
let iceConnectionPreparationPromise: Promise<IceConnectionPreparationResult> | null = null;
let resolveIceConnectionPreparation: ((result: IceConnectionPreparationResult) => void) | null = null;
let icePreparationSnapshot: Pick<ConnectionProgress, IcePreparationStep> = {
  resource: pendingStep("Waiting to request Cloudflare resources"),
  stun: pendingStep("Checking STUN server"),
  turn: pendingStep("Checking TURN server"),
};
const icePreparationListeners = new Set<IcePreparationListener>();

function updateIcePreparation(step: IcePreparationStep, status: ConnectionStep): void {
  icePreparationSnapshot = { ...icePreparationSnapshot, [step]: status };
  for (const listener of icePreparationListeners) listener(step, status);
}

function notifyIcePreparation(listener: IcePreparationListener): void {
  listener("resource", icePreparationSnapshot.resource);
  listener("stun", icePreparationSnapshot.stun);
  listener("turn", icePreparationSnapshot.turn);
}

async function fetchCloudflareIceServers(): Promise<CloudflareIceResponse> {
  const startedAt = performance.now();
  try {
    const response = await fetch("/api/turn/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 3_600 }),
    });
    const body = (await response.json().catch(() => ({}))) as TurnResponse;
    const latency = Math.round(performance.now() - startedAt);
    return response.ok
      ? { ...body, latency }
      : { iceServers: [], error: body.error ?? "TURN credentials could not be generated.", latency };
  } catch {
    return { iceServers: [], error: "TURN credentials could not be generated.", latency: Math.round(performance.now() - startedAt) };
  }
}

/**
 * Fetches Cloudflare's short-lived ICE credentials once, then concurrently
 * measures Cloudflare and public STUN candidates plus Cloudflare TURN.
 */
export function prepareIceServers(listener?: IcePreparationListener): Promise<IcePreparationResult> {
  if (listener) {
    icePreparationListeners.add(listener);
    notifyIcePreparation(listener);
  }

  if (!icePreparationPromise) {
    iceConnectionPreparationPromise = new Promise<IceConnectionPreparationResult>((resolve) => {
      resolveIceConnectionPreparation = resolve;
    });
    icePreparationPromise = (async () => {
      const preparationStartedAt = performance.now();
      updateIcePreparation("resource", { state: "checking", detail: "Requesting Cloudflare ICE resources" });

      const response = await fetchCloudflareIceServers();
      if (response.error) {
        updateIcePreparation("resource", {
          state: "error",
          detail: response.error === "TURN credentials are not configured."
            ? "TURN extension not configured on server"
            : response.error,
          latency: response.latency,
        });
      } else {
        updateIcePreparation("resource", {
          state: "ready",
          detail: "ICE resources issued by server",
          latency: response.latency,
        });
      }

      const candidates = response.iceServers ?? [];
      const cloudflareStunCandidates = candidates.filter((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => url.startsWith("stun:"));
      });
      const stunCandidates: StunCandidate[] = [
        ...cloudflareStunCandidates.map((server) => ({ provider: "cloudflare", server })),
        ...PUBLIC_STUN_CANDIDATES,
      ];
      const turnCandidates = candidates.filter((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
      });

      updateIcePreparation("stun", { state: "checking", detail: "Testing STUN server" });
      updateIcePreparation("turn", { state: "checking", detail: "Testing TURN server" });

      const readyStunServers: NonNullable<IceProbeResult>[] = [];
      let completedStunProbes = 0;
      let connectionPreparationResolved = false;
      const resolveConnectionPreparation = () => {
        if (connectionPreparationResolved) return;
        connectionPreparationResolved = true;
        const connectionStunServers = [...readyStunServers].sort((a, b) => a.latency - b.latency);
        const primaryStunServer = connectionStunServers[0] ?? null;
        updateIcePreparation(
          "stun",
          primaryStunServer
            ? { state: "ready", detail: "Available STUN server detected", latency: primaryStunServer.latency }
            : { state: "error", detail: "STUN server unavailable" },
        );
        resolveIceConnectionPreparation?.({
          // TURN credentials are usable immediately; its diagnostic probe continues in the background.
          servers: [...connectionStunServers.map(({ server }) => server), ...turnCandidates],
        });
        resolveIceConnectionPreparation = null;
      };
      const stunProbePromises = stunCandidates.map(({ provider, server }) => probeIceServer(server, "srflx", 4_500, provider));
      const observedStunProbes = stunProbePromises.map((probe, index) => probe.then((result) => {
        completedStunProbes += 1;
        if (result && !readyStunServers.some((entry) => entry.provider === result.provider) && readyStunServers.length < 3) {
          readyStunServers.push(result);
        }
        if (readyStunServers.length === 3 || completedStunProbes === stunCandidates.length) {
          resolveConnectionPreparation();
        }
        return result;
      }));

      if (stunCandidates.length === 0) resolveConnectionPreparation();

      const [stunResults, turnResults] = await Promise.all([
        Promise.all(observedStunProbes),
        Promise.all(turnCandidates.map((server) => probeIceServer(server, "relay"))),
      ]);
      const successfulByLatency = (results: IceProbeResult[]) =>
        results
          .filter((result): result is NonNullable<IceProbeResult> => result !== null)
          .sort((a, b) => a.latency - b.latency);
      const fastestStunServers = successfulByLatency(stunResults).reduce<NonNullable<IceProbeResult>[]>(
        (selected, result) => {
          if (selected.length >= 3 || selected.some((entry) => entry.provider === result.provider)) return selected;
          selected.push(result);
          return selected;
        },
        [],
      );
      const selectedStunServers = readyStunServers.sort((a, b) => a.latency - b.latency);
      const stun = selectedStunServers[0] ?? fastestStunServers[0] ?? null;
      const turn = successfulByLatency(turnResults)[0] ?? null;
      const selectedStunServerSet = new Set(selectedStunServers.map(({ server }) => server));
      const diagnostics: IceDiagnosticEntry[] = [
        ...stunResults.map((result, index) => {
          const candidate = stunCandidates[index];
          return result
            ? {
                kind: "stun" as const,
                latency: result.latency,
                provider: candidate.provider,
                selected: selectedStunServerSet.has(result.server),
                state: "ready" as const,
                url: iceServerUrl(result.server),
              }
            : {
                kind: "stun" as const,
                provider: candidate.provider,
                selected: false,
                state: "error" as const,
                url: iceServerUrl(candidate.server),
              };
        }),
        ...turnResults.map((result, index) => {
          const server = turnCandidates[index];
          return result
            ? {
                kind: "turn" as const,
                latency: result.latency,
                provider: "cloudflare",
                selected: result === turn,
                state: "ready" as const,
                url: iceServerUrl(result.server),
              }
            : {
                kind: "turn" as const,
                provider: "cloudflare",
                selected: false,
                state: "error" as const,
                url: iceServerUrl(server),
              };
        }),
      ];

      if (turnCandidates.length === 0) {
        diagnostics.push({
          kind: "turn",
          provider: "cloudflare",
          selected: false,
          state: "error",
          url: "Cloudflare TURN",
        });
      }

      updateIcePreparation(
        "stun",
        stun
          ? { state: "ready", detail: "Available STUN server detected", latency: stun.latency }
          : { state: "error", detail: "STUN server unavailable" },
      );
      updateIcePreparation(
        "turn",
        turn
          ? { state: "ready", detail: "Available TURN server detected", latency: turn.latency }
          : {
              state: "error",
              detail: response.error === "TURN credentials are not configured."
                ? "TURN credentials are not configured."
                : "TURN server unavailable",
            },
      );

      return {
        completedAt: Date.now(),
        diagnostics,
        duration: Math.round(performance.now() - preparationStartedAt),
        resource: icePreparationSnapshot.resource,
        servers: [...selectedStunServers.map(({ server }) => server), ...turnCandidates],
        stun,
        turn,
      };
    })();
  }

  return icePreparationPromise;
}

/** Returns once three usable STUN providers have replied, while diagnostics keep measuring in the background. */
export function prepareIceServersForConnection(listener?: IcePreparationListener): Promise<IceConnectionPreparationResult> {
  void prepareIceServers(listener);
  return iceConnectionPreparationPromise ?? Promise.resolve({ servers: [] });
}

export function preloadIceServers(): void {
  void prepareIceServers();
}

export function stopObservingIceServers(listener: IcePreparationListener): void {
  icePreparationListeners.delete(listener);
}


const V2_RECONNECT_DELAYS = [250, 500, 1_000, 2_000, 4_000, 5_000] as const;
const V2_HEARTBEAT_INTERVAL = 15_000;
const V2_MAX_HEARTBEAT_MISSES = 3;
type V2HelloMode = "new" | "resume-signaling" | "restart-peer";

function v2ResumeKey(roomId: string): string {
  return `zestsend:room:${encodeURIComponent(roomId)}:resume`;
}

function v2ReadResumeToken(roomId: string): string | null {
  try {
    const token = window.sessionStorage.getItem(v2ResumeKey(roomId));
    return token && token.length <= 512 ? token : null;
  } catch {
    return null;
  }
}

function v2WriteResumeToken(roomId: string, token: string | null): void {
  try {
    const key = v2ResumeKey(roomId);
    if (token) window.sessionStorage.setItem(key, token);
    else window.sessionStorage.removeItem(key);
  } catch {
    // sessionStorage is optional in private browsing contexts.
  }
}

function v2Epoch(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

type V2Signal = SignalMessage & { from?: string; peerId?: string };

/** WebRTC session with resumable signaling and peer renegotiation. */
export class NativeWebRTCSession {
  private channels: Record<DataChannelName, RTCDataChannel | null> = { bulk: null, control: null, interactive: null };
  private closed = false;
  private suspended = false;
  private leaving = false;
  private peer: RTCPeerConnection | null = null;
  private peerGeneration = 0;
  private peerRestarting = false;
  private connectedNotified = false;
  private pendingSignals: V2Signal[] = [];
  private signalFlushPromise: Promise<void> | null = null;
  private negotiationPromise: Promise<void> | null = null;
  private offerRetryQueued = false;
  private remoteParticipantJoined = false;
  private remoteSignalingDisconnected = false;
  private remoteSlotId: string | null = null;
  private remotePeerSessionId: string | null = null;
  private initiator = false;
  private slotId: string | null = null;
  private peerSessionId: string | null = null;
  private offererSlotId: string | null = null;
  private epoch = 0;
  private resumeToken: string | null;
  private selectedServers: RTCIceServer[] = [];
  private readyForPeerConnection = false;
  private icePreparationListener: IcePreparationListener | null = null;
  private icePreparationPromise: Promise<void> | null = null;
  private socket: WebSocket | null = null;
  private socketGeneration = 0;
  private socketMode: V2HelloMode = "new";
  private reconnectMode: V2HelloMode = "new";
  private reconnectAttempt = 0;
  private reconnectTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private heartbeatStartedAt: number | null = null;
  private heartbeatMisses = 0;
  private leaveAckTimer: number | undefined;
  private progress = initialProgress();
  private dataChannelPingStartedAt: number | null = null;
  private dataChannelPingTimer: number | undefined;
  private dataChannelPingTimeout: number | undefined;
  private receivedBytes = 0;
  private sentBytes = 0;
  private receivedChatIds = new Set<string>();
  private fileTransferManager: FileTransferManager | null = null;
  private mediaTransport: MediaTransport;

  constructor(
    private readonly roomId: string,
    private readonly onProgress: (progress: ConnectionProgress) => void,
    private readonly onConnected: (session: NativeWebRTCSession) => void,
    private readonly onError: (message: string) => void,
    private readonly onRoomFull: () => void,
    private readonly onPeerLeft: () => void,
    private readonly onConnectionRoute: (route: ConnectionRoute) => void,
    private readonly onInteractiveMessage: (message: InteractiveMessage) => void,
    private readonly onChatReceipt: (id: string, status: ChatReceiptStatus) => void,
    private readonly onChatTyping: () => void,
    private readonly onStatus: (status: SessionStatus) => void = () => undefined,
  ) {
    this.resumeToken = v2ReadResumeToken(roomId);
    this.mediaTransport = new MediaTransport(
      (message) => this.sendControlMessage(message),
      undefined,
      () => this.updateDataTransferProgress(),
    );
  }

  connect(): void {
    if (this.closed || this.suspended) return;
    this.onStatus({ detail: "Opening signaling socket", state: "connecting" });
    void this.prepareIceServers();
    this.openSocket(this.resumeToken ? "resume-signaling" : "new", true);
  }

  /**
   * Releases browser transports while retaining the tab-local lease token.
   * `pageshow` can call resume() when the document returns from bfcache.
   */
  suspend(): void {
    if (this.closed || this.suspended) return;
    this.suspended = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.stopDataChannelLatencyProbe();
    this.socketGeneration += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(1_000, "Page hidden"); } catch { /* already closed */ }
    }
    this.closeDataChannels();
    this.mediaTransport.detachPeer();
    this.peer?.close();
    this.peer = null;
    this.pendingSignals = [];
    this.peerRestarting = false;
    this.connectedNotified = false;
  }

  /** Reopens a suspended session without asking the user for a token. */
  resume(): void {
    if (this.closed || !this.suspended) return;
    this.suspended = false;
    if (!this.readyForPeerConnection) {
      if (this.icePreparationListener) stopObservingIceServers(this.icePreparationListener);
      this.icePreparationListener = null;
      this.icePreparationPromise = null;
    }
    this.remoteParticipantJoined = false;
    this.remoteSignalingDisconnected = false;
    this.remoteSlotId = null;
    this.remotePeerSessionId = null;
    this.onStatus({ detail: "Reconnecting signaling socket", state: "reconnecting" });
    void this.prepareIceServers();
    this.openSocket(this.resumeToken ? "resume-signaling" : "new", true);
  }

  /** Explicit leave releases the seat and clears the tab-local resume token. */
  close(): void {
    if (this.leaving) return;
    if (this.closed && !this.socket) return;
    this.closed = true;
    this.leaving = true;
    this.onStatus({ state: "closed" });
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.stopDataChannelLatencyProbe();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSocket({ type: "leave" });
      this.leaveAckTimer = window.setTimeout(() => this.finishClose(), 500);
    } else {
      this.finishClose();
    }
  }

  private finishClose(preserveResumeToken = false): void {
    if (this.leaveAckTimer !== undefined) {
      window.clearTimeout(this.leaveAckTimer);
      this.leaveAckTimer = undefined;
    }
    if (this.icePreparationListener) {
      stopObservingIceServers(this.icePreparationListener);
      this.icePreparationListener = null;
    }
    this.stopHeartbeat();
    this.stopDataChannelLatencyProbe();
    this.closeDataChannels();
    this.mediaTransport.dispose();
    this.peer?.close();
    this.peer = null;
    this.socket?.close(1_000, "Leaving room");
    this.socket = null;
    this.leaving = false;
    this.suspended = false;
    if (!preserveResumeToken) {
      this.resumeToken = null;
      v2WriteResumeToken(this.roomId, null);
    }
  }

  send(data: string | ArrayBuffer | Blob): boolean { return this.sendOnChannel("interactive", data); }
  sendBulk(data: string | ArrayBuffer | Blob): boolean { return this.sendOnChannel("bulk", data); }
  sendControlMessage(message: { type: string; [key: string]: unknown }): boolean {
    return this.sendOnChannel("control", JSON.stringify(message));
  }
  attachFileTransferManager(manager: FileTransferManager | null): void { this.fileTransferManager = manager; }
  get dataChannel(): RTCDataChannel | null { return this.channels.interactive; }
  get media(): MediaTransport { return this.mediaTransport; }

  sendChatMessage(id: string, text: string): boolean {
    const message = text.trim();
    if (!id || id.length > 128 || !message || message.length > 4_000) return false;
    return this.sendOnChannel("interactive", JSON.stringify({ id, text: message, type: "chat" satisfies InteractiveMessage["type"] }));
  }

  private sendOnChannel(channelName: DataChannelName, data: string | ArrayBuffer | Blob): boolean {
    const channel = this.channels[channelName];
    if (channel?.readyState !== "open") return false;
    if (channelName === "bulk" && channel.bufferedAmount > 3 * 1024 * 1024) return false;
    try {
      if (typeof data === "string") channel.send(data);
      else if (data instanceof Blob) channel.send(data);
      else if (data instanceof ArrayBuffer) channel.send(data);
      else channel.send(data as any);
    } catch { return false; }
    this.sentBytes += dataSize(data);
    this.updateDataTransferProgress();
    return true;
  }

  async getTransportDiagnostics(): Promise<WebRTCTransportDiagnostics> {
    const bufferedAmount: WebRTCTransportDiagnostics["bufferedAmount"] = {
      bulk: this.channels.bulk?.readyState === "open" ? this.channels.bulk.bufferedAmount : null,
      control: this.channels.control?.readyState === "open" ? this.channels.control.bufferedAmount : null,
      interactive: this.channels.interactive?.readyState === "open" ? this.channels.interactive.bufferedAmount : null,
    };
    const fallback = {
      availableOutgoingBitrate: null, bufferedAmount, bytesReceived: null, bytesSent: null,
      currentRoundTripTime: null, localCandidateType: null, localProtocol: null,
      packetsRetransmitted: null, packetsDiscardedOnSend: null, remoteCandidateType: null,
      remoteProtocol: null, relayProtocol: null, sctpCongestionWindow: null,
      sctpReceiverWindow: null, sctpSmoothedRoundTripTime: null, sctpState: null,
    } satisfies WebRTCTransportDiagnostics;
    if (!this.peer) return fallback;
    try {
      const stats = await this.peer.getStats();
      for (const report of stats.values()) {
        if (report.type !== "candidate-pair" || report.state !== "succeeded" || (report.selected !== true && report.nominated !== true)) continue;
        const local = report.localCandidateId ? stats.get(report.localCandidateId) : undefined;
        const remote = report.remoteCandidateId ? stats.get(report.remoteCandidateId) : undefined;
        const sctp = [...stats.values()].find((entry) => entry.type === "sctp");
        return {
          availableOutgoingBitrate: typeof report.availableOutgoingBitrate === "number" ? report.availableOutgoingBitrate : null,
          bufferedAmount,
          bytesReceived: typeof report.bytesReceived === "number" ? report.bytesReceived : null,
          bytesSent: typeof report.bytesSent === "number" ? report.bytesSent : null,
          currentRoundTripTime: typeof report.currentRoundTripTime === "number" ? report.currentRoundTripTime * 1_000 : null,
          localCandidateType: typeof local?.candidateType === "string" ? local.candidateType : null,
          localProtocol: typeof local?.protocol === "string" ? local.protocol : null,
          packetsRetransmitted: typeof report.packetsRetransmitted === "number" ? report.packetsRetransmitted : null,
          packetsDiscardedOnSend: typeof report.packetsDiscardedOnSend === "number" ? report.packetsDiscardedOnSend : null,
          remoteCandidateType: typeof remote?.candidateType === "string" ? remote.candidateType : null,
          remoteProtocol: typeof remote?.protocol === "string" ? remote.protocol : null,
          relayProtocol: typeof local?.relayProtocol === "string" ? local.relayProtocol : null,
          sctpCongestionWindow: typeof sctp?.congestionWindow === "number" ? sctp.congestionWindow : null,
          sctpReceiverWindow: typeof sctp?.receiverWindow === "number" ? sctp.receiverWindow : null,
          sctpSmoothedRoundTripTime: typeof sctp?.smoothedRoundTripTime === "number" ? sctp.smoothedRoundTripTime * 1_000 : null,
          sctpState: typeof sctp?.state === "string" ? sctp.state : null,
        };
      }
    } catch { /* stats are optional */ }
    return fallback;
  }

  private async prepareIceServers(): Promise<void> {
    if (this.icePreparationPromise) return this.icePreparationPromise;
    this.icePreparationPromise = (async () => {
      const listener: IcePreparationListener = (step, status) => this.setStep(step, status);
      this.icePreparationListener = listener;
      try { this.selectedServers = (await prepareIceServersForConnection(listener)).servers; } catch { this.selectedServers = []; }
      if (this.closed || this.suspended) return;
      this.readyForPeerConnection = true;
      if (!this.remoteParticipantJoined) this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
      await this.flushSignals();
      if (this.remoteParticipantJoined && this.initiator && !this.peer) await this.createOffer();
    })();
    return this.icePreparationPromise;
  }

  private openSocket(mode: V2HelloMode, resetBackoff = false): void {
    if (this.closed || this.suspended) return;
    this.clearReconnectTimer();
    if (resetBackoff) this.reconnectAttempt = 0;
    this.stopHeartbeat();
    const previous = this.socket;
    if (previous && previous.readyState !== WebSocket.CLOSED) {
      previous.onopen = null; previous.onmessage = null; previous.onerror = null; previous.onclose = null;
      previous.close(1_000, "Replacing signaling socket");
    }
    this.socketMode = mode;
    this.reconnectMode = mode;
    this.heartbeatMisses = 0;
    this.heartbeatStartedAt = null;
    const generation = ++this.socketGeneration;
    this.setStep("websocket", { state: "checking", detail: "Opening signaling socket" });
    try {
      const socket = new WebSocket(websocketUrl(this.roomId));
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.socketGeneration || this.closed || this.suspended) return;
        this.setStep("websocket", { state: "active", detail: "Signaling socket connected" });
        this.startHeartbeat(generation);
        const token = mode === "new" ? undefined : this.resumeToken ?? undefined;
        this.sendSocket({ type: "hello", mode, ...(token ? { resumeToken: token } : {}) });
        void this.prepareIceServers();
      };
      socket.onmessage = (event) => {
        if (generation === this.socketGeneration && !this.suspended && (!this.closed || this.leaving)) {
          this.handleSocketMessage(String(event.data));
        }
      };
      socket.onerror = () => {
        if (generation !== this.socketGeneration || this.closed || this.suspended) return;
        this.setStep("websocket", { state: "error", detail: "The signaling WebSocket could not be opened." });
        try { socket.close(1_011, "Signaling socket error"); } catch { /* close event will handle retry */ }
      };
      socket.onclose = () => {
        if (generation !== this.socketGeneration) return;
        this.stopHeartbeat(); this.socket = null;
        if (this.closed || this.suspended) return;
        this.setStep("websocket", { state: "checking", detail: "Signaling socket closed" });
        this.scheduleSocketReconnect(this.reconnectMode);
      };
    } catch { this.scheduleSocketReconnect(mode); }
  }

  private handleSocketMessage(rawMessage: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(rawMessage) as ServerMessage; } catch { return; }
    if (message.type === "welcome") {
      const oldEpoch = this.epoch;
      this.slotId = message.slotId ?? message.peerId ?? this.slotId;
      this.peerSessionId = message.peerSessionId ?? this.peerSessionId;
      this.offererSlotId = message.offererSlotId ?? this.offererSlotId;
      const epoch = v2Epoch(message.epoch);
      if (epoch !== undefined && epoch !== this.epoch) { this.epoch = epoch; this.pendingSignals = []; }
      if (typeof message.resumeToken === "string" && message.resumeToken.length <= 512) {
        this.resumeToken = message.resumeToken; v2WriteResumeToken(this.roomId, message.resumeToken);
      }
      // Once admitted, ordinary signaling reconnects must resume this seat;
      // only an explicit peer restart should rotate the peer session.
      this.reconnectMode = this.resumeToken ? "resume-signaling" : "new";
      this.initiator = message.offererSlotId ? message.offererSlotId === this.slotId : message.isInitiator;
      const hadRemoteParticipant = this.remoteParticipantJoined;
      this.remoteParticipantJoined = message.peerCount > 1;
      if (!this.remoteParticipantJoined) {
        this.remoteSlotId = null;
        this.remotePeerSessionId = null;
        this.remoteSignalingDisconnected = hadRemoteParticipant;
      } else {
        this.remoteSignalingDisconnected = false;
      }
      if (this.socketMode === "restart-peer" && oldEpoch !== 0 && this.epoch !== oldEpoch) this.resetPeerForNegotiation();
      this.reconnectAttempt = 0;
      this.setStep("websocket", { state: "active", detail: "Signaling socket connected" });
      this.onStatus({ detail: "Signaling socket connected", state: "connected" });
      if (!this.initiator && !this.peer) this.setStep("p2p", { state: "pending", detail: "Waiting for connection offer" });
      // A full page refresh can resume the signaling lease without retaining
      // the old RTCPeerConnection. Ask the room to rotate the peer session so
      // both sides receive a fresh negotiate event.
      if (message.resumed && message.peerCount > 1 && !this.peer && this.socketMode === "resume-signaling") {
        this.peerRestarting = true;
        this.openSocket("restart-peer");
        return;
      }
      void this.flushSignals();
      // A restart handshake is followed by a recipient-relative `negotiate`
      // event. Waiting for it prevents an offer from the previous epoch from
      // racing the fresh peer session.
      if (this.socketMode !== "restart-peer" && this.remoteParticipantJoined && this.initiator && this.readyForPeerConnection && !this.peer) {
        void this.createOffer();
      }
      // A signaling-only interruption does not close the SCTP channels. In
      // that case no channel `onopen` event fires again, so explicitly restore
      // the ready UI after the signaling lease is resumed.
      if (this.connectedNotified && this.openDataChannelCount() === DATA_CHANNEL_COUNT) this.onConnected(this);
      return;
    }
    if (message.type === "pong") {
      if (this.heartbeatStartedAt === null) return;
      const latency = Math.round(performance.now() - this.heartbeatStartedAt);
      this.heartbeatStartedAt = null; this.heartbeatMisses = 0;
      this.setStep("websocket", { state: "active", detail: "Signaling socket connected", latency });
      return;
    }
    if (message.type === "left") { if (this.leaving) this.finishClose(); return; }
    if (message.type === "peer-ready" || message.type === "negotiate") {
      if (!this.updateRemoteMetadata(message)) return;
      this.remoteParticipantJoined = true;
      this.remoteSignalingDisconnected = false;
      if (message.type === "negotiate") this.resetPeerForNegotiation();
      if (!this.readyForPeerConnection) this.setStep("p2p", { state: "checking", detail: "Peer joined, preparing P2P connection" });
      // `peer-ready` is an admission hint. The worker follows it with a
      // recipient-relative `negotiate` event; waiting for that event avoids
      // creating an offer that is immediately invalidated by the new epoch.
      if (message.type === "negotiate" && this.initiator && this.readyForPeerConnection && !this.peer) void this.createOffer();
      return;
    }
    if (message.type === "peer-disconnected" || message.type === "peer-reconnected") {
      if (!this.updateRemoteMetadata(message as unknown as { epoch?: number; peerId?: string; peerSessionId?: string; slotId?: string; offererSlotId?: string })) return;
      if (message.type === "peer-disconnected") {
        this.remoteSignalingDisconnected = true;
        // Keep the P2P transport alive while the remote signaling lease is
        // within its grace period; the room will emit peer-left on expiry.
        this.onStatus({ detail: "Waiting for the other participant to reconnect", state: "reconnecting" });
      } else {
        this.remoteParticipantJoined = true;
        this.remoteSignalingDisconnected = false;
        this.peerRestarting = false;
        this.onStatus({ detail: "Signaling socket connected", state: "connected" });
        const peerNeedsReset = !this.peer
          || this.peer.connectionState !== "connected"
          || this.openDataChannelCount() !== DATA_CHANNEL_COUNT;
        if (this.peer && peerNeedsReset) this.resetPeerForNegotiation();
        if (!this.peer && this.readyForPeerConnection) {
          if (this.initiator) void this.createOffer();
          else this.requestPeerRestart();
        }
      }
      return;
    }
    if (message.type === "replaced") {
      this.closed = true;
      this.finishClose(true);
      this.onStatus({ detail: "Signaling connection replaced", state: "closed" });
      return;
    }
    if (message.type === "signal") {
      const signal = message as V2Signal;
      signal.fromSlotId ??= signal.from ?? signal.peerId;
      if (!this.acceptSignal(signal)) return;
      this.pendingSignals.push(signal); void this.flushSignals(); return;
    }
    if (message.type === "peer-left") {
      const eventEpoch = v2Epoch(message.epoch);
      if (eventEpoch !== undefined && this.epoch !== 0 && eventEpoch < this.epoch) return;
      if (message.peerSessionId && this.remotePeerSessionId && message.peerSessionId !== this.remotePeerSessionId) return;
      if (eventEpoch !== undefined && eventEpoch > this.epoch) {
        this.epoch = eventEpoch;
        this.pendingSignals = [];
      }
      this.remoteParticipantJoined = false; this.remoteSlotId = null; this.remotePeerSessionId = null;
      this.remoteSignalingDisconnected = false;
      this.stopDataChannelLatencyProbe(); this.closeDataChannels(); this.mediaTransport.detachPeer();
      this.peer?.close(); this.peer = null; this.peerRestarting = false; this.connectedNotified = false;
      this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
      this.setStep("dataChannel", { channels: 0, state: "pending", detail: "Waiting for data channel", transferred: this.dataTransfer() });
      this.onPeerLeft(); return;
    }
    if (message.type === "error") {
      if (message.code === "room-full") { this.clearReconnectTimer(); this.onRoomFull(); return; }
      if (message.code === "room-reserved") {
        this.setStep("websocket", { state: "checking", detail: "Room temporarily reserved; retrying automatically" });
        this.onStatus({ detail: "Room temporarily reserved; retrying automatically", retryAfterMs: message.retryAfterMs, state: "reserved" });
        this.scheduleReservedRetry(message.retryAfterMs); return;
      }
      if (message.code === "resume-invalid") {
        this.resumeToken = null; v2WriteResumeToken(this.roomId, null); this.scheduleSocketReconnect("new", true); return;
      }
      this.fail(message.message);
    }
  }

  private updateRemoteMetadata(message: { epoch?: number; peerId?: string; peerSessionId?: string; slotId?: string; offererSlotId?: string; peers?: Array<{ slotId?: string; peerSessionId?: string }> }): boolean {
    const epoch = v2Epoch(message.epoch);
    if (epoch !== undefined && this.epoch !== 0 && epoch < this.epoch) return false;
    if (epoch !== undefined && epoch !== this.epoch) { this.epoch = epoch; this.pendingSignals = []; }
    const announcedSlotId = message.slotId ?? message.peerId;
    const announcedPeerSessionId = message.peerSessionId;
    const peerFromList = message.peers?.find((peer) => peer.slotId && peer.slotId !== this.slotId);
    if (announcedSlotId && announcedSlotId !== this.slotId) {
      this.remoteSlotId = announcedSlotId;
      this.remotePeerSessionId = announcedPeerSessionId ?? this.remotePeerSessionId;
    } else if (peerFromList?.slotId) {
      this.remoteSlotId = peerFromList.slotId;
      this.remotePeerSessionId = peerFromList.peerSessionId ?? this.remotePeerSessionId;
    }
    if (message.offererSlotId) { this.offererSlotId = message.offererSlotId; this.initiator = this.offererSlotId === this.slotId; }
    return true;
  }

  private acceptSignal(signal: V2Signal): boolean {
    const epoch = v2Epoch(signal.epoch);
    if (epoch !== undefined && this.epoch !== 0 && epoch < this.epoch) return false;
    if (epoch !== undefined && epoch > this.epoch) {
      this.epoch = epoch;
      this.pendingSignals = [];
    }
    if (signal.fromSlotId && this.remoteSlotId && signal.fromSlotId !== this.remoteSlotId) return false;
    if (signal.peerSessionId && this.remotePeerSessionId && signal.peerSessionId !== this.remotePeerSessionId) return false;
    if (epoch !== undefined && this.epoch === 0) this.epoch = epoch;
    if (signal.fromSlotId) this.remoteSlotId = signal.fromSlotId;
    if (signal.peerSessionId) this.remotePeerSessionId = signal.peerSessionId;
    return true;
  }

  private async createOffer(): Promise<void> {
    if (!this.readyForPeerConnection || !this.remoteParticipantJoined || !this.initiator || this.closed || this.suspended || this.peer) return;
    if (this.negotiationPromise) {
      if (!this.offerRetryQueued) {
        this.offerRetryQueued = true;
        const pending = this.negotiationPromise;
        const retry = () => {
          this.offerRetryQueued = false;
          if (!this.closed && !this.suspended && this.remoteParticipantJoined && this.initiator && this.readyForPeerConnection && !this.peer) {
            void this.createOffer();
          }
        };
        void pending.then(retry, retry);
      }
      return;
    }
    this.negotiationPromise = this.performCreateOffer().finally(() => { this.negotiationPromise = null; });
    await this.negotiationPromise;
  }

  private async performCreateOffer(): Promise<void> {
    const peer = this.createPeerConnection();
    const offerEpoch = this.epoch;
    this.mediaTransport.prepareOffer(peer);
    for (const name of DATA_CHANNEL_NAMES) this.attachDataChannel(peer.createDataChannel(name, { ordered: name !== "bulk" }));
    this.setStep("p2p", { state: "checking", detail: "Creating P2P offer" });
    try {
      const offer = await peer.createOffer();
      if (this.closed || this.suspended || this.peer !== peer || this.epoch !== offerEpoch) return;
      await peer.setLocalDescription(offer);
      if (this.closed || this.suspended || this.peer !== peer || this.epoch !== offerEpoch) return;
      this.sendSignal({ description: offer });
    } catch { if (!this.closed && this.peer === peer) this.requestPeerRestart(); }
  }

  private createPeerConnection(): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: this.selectedServers });
    const generation = ++this.peerGeneration;
    this.peer = peer;
    peer.onicecandidate = ({ candidate }) => { if (candidate && this.peer === peer && generation === this.peerGeneration) this.sendSignal({ candidate: asCandidate(candidate) }); };
    peer.ontrack = (event) => { if (this.peer === peer && generation === this.peerGeneration) this.mediaTransport.handleRemoteTrack(event); };
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer || generation !== this.peerGeneration || this.closed || this.suspended) return;
      if (peer.connectionState === "failed") this.requestPeerRestart();
      if (peer.connectionState === "connected") { this.setStep("p2p", { state: "active", detail: "P2P connection established" }); void this.detectConnectionRoute(peer); }
    };
    peer.ondatachannel = ({ channel }) => { if (this.peer === peer && generation === this.peerGeneration) this.attachDataChannel(channel); };
    return peer;
  }

  private async flushSignals(): Promise<void> {
    if (!this.readyForPeerConnection || this.closed || this.suspended) return;
    if (this.signalFlushPromise) return this.signalFlushPromise;
    this.signalFlushPromise = this.flushSignalsInternal().finally(() => { this.signalFlushPromise = null; });
    return this.signalFlushPromise;
  }

  private async flushSignalsInternal(): Promise<void> {
    while (this.pendingSignals.length && !this.closed && !this.suspended) {
      const signal = this.pendingSignals.shift();
      if (!signal?.payload) continue;
      const { candidate, description } = signal.payload;
      const signalEpoch = this.epoch;
      try {
        if (description) {
          const peer = this.peer ?? this.createPeerConnection();
          if (description.type === "offer" && peer.signalingState === "have-local-offer") await peer.setLocalDescription({ type: "rollback" });
          if (this.closed || this.suspended || this.peer !== peer || this.epoch !== signalEpoch) return;
          await peer.setRemoteDescription(description);
          if (this.closed || this.suspended || this.peer !== peer || this.epoch !== signalEpoch) return;
          if (description.type === "offer") {
            this.mediaTransport.bindIncomingPeer(peer);
            this.setStep("p2p", { state: "checking", detail: "Accepting P2P offer" });
            const answer = await peer.createAnswer();
            if (this.closed || this.suspended || this.peer !== peer || this.epoch !== signalEpoch) return;
            await peer.setLocalDescription(answer);
            if (this.closed || this.suspended || this.peer !== peer || this.epoch !== signalEpoch) return;
            this.sendSignal({ description: answer });
          }
        }
        if (candidate) {
          const peer = this.peer;
          if (peer?.remoteDescription) {
            await peer.addIceCandidate(candidate);
            if (this.closed || this.suspended || this.peer !== peer || this.epoch !== signalEpoch) return;
          }
          else {
            // Candidates can arrive before the offer. Keep them behind any
            // queued description so one early candidate cannot block the
            // whole signaling queue.
            const hasQueuedDescription = this.pendingSignals.some((queued) => queued.payload?.description);
            if (hasQueuedDescription) {
              this.pendingSignals.push(signal);
              continue;
            }
            this.pendingSignals.unshift(signal);
            return;
          }
        }
      } catch { if (!this.closed && !this.suspended) this.requestPeerRestart(); return; }
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    if (!isDataChannelName(channel.label)) { channel.close(); return; }
    const name = channel.label;
    const previous = this.channels[name];
    if (previous && previous !== channel) {
      previous.onclose = null;
      previous.onerror = null;
      try { previous.close(); } catch { /* already closed */ }
    }
    this.channels[name] = channel; channel.binaryType = "arraybuffer"; this.updateDataChannelProgress();
    channel.onopen = () => {
      if (this.channels[name] !== channel || this.closed || this.suspended) return;
      this.updateDataChannelProgress(); if (name === "control") this.startDataChannelLatencyProbe();
      if (this.openDataChannelCount() === DATA_CHANNEL_COUNT && !this.connectedNotified) {
        this.connectedNotified = true; this.peerRestarting = false; this.onStatus({ detail: "Peer-to-peer connection established", state: "connected" }); this.onConnected(this);
      }
      if (this.peer) void this.detectConnectionRoute(this.peer);
    };
    channel.onmessage = (event) => {
      if (this.channels[name] !== channel) return;
      this.receivedBytes += dataSize(event.data); this.updateDataTransferProgress();
      if (name === "control") this.handleDataChannelMessage(event.data);
      if (name === "interactive") this.handleInteractiveMessage(event.data);
      if (name === "bulk" && event.data instanceof ArrayBuffer) this.fileTransferManager?.handleSegment(event.data);
    };
    channel.onclose = () => { if (this.channels[name] === channel) this.requestPeerRestart(); };
    channel.onerror = () => { if (this.channels[name] === channel) this.requestPeerRestart(); };
  }

  /** Clears the current peer transport while retaining local capture tracks and application state. */
  private resetPeerForNegotiation(): void {
    this.connectedNotified = false;
    this.peerRestarting = false;
    this.stopDataChannelLatencyProbe();
    this.closeDataChannels();
    this.mediaTransport.detachPeer();
    const peer = this.peer;
    this.peer = null;
    peer?.close();
    this.pendingSignals = [];
    this.setStep("p2p", { state: "checking", detail: "Reconnecting peer-to-peer connection" });
    this.setStep("dataChannel", { channels: 0, state: "checking", detail: "Reconnecting data channels", transferred: this.dataTransfer() });
  }

  private requestPeerRestart(): void {
    if (this.closed || this.suspended || this.peerRestarting || !this.remoteParticipantJoined) return;
    const waitForRemote = this.remoteSignalingDisconnected;
    this.peerRestarting = !waitForRemote;
    this.connectedNotified = false; this.stopDataChannelLatencyProbe(); this.closeDataChannels();
    this.mediaTransport.detachPeer(); const peer = this.peer; this.peer = null; peer?.close();
    this.setStep("p2p", { state: "checking", detail: "Reconnecting peer-to-peer connection" });
    this.setStep("dataChannel", { channels: 0, state: "checking", detail: "Reconnecting data channels", transferred: this.dataTransfer() });
    this.onStatus({ detail: waitForRemote ? "Waiting for the other participant to reconnect" : "Reconnecting peer-to-peer connection", state: "reconnecting" });
    if (!waitForRemote) this.openSocket("restart-peer");
  }

  private detectConnectionRoute = async (peer: RTCPeerConnection): Promise<void> => {
    try {
      const stats = await peer.getStats();
      for (const report of stats.values()) {
        if (report.type !== "candidate-pair" || report.state !== "succeeded" || (report.selected !== true && report.nominated !== true)) continue;
        const local = report.localCandidateId ? stats.get(report.localCandidateId) : undefined;
        const route: ConnectionRoute = local?.candidateType === "relay" ? "relay" : "direct";
        this.fileTransferManager?.setConnectionRoute(route); this.onConnectionRoute(route); return;
      }
    } catch { /* stats are optional */ }
  };

  private sendSignal(payload: SignalMessage["payload"]): void {
    this.sendSocket({ type: "signal", epoch: this.epoch, fromSlotId: this.slotId ?? undefined, peerSessionId: this.peerSessionId ?? undefined, payload });
  }

  private startHeartbeat(generation: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.closed || this.suspended || generation !== this.socketGeneration || this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.heartbeatStartedAt !== null) {
        this.heartbeatMisses += 1;
        if (this.heartbeatMisses >= V2_MAX_HEARTBEAT_MISSES) { this.socket?.close(4_001, "Signaling heartbeat timeout"); return; }
      }
      this.heartbeatStartedAt = performance.now(); this.sendSocket({ type: "ping" });
    }, V2_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) { window.clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    this.heartbeatStartedAt = null; this.heartbeatMisses = 0;
  }

  private scheduleSocketReconnect(mode: V2HelloMode, immediate = false): void {
    if (this.closed || this.suspended || this.reconnectTimer !== undefined) return;
    this.reconnectMode = mode;
    const base = immediate ? 0 : V2_RECONNECT_DELAYS[Math.min(this.reconnectAttempt++, V2_RECONNECT_DELAYS.length - 1)];
    const jitter = base ? Math.round(base * (Math.random() * 0.2 - 0.1)) : 0;
    const delay = Math.max(0, base + jitter);
    this.onStatus({ detail: "Reconnecting signaling socket", retryAfterMs: delay, state: "reconnecting" });
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = undefined; this.openSocket(this.reconnectMode); }, delay);
  }

  private scheduleReservedRetry(retryAfterMs?: number): void {
    if (this.closed || this.suspended || this.reconnectTimer !== undefined) return;
    const delay = Math.min(30_000, Math.max(250, Math.round(retryAfterMs ?? 1_000)));
    this.reconnectMode = this.resumeToken ? "resume-signaling" : "new";
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = undefined; this.openSocket(this.reconnectMode); }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
  }

  private sendSocket(message: object): boolean {
    const messageType = (message as { type?: unknown }).type;
    const leavingMessage = this.leaving && messageType === "leave";
    if (this.suspended || (this.closed && !leavingMessage) || this.socket?.readyState !== WebSocket.OPEN) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  private handleDataChannelMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: DataChannelControlMessage;
    try { message = JSON.parse(data) as DataChannelControlMessage; } catch { return; }
    this.fileTransferManager?.handleControl(message as unknown as { type: string; [key: string]: unknown });
    if (this.mediaTransport.handleControlMessage(message)) return;
    if (message.type === "chat-received" || message.type === "chat-read") {
      if (typeof message.id === "string" && message.id.length > 0 && message.id.length <= 128) this.onChatReceipt(message.id, message.type === "chat-read" ? "read" : "received");
      return;
    }
    if (message.type === "chat-typing") { this.onChatTyping(); return; }
    if (message.type === "zestsend-ping") { this.sendDataChannelControl({ id: message.id, type: "zestsend-pong" }); return; }
    const startedAt = this.dataChannelPingStartedAt;
    if (message.type !== "zestsend-pong" || startedAt === null || message.id !== String(startedAt)) return;
    this.dataChannelPingStartedAt = null;
    if (this.dataChannelPingTimeout !== undefined) { window.clearTimeout(this.dataChannelPingTimeout); this.dataChannelPingTimeout = undefined; }
    this.setStep("p2p", { state: "active", detail: "P2P connection established", latency: Math.round(performance.now() - startedAt) });
  }

  private handleInteractiveMessage(data: unknown): void {
    if (typeof data !== "string") return;
    try {
      const message = JSON.parse(data) as unknown;
      if (!isInteractiveMessage(message)) return;
      this.sendDataChannelControl({ id: message.id, type: "chat-received" });
      if (this.receivedChatIds.has(message.id)) return;
      this.receivedChatIds.add(message.id); this.onInteractiveMessage(message);
    } catch { /* malformed application messages are ignored */ }
  }

  private startDataChannelLatencyProbe(): void {
    this.stopDataChannelLatencyProbe(); this.measureDataChannelLatency();
    this.dataChannelPingTimer = window.setInterval(() => this.measureDataChannelLatency(), 5_000);
  }
  private stopDataChannelLatencyProbe(): void {
    if (this.dataChannelPingTimer !== undefined) { window.clearInterval(this.dataChannelPingTimer); this.dataChannelPingTimer = undefined; }
    if (this.dataChannelPingTimeout !== undefined) { window.clearTimeout(this.dataChannelPingTimeout); this.dataChannelPingTimeout = undefined; }
    this.dataChannelPingStartedAt = null;
  }
  private measureDataChannelLatency(): void {
    if (this.closed || this.dataChannelPingStartedAt !== null || this.channels.control?.readyState !== "open") return;
    const startedAt = performance.now(); this.dataChannelPingStartedAt = startedAt;
    this.sendDataChannelControl({ id: String(startedAt), type: "zestsend-ping" });
    this.dataChannelPingTimeout = window.setTimeout(() => { this.dataChannelPingStartedAt = null; this.dataChannelPingTimeout = undefined; }, 5_000);
  }
  private sendDataChannelControl(message: DataChannelControlMessage): void { this.sendOnChannel("control", JSON.stringify(message)); }
  markChatMessageRead(id: string): boolean {
    if (!id || id.length > 128) return false;
    return this.sendOnChannel("control", JSON.stringify({ id, type: "chat-read" satisfies ChatReceiptMessage["type"] }));
  }
  sendChatTyping(): boolean { return this.sendOnChannel("control", JSON.stringify({ type: "chat-typing" satisfies ChatTypingMessage["type"] })); }
  private openDataChannelCount(): number { return DATA_CHANNEL_NAMES.filter((name) => this.channels[name]?.readyState === "open").length; }
  private updateDataChannelProgress(): void {
    const channels = this.openDataChannelCount();
    this.setStep("dataChannel", { channels, detail: channels === DATA_CHANNEL_COUNT ? "Data channels ready" : "Opening data channels", state: channels === DATA_CHANNEL_COUNT ? "active" : "checking", transferred: this.dataTransfer() });
  }
  private updateDataTransferProgress(): void { this.setStep("dataChannel", { ...this.progress.dataChannel, transferred: this.dataTransfer() }); }
  private dataTransfer(): { received: number; sent: number } {
    const traffic = this.mediaTransport.traffic; return { received: this.receivedBytes + traffic.received, sent: this.sentBytes + traffic.sent };
  }
  private closeDataChannels(): void {
    for (const name of DATA_CHANNEL_NAMES) {
      const channel = this.channels[name]; if (!channel) continue;
      channel.onclose = null; channel.onerror = null; channel.onopen = null; channel.onmessage = null;
      try { channel.close(); } catch { /* already closed */ }
      this.channels[name] = null;
    }
  }
  private setStep(step: keyof ConnectionProgress, value: ConnectionStep): void { this.progress = { ...this.progress, [step]: value }; this.onProgress(this.progress); }
  private fail(message: string): void { if (this.closed || this.suspended) return; this.setStep("p2p", { state: "error", detail: message }); this.onError(message); }
}
