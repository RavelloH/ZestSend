import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  SIGNALING_HEARTBEAT_CAPABILITY,
  SIGNALING_HEARTBEAT_REQUEST,
  SIGNALING_HEARTBEAT_RESPONSE,
} from "../src/shared/signaling-protocol";

type JsonMessage = Record<string, unknown> & { type?: string };
type SocketMessage = JsonMessage | string;

class MessageInbox {
  private messages: SocketMessage[] = [];
  private waiters: Array<{
    predicate: (message: SocketMessage) => boolean;
    resolve: (message: SocketMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const raw = String(event.data);
      let message: SocketMessage = raw;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === "object" && parsed !== null) message = parsed as JsonMessage;
      } catch {
        // Keep protocol strings as strings for auto-response assertions.
      }
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) {
        this.messages.push(message);
        return;
      }
      const [waiter] = this.waiters.splice(index, 1);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  next(predicate: (message: SocketMessage) => boolean, timeoutMs = 2_000): Promise<SocketMessage> {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) {
      const [message] = this.messages.splice(index, 1);
      return Promise.resolve(message!);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const waiterIndex = this.waiters.indexOf(waiter);
          if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
          reject(new Error("Timed out waiting for WebSocket message."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  nextType(type: string, timeoutMs?: number): Promise<JsonMessage> {
    return this.next((message) => typeof message !== "string" && message.type === type, timeoutMs) as Promise<JsonMessage>;
  }
}

const sockets = new Set<WebSocket>();

async function openRoomSocket(roomId: string) {
  const id = env.ROOMS.idFromName(roomId);
  const stub = env.ROOMS.get(id);
  const response = await stub.fetch("https://room.test/api/rooms/1234/ws", {
    headers: { Upgrade: "websocket" },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error(`Expected WebSocket upgrade, got ${response.status}.`);
  socket.accept();
  sockets.add(socket);
  return { inbox: new MessageInbox(socket), socket, stub };
}

async function hello(
  socket: WebSocket,
  inbox: MessageInbox,
  mode: "new" | "resume-signaling" | "restart-peer" = "new",
  resumeToken?: string,
  capabilities?: string[],
) {
  const welcome = inbox.nextType("welcome");
  socket.send(JSON.stringify({
    type: "hello",
    mode,
    ...(resumeToken ? { resumeToken } : {}),
    ...(capabilities ? { capabilities } : {}),
  }));
  return welcome;
}

async function inspectRoom(stub: DurableObjectStub) {
  return runInDurableObject(stub, async (_instance, state) => ({
    alarm: await state.storage.getAlarm(),
    room: await state.storage.get<{
      epoch: number;
      slots: Array<{ connectionId: string | null; leaseExpiresAt: number | null; slotId: string; lastSeenAt?: number }>;
    }>("room-state-v2"),
  }));
}

afterEach(() => {
  for (const socket of sockets) {
    try {
      socket.close(1000, "Test cleanup");
    } catch {
      // The test may already have closed this socket.
    }
  }
  sockets.clear();
});

describe("Durable Object room protocol", () => {
  it("admits two participants and rejects a third", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    const firstWelcome = await hello(first.socket, first.inbox);
    expect(firstWelcome.peerCount).toBe(1);

    const firstNegotiation = first.inbox.nextType("negotiate");
    const second = await openRoomSocket(roomId);
    const secondWelcome = await hello(second.socket, second.inbox);
    expect(secondWelcome.peerCount).toBe(2);
    const negotiation = await firstNegotiation;
    expect(negotiation.slotId).toBe(secondWelcome.slotId);

    const third = await openRoomSocket(roomId);
    const rejection = third.inbox.nextType("error");
    third.socket.send(JSON.stringify({ type: "hello", mode: "new" }));
    expect((await rejection).code).toBe("room-full");
  });

  it("keeps the legacy first JSON ping handshake working", async () => {
    const client = await openRoomSocket(crypto.randomUUID());
    const welcome = client.inbox.nextType("welcome");
    const pong = client.inbox.nextType("pong");
    client.socket.send(JSON.stringify({ type: "ping" }));

    expect((await welcome).peerCount).toBe(1);
    expect((await pong).type).toBe("pong");
  });

  it("keeps legacy active heartbeats out of room Storage", async () => {
    const client = await openRoomSocket(crypto.randomUUID());
    await hello(client.socket, client.inbox);
    const before = (await inspectRoom(client.stub)).room;

    const pong = client.inbox.nextType("pong");
    client.socket.send(JSON.stringify({ type: "ping" }));
    await pong;

    const after = (await inspectRoom(client.stub)).room;
    expect(after).toEqual(before);
    expect(after?.slots[0]?.lastSeenAt).toBeUndefined();
  });

  it("auto-replies to the v3 heartbeat without admission or waking an evicted Durable Object", async () => {
    const client = await openRoomSocket(crypto.randomUUID());
    const pendingReply = client.inbox.next((message) => message === SIGNALING_HEARTBEAT_RESPONSE);
    client.socket.send(SIGNALING_HEARTBEAT_REQUEST);
    expect(await pendingReply).toBe(SIGNALING_HEARTBEAT_RESPONSE);

    const welcome = client.inbox.nextType("welcome");
    client.socket.send(JSON.stringify({
      type: "hello",
      mode: "new",
      capabilities: [SIGNALING_HEARTBEAT_CAPABILITY],
    }));
    expect(await welcome).toMatchObject({ peerCount: 1, heartbeatProtocol: "auto-response-v3" });
    expect((await inspectRoom(client.stub)).room?.slots).toHaveLength(1);

    await evictDurableObject(client.stub);
    const activeReply = client.inbox.next((message) => message === SIGNALING_HEARTBEAT_RESPONSE);
    client.socket.send(SIGNALING_HEARTBEAT_REQUEST);
    expect(await activeReply).toBe(SIGNALING_HEARTBEAT_RESPONSE);
    await expect(evictDurableObject(client.stub)).rejects.toThrow();
  });

  it("does not schedule active-session sweeps and only alarms for real deadlines", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    const pendingAlarm = (await inspectRoom(first.stub)).alarm;
    expect(pendingAlarm).not.toBeNull();
    await hello(first.socket, first.inbox);
    expect((await inspectRoom(first.stub)).alarm).toBeNull();

    const second = await openRoomSocket(roomId);
    await hello(second.socket, second.inbox);
    expect((await inspectRoom(first.stub)).alarm).toBeNull();

    const disconnected = first.inbox.nextType("peer-disconnected");
    second.socket.close(1000, "network interruption");
    await disconnected;
    expect((await inspectRoom(first.stub)).alarm).not.toBeNull();
  });

  it("expires a lease once, notifies the waiting participant, and leaves no follow-up alarm", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    await hello(first.socket, first.inbox);
    const second = await openRoomSocket(roomId);
    const secondWelcome = await hello(second.socket, second.inbox);

    const disconnected = first.inbox.nextType("peer-disconnected");
    second.socket.close(1000, "network interruption");
    await disconnected;

    await runInDurableObject(first.stub, async (_instance, state) => {
      const room = await state.storage.get<{ slots: Array<{ leaseExpiresAt: number | null; slotId: string }> }>("room-state-v2");
      const slot = room?.slots.find((candidate) => candidate.slotId === secondWelcome.slotId);
      if (!slot) throw new Error("Disconnected participant slot was not persisted.");
      slot.leaseExpiresAt = Date.now() - 1;
      await state.storage.put("room-state-v2", room);
    });

    const peerLeft = first.inbox.nextType("peer-left");
    expect(await runDurableObjectAlarm(first.stub)).toBe(true);
    expect((await peerLeft).slotId).toBe(secondWelcome.slotId);
    const after = await inspectRoom(first.stub);
    expect(after.room?.slots.map((slot) => slot.slotId)).toEqual([expect.any(String)]);
    expect(after.alarm).toBeNull();
    expect(await runDurableObjectAlarm(first.stub)).toBe(false);
  });

  it("times out pending handshakes and clears their one-shot alarm", async () => {
    const client = await openRoomSocket(crypto.randomUUID());
    await runInDurableObject(client.stub, (_instance, state) => {
      const socket = state.getWebSockets()[0];
      const attachment = socket?.deserializeAttachment() as { connectedAt: number; [key: string]: unknown } | null;
      if (!socket || !attachment) throw new Error("Pending socket attachment was not found.");
      socket.serializeAttachment({ ...attachment, connectedAt: Date.now() - 10_000 });
    });

    const timeoutMessage = client.inbox.nextType("error");
    expect(await runDurableObjectAlarm(client.stub)).toBe(true);
    expect((await timeoutMessage).code).toBe("hello-timeout");
    expect((await inspectRoom(client.stub)).alarm).toBeNull();
    expect(await runDurableObjectAlarm(client.stub)).toBe(false);
  });

  it("resumes a reserved seat, rotates its token, and ignores a delayed close from the old socket", async () => {
    const roomId = crypto.randomUUID();
    const original = await openRoomSocket(roomId);
    const firstWelcome = await hello(original.socket, original.inbox);
    const originalToken = firstWelcome.resumeToken;
    const slotId = firstWelcome.slotId;
    if (typeof originalToken !== "string" || typeof slotId !== "string") throw new Error("Welcome did not provide a resumable seat.");

    const replacement = await openRoomSocket(roomId);
    const replaced = original.inbox.nextType("replaced");
    const resumed = await hello(replacement.socket, replacement.inbox, "resume-signaling", originalToken);
    await replaced;
    expect(resumed).toMatchObject({ resumed: true, slotId, peerCount: 1 });
    expect(resumed.resumeToken).toEqual(expect.any(String));
    expect(resumed.resumeToken).not.toBe(originalToken);
    expect((await inspectRoom(replacement.stub)).room?.slots).toHaveLength(1);

    const staleResume = await openRoomSocket(roomId);
    const rejection = staleResume.inbox.nextType("error");
    staleResume.socket.send(JSON.stringify({ type: "hello", mode: "resume-signaling", resumeToken: originalToken }));
    expect((await rejection).code).toBe("resume-invalid");
  });

  it("rotates the peer session on restart and rejects signals from an earlier epoch", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    const firstWelcome = await hello(first.socket, first.inbox);
    const token = firstWelcome.resumeToken;
    const second = await openRoomSocket(roomId);
    const secondWelcome = await hello(second.socket, second.inbox);
    const oldEpoch = secondWelcome.epoch;
    const oldPeerSessionId = firstWelcome.peerSessionId;
    if (typeof token !== "string" || typeof oldEpoch !== "number" || typeof oldPeerSessionId !== "string"
      || typeof secondWelcome.peerSessionId !== "string" || typeof firstWelcome.slotId !== "string") {
      throw new Error("Welcome did not provide restart metadata.");
    }

    const replaced = first.inbox.nextType("replaced");
    const peerReady = second.inbox.nextType("peer-ready");
    const negotiation = second.inbox.nextType("negotiate");
    const restart = await openRoomSocket(roomId);
    const restarted = await hello(restart.socket, restart.inbox, "restart-peer", token);
    await replaced;
    await peerReady;
    await negotiation;
    if (typeof restarted.epoch !== "number") throw new Error("Restart welcome did not provide an epoch.");
    expect(restarted).toMatchObject({ resumed: true, slotId: firstWelcome.slotId });
    expect(restarted.peerSessionId).not.toBe(oldPeerSessionId);
    expect(restarted.epoch).toBeGreaterThan(oldEpoch);

    const staleSignal = restart.inbox.nextType("signal", 100);
    second.socket.send(JSON.stringify({
      type: "signal",
      epoch: oldEpoch,
      peerSessionId: secondWelcome.peerSessionId,
      payload: { candidate: { candidate: "candidate:stale" } },
    }));
    await expect(staleSignal).rejects.toThrow("Timed out");

    const forwarded = restart.inbox.nextType("signal");
    second.socket.send(JSON.stringify({
      type: "signal",
      epoch: restarted.epoch,
      peerSessionId: secondWelcome.peerSessionId,
      payload: { candidate: { candidate: "candidate:current" } },
    }));
    expect((await forwarded).payload).toEqual({ candidate: { candidate: "candidate:current" } });
  });

  it("releases a seat on explicit leave and admits the next participant", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    await hello(first.socket, first.inbox);
    const second = await openRoomSocket(roomId);
    await hello(second.socket, second.inbox);

    const peerLeft = first.inbox.nextType("peer-left");
    const left = second.inbox.nextType("left");
    second.socket.send(JSON.stringify({ type: "leave" }));
    expect((await left).type).toBe("left");
    await peerLeft;
    expect((await inspectRoom(first.stub)).room?.slots).toHaveLength(1);

    const next = await openRoomSocket(roomId);
    expect((await hello(next.socket, next.inbox)).peerCount).toBe(2);
  });

  it("keeps a lone disconnected seat without a timer and lazily frees it on the next admission", async () => {
    const roomId = crypto.randomUUID();
    const first = await openRoomSocket(roomId);
    const welcome = await hello(first.socket, first.inbox);
    first.socket.close(1000, "network interruption");

    let afterClose = await inspectRoom(first.stub);
    for (let attempt = 0; attempt < 20 && afterClose.room?.slots[0]?.connectionId !== null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      afterClose = await inspectRoom(first.stub);
    }
    expect(afterClose.room?.slots[0]?.leaseExpiresAt).toEqual(expect.any(Number));
    expect(afterClose.alarm).toBeNull();

    await runInDurableObject(first.stub, async (_instance, state) => {
      const room = await state.storage.get<{ slots: Array<{ leaseExpiresAt: number | null; slotId: string }> }>("room-state-v2");
      const slot = room?.slots.find((candidate) => candidate.slotId === welcome.slotId);
      if (!slot) throw new Error("Disconnected participant slot was not persisted.");
      slot.leaseExpiresAt = Date.now() - 1;
      await state.storage.put("room-state-v2", room);
    });

    const next = await openRoomSocket(roomId);
    expect((await hello(next.socket, next.inbox)).peerCount).toBe(1);
    expect((await inspectRoom(next.stub)).room?.slots).toHaveLength(1);
  });

  it("rejects malformed and oversized signaling messages", async () => {
    const malformed = await openRoomSocket(crypto.randomUUID());
    const malformedError = malformed.inbox.nextType("error");
    malformed.socket.send("not-json");
    expect((await malformedError).code).toBe("invalid-message");

    const oversized = await openRoomSocket(crypto.randomUUID());
    const oversizedError = oversized.inbox.nextType("error");
    oversized.socket.send("x".repeat(128 * 1024 + 1));
    expect((await oversizedError).code).toBe("message-too-large");
  });
});
