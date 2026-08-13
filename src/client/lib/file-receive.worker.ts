const FILE_BLOCK_SIZE = 1_048_576;
const FILE_SEGMENT_SIZE = 64 * 1024;

type SegmentMessage = {
  type: "segment";
  transferId: string;
  blockIndex: number;
  segmentIndex: number;
  segmentCount: number;
  blockLength: number;
  payload: ArrayBuffer;
};

type ReceiverMessage = SegmentMessage
  | { type: "initialize"; transferId: string; targetName: string }
  | { type: "meta"; transferId: string; blockIndex: number; hash: string }
  | { type: "close"; transferId: string }
  | { type: "discard"; transferId: string; targetName: string };

type BlockState = {
  blockLength: number;
  buffer: Uint8Array;
  received: Uint8Array;
  receivedCount: number;
  segmentCount: number;
};

type SyncAccessHandle = {
  close: () => Promise<void>;
  flush: () => Promise<void>;
  truncate: (newSize: number) => Promise<void>;
  write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
};

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle: () => Promise<SyncAccessHandle>;
};

type ReceiverState = {
  blocks: Map<number, BlockState>;
  completed: Map<number, { data: ArrayBuffer; hash: string }>;
  hashes: Map<number, string>;
  targetName: string;
  target: SyncAccessHandle;
};

const receivers = new Map<string, ReceiverState>();
let rootPromise: Promise<FileSystemDirectoryHandle> | undefined;

function root(): Promise<FileSystemDirectoryHandle> {
  rootPromise ??= navigator.storage.getDirectory();
  return rootPromise;
}

function post(message: unknown): void {
  (self as unknown as { postMessage: (value: unknown) => void }).postMessage(message);
}

async function digest(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function initialize(transferId: string, targetName: string): Promise<void> {
  const directory = await root();
  const file = await directory.getFileHandle(targetName, { create: true }) as SyncFileHandle;
  const target = await file.createSyncAccessHandle();
  await target.truncate(0);
  await target.flush();
  receivers.set(transferId, { blocks: new Map(), completed: new Map(), hashes: new Map(), targetName, target });
  post({ transferId, type: "receiver-ready" });
}

async function writeCompletedBlock(transferId: string, blockIndex: number): Promise<void> {
  const receiver = receivers.get(transferId);
  const completed = receiver?.completed.get(blockIndex);
  const expectedHash = receiver?.hashes.get(blockIndex);
  if (!receiver || !completed || !expectedHash) return;

  receiver.completed.delete(blockIndex);
  receiver.hashes.delete(blockIndex);
  if (completed.hash !== expectedHash) {
    post({ blockIndex, transferId, type: "block-invalid" });
    return;
  }

  const data = new Uint8Array(completed.data);
  const written = receiver.target.write(data, { at: blockIndex * FILE_BLOCK_SIZE });
  if (written !== data.byteLength) throw new Error("OPFS write was incomplete.");
  await receiver.target.flush();
  post({ blockIndex, byteLength: data.byteLength, transferId, type: "block-written" });
}

async function receiveSegment(message: SegmentMessage): Promise<void> {
  const receiver = receivers.get(message.transferId);
  if (!receiver) return;
  let block = receiver.blocks.get(message.blockIndex);
  if (!block || block.segmentCount !== message.segmentCount || block.blockLength !== message.blockLength) {
    block = {
      blockLength: message.blockLength,
      buffer: new Uint8Array(message.blockLength),
      received: new Uint8Array(message.segmentCount),
      receivedCount: 0,
      segmentCount: message.segmentCount,
    };
    receiver.blocks.set(message.blockIndex, block);
  }

  if (message.segmentIndex < 0 || message.segmentIndex >= block.segmentCount || block.received[message.segmentIndex]) return;
  const payload = new Uint8Array(message.payload);
  // The sender always begins segments on a fixed 64 KiB boundary. The final
  // segment is shorter, so deriving an average segment length corrupts it.
  const offset = message.segmentIndex * FILE_SEGMENT_SIZE;
  if (offset + payload.byteLength > block.blockLength) return;

  block.buffer.set(payload, offset);
  block.received[message.segmentIndex] = 1;
  block.receivedCount += 1;
  if (block.receivedCount !== block.segmentCount) return;

  receiver.blocks.delete(message.blockIndex);
  const data = block.buffer.slice().buffer as ArrayBuffer;
  receiver.completed.set(message.blockIndex, { data, hash: await digest(data) });
  await writeCompletedBlock(message.transferId, message.blockIndex);
}

async function closeReceiver(transferId: string, discard: boolean, targetName?: string): Promise<void> {
  const receiver = receivers.get(transferId);
  if (!receiver) {
    if (discard && targetName) await (await root()).removeEntry(targetName).catch(() => undefined);
    post({ transferId, type: discard ? "receiver-discarded" : "receiver-closed" });
    return;
  }
  receivers.delete(transferId);
  await receiver.target.flush();
  await receiver.target.close();
  if (discard) await (await root()).removeEntry(receiver.targetName);
  post({ transferId, type: discard ? "receiver-discarded" : "receiver-closed" });
}

self.onmessage = (event: MessageEvent<ReceiverMessage>) => {
  const message = event.data;
  void (async () => {
    if (!message) return;
    if (message.type === "initialize") await initialize(message.transferId, message.targetName);
    else if (message.type === "meta") {
      const receiver = receivers.get(message.transferId);
      if (!receiver) return;
      receiver.hashes.set(message.blockIndex, message.hash);
      await writeCompletedBlock(message.transferId, message.blockIndex);
    } else if (message.type === "segment") await receiveSegment(message);
    else if (message.type === "close") await closeReceiver(message.transferId, false);
    else if (message.type === "discard") await closeReceiver(message.transferId, true, message.targetName);
  })().catch((error) => {
    post({ error: error instanceof Error ? error.message : String(error), transferId: message?.transferId, type: "receiver-error" });
  });
};
