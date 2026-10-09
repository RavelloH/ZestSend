import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function installPeerProbe(page: Page) {
  await page.addInitScript(() => {
    const nativeConstructor = window.RTCPeerConnection;
    const probe = { peers: [] as RTCPeerConnection[] };
    Object.defineProperty(window, "__zestsendPeerProbe", { configurable: false, value: probe });
    const signalingSockets: WebSocket[] = [];
    Object.defineProperty(window, "__zestsendSignalingSockets", { configurable: false, value: signalingSockets });
    const nativeWebSocket = window.WebSocket;
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: new Proxy(nativeWebSocket, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget) as WebSocket;
          if (String(args[0]).includes("/api/rooms/")) signalingSockets.push(socket);
          return socket;
        },
      }),
    });
    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      value: new Proxy(nativeConstructor, {
        construct(target, args, newTarget) {
          const peer = Reflect.construct(target, args, newTarget) as RTCPeerConnection;
          probe.peers.push(peer);
          return peer;
        },
      }),
    });
  });
}

async function peerCount(page: Page) {
  return page.evaluate(() => (window as unknown as Window & { __zestsendPeerProbe: { peers: RTCPeerConnection[] } })
    .__zestsendPeerProbe.peers.filter((peer) => peer.sctp !== null).length);
}

async function liveSenderKinds(page: Page) {
  return page.evaluate(() => {
    const peers = (window as unknown as Window & { __zestsendPeerProbe: { peers: RTCPeerConnection[] } })
      .__zestsendPeerProbe.peers;
    const kinds = peers.filter((peer) => peer.signalingState !== "closed")
      .flatMap((peer) => peer.getSenders().map((sender) => sender.track).filter((track): track is MediaStreamTrack => Boolean(track) && track.readyState === "live"))
      .map((track) => track.kind);
    return { audio: kinds.includes("audio"), video: kinds.includes("video") };
  });
}

async function peerDiagnostics(page: Page) {
  return page.evaluate(() => (window as unknown as Window & { __zestsendPeerProbe: { peers: RTCPeerConnection[] } })
    .__zestsendPeerProbe.peers.map((peer) => ({
      connectionState: peer.connectionState,
      signalingState: peer.signalingState,
      senders: peer.getSenders().map((sender) => sender.track ? `${sender.track.kind}:${sender.track.readyState}` : null).filter(Boolean),
      sctp: peer.sctp !== null,
    })));
}

async function forceIceFailure(page: Page) {
  await page.evaluate(() => {
    const peers = (window as unknown as Window & { __zestsendPeerProbe: { peers: RTCPeerConnection[] } })
      .__zestsendPeerProbe.peers;
    const connectedPeers = peers.filter((candidate) => candidate.sctp !== null
      && candidate.signalingState !== "closed"
      && candidate.connectionState === "connected");
    if (connectedPeers.length === 0) throw new Error("No connected peer connection was found to exercise ICE recovery.");
    for (const peer of connectedPeers) {
      Object.defineProperty(peer, "connectionState", { configurable: true, value: "failed" });
      peer.close();
      peer.dispatchEvent(new Event("connectionstatechange"));
    }
  });
}

async function openChat(page: Page) {
  const composer = page.getByRole("textbox", { name: "Write a message" });
  if (await composer.isVisible().catch(() => false)) return composer;
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(composer).toBeVisible();
  return composer;
}

