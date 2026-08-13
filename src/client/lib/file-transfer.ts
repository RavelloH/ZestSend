export const FILE_BLOCK_SIZE = 1_048_576;
export const FILE_SEGMENT_SIZE = 64 * 1024;
export const FILE_MEMORY_LIMIT = 512 * 1024 * 1024;
const FILE_PERSISTENCE_THRESHOLD = 2 * 1024 * 1024 * 1024;
export const FILE_INITIAL_CREDIT = 4 * FILE_BLOCK_SIZE;
export const FILE_MAX_CREDIT = 16 * FILE_BLOCK_SIZE;
const FILE_HEADER_SIZE = 32;
const FILE_MAGIC = 0x5a534631;
const FILE_TEMP_PREFIX = "zestsend-";
const FILE_TEMP_SUFFIX = ".part";

export type FileTransferState = "offered" | "waiting" | "transferring" | "complete" | "cancelled" | "error";
export type FileTransferDirection = "outgoing" | "incoming";

export type FileTransferSnapshot = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  direction: FileTransferDirection;
  state: FileTransferState;
  transferredBytes: number;
  confirmedBytes: number;
  speed: number;
  averageSpeed: number;
  paused: boolean;
  eta: number | null;
  duration: number | null;
  error?: string;
  url?: string;
};

type WireMessage = {
  type: string;
  [key: string]: unknown;
};

type BlockMeta = {
  type: "BLOCK_META";
  transferId: string;
  blockIndex: number;
  blockLength: number;
  segmentCount: number;
  hash: string;
};

type Segment = {
  blockIndex: number;
  blockLength: number;
  payload: ArrayBuffer;
  segmentCount: number;
  segmentIndex: number;
  transferId: string;
};

type ReceiverBlock = BlockMeta & { received: number };

type FileRecord = FileTransferSnapshot & {
  file?: File;
  blockHashes: string[];
  completedBlocks: Set<number>;
  receiverBlocks: Map<number, ReceiverBlock>;
  chunks: Map<number, ArrayBuffer>;
  target?: FileSystemWritableFileStream;
  fileHandle?: { getFile: () => Promise<File> };
  targetName?: string;
  startedAt?: number;
  throughputEwma: number;
  transferStartedAt?: number;
  lastSampleAt: number;
  lastSampleBytes: number;
  retryCount: Map<number, number>;
  inFlightBlocks: Set<number>;
  pendingCompleted: Map<number, { data: ArrayBuffer; hash: string }>;
  nextBlockIndex: number;
  blockSizes: Map<number, number>;
  inFlightBytes: number;
  remoteCredit: number;
  paused: boolean;
  writeChain: Promise<void>;
};

type FileTransferCallbacks = {
  sendControl: (message: WireMessage) => boolean;
  sendBulk: (data: ArrayBuffer) => boolean;
  onUpdate: (file: FileTransferSnapshot) => void;
  onOffer: (file: FileTransferSnapshot) => void;
  onError: (id: string, error: string) => void;
  onRemove?: (id: string) => void;
};

type FileSystemWritableFileStream = {
  write: (data: ArrayBuffer | { type: "write"; position: number; data: ArrayBuffer }) => Promise<void>;
  close: () => Promise<void>;
};

type FileSystemDirectoryWithEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, unknown]>;
};

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", data));
}

function asRecord(file: File, direction: FileTransferDirection, id: string): FileRecord {
  return {
    confirmedBytes: 0,
    completedBlocks: new Set(),
    blockHashes: [],
    chunks: new Map(),
    direction,
    duration: null,
    eta: null,
    file: direction === "outgoing" ? file : undefined,
    id,
    lastSampleAt: performance.now(),
    lastSampleBytes: 0,
    mimeType: file.type || "application/octet-stream",
    name: file.name,
    receiverBlocks: new Map(),
    retryCount: new Map(),
    inFlightBlocks: new Set(),
    pendingCompleted: new Map(),
    nextBlockIndex: 0,
    blockSizes: new Map(),
    inFlightBytes: 0,
    remoteCredit: FILE_INITIAL_CREDIT,
    paused: false,
    writeChain: Promise.resolve(),
    size: file.size,
    speed: 0,
    averageSpeed: 0,
    state: "waiting",
    throughputEwma: 0,
    transferredBytes: 0,
  };
}

