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
  await page.route("**/api/turn/credentials", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    json: { error: "TURN credentials are not configured." },
  }));
  if (interceptSignaling) {
    await page.routeWebSocket(/\/api\/rooms\/\d{4}\/ws(?:\?.*)?$/, (client) => {
      if (blockNewSockets) {
        client.close({ code: 1001, reason: "Signaling is paused by the test." });
        return;
      }
      const server = client.connectToServer();
      client.onClose(() => server.close({ code: 1001, reason: "Signaling interruption under test." }));
      server.onClose(() => client.close({ code: 1001, reason: "Signaling interruption under test." }));
    });
  }

  await page.goto(`/en/room/${roomId}`);

  return {
    async disconnectSignaling(page: Page) {
      blockNewSockets = true;
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

async function createPair(browser: Browser, roomId: string) {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const aliceFrames: string[] = [];
  const bobFrames: string[] = [];
  observeFrames(alice, aliceFrames);
  observeFrames(bob, bobFrames);
  await Promise.all([installPeerProbe(alice), installPeerProbe(bob)]);
  const bobSession = await createRoomPeer(bob, roomId);
  const aliceSession = await createRoomPeer(alice, roomId);
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
    const pair = await createPair(browser, roomId);
    try {
      const resumeKey = `zestsend:room:${encodeURIComponent(roomId)}:resume`;
      const tokenBeforeReload = await pair.alice.evaluate((key) => sessionStorage.getItem(key), resumeKey);
      expect(tokenBeforeReload).not.toBeNull();
      await pair.alice.reload();
      await pair.alice.getByRole("button", { name: "Chat" }).click();
      try {
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
      await expect.poll(() => pair.bobFrames.some((frame) => frame.startsWith("received:peer-left:")), { timeout: 10_000 }).toBe(true);
      await sendChat(pair.alice, "existing-peer-survived-seat-expiry");
      await openChat(pair.bob);
      await expect(pair.bob.getByText("existing-peer-survived-seat-expiry", { exact: true })).toBeVisible();
    } finally {
      await pair.aliceContext.close();
      await pair.bobContext.close();
    }
  });
});