async function sendChat(page: Page, text: string) {
  const composer = await openChat(page);
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

function observeFrames(page: Page, frames: string[]) {
  page.on("websocket", (socket) => {
    const record = (direction: string, payload: string | Buffer) => {
      if (typeof payload !== "string" || !payload.startsWith("{")) return;
      try {
        const message = JSON.parse(payload) as { code?: string; epoch?: number; mode?: string; payload?: { description?: { type?: string } }; type?: string };
        if (message.type === "hello") frames.push(`${direction}:hello:${message.mode}`);
        else if (message.type === "signal" && message.payload?.description) frames.push(`${direction}:signal:${message.payload.description.type}:epoch=${message.epoch}`);
        else if (message.type === "error") frames.push(`${direction}:error:${message.code ?? "unknown"}`);
        else if (message.type && !["pong", "signal"].includes(message.type)) frames.push(`${direction}:${message.type}:epoch=${message.epoch ?? ""}`);
      } catch {
        // Ignore non-protocol WebSocket payloads in this diagnostic stream.
      }
    };
    socket.on("framesent", ({ payload }) => record("sent", payload));
    socket.on("framereceived", ({ payload }) => record("received", payload));
  });
}

async function createRoomPeer(page: Page, roomId: string, interceptSignaling = true) {
  let blockNewSockets = false;
  let routeRegistered = false;
  const registerSignalingRoute = async () => {
    if (routeRegistered) return;
    await page.routeWebSocket(/\/api\/rooms\/\d{4}\/ws(?:\?.*)?$/, (client) => {
      if (blockNewSockets) {
        client.close({ code: 1001, reason: "Signaling is paused by the test." });
        return;
      }
      const server = client.connectToServer();
      client.onClose(() => server.close({ code: 1001, reason: "Signaling interruption under test." }));
      server.onClose(() => client.close({ code: 1001, reason: "Signaling interruption under test." }));
    });
    routeRegistered = true;
  };
  await page.route("**/api/turn/credentials", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    json: { error: "TURN credentials are not configured." },
  }));

  await page.goto(`/en/room/${roomId}`);

  return {
    async disconnectSignaling(page: Page) {
      blockNewSockets = true;
      if (interceptSignaling) await registerSignalingRoute();
      await page.evaluate(() => {
        const sockets = (window as unknown as Window & { __zestsendSignalingSockets: WebSocket[] }).__zestsendSignalingSockets;
        const current = [...sockets].reverse().find((socket) => socket.readyState === WebSocket.OPEN);
        if (!current) throw new Error("No open signaling WebSocket was found in the page.");
        current.close(4001, "Signaling interruption under test.");
      });
    },
    async reconnectSignaling() {
      blockNewSockets = false;
    },
  };
}

async function createPair(
  browser: Browser,
  roomId: string,
  options: { grantMediaPermissions?: boolean; interceptSignaling?: boolean } = {},
) {
  const grantMediaPermissions = options.grantMediaPermissions ?? false;
  const interceptSignaling = options.interceptSignaling ?? true;
  const contextOptions = grantMediaPermissions ? { permissions: ["camera", "microphone"] } : {};
  const aliceContext = await browser.newContext(contextOptions);
  const bobContext = await browser.newContext(contextOptions);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const aliceFrames: string[] = [];
  const bobFrames: string[] = [];
  observeFrames(alice, aliceFrames);
  observeFrames(bob, bobFrames);
  await Promise.all([installPeerProbe(alice), installPeerProbe(bob)]);
  const bobSession = await createRoomPeer(bob, roomId, interceptSignaling);
  const aliceSession = await createRoomPeer(alice, roomId, interceptSignaling);
  await openChat(alice);
  await openChat(bob);
  await expect(alice.getByRole("textbox", { name: "Write a message" })).toBeEnabled();
  await expect(bob.getByRole("textbox", { name: "Write a message" })).toBeEnabled();
  await expect.poll(() => peerCount(alice)).toBeGreaterThan(0);
  await expect.poll(() => peerCount(bob)).toBeGreaterThan(0);
  return { alice, aliceContext, aliceFrames, aliceSession, bob, bobContext, bobFrames, bobSession };
}

