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
  payload?: {
    candidate?: RTCIceCandidateInit;
    description?: RTCSessionDescriptionInit;
  };
  type: "signal";
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
// Kept local to development while validating relay-path behavior.
const FORCE_TURN_RELAY_FOR_DIAGNOSTICS = true;
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
  | { isInitiator: boolean; peerCount: number; peerId: string; type: "welcome" }
  | { peerId: string; type: "peer-ready" }
  | { peerId?: string; type: "peer-left" }
  | SignalMessage
  | { code?: "room-full"; message: string; type: "error" }
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

/** Native WebRTC session using a Durable Object WebSocket only for SDP and ICE signaling. */
export class NativeWebRTCSession {
  private channels: Record<DataChannelName, RTCDataChannel | null> = {
    bulk: null,
    control: null,
    interactive: null,
  };
  private closed = false;
  private initiator = false;
  private peer: RTCPeerConnection | null = null;
  private pendingSignals: SignalMessage[] = [];
  private remoteParticipantJoined = false;
  private icePreparationListener: IcePreparationListener | null = null;
  private progress = initialProgress();
  private readyForPeerConnection = false;
  private selectedServers: RTCIceServer[] = [];
  private socket: WebSocket | null = null;
  private socketPingStartedAt: number | null = null;
  private socketPingTimer: number | undefined;
  private socketPingTimeout: number | undefined;
  private dataChannelPingStartedAt: number | null = null;
  private dataChannelPingTimer: number | undefined;
  private dataChannelPingTimeout: number | undefined;
  private receivedBytes = 0;
  private receivedChatIds = new Set<string>();
  private sentBytes = 0;
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
  ) {
    this.mediaTransport = new MediaTransport(
      (message) => this.sendControlMessage(message),
      undefined,
      () => this.updateDataTransferProgress(),
    );
  }

  connect(): void {
    this.setStep("websocket", { state: "checking", detail: "Opening signaling socket" });
    this.socket = new WebSocket(websocketUrl(this.roomId));
    this.socket.addEventListener("open", () => {
      this.startSocketLatencyProbe();
      void this.prepareIceServers();
    });
    this.socket.addEventListener("message", (event) => this.handleSocketMessage(String(event.data)));
    this.socket.addEventListener("error", () => this.fail("The signaling WebSocket could not be opened."));
    this.socket.addEventListener("close", () => {
      this.stopSocketLatencyProbe();
      if (!this.closed && this.progress.dataChannel.state !== "active") {
        this.setStep("websocket", { state: "error", detail: "Signaling socket closed" });
      }
    });
  }

  close(): void {
    this.closed = true;
    if (this.icePreparationListener) {
      stopObservingIceServers(this.icePreparationListener);
      this.icePreparationListener = null;
    }
    this.stopSocketLatencyProbe();
    this.stopDataChannelLatencyProbe();
    this.closeDataChannels();
    this.mediaTransport.dispose();
    this.peer?.close();
    this.socket?.close();
  }

  send(data: string | ArrayBuffer | Blob): boolean {
    return this.sendOnChannel("interactive", data);
  }

  sendBulk(data: string | ArrayBuffer | Blob): boolean {
    return this.sendOnChannel("bulk", data);
  }

  sendControlMessage(message: { type: string; [key: string]: unknown }): boolean {
    return this.sendOnChannel("control", JSON.stringify(message));
  }

  attachFileTransferManager(manager: FileTransferManager | null): void {
    this.fileTransferManager = manager;
    if (manager && FORCE_TURN_RELAY_FOR_DIAGNOSTICS) manager.setConnectionRoute("relay");
  }

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
      else channel.send(data);
    } catch {
      return false;
    }
    this.sentBytes += dataSize(data);
    this.updateDataTransferProgress();
    return true;
  }

  get dataChannel(): RTCDataChannel | null {
    return this.channels.interactive;
  }

  get media(): MediaTransport {
    return this.mediaTransport;
  }

  async getTransportDiagnostics(): Promise<WebRTCTransportDiagnostics> {
    const bufferedAmount: WebRTCTransportDiagnostics["bufferedAmount"] = {
      bulk: this.channels.bulk?.readyState === "open" ? this.channels.bulk.bufferedAmount : null,
      control: this.channels.control?.readyState === "open" ? this.channels.control.bufferedAmount : null,
      interactive: this.channels.interactive?.readyState === "open" ? this.channels.interactive.bufferedAmount : null,
    };
    const fallback = {
      availableOutgoingBitrate: null,
      bufferedAmount,
      bytesReceived: null,
      bytesSent: null,
      currentRoundTripTime: null,
      localCandidateType: null,
      localProtocol: null,
      packetsRetransmitted: null,
      packetsDiscardedOnSend: null,
      remoteCandidateType: null,
      remoteProtocol: null,
      relayProtocol: null,
      sctpCongestionWindow: null,
      sctpReceiverWindow: null,
      sctpSmoothedRoundTripTime: null,
      sctpState: null,
    } satisfies WebRTCTransportDiagnostics;
    if (!this.peer) return fallback;

    try {
      const stats = await this.peer.getStats();
      for (const report of stats.values()) {
        if (report.type !== "candidate-pair" || report.state !== "succeeded") continue;
        if (report.selected !== true && report.nominated !== true) continue;
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
    } catch {
      // The diagnostics view remains useful even if this browser withholds stats.
    }
    return fallback;
  }

  private async prepareIceServers(): Promise<void> {
    const listener: IcePreparationListener = (step, status) => this.setStep(step, status);
    this.icePreparationListener = listener;
    const preparation = await prepareIceServersForConnection(listener);
    this.selectedServers = preparation.servers;

    this.readyForPeerConnection = true;
    this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
    await this.flushSignals();
    if (this.remoteParticipantJoined) await this.createOffer();
  }

  private handleSocketMessage(rawMessage: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(rawMessage) as ServerMessage;
    } catch {
      return;
    }

    if (message.type === "welcome") {
      this.initiator = message.isInitiator;
      this.setStep("websocket", { state: "active", detail: "Signaling socket connected" });
      if (!this.initiator) this.setStep("p2p", { state: "pending", detail: "Waiting for connection offer" });
      return;
    }

    if (message.type === "pong") {
      if (this.socketPingStartedAt === null) return;
      const latency = Math.round(performance.now() - this.socketPingStartedAt);
      this.socketPingStartedAt = null;
      if (this.socketPingTimeout !== undefined) {
        window.clearTimeout(this.socketPingTimeout);
        this.socketPingTimeout = undefined;
      }
      this.setStep("websocket", {
        state: "active",
        detail: "Signaling socket connected",
        latency,
      });
      return;
    }

    if (message.type === "peer-ready") {
      this.remoteParticipantJoined = true;
      if (!this.readyForPeerConnection) {
        this.setStep("p2p", { state: "checking", detail: "Peer joined, preparing P2P connection" });
      }
      void this.createOffer();
      return;
    }

    if (message.type === "signal") {
      this.pendingSignals.push(message);
      void this.flushSignals();
      return;
    }

    if (message.type === "peer-left") {
      this.remoteParticipantJoined = false;
      this.stopDataChannelLatencyProbe();
      this.useConnectingSocketLatencyInterval();
      this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
      this.setStep("dataChannel", { channels: 0, state: "pending", detail: "Waiting for data channel", transferred: this.dataTransfer() });
      this.closeDataChannels();
      this.mediaTransport.stopLocalTracks();
      this.mediaTransport.detachPeer();
      this.peer?.close();
      this.peer = null;
      this.onPeerLeft();
      return;
    }

    if (message.type === "error") {
      if (message.code === "room-full") {
        this.onRoomFull();
        return;
      }
      this.fail(message.message);
    }
  }

  private async createOffer(): Promise<void> {
    if (!this.readyForPeerConnection || this.peer || this.closed) return;
    const peer = this.createPeerConnection();
    this.mediaTransport.prepareOffer(peer);
    for (const channelName of DATA_CHANNEL_NAMES) {
      this.attachDataChannel(peer.createDataChannel(channelName, { ordered: channelName !== "bulk" }));
    }
    this.setStep("p2p", { state: "checking", detail: "Creating P2P offer" });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.sendSignal({ description: offer });
  }

  private createPeerConnection(): RTCPeerConnection {
    // Development weak-network test mode: prevent direct host/srflx paths so
    // every room data channel traverses the configured TURN relay.
    const peer = new RTCPeerConnection({ iceServers: this.selectedServers, iceTransportPolicy: FORCE_TURN_RELAY_FOR_DIAGNOSTICS ? "relay" : "all" });
    this.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate: asCandidate(candidate) });
    };
    peer.ontrack = (event) => this.mediaTransport.handleRemoteTrack(event);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") this.fail("P2P connection failed.");
      if (peer.connectionState === "connected") {
        this.setStep("p2p", { state: "active", detail: "P2P connection established" });
        void this.detectConnectionRoute(peer);
      }
    };
    peer.ondatachannel = ({ channel }) => this.attachDataChannel(channel);
    return peer;
  }

  private async flushSignals(): Promise<void> {
    if (!this.readyForPeerConnection || this.closed) return;
    while (this.pendingSignals.length) {
      const signal = this.pendingSignals.shift();
      if (!signal?.payload) continue;
      const { candidate, description } = signal.payload;

      if (description) {
        const peer = this.peer ?? this.createPeerConnection();
        await peer.setRemoteDescription(description);
        if (description.type === "offer") {
          this.mediaTransport.bindIncomingPeer(peer);
          this.setStep("p2p", { state: "checking", detail: "Accepting P2P offer" });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.sendSignal({ description: answer });
        }
      }

      if (candidate) {
        const peer = this.peer;
        if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
        else {
          this.pendingSignals.unshift(signal);
          return;
        }
      }
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    if (!isDataChannelName(channel.label)) {
      channel.close();
      return;
    }

    const channelName = channel.label;
    this.channels[channelName] = channel;
    this.updateDataChannelProgress();
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      this.updateDataChannelProgress();
      if (channelName === "control") this.startDataChannelLatencyProbe();
      if (this.openDataChannelCount() === DATA_CHANNEL_COUNT) {
        this.useConnectedSocketLatencyInterval();
        this.onConnected(this);
      }
      if (this.peer) void this.detectConnectionRoute(this.peer);
    };
    channel.onmessage = (event) => {
      this.receivedBytes += dataSize(event.data);
      this.updateDataTransferProgress();
      if (channelName === "control") this.handleDataChannelMessage(event.data);
      if (channelName === "interactive") this.handleInteractiveMessage(event.data);
      if (channelName === "bulk" && event.data instanceof ArrayBuffer) this.fileTransferManager?.handleSegment(event.data);
    };
    channel.onclose = () => this.handlePeerDisconnect();
    channel.onerror = () => this.handlePeerDisconnect();
  }

  private handlePeerDisconnect(): void {
    if (this.closed) return;
    this.stopDataChannelLatencyProbe();
    this.useConnectingSocketLatencyInterval();
    this.remoteParticipantJoined = false;
    this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
    this.setStep("dataChannel", { channels: 0, state: "pending", detail: "Waiting for data channel", transferred: this.dataTransfer() });
    this.closeDataChannels();
    this.mediaTransport.stopLocalTracks();
    this.mediaTransport.detachPeer();
    const peer = this.peer;
    this.peer = null;
    peer?.close();
    this.onError("Data channel failed.");
    this.onPeerLeft();
  }

  /** Reports the actual selected ICE path, not merely whether TURN credentials exist. */
  private async detectConnectionRoute(peer: RTCPeerConnection): Promise<void> {
    try {
      const stats = await peer.getStats();
      for (const report of stats.values()) {
        if (report.type !== "candidate-pair" || report.state !== "succeeded") continue;
        if (report.selected !== true && report.nominated !== true) continue;

        const localCandidate = report.localCandidateId ? stats.get(report.localCandidateId) : undefined;
        const route = localCandidate?.candidateType === "relay" ? "relay" : "direct";
        this.fileTransferManager?.setConnectionRoute(route);
        this.onConnectionRoute(route);
        return;
      }
    } catch {
      // Keep the direct label when the browser does not expose candidate statistics.
    }
  }

  private sendSignal(payload: SignalMessage["payload"]): void {
    this.sendSocket({ type: "signal", payload });
  }

  private startSocketLatencyProbe(): void {
    this.measureSocketLatency();
    this.setSocketLatencyInterval(5_000);
  }

  private useConnectingSocketLatencyInterval(): void {
    this.setSocketLatencyInterval(5_000);
  }

  private useConnectedSocketLatencyInterval(): void {
    this.setSocketLatencyInterval(30_000);
  }

  private setSocketLatencyInterval(interval: number): void {
    if (this.socketPingTimer !== undefined) {
      window.clearInterval(this.socketPingTimer);
    }
    this.socketPingTimer = window.setInterval(() => this.measureSocketLatency(), interval);
  }

  private stopSocketLatencyProbe(): void {
    if (this.socketPingTimer !== undefined) {
      window.clearInterval(this.socketPingTimer);
      this.socketPingTimer = undefined;
    }
    if (this.socketPingTimeout !== undefined) {
      window.clearTimeout(this.socketPingTimeout);
      this.socketPingTimeout = undefined;
    }
    this.socketPingStartedAt = null;
  }

  private measureSocketLatency(): void {
    if (
      this.closed ||
      this.socketPingStartedAt !== null ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this.socketPingStartedAt = performance.now();
    this.sendSocket({ type: "ping" });
    this.socketPingTimeout = window.setTimeout(() => {
      this.socketPingStartedAt = null;
      this.socketPingTimeout = undefined;
    }, 5_000);
  }

  private sendSocket(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private handleDataChannelMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let message: DataChannelControlMessage;
    try {
      message = JSON.parse(data) as DataChannelControlMessage;
    } catch {
      return;
    }

    this.fileTransferManager?.handleControl(message as unknown as { type: string; [key: string]: unknown });
    if (this.mediaTransport.handleControlMessage(message)) return;

    if (message.type === "chat-received" || message.type === "chat-read") {
      if (typeof message.id === "string" && message.id.length > 0 && message.id.length <= 128) {
        this.onChatReceipt(message.id, message.type === "chat-read" ? "read" : "received");
      }
      return;
    }

    if (message.type === "chat-typing") {
      this.onChatTyping();
      return;
    }

    if (message.type === "zestsend-ping") {
      this.sendDataChannelControl({ id: message.id, type: "zestsend-pong" });
      return;
    }

    const startedAt = this.dataChannelPingStartedAt;
    if (message.type !== "zestsend-pong" || startedAt === null || message.id !== String(startedAt)) return;

    const latency = Math.round(performance.now() - startedAt);
    this.dataChannelPingStartedAt = null;
    if (this.dataChannelPingTimeout !== undefined) {
      window.clearTimeout(this.dataChannelPingTimeout);
      this.dataChannelPingTimeout = undefined;
    }
    this.setStep("p2p", { state: "active", detail: "P2P connection established", latency });
  }

  private handleInteractiveMessage(data: unknown): void {
    if (typeof data !== "string") return;

    try {
      const message = JSON.parse(data) as unknown;
      if (isInteractiveMessage(message)) {
        this.sendDataChannelControl({ id: message.id, type: "chat-received" });
        if (this.receivedChatIds.has(message.id)) return;
        this.receivedChatIds.add(message.id);
        this.onInteractiveMessage(message);
      }
    } catch {
      // Ignore malformed application messages without affecting the data channel.
    }
  }

  private startDataChannelLatencyProbe(): void {
    this.measureDataChannelLatency();
    this.dataChannelPingTimer = window.setInterval(() => this.measureDataChannelLatency(), 5_000);
  }

  private stopDataChannelLatencyProbe(): void {
    if (this.dataChannelPingTimer !== undefined) {
      window.clearInterval(this.dataChannelPingTimer);
      this.dataChannelPingTimer = undefined;
    }
    if (this.dataChannelPingTimeout !== undefined) {
      window.clearTimeout(this.dataChannelPingTimeout);
      this.dataChannelPingTimeout = undefined;
    }
    this.dataChannelPingStartedAt = null;
  }

  private measureDataChannelLatency(): void {
    if (this.closed || this.dataChannelPingStartedAt !== null || this.channels.control?.readyState !== "open") return;

    const startedAt = performance.now();
    this.dataChannelPingStartedAt = startedAt;
    this.sendDataChannelControl({ id: String(startedAt), type: "zestsend-ping" });
    this.dataChannelPingTimeout = window.setTimeout(() => {
      this.dataChannelPingStartedAt = null;
      this.dataChannelPingTimeout = undefined;
    }, 5_000);
  }

  private sendDataChannelControl(message: DataChannelControlMessage): void {
    this.sendOnChannel("control", JSON.stringify(message));
  }

  markChatMessageRead(id: string): boolean {
    if (!id || id.length > 128) return false;
    return this.sendOnChannel("control", JSON.stringify({ id, type: "chat-read" satisfies ChatReceiptMessage["type"] }));
  }

  sendChatTyping(): boolean {
    return this.sendOnChannel("control", JSON.stringify({ type: "chat-typing" satisfies ChatTypingMessage["type"] }));
  }

  private openDataChannelCount(): number {
    return DATA_CHANNEL_NAMES.filter((channelName) => this.channels[channelName]?.readyState === "open").length;
  }

  private updateDataChannelProgress(): void {
    const channels = this.openDataChannelCount();
    this.setStep("dataChannel", {
      channels,
      detail: channels === DATA_CHANNEL_COUNT ? "Data channels ready" : "Opening data channels",
      state: channels === DATA_CHANNEL_COUNT ? "active" : "checking",
      transferred: this.dataTransfer(),
    });
  }

  private updateDataTransferProgress(): void {
    this.setStep("dataChannel", { ...this.progress.dataChannel, transferred: this.dataTransfer() });
  }

  private dataTransfer(): { received: number; sent: number } {
    const traffic = this.mediaTransport.traffic;
    return { received: this.receivedBytes + traffic.received, sent: this.sentBytes + traffic.sent };
  }

  private closeDataChannels(): void {
    for (const channelName of DATA_CHANNEL_NAMES) {
      const channel = this.channels[channelName];
      if (!channel) continue;
      channel.onclose = null;
      channel.onerror = null;
      channel.close();
      this.channels[channelName] = null;
    }
  }

  private setStep(step: keyof ConnectionProgress, value: ConnectionStep): void {
    this.progress = { ...this.progress, [step]: value };
    this.onProgress(this.progress);
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.setStep("p2p", { state: "error", detail: message });
    this.onError(message);
  }
}
