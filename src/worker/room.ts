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

type SocketAttachment = {
  peerId: string;
};

const MAX_PEERS = 2;

/** A room owns exactly the two WebSocket clients needed for WebRTC signaling. */
export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const peers = this.ctx.getWebSockets();
    if (peers.length >= MAX_PEERS) {
      return Response.json({ message: "Room is full." }, { status: 403 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const peerId = crypto.randomUUID();

    server.serializeAttachment({ peerId } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);

    const isInitiator = peers.length === 0;
    this.send(server, { type: "welcome", peerId, isInitiator, peerCount: peers.length + 1 });
    if (!isInitiator) this.broadcast({ type: "peer-ready", peerId }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;

    try {
      const parsed = JSON.parse(message) as { type?: string; payload?: SignalPayload };
      if (parsed.type === "ping") {
        this.send(socket, { type: "pong" });
        return;
      }
      if (parsed.type !== "signal" || !parsed.payload) return;

      const sender = socket.deserializeAttachment() as SocketAttachment | null;
      this.broadcast({ type: "signal", from: sender?.peerId, payload: parsed.payload }, socket);
    } catch {
      this.send(socket, { type: "error", message: "Invalid signaling message." });
    }
  }

  webSocketClose(socket: WebSocket): void {
    const peer = socket.deserializeAttachment() as SocketAttachment | null;
    this.broadcast({ type: "peer-left", peerId: peer?.peerId }, socket);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "Signaling error");
  }

  private broadcast(payload: object, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.send(socket, payload);
    }
  }

  private send(socket: WebSocket, payload: object): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      socket.close(1011, "Unable to deliver signaling message");
    }
  }
}