export function encodeSegment(segment: Segment): ArrayBuffer {
  const id = new TextEncoder().encode(segment.transferId);
  const header = new ArrayBuffer(FILE_HEADER_SIZE + id.byteLength);
  const view = new DataView(header);
  view.setUint32(0, FILE_MAGIC);
  view.setUint32(4, segment.blockIndex);
  view.setUint32(8, segment.segmentIndex);
  view.setUint32(12, segment.segmentCount);
  view.setUint32(16, segment.blockLength);
  view.setUint32(20, segment.payload.byteLength);
  view.setUint32(24, id.byteLength);
  new Uint8Array(header, FILE_HEADER_SIZE).set(id);
  const output = new Uint8Array(header.byteLength + segment.payload.byteLength);
  output.set(new Uint8Array(header));
  output.set(new Uint8Array(segment.payload), header.byteLength);
  return output.buffer;
}

export function decodeSegment(data: ArrayBuffer): Segment | null {
  if (data.byteLength < FILE_HEADER_SIZE) return null;
  const view = new DataView(data);
  if (view.getUint32(0) !== FILE_MAGIC) return null;
  const idLength = view.getUint32(24);
  const payloadLength = view.getUint32(20);
  if (FILE_HEADER_SIZE + idLength + payloadLength !== data.byteLength) return null;
  const id = new TextDecoder().decode(new Uint8Array(data, FILE_HEADER_SIZE, idLength));
  return {
    blockIndex: view.getUint32(4),
    blockLength: view.getUint32(16),
    payload: data.slice(FILE_HEADER_SIZE + idLength),
    segmentCount: view.getUint32(12),
    segmentIndex: view.getUint32(8),
    transferId: id,
  };
}

export class FileTransferManager {
  private files = new Map<string, FileRecord>();
  private worker = new Worker(new URL("./file-receive.worker.ts", import.meta.url), { type: "module" });
  private readonly temporaryFileCleanup: Promise<void>;
  private incomingActivation: Promise<boolean> = Promise.resolve(false);
  private receiverReady = new Map<string, { reject: (reason?: unknown) => void; resolve: () => void }>();
  private receiverClosed = new Map<string, { reject: (reason?: unknown) => void; resolve: () => void }>();

