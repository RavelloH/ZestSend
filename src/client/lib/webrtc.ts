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
  | { message: string; type: "error" }
  | { type: "pong" };

type TurnResponse = { error?: string; iceServers?: RTCIceServer[] };
type CloudflareIceResponse = TurnResponse & { latency: number };

const GOOGLE_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
];

type IceProbeResult = { latency: number; server: RTCIceServer } | null;

type IcePreparationResult = {
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

async function probeIceServer(
  server: RTCIceServer,
  candidateType: "srflx" | "relay",
  timeoutMs = 4_500,
): Promise<{ latency: number; server: RTCIceServer } | null> {
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

    return discovered ? { server, latency: Math.round(performance.now() - startedAt) } : null;
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
 * measures Cloudflare and Google STUN candidates plus Cloudflare TURN.
 */
export function prepareIceServers(listener?: IcePreparationListener): Promise<IcePreparationResult> {
  if (listener) {
    icePreparationListeners.add(listener);
    notifyIcePreparation(listener);
  }

  if (!icePreparationPromise) {
    icePreparationPromise = (async () => {
      updateIcePreparation("resource", { state: "checking", detail: "Requesting Cloudflare ICE resources" });

      const response = await fetchCloudflareIceServers();
      if (response.error) {
        updateIcePreparation("resource", { state: "error", detail: response.error, latency: response.latency });
        updateIcePreparation("stun", { state: "error", detail: "STUN server unavailable" });
        updateIcePreparation("turn", { state: "error", detail: response.error });
        return { servers: [], stun: null, turn: null, turnError: response.error };
      }

      const candidates = response.iceServers ?? [];
      updateIcePreparation("resource", {
        state: "ready",
        detail: "ICE resources issued by server",
        latency: response.latency,
      });
      const cloudflareStunCandidates = candidates.filter((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => url.startsWith("stun:"));
      });
      const stunCandidates = [...cloudflareStunCandidates, ...GOOGLE_STUN_SERVERS];
      const turnCandidates = candidates.filter((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
      });

      updateIcePreparation("stun", { state: "checking", detail: "Testing STUN server" });
      updateIcePreparation("turn", { state: "checking", detail: "Testing TURN server" });

      const [stunResults, turnResults] = await Promise.all([
        Promise.all(stunCandidates.map((server) => probeIceServer(server, "srflx"))),
        Promise.all(turnCandidates.map((server) => probeIceServer(server, "relay"))),
      ]);
      const successfulByLatency = (results: IceProbeResult[]) =>
        results
          .filter((result): result is NonNullable<IceProbeResult> => result !== null)
          .sort((a, b) => a.latency - b.latency);
      const fastestStunServers = successfulByLatency(stunResults).slice(0, 3);
      const stun = fastestStunServers[0] ?? null;
      const turn = successfulByLatency(turnResults)[0] ?? null;

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
          : { state: "error", detail: "TURN server unavailable" },
      );

      return {
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
  private socketPingStartedAt = 0;

  constructor(
    private readonly roomId: string,
    private readonly onProgress: (progress: ConnectionProgress) => void,
    private readonly onConnected: (session: NativeWebRTCSession) => void,
    private readonly onError: (message: string) => void,
  ) {}

  connect(): void {
    this.setStep("websocket", { state: "checking", detail: "Opening signaling socket" });
    this.socket = new WebSocket(websocketUrl(this.roomId));
    this.socket.addEventListener("open", () => {
      this.socketPingStartedAt = performance.now();
      this.sendSocket({ type: "ping" });
      void this.prepareIceServers();
    });
    this.socket.addEventListener("message", (event) => this.handleSocketMessage(String(event.data)));
    this.socket.addEventListener("error", () => this.fail("The signaling WebSocket could not be opened."));
    this.socket.addEventListener("close", () => {
      if (!this.closed && this.progress.dataChannel.state !== "active") {
        this.setStep("websocket", { state: "error", detail: "Signaling socket closed" });
      }
    });
  }

  close(): void {
    this.closed = true;
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
    if (this.initiator && this.remoteParticipantJoined) await this.createOffer();
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
      this.setStep("websocket", {
        state: "active",
        detail: "Signaling socket connected",
        latency: Math.round(performance.now() - this.socketPingStartedAt),
      });
      return;
    }

    if (message.type === "peer-ready" && this.initiator) {
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
      this.setStep("p2p", { state: "pending", detail: "The other participant left" });
      this.setStep("dataChannel", { state: "pending", detail: "Waiting for data channel" });
      this.peer?.close();
      this.peer = null;
      this.channel = null;
      return;
    }

    if (message.type === "error") this.fail(message.message);
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
      if (peer.connectionState === "connected") this.setStep("p2p", { state: "active", detail: "P2P connection established" });
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
      this.onConnected(this);
    };
    channel.onclose = () => this.setStep("dataChannel", { state: "error", detail: "Data channel closed" });
    channel.onerror = () => this.fail("Data channel failed.");
  }

  private sendSignal(payload: SignalMessage["payload"]): void {
    this.sendSocket({ type: "signal", payload });
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