test.describe("signaling-only interruptions", () => {
  for (const durationMs of [5_000, 20_000]) {
    test(`preserves chat and the peer connection through a ${durationMs / 1_000}s signaling interruption`, async ({ browser }) => {
      const roomId = String(Math.floor(1000 + Math.random() * 9000));
      const pair = await createPair(browser, roomId);
      try {
        const alicePeerCount = await peerCount(pair.alice);
        const bobPeerCount = await peerCount(pair.bob);
        await pair.aliceSession.disconnectSignaling(pair.alice);
        await expect.poll(() => pair.bobFrames.some((frame) => frame.startsWith("received:peer-disconnected:"))).toBe(true);
        await sendChat(pair.bob, `from-bob-${durationMs}`);
        await expect(pair.alice.getByText(`from-bob-${durationMs}`, { exact: true })).toBeVisible();
        await sendChat(pair.alice, `from-alice-${durationMs}`);
        await expect(pair.bob.getByText(`from-alice-${durationMs}`, { exact: true })).toBeVisible();
        await pair.alice.waitForTimeout(durationMs);
        await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);
        await expect.poll(() => peerCount(pair.bob)).toBe(bobPeerCount);
        await expect(pair.alice.getByRole("textbox", { name: "Write a message" })).toBeEnabled();

        await pair.aliceSession.reconnectSignaling();
        await expect(pair.alice.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
        await sendChat(pair.alice, `after-recovery-${durationMs}`);
        await expect(pair.bob.getByText(`after-recovery-${durationMs}`, { exact: true })).toBeVisible();
        await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);
      } finally {
        await pair.aliceContext.close();
        await pair.bobContext.close();
      }
    });
  }

  test("resumes the signaling seat after a full page refresh", async ({ browser }) => {
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const pair = await createPair(browser, roomId, { interceptSignaling: false });
    try {
      await sendChat(pair.bob, "chat-before-refresh");
      await expect(pair.alice.getByText("chat-before-refresh", { exact: true })).toBeVisible();
      const resumeKey = `zestsend:room:${encodeURIComponent(roomId)}:resume`;
      const tokenBeforeReload = await pair.alice.evaluate((key) => sessionStorage.getItem(key), resumeKey);
      expect(tokenBeforeReload).not.toBeNull();
      await pair.alice.reload();
      try {
        await pair.alice.getByRole("button", { name: "Chat" }).click({ timeout: 30_000 });
        await expect(pair.alice.getByRole("textbox", { name: "Write a message" })).toBeEnabled({ timeout: 30_000 });
      } catch (error) {
        const tokenAfterReload = await pair.alice.evaluate((key) => sessionStorage.getItem(key), resumeKey);
        console.log("refresh diagnostics", JSON.stringify({ alice: pair.aliceFrames, bob: pair.bobFrames, tokenBeforeReload, tokenAfterReload }));
        throw error;
      }
      await expect.poll(() => pair.aliceFrames.includes("sent:hello:resume-signaling")).toBe(true);
      await expect.poll(() => peerCount(pair.alice), { timeout: 30_000 }).toBeGreaterThan(0);
      await sendChat(pair.bob, "chat-after-refresh");
      await expect(pair.alice.getByText("chat-after-refresh", { exact: true })).toBeVisible();
      await sendChat(pair.alice, "reply-after-refresh");
      await expect(pair.bob.getByText("reply-after-refresh", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });

  test("admits only two participants in the browser room", async ({ browser }) => {
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const thirdContext = await browser.newContext();
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const third = await thirdContext.newPage();
    const firstFrames: string[] = [];
    const secondFrames: string[] = [];
    const thirdFrames: string[] = [];
    observeFrames(first, firstFrames);
    observeFrames(second, secondFrames);
    observeFrames(third, thirdFrames);
    try {
      await createRoomPeer(first, roomId, false);
      await expect.poll(() => firstFrames.some((frame) => frame.startsWith("received:welcome:"))).toBe(true);
      await createRoomPeer(second, roomId, false);
      await expect.poll(() => secondFrames.some((frame) => frame.startsWith("received:welcome:"))).toBe(true);
      await createRoomPeer(third, roomId, false);
      try {
        await expect.poll(() => thirdFrames.includes("received:error:room-full")).toBe(true);
      } catch (error) {
        console.log("full room diagnostics", JSON.stringify({ roomId, firstFrames, secondFrames, thirdFrames }));
        throw error;
      }
      await expect(third.getByText("Room is full", { exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      await thirdContext.close();
      await secondContext.close();
      await firstContext.close();
    }
  });

  test("restarts the peer after ICE failure and reconnects chat", async ({ browser }) => {
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const pair = await createPair(browser, roomId, { interceptSignaling: false });
    try {
      await sendChat(pair.alice, "chat-before-ice-failure");
      await expect(pair.bob.getByText("chat-before-ice-failure", { exact: true })).toBeVisible();
      const peersBeforeFailure = await peerCount(pair.alice);
      await forceIceFailure(pair.alice);
      try {
        await expect.poll(() => peerCount(pair.alice), { timeout: 30_000 }).toBeGreaterThan(peersBeforeFailure);
      } catch (error) {
        console.log("ICE restart diagnostics", JSON.stringify({ aliceFrames: pair.aliceFrames, bobFrames: pair.bobFrames, peersBeforeFailure, alicePeers: await peerDiagnostics(pair.alice), bobPeers: await peerDiagnostics(pair.bob) }));
        throw error;
      }
      await expect.poll(
        () => pair.aliceFrames.includes("sent:hello:restart-peer")
          || pair.bobFrames.some((frame) => frame.startsWith("sent:signal:offer:")),
        { timeout: 30_000 },
      ).toBe(true);
      await sendChat(pair.alice, "chat-after-ice-restart");
      await expect(pair.bob.getByText("chat-after-ice-restart", { exact: true })).toBeVisible();
      await sendChat(pair.bob, "reply-after-ice-restart");
      await expect(pair.alice.getByText("reply-after-ice-restart", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });

  test("keeps collaboration and voice active through a signaling outage", async ({ browser }) => {
    test.setTimeout(240_000);
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const pair = await createPair(browser, roomId, { grantMediaPermissions: true });
    try {
      await pair.alice.getByRole("button", { name: "Collaborate" }).click();
      await pair.bob.getByRole("button", { name: "Collaborate" }).click();
      const aliceEditor = pair.alice.locator('[contenteditable="true"]');
      const bobEditor = pair.bob.locator('[contenteditable="true"]');
      await expect(aliceEditor).toBeVisible();
      await expect(bobEditor).toBeVisible();
      await aliceEditor.fill("Collaboration survives signaling loss");
      await expect(bobEditor).toContainText("Collaboration survives signaling loss");

      await pair.alice.getByRole("button", { name: "Voice" }).click();
      await pair.alice.getByRole("button", { name: "Turn microphone on" }).click();
      await expect.poll(async () => (await liveSenderKinds(pair.alice)).audio).toBe(true);
      await pair.alice.getByRole("button", { name: "Video" }).click();
      await pair.alice.getByRole("button", { name: "Turn camera on" }).click();
      await expect.poll(async () => (await liveSenderKinds(pair.alice)).video).toBe(true);

      const alicePeerCount = await peerCount(pair.alice);
      await pair.aliceSession.disconnectSignaling(pair.alice);
      await expect(pair.alice.getByRole("status")).toContainText("Signaling is reconnecting");
      await expect.poll(async () => (await liveSenderKinds(pair.alice)).audio).toBe(true);
      await pair.alice.getByRole("button", { name: "Collaborate" }).click();
      await aliceEditor.fill("Shared edits continue while offline");
      await expect(bobEditor).toContainText("Shared edits continue while offline");
      await pair.alice.bringToFront();
      await expect.poll(async () => (await liveSenderKinds(pair.alice)).audio).toBe(true);
      await sendChat(pair.bob, "chat-during-collaboration-outage");
      await openChat(pair.alice);
      await expect(pair.alice.getByText("chat-during-collaboration-outage", { exact: true })).toBeVisible();
      await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);

      await pair.aliceSession.reconnectSignaling();
      await pair.alice.bringToFront();
      await expect(pair.alice.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);
      await expect.poll(async () => (await liveSenderKinds(pair.alice)).audio).toBe(true);
      await sendChat(pair.alice, "chat-after-collaboration-recovery");
      await expect(pair.bob.getByText("chat-after-collaboration-recovery", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });

  test("keeps a large file transfer intact across signaling reconnection", async ({ browser }) => {
    test.setTimeout(180_000);
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const pair = await createPair(browser, roomId);
    try {
      const payload = Buffer.alloc(32 * 1024 * 1024, 0x5a);
      const expectedDigest = createHash("sha256").update(payload).digest("hex");
      await pair.alice.getByRole("button", { name: "Files" }).click();
      await pair.alice.locator('input[type="file"]').setInputFiles({
        name: "signaling-resume-integrity.bin",
        mimeType: "application/octet-stream",
        buffer: payload,
      });
      await pair.bob.getByRole("button", { name: "Files" }).click();
      await expect(pair.bob.getByRole("button", { name: "Receive" })).toBeVisible({ timeout: 20_000 });
      const downloadPromise = pair.bob.waitForEvent("download");
      await pair.bob.getByRole("button", { name: "Receive" }).click();
      await expect(pair.alice.getByText("Sending", { exact: true })).toBeVisible();

      const alicePeerCount = await peerCount(pair.alice);
      const offersBeforeReconnect = pair.aliceFrames.filter((frame) => frame.startsWith("sent:signal:offer:")).length;
      await pair.aliceSession.disconnectSignaling(pair.alice);
      await expect(pair.alice.getByRole("status")).toContainText("Signaling is reconnecting");
      await pair.alice.waitForTimeout(1_000);
      await pair.aliceSession.reconnectSignaling();
      const download = await downloadPromise;
      await expect(pair.bob.getByText("Transfer complete", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => pair.aliceFrames.includes("sent:hello:resume-signaling"), { timeout: 20_000 }).toBe(true);
      await expect(pair.alice.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);
      expect(pair.aliceFrames.filter((frame) => frame.startsWith("sent:signal:offer:")).length).toBe(offersBeforeReconnect);
      expect(download.suggestedFilename()).toBe("signaling-resume-integrity.bin");
      const downloadedPath = await download.path();
      if (!downloadedPath) throw new Error("The browser did not retain the completed download.");
      const downloadedDigest = createHash("sha256").update(await readFile(downloadedPath)).digest("hex");
      expect(downloadedDigest).toBe(expectedDigest);

      await sendChat(pair.alice, "chat-after-file-transfer-recovery");
      await openChat(pair.bob);
      await expect(pair.bob.getByText("chat-after-file-transfer-recovery", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });

  test("preserves a large file transfer and the existing peer after the seat lease expires", async ({ browser }) => {
    test.setTimeout(240_000);
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    const pair = await createPair(browser, roomId);
    try {
      await pair.alice.getByRole("button", { name: "Files" }).click();
      await pair.alice.locator('input[type="file"]').setInputFiles({
        name: "lease-interruption.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.alloc(32 * 1024 * 1024, 0x5a),
      });
      await pair.bob.getByRole("button", { name: "Files" }).click();
      await expect(pair.bob.getByRole("button", { name: "Receive" })).toBeVisible({ timeout: 20_000 });
      await pair.bob.getByRole("button", { name: "Receive" }).click();
      await expect(pair.alice.getByText("Sending", { exact: true })).toBeVisible();

      const alicePeerCount = await peerCount(pair.alice);
      await pair.aliceSession.disconnectSignaling(pair.alice);
      await pair.alice.getByRole("button", { name: "Chat" }).click();
      await expect(pair.alice.getByRole("status")).toContainText("Signaling is reconnecting");
      await expect(pair.bob.getByText("Transfer complete", { exact: true })).toBeVisible({ timeout: 60_000 });
      await pair.alice.waitForTimeout(36_000);
      await expect(pair.alice.getByRole("status")).toContainText("Verifying the room seat", { timeout: 10_000 });
      await expect.poll(() => peerCount(pair.alice)).toBe(alicePeerCount);
      await sendChat(pair.alice, "existing-peer-survived-seat-expiry");
      await openChat(pair.bob);
      await expect(pair.bob.getByText("existing-peer-survived-seat-expiry", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });
});