  constructor(private readonly callbacks: FileTransferCallbacks) {
    this.worker.onmessage = (event: MessageEvent<{ blockIndex?: number; byteLength?: number; error?: string; transferId: string; type: string }>) => {
      const message = event.data;
      if (message.type === "receiver-ready") this.receiverReady.get(message.transferId)?.resolve();
      else if (message.type === "receiver-closed" || message.type === "receiver-discarded") this.receiverClosed.get(message.transferId)?.resolve();
      else if (message.type === "block-written" && typeof message.blockIndex === "number" && typeof message.byteLength === "number") void this.completeReceivedBlock(message as { blockIndex: number; byteLength: number; transferId: string });
      else if (message.type === "block-invalid" && typeof message.blockIndex === "number") this.callbacks.sendControl({ type: "BLOCK_NACK", transferId: message.transferId, blockIndex: message.blockIndex });
      else if (message.type === "receiver-error") {
        const error = new Error(message.error ?? "OPFS receiver failed.");
        const pending = this.receiverReady.get(message.transferId);
        if (pending) pending.reject(error);
        else {
          const record = this.files.get(message.transferId);
          if (record) this.fail(record, this.storageErrorMessage(error));
        }
      }
    };
    this.temporaryFileCleanup = this.clearStaleTemporaryFiles();
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => this.removeTemporaryFile(file)));
    this.worker.terminate();
    this.files.clear();
    this.receiverReady.clear();
    this.receiverClosed.clear();
  }

  get snapshots(): FileTransferSnapshot[] {
    return [...this.files.values()].map(({ file: _file, completedBlocks: _blocks, receiverBlocks: _receiver, chunks: _chunks, retryCount: _retry, target: _target, blockHashes: _hashes, ...snapshot }) => snapshot);
  }

  async togglePause(id: string): Promise<void> {
    const record = this.files.get(id);
    if (!record || record.state !== "transferring") return;
    if (record.direction === "incoming" && record.paused) this.pauseOtherIncoming(record.id);
    record.paused = !record.paused;
    this.callbacks.sendControl({ type: record.paused ? "PAUSE" : "RESUME", transferId: id });
    if (!record.paused && record.direction === "outgoing") void this.pumpOutgoing(record);
    this.emit(record);
  }

  downloadFile(id: string): boolean {
    const record = this.files.get(id);
    if (!record?.url) return false;
    const anchor = document.createElement("a");
    anchor.href = record.url;
    anchor.download = record.name;
    anchor.click();
    return true;
  }

  deleteFile(id: string): void {
    const record = this.files.get(id);
    if (!record) return;
    this.removeRecord(record);
  }

  resendFile(id: string, nextId: string): boolean {
    const record = this.files.get(id);
    if (!record?.file || record.direction !== "outgoing") return false;
    return this.offerFile(record.file, nextId);
  }

  offerFile(file: File, id: string): boolean {
    const record = asRecord(file, "outgoing", id);
    record.state = "offered";
    record.blockHashes = [];
    this.files.set(id, record);
    this.callbacks.sendControl({
      type: "FILE_OFFER", transferId: id, name: file.name, size: file.size, mimeType: record.mimeType, completedBlocks: [],
    });
    this.emit(record);
    return true;
  }

  handleControl(message: WireMessage): void {
    const id = typeof message.transferId === "string" ? message.transferId : "";
    if (message.type === "FILE_OFFER" && id && typeof message.name === "string" && typeof message.size === "number") {
      const existing = this.files.get(id);
      if (existing?.direction === "incoming" && existing.state === "transferring") {
        this.callbacks.sendControl({ type: "FILE_ACCEPT", transferId: id, credit: FILE_INITIAL_CREDIT, completedBlocks: [...existing.completedBlocks] });
        return;
      }
      if (existing?.direction === "incoming" && existing.state === "offered") {
        this.callbacks.onOffer(this.snapshot(existing));
        return;
      }
      const fake = new File([], message.name, { type: typeof message.mimeType === "string" ? message.mimeType : "application/octet-stream" });
      const record = asRecord(fake, "incoming", id);
      record.size = message.size;
      record.file = undefined;
      record.blockHashes = [];
      record.state = "offered";
      this.files.set(id, record);
      this.emit(record);
      this.callbacks.onOffer(this.snapshot(record));
      return;
    }
    const record = id ? this.files.get(id) : undefined;
    if (!record) return;
    if (message.type === "FLOW_UPDATE" && record.direction === "outgoing") {
      if (typeof message.credit === "number") {
        record.remoteCredit = Math.max(FILE_BLOCK_SIZE, Math.min(FILE_MAX_CREDIT, message.credit));
        void this.pumpOutgoing(record);
      }
      return;
    }
    if (message.type === "PAUSE") {
      record.paused = true;
      this.emit(record);
      return;
    }
    if (message.type === "RESUME") {
      record.paused = false;
      void this.pumpOutgoing(record);
      this.emit(record);
      return;
    }
    if (message.type === "BLOCK_META" && record.direction === "incoming") {
      if (typeof message.blockIndex !== "number" || typeof message.blockLength !== "number" || typeof message.segmentCount !== "number" || typeof message.hash !== "string") return;
      record.receiverBlocks.set(message.blockIndex, {
        blockIndex: message.blockIndex,
        blockLength: message.blockLength,
        hash: message.hash,
        segmentCount: message.segmentCount,
        transferId: record.id,
        type: "BLOCK_META",
        received: 0,
      });
      const pending = record.pendingCompleted.get(message.blockIndex);
      if (pending) record.pendingCompleted.delete(message.blockIndex);
      this.worker.postMessage({ type: "meta", transferId: record.id, blockIndex: message.blockIndex, hash: message.hash });
      return;
    }
    if (message.type === "FILE_ACCEPT" && record.direction === "outgoing") {
      if (Array.isArray(message.completedBlocks)) {
        for (const blockIndex of message.completedBlocks) if (typeof blockIndex === "number") record.completedBlocks.add(blockIndex);
        record.nextBlockIndex = 0;
        while (record.completedBlocks.has(record.nextBlockIndex)) record.nextBlockIndex += 1;
      }
      if (typeof message.credit === "number") record.remoteCredit = Math.min(FILE_MAX_CREDIT, Math.max(FILE_BLOCK_SIZE, message.credit));
      record.state = "transferring";
      this.startTransfer(record);
      this.emit(record);
      void this.pumpOutgoing(record);
    } else if (message.type === "FILE_REJECT" || message.type === "CANCEL") {
      this.removeRecord(record);
    } else if (message.type === "BLOCK_ACK" && record.direction === "outgoing") {
      const blockIndex = Number(message.blockIndex);
      const blockLength = Math.min(FILE_BLOCK_SIZE, record.size - blockIndex * FILE_BLOCK_SIZE);
      record.completedBlocks.add(blockIndex);
      record.inFlightBlocks.delete(blockIndex);
      record.inFlightBytes = Math.max(0, record.inFlightBytes - (record.blockSizes.get(blockIndex) ?? blockLength));
      record.confirmedBytes = Math.min(record.size, record.confirmedBytes + blockLength);
      this.updateRate(record);
      this.emit(record);
      if (record.completedBlocks.size >= Math.ceil(record.size / FILE_BLOCK_SIZE)) {
        record.state = "complete";
        record.speed = record.averageSpeed;
        record.duration = record.startedAt ? Date.now() - record.startedAt : null;
        this.callbacks.sendControl({ type: "FILE_COMMIT", transferId: id });
        this.emit(record);
      } else void this.pumpOutgoing(record);
    } else if (message.type === "BLOCK_NACK" && record.direction === "outgoing") {
      const blockIndex = Number(message.blockIndex);
      const retries = (record.retryCount.get(blockIndex) ?? 0) + 1;
      record.retryCount.set(blockIndex, retries);
      if (retries > 2) this.fail(record, "Block integrity check failed.");
      else {
        record.inFlightBlocks.delete(blockIndex);
        record.inFlightBytes = Math.max(0, record.inFlightBytes - (record.blockSizes.get(blockIndex) ?? 0));
        void this.sendNextBlock(record, blockIndex);
      }
    }
  }

  handleSegment(data: ArrayBuffer): void {
    const segment = decodeSegment(data);
    if (!segment) return;
    const record = this.files.get(segment.transferId);
    if (!record || record.direction !== "incoming" || record.state !== "transferring") return;
    const meta = record.receiverBlocks.get(segment.blockIndex);
    if (!meta) {
      record.receiverBlocks.set(segment.blockIndex, {
        blockIndex: segment.blockIndex,
        blockLength: segment.blockLength,
        hash: "",
        segmentCount: segment.segmentCount,
        transferId: record.id,
        type: "BLOCK_META",
        received: 0,
      });
    }
    record.transferredBytes = Math.min(record.size, record.transferredBytes + segment.payload.byteLength);
    this.updateRate(record);
    this.emit(record);
    this.worker.postMessage({ ...segment, type: "segment" }, [segment.payload]);
  }

  async acceptFile(id: string): Promise<boolean> {
    const activate = () => this.acceptIncomingFile(id);
    this.incomingActivation = this.incomingActivation.then(activate, activate);
    return this.incomingActivation;
  }

  private async acceptIncomingFile(id: string): Promise<boolean> {
    const record = this.files.get(id);
    if (!record || record.direction !== "incoming" || record.state !== "offered") return false;
    await this.temporaryFileCleanup;
    if (record.size > FILE_PERSISTENCE_THRESHOLD) await this.requestPersistentStorage();
    const storageError = await this.storagePreflightError(record.size);
    if (storageError) {
      this.fail(record, storageError);
      return false;
    }
    try {
      record.target = await this.createTarget(record);
      this.pauseOtherIncoming(record.id);
      record.state = "transferring";
      this.startTransfer(record);
      this.callbacks.sendControl({ type: "FILE_ACCEPT", transferId: id, credit: FILE_INITIAL_CREDIT, completedBlocks: [...record.completedBlocks] });
      this.callbacks.sendControl({ type: "FLOW_UPDATE", transferId: id, credit: FILE_INITIAL_CREDIT });
      this.emit(record);
      return true;
    } catch (error) {
      this.fail(record, this.storageErrorMessage(error));
      return false;
    }
  }

  rejectFile(id: string): void {
    const record = this.files.get(id);
    if (!record) return;
    this.callbacks.sendControl({ type: "FILE_REJECT", transferId: id });
    this.removeRecord(record);
  }

  cancelFile(id: string): void {
    const record = this.files.get(id);
    if (!record) return;
    const previousState = record.state;
    record.state = "cancelled";
    this.callbacks.sendControl({ type: record.direction === "incoming" && previousState === "offered" ? "FILE_REJECT" : "CANCEL", transferId: id });
    this.removeRecord(record);
  }

  onTransportReady(): void {
    for (const record of this.files.values()) {
      if (record.state === "complete" || record.state === "cancelled" || record.state === "error") continue;
      if (record.direction === "outgoing") {
        record.inFlightBlocks.clear();
        record.inFlightBytes = 0;
        record.nextBlockIndex = 0;
        while (record.completedBlocks.has(record.nextBlockIndex)) record.nextBlockIndex += 1;
        this.callbacks.sendControl({ type: "FILE_OFFER", transferId: record.id, name: record.name, size: record.size, mimeType: record.mimeType, completedBlocks: [...record.completedBlocks] });
      } else if (record.state === "transferring") {
        this.callbacks.sendControl({ type: record.paused ? "PAUSE" : "FILE_ACCEPT", transferId: record.id, credit: FILE_INITIAL_CREDIT, completedBlocks: [...record.completedBlocks] });
      }
    }
  }

  private pauseOtherIncoming(activeId: string): void {
    for (const record of this.files.values()) {
      if (record.id === activeId || record.direction !== "incoming" || record.state !== "transferring" || record.paused) continue;
      record.paused = true;
      this.callbacks.sendControl({ type: "PAUSE", transferId: record.id });
      this.emit(record);
    }
  }

  private async sendNextBlock(record: FileRecord, blockIndex: number): Promise<void> {
    if (!record.file || record.state !== "transferring") return;
    if (record.inFlightBlocks.has(blockIndex) || record.completedBlocks.has(blockIndex)) return;
    record.inFlightBlocks.add(blockIndex);
    const offset = blockIndex * FILE_BLOCK_SIZE;
    const data = await record.file.slice(offset, Math.min(offset + FILE_BLOCK_SIZE, record.size)).arrayBuffer();
    record.blockSizes.set(blockIndex, data.byteLength);
    record.inFlightBytes += data.byteLength;
    const segmentCount = Math.ceil(data.byteLength / FILE_SEGMENT_SIZE);
    const hash = await sha256(data);
    record.blockHashes[blockIndex] = hash;
    this.callbacks.sendControl({ type: "BLOCK_META", transferId: record.id, blockIndex, blockLength: data.byteLength, segmentCount, hash });
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const start = segmentIndex * FILE_SEGMENT_SIZE;
      const payload = data.slice(start, Math.min(start + FILE_SEGMENT_SIZE, data.byteLength));
      const encoded = encodeSegment({ blockIndex, blockLength: data.byteLength, payload, segmentCount, segmentIndex, transferId: record.id });
      let sent = this.callbacks.sendBulk(encoded);
      while (!sent && record.state === "transferring") {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        sent = this.callbacks.sendBulk(encoded);
      }
      if (!sent) return;
      record.transferredBytes = Math.min(record.size, record.transferredBytes + payload.byteLength);
      this.updateRate(record);
      this.emit(record);
    }
  }

  private async pumpOutgoing(record: FileRecord): Promise<void> {
    while (!record.paused && record.state === "transferring" && record.inFlightBlocks.size < 4 && record.inFlightBytes < record.remoteCredit && record.nextBlockIndex * FILE_BLOCK_SIZE < record.size) {
      const blockIndex = record.nextBlockIndex;
      record.nextBlockIndex += 1;
      void this.sendNextBlock(record, blockIndex);
    }
  }

  private async completeReceivedBlock(result: { blockIndex: number; byteLength: number; transferId: string }): Promise<void> {
    const record = this.files.get(result.transferId);
    if (!record || record.direction !== "incoming" || record.state !== "transferring") return;
    record.writeChain = record.writeChain.then(async () => {
      if (record.state !== "transferring") return;
      record.completedBlocks.add(result.blockIndex);
      record.confirmedBytes = Math.min(record.size, record.confirmedBytes + result.byteLength);
      record.receiverBlocks.delete(result.blockIndex);
      this.callbacks.sendControl({ type: "BLOCK_ACK", transferId: record.id, blockIndex: result.blockIndex });
      this.updateRate(record);
      if (record.confirmedBytes >= record.size) {
        await this.closeReceiver(record);
        record.state = "complete";
        record.speed = record.averageSpeed;
        record.duration = record.startedAt ? Date.now() - record.startedAt : null;
        record.url = await this.createDownloadUrl(record);
        this.callbacks.sendControl({ type: "FILE_ACK", transferId: record.id });
        this.downloadFile(record.id);
      }
      this.emit(record);
    }).catch((error) => {
      console.error("ZestSend could not write a received file block", error);
      this.fail(record, this.storageErrorMessage(error));
    });
  }

  private async storagePreflightError(size: number): Promise<string | null> {
    if (typeof navigator.storage?.getDirectory !== "function") {
      return size <= FILE_MEMORY_LIMIT ? null : "This browser cannot receive a file of this size.";
    }

    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (typeof quota === "number" && typeof usage === "number" && quota - usage < size) {
        return "Browser storage does not have enough free space for this file.";
      }
    } catch {
      // Storage estimation is advisory. Opening the OPFS target remains authoritative.
    }
    return null;
  }

  private async requestPersistentStorage(): Promise<void> {
    if (typeof navigator.storage?.persist !== "function") return;
    try {
      const persisted = await navigator.storage.persist();
      if (!persisted) console.warn("ZestSend persistent storage request was not granted.");
    } catch (error) {
      console.warn("ZestSend could not request persistent storage", error);
    }
  }

  private async createTarget(record: FileRecord): Promise<FileSystemWritableFileStream | undefined> {
    if (typeof navigator.storage?.getDirectory === "function") {
      const root = await navigator.storage.getDirectory();
      record.targetName = `${FILE_TEMP_PREFIX}${record.id}${FILE_TEMP_SUFFIX}`;
      const handle = await root.getFileHandle(record.targetName, { create: true });
      record.fileHandle = handle;
      const ready = new Promise<void>((resolve, reject) => this.receiverReady.set(record.id, { resolve, reject }));
      this.worker.postMessage({ type: "initialize", transferId: record.id, targetName: record.targetName });
      await ready;
      this.receiverReady.delete(record.id);
      return undefined;
    }
    return undefined;
  }

  private async writeTarget(record: FileRecord, data: ArrayBuffer, position: number): Promise<void> {
    if (record.target) {
      await record.target.write({ data, position, type: "write" });
      return;
    }
    record.chunks.set(position, data);
  }

  private async closeReceiver(record: FileRecord): Promise<void> {
    if (!record.targetName) return;
    const closed = new Promise<void>((resolve, reject) => this.receiverClosed.set(record.id, { resolve, reject }));
    this.worker.postMessage({ type: "close", transferId: record.id });
    await closed;
    this.receiverClosed.delete(record.id);
  }

  private storageErrorMessage(error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "QuotaExceededError") return "Browser storage is full; the received file cannot continue writing.";
    if (error instanceof Error && error.message) return `Unable to write the received file: ${error.message}`;
    return "Unable to write the received file.";
  }

  private async createDownloadUrl(record: FileRecord): Promise<string | undefined> {
    if (record.fileHandle) {
      const file = await record.fileHandle.getFile();
      return URL.createObjectURL(file);
    }
    const chunks = [...record.chunks.entries()].sort(([a], [b]) => a - b).map(([, data]) => data);
    return URL.createObjectURL(new Blob(chunks, { type: record.mimeType }));
  }

  private async clearStaleTemporaryFiles(): Promise<void> {
    if (typeof navigator.storage?.getDirectory !== "function") return;
    try {
      const root = await navigator.storage.getDirectory() as FileSystemDirectoryWithEntries;
      for await (const [name] of root.entries()) {
        if (name.startsWith(FILE_TEMP_PREFIX) && name.endsWith(FILE_TEMP_SUFFIX)) {
          await root.removeEntry(name);
        }
      }
    } catch (error) {
      console.warn("ZestSend could not clean temporary file storage", error);
    }
  }

  private async removeTemporaryFile(record: FileRecord): Promise<void> {
    const targetName = record.targetName;
    if (!targetName || typeof navigator.storage?.getDirectory !== "function") return;
    record.targetName = undefined;
    try {
      await record.writeChain.catch(() => undefined);
      const closed = new Promise<void>((resolve, reject) => this.receiverClosed.set(record.id, { resolve, reject }));
      this.worker.postMessage({ type: "discard", transferId: record.id, targetName });
      await closed;
      this.receiverClosed.delete(record.id);
      record.target = undefined;
      record.fileHandle = undefined;
    } catch (error) {
      console.warn("ZestSend could not remove a temporary file", error);
    }
  }

  private updateRate(record: FileRecord): void {
    const now = performance.now();
    const elapsed = now - record.lastSampleAt;
    if (elapsed < 250) return;
    const instantaneousRate = Math.max(0, (record.transferredBytes - record.lastSampleBytes) / (elapsed / 1_000));
    record.speed = instantaneousRate;
    record.lastSampleAt = now;
    record.lastSampleBytes = record.transferredBytes;

    const transferElapsed = Math.max(1, now - (record.transferStartedAt ?? now));
    const lifetimeRate = record.transferredBytes / (transferElapsed / 1_000);
    record.averageSpeed = lifetimeRate;
    const trendAlpha = 1 - Math.exp(-elapsed / 7_000);
    record.throughputEwma = record.throughputEwma === 0
      ? instantaneousRate
      : record.throughputEwma + (instantaneousRate - record.throughputEwma) * trendAlpha;

    // The whole-transfer average anchors ETA; the decaying trend follows sustained changes.
    const trendWeight = 0.2 + 0.45 * Math.min(1, transferElapsed / 20_000);
    const etaRate = lifetimeRate * (1 - trendWeight) + record.throughputEwma * trendWeight;
    record.eta = etaRate > 0 ? Math.ceil((record.size - record.transferredBytes) / etaRate) : null;
  }

  private startTransfer(record: FileRecord): void {
    record.startedAt = Date.now();
    record.transferStartedAt = performance.now();
    record.lastSampleAt = record.transferStartedAt;
    record.lastSampleBytes = record.transferredBytes;
    record.throughputEwma = 0;
  }

  private snapshot(record: FileRecord): FileTransferSnapshot {
    const { file: _file, fileHandle: _handle, targetName: _targetName, transferStartedAt: _transferStartedAt, throughputEwma: _throughputEwma, completedBlocks: _blocks, receiverBlocks: _receiver, chunks: _chunks, retryCount: _retry, target: _target, blockHashes: _hashes, inFlightBlocks: _inFlight, pendingCompleted: _pending, nextBlockIndex: _next, blockSizes: _sizes, inFlightBytes: _inFlightBytes, remoteCredit: _credit, writeChain: _writeChain, ...snapshot } = record;
    return snapshot;
  }

  private emit(record: FileRecord): void {
    this.callbacks.onUpdate(this.snapshot(record));
  }

  private emitRemoved(id: string): void {
    this.callbacks.onRemove?.(id);
  }

  private removeRecord(record: FileRecord): void {
    record.state = "cancelled";
    if (record.url) URL.revokeObjectURL(record.url);
    void this.removeTemporaryFile(record);
    this.files.delete(record.id);
    this.emitRemoved(record.id);
  }

  private fail(record: FileRecord, error: string): void {
    if (record.state === "error") return;
    record.state = "error";
    record.error = error;
    void this.removeTemporaryFile(record);
    console.error("ZestSend file transfer failed", { error, id: record.id, name: record.name });
    this.callbacks.onError(record.id, error);
    this.emit(record);
  }
}
