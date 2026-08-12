export type ConnectionState = "pending" | "checking" | "ready" | "active" | "error";

export type ConnectionStep = {
  detail: string;
  latency?: number;
  state: ConnectionState;
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

type SignalMessage = {
  payload?: {
    candidate?: RTCIceCandidateInit;
    description?: RTCSessionDescriptionInit;
  };
  type: "signal";
};

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

type IcePreparationStep = "resource" | "stun" | "turn";
type IcePreparationListener = (step: IcePreparationStep, status: ConnectionStep) => void;

const pendingStep = (detail: string): ConnectionStep => ({ state: "pending", detail });

const initialProgress = (): ConnectionProgress => ({
  websocket: pendingStep("Waiting for signaling socket"),
  resource: pendingStep("Waiting to request Cloudflare resources"),
  stun: pendingStep("Checking STUN server"),
  turn: pendingStep("Checking TURN server"),
  p2p: pendingStep("Waiting for the other participant to join the room"),
  dataChannel: pendingStep("Waiting for data channel"),
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

      const [stunResults, turnResults] = await Promise.all([
        Promise.all(stunCandidates.map(({ provider, server }) => probeIceServer(server, "srflx", 4_500, provider))),
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
      const stun = fastestStunServers[0] ?? null;
      const turn = successfulByLatency(turnResults)[0] ?? null;
      const selectedStunServers = new Set(fastestStunServers.map(({ server }) => server));
      const diagnostics: IceDiagnosticEntry[] = [
        ...stunResults.map((result, index) => {
          const candidate = stunCandidates[index];
          return result
            ? {
                kind: "stun" as const,
                latency: result.latency,
                provider: candidate.provider,
                selected: selectedStunServers.has(result.server),
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
        servers: [...fastestStunServers.map(({ server }) => server), turn?.server].filter(
          (server): server is RTCIceServer => Boolean(server),
        ),
        stun,
        turn,
      };
    })();
  }

  return icePreparationPromise;
}

export function preloadIceServers(): void {
  void prepareIceServers();
}

export function stopObservingIceServers(listener: IcePreparationListener): void {
  icePreparationListeners.delete(listener);
}

/** Native WebRTC session using a Durable Object WebSocket only for SDP and ICE signaling. */
export class NativeWebRTCSession {
  private channel: RTCDataChannel | null = null;
  private closed = false;
  private initiator = false;
  private peer: RTCPeerConnection | null = null;
  private pendingSignals: SignalMessage[] = [];
  private remoteParticipantJoined = false;
  private progress = initialProgress();
  private readyForPeerConnection = false;
  private selectedServers: RTCIceServer[] = [];
  private socket: WebSocket | null = null;
  private socketPingStartedAt: number | null = null;
  private socketPingTimer: number | undefined;
  private socketPingTimeout: number | undefined;

  constructor(
    private readonly roomId: string,
    private readonly onProgress: (progress: ConnectionProgress) => void,
    private readonly onConnected: (session: NativeWebRTCSession) => void,
    private readonly onError: (message: string) => void,
    private readonly onRoomFull: () => void,
    private readonly onPeerLeft: () => void,
    private readonly onConnectionRoute: (route: ConnectionRoute) => void,
  ) {}

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
    this.stopSocketLatencyProbe();
    this.channel?.close();
    this.peer?.close();
    this.socket?.close();
  }

  send(data: string | ArrayBuffer | Blob): boolean {
    if (this.channel?.readyState !== "open") return false;
    if (typeof data === "string") this.channel.send(data);
    else if (data instanceof Blob) this.channel.send(data);
    else this.channel.send(data);
    return true;
  }

  get dataChannel(): RTCDataChannel | null {
    return this.channel;
  }

  private async prepareIceServers(): Promise<void> {
    const listener: IcePreparationListener = (step, status) => this.setStep(step, status);
    const preparation = await prepareIceServers(listener);
    stopObservingIceServers(listener);
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
      this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
      this.setStep("dataChannel", { state: "pending", detail: "Waiting for data channel" });
      if (this.channel) {
        this.channel.onclose = null;
        this.channel.onerror = null;
      }
      this.peer?.close();
      this.peer = null;
      this.channel = null;
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
    const channel = peer.createDataChannel("zestsend", { ordered: true });
    this.attachDataChannel(channel);
    this.setStep("p2p", { state: "checking", detail: "Creating P2P offer" });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.sendSignal({ description: offer });
  }

  private createPeerConnection(): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: this.selectedServers });
    this.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate: asCandidate(candidate) });
    };
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
    this.channel = channel;
    this.setStep("dataChannel", { state: "checking", detail: "Opening data channel" });
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      this.setStep("dataChannel", { state: "active", detail: "Data channel ready" });
      if (this.peer) void this.detectConnectionRoute(this.peer);
      this.onConnected(this);
    };
    channel.onclose = () => this.handlePeerDisconnect();
    channel.onerror = () => this.handlePeerDisconnect();
  }

  private handlePeerDisconnect(): void {
    if (this.closed) return;
    this.remoteParticipantJoined = false;
    this.setStep("p2p", { state: "pending", detail: "Waiting for the other participant to join the room" });
    this.setStep("dataChannel", { state: "pending", detail: "Waiting for data channel" });
    const channel = this.channel;
    this.channel = null;
    channel?.close();
    channel && (channel.onclose = null);
    channel && (channel.onerror = null);
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
        this.onConnectionRoute(localCandidate?.candidateType === "relay" ? "relay" : "direct");
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
    this.socketPingTimer = window.setInterval(() => this.measureSocketLatency(), 5_000);
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
