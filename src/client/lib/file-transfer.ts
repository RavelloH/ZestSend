export const FILE_BLOCK_SIZE = 1_048_576;
export const FILE_SEGMENT_SIZE = 64 * 1024;
export const FILE_MEMORY_LIMIT = 512 * 1024 * 1024;
const FILE_PERSISTENCE_THRESHOLD = 2 * 1024 * 1024 * 1024;
export const FILE_INITIAL_CREDIT = 4 * FILE_BLOCK_SIZE;
export const FILE_MAX_CREDIT = 16 * FILE_BLOCK_SIZE;
const FILE_RELAY_INITIAL_CREDIT = 2 * FILE_BLOCK_SIZE;
const FILE_DIRECT_MAX_IN_FLIGHT_BLOCKS = 4;
const FILE_RELAY_MAX_IN_FLIGHT_BLOCKS = 2;
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

export type FileTransferDiagnostics = {
  blockCount: number;
  blockSize: number;
  completedBlocks: number;
  connectionRoute: "direct" | "relay";
  direction: FileTransferDirection;
  inFlightBlocks: number;
  inFlightBytes: number;
  maxInFlightBlocks: number;
  pendingReceiveBlocks: number;
  remoteCredit: number;
  retries: number;
  segmentSize: number;
  transferId: string;
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
  generation: number;
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
  sendTasks: Map<number, Promise<void>>;
  writeChain: Promise<void>;
};

type PendingWorkerOperation = {
  promise: Promise<void>;
  reject: (reason?: unknown) => void;
  resolve: () => void;
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

function abortError(): DOMException {
  return new DOMException("The file transfer session was replaced.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function pendingWorkerOperation(): PendingWorkerOperation {
  let reject!: (reason?: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function asRecord(file: File, direction: FileTransferDirection, id: string, generation: number): FileRecord {
  return {
    confirmedBytes: 0,
    completedBlocks: new Set(),
    blockHashes: [],
    chunks: new Map(),
    direction,
    duration: null,
    eta: null,
    file: direction === "outgoing" ? file : undefined,
    generation,
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
    sendTasks: new Map(),
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
  private worker: Worker;
  private readonly temporaryFileCleanup: Promise<void>;
  private incomingActivation: Promise<boolean> = Promise.resolve(false);
  private receiverReady = new Map<string, PendingWorkerOperation>();
  private receiverClosed = new Map<string, PendingWorkerOperation>();
  private activeSendTasks = new Set<Promise<void>>();
  private sessionGeneration = 0;
  private sendGeneration = 0;
  private sessionAbortController = new AbortController();
  private sendAbortController = new AbortController();
  private disposed = false;
  private connectionRoute: "direct" | "relay" = "direct";

  constructor(private readonly callbacks: FileTransferCallbacks) {
    this.worker = this.createWorker();
    this.temporaryFileCleanup = this.clearStaleTemporaryFiles();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./file-receive.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ blockIndex?: number; byteLength?: number; error?: string; transferId: string; type: string }>) => {
      if (this.disposed || this.worker !== worker) return;
      const message = event.data;
      if (message.type === "receiver-ready") this.receiverReady.get(message.transferId)?.resolve();
      else if (message.type === "receiver-closed" || message.type === "receiver-discarded") this.receiverClosed.get(message.transferId)?.resolve();
      else if (message.type === "block-written" && typeof message.blockIndex === "number" && typeof message.byteLength === "number") void this.completeReceivedBlock(message as { blockIndex: number; byteLength: number; transferId: string });
      else if (message.type === "block-invalid" && typeof message.blockIndex === "number") {
        const record = this.files.get(message.transferId);
        if (record && record.direction === "incoming" && record.state === "transferring" && this.isCurrentRecord(record)) {
          this.callbacks.sendControl({ type: "BLOCK_NACK", transferId: message.transferId, blockIndex: message.blockIndex });
        }
      }
      else if (message.type === "receiver-error") {
        const error = new Error(message.error ?? "OPFS receiver failed.");
        const pending = this.receiverReady.get(message.transferId);
        const closing = this.receiverClosed.get(message.transferId);
        if (pending) pending.reject(error);
        else if (closing) closing.reject(error);
        else {
          const record = this.files.get(message.transferId);
          if (record && this.isCurrentRecord(record)) this.fail(record, this.storageErrorMessage(error));
        }
      }
    };
    return worker;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const { records, tasks } = this.invalidateSession(false);
    await Promise.allSettled(tasks);
    await Promise.allSettled(records.map((record) => this.removeTemporaryFileAfterWorkerReset(record)));
    this.releaseRecords(records);
  }

  /** Clears in-memory transfers and their temporary receiving files after a room reconnect. */
  async clearSession(): Promise<void> {
    if (this.disposed) return;
    const { records, tasks } = this.invalidateSession(true);
    await Promise.allSettled(tasks);
    await Promise.allSettled(records.map((record) => this.removeTemporaryFileAfterWorkerReset(record)));
    this.releaseRecords(records);
  }

  private invalidateSession(recreateWorker: boolean): { records: FileRecord[]; tasks: Promise<unknown>[] } {
    const records = [...this.files.values()];
    const tasks: Promise<unknown>[] = [this.incomingActivation, ...this.activeSendTasks];
    for (const record of records) tasks.push(record.writeChain);

    this.sessionAbortController.abort();
    this.sendAbortController.abort();
    this.sessionGeneration += 1;
    this.sendGeneration += 1;
    this.sessionAbortController = new AbortController();
    this.sendAbortController = new AbortController();

    for (const record of records) {
      record.state = "cancelled";
      record.sendTasks.clear();
      if (record.url) {
        URL.revokeObjectURL(record.url);
        record.url = undefined;
      }
    }
    this.files.clear();
    this.incomingActivation = Promise.resolve(false);
    this.rejectPendingOperations();

    const worker = this.worker;
    worker.onmessage = null;
    worker.terminate();
    if (recreateWorker) this.worker = this.createWorker();
    return { records, tasks };
  }

  private rejectPendingOperations(): void {
    const error = abortError();
    for (const pending of this.receiverReady.values()) pending.reject(error);
    for (const pending of this.receiverClosed.values()) pending.reject(error);
    this.receiverReady.clear();
    this.receiverClosed.clear();
  }

  private releaseRecords(records: FileRecord[]): void {
    for (const record of records) {
      record.file = undefined;
      record.fileHandle = undefined;
      record.target = undefined;
      record.chunks.clear();
      record.blockHashes.length = 0;
      record.blockSizes.clear();
      record.completedBlocks.clear();
      record.inFlightBlocks.clear();
      record.receiverBlocks.clear();
      record.retryCount.clear();
      record.pendingCompleted.clear();
      record.sendTasks.clear();
    }
  }

  private isCurrentRecord(record: FileRecord): boolean {
    return !this.disposed
      && record.generation === this.sessionGeneration
      && this.files.get(record.id) === record;
  }

  private isActiveIncomingOffer(record: FileRecord, generation: number, signal: AbortSignal): boolean {
    return generation === this.sessionGeneration
      && !signal.aborted
      && record.direction === "incoming"
      && record.state === "offered"
      && this.isCurrentRecord(record);
  }

  private isActiveIncomingTransfer(record: FileRecord, generation: number, signal: AbortSignal): boolean {
    return generation === this.sessionGeneration
      && !signal.aborted
      && record.direction === "incoming"
      && record.state === "transferring"
      && this.isCurrentRecord(record);
  }

  private isActiveSend(record: FileRecord, generation: number, signal: AbortSignal): boolean {
    return generation === this.sendGeneration
      && !signal.aborted
      && record.state === "transferring"
      && this.isCurrentRecord(record);
  }

  private resetSendGeneration(): void {
    this.sendAbortController.abort();
    this.sendGeneration += 1;
    this.sendAbortController = new AbortController();
    for (const record of this.files.values()) record.sendTasks.clear();
  }

  setConnectionRoute(route: "direct" | "relay"): void {
    if (this.disposed) return;
    if (this.connectionRoute === route) return;
    this.connectionRoute = route;

    for (const record of this.files.values()) {
      if (record.direction !== "incoming" || record.state !== "transferring") continue;
      this.callbacks.sendControl({
        type: "FLOW_UPDATE",
        transferId: record.id,
        credit: this.initialCredit(),
      });
    }
  }

  get snapshots(): FileTransferSnapshot[] {
    return [...this.files.values()].map((record) => this.snapshot(record));
  }

  getDiagnostics(id: string): FileTransferDiagnostics | null {
    const record = this.files.get(id);
    if (!record) return null;
    return {
      blockCount: Math.ceil(record.size / FILE_BLOCK_SIZE),
      blockSize: FILE_BLOCK_SIZE,
      completedBlocks: record.completedBlocks.size,
      connectionRoute: this.connectionRoute,
      direction: record.direction,
      inFlightBlocks: record.inFlightBlocks.size,
      inFlightBytes: record.inFlightBytes,
      maxInFlightBlocks: this.maxInFlightBlocks(),
      pendingReceiveBlocks: record.receiverBlocks.size,
      remoteCredit: record.remoteCredit,
      retries: [...record.retryCount.values()].reduce((total, attempts) => total + attempts, 0),
      segmentSize: FILE_SEGMENT_SIZE,
      transferId: record.id,
    };
  }

  async togglePause(id: string): Promise<void> {
    const record = this.files.get(id);
    if (!record || record.state !== "transferring") return;
    if (record.direction === "incoming" && record.paused) this.pauseOtherIncoming(record.id);
    record.paused = !record.paused;
    this.callbacks.sendControl({ type: record.paused ? "PAUSE" : "RESUME", transferId: id });
    if (!record.paused && record.direction === "outgoing") this.pumpOutgoing(record);
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
    if (this.disposed) return false;
    const record = asRecord(file, "outgoing", id, this.sessionGeneration);
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
    if (this.disposed) return;
    const id = typeof message.transferId === "string" ? message.transferId : "";
    if (message.type === "FILE_OFFER" && id && typeof message.name === "string" && typeof message.size === "number") {
      const existing = this.files.get(id);
      if (existing?.direction === "incoming" && existing.state === "transferring") {
        this.callbacks.sendControl({ type: "FILE_ACCEPT", transferId: id, credit: this.initialCredit(), completedBlocks: [...existing.completedBlocks] });
        return;
      }
      if (existing?.direction === "incoming" && existing.state === "offered") {
        this.callbacks.onOffer(this.snapshot(existing));
        return;
      }
      const fake = new File([], message.name, { type: typeof message.mimeType === "string" ? message.mimeType : "application/octet-stream" });
      const record = asRecord(fake, "incoming", id, this.sessionGeneration);
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
        this.pumpOutgoing(record);
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
      this.pumpOutgoing(record);
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
      this.pumpOutgoing(record);
    } else if (message.type === "FILE_REJECT" || message.type === "CANCEL") {
      this.removeRecord(record);
    } else if (message.type === "BLOCK_ACK" && record.direction === "outgoing") {
      const blockIndex = Number(message.blockIndex);
      const blockLength = Math.min(FILE_BLOCK_SIZE, record.size - blockIndex * FILE_BLOCK_SIZE);
      record.completedBlocks.add(blockIndex);
      this.releaseInFlightBlock(record, blockIndex);
      record.confirmedBytes = Math.min(record.size, record.confirmedBytes + blockLength);
      this.updateRate(record);
      this.emit(record);
      if (record.completedBlocks.size >= Math.ceil(record.size / FILE_BLOCK_SIZE)) {
        record.state = "complete";
        record.speed = record.averageSpeed;
        record.duration = record.startedAt ? Date.now() - record.startedAt : null;
        this.callbacks.sendControl({ type: "FILE_COMMIT", transferId: id });
        this.emit(record);
      } else this.pumpOutgoing(record);
    } else if (message.type === "BLOCK_NACK" && record.direction === "outgoing") {
      const blockIndex = Number(message.blockIndex);
      if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex * FILE_BLOCK_SIZE >= record.size) return;
      if (!record.inFlightBlocks.has(blockIndex) || record.sendTasks.has(blockIndex)) return;
      const retries = (record.retryCount.get(blockIndex) ?? 0) + 1;
      record.retryCount.set(blockIndex, retries);
      if (retries > 2) this.fail(record, "Block integrity check failed.");
      else {
        this.releaseInFlightBlock(record, blockIndex);
        this.scheduleBlockSend(record, blockIndex);
      }
    }
  }

  handleSegment(data: ArrayBuffer): void {
    if (this.disposed) return;
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
    const record = this.files.get(id);
    if (!record || record.direction !== "incoming" || record.state !== "offered" || !this.isCurrentRecord(record)) return false;
    const generation = this.sessionGeneration;
    const signal = this.sessionAbortController.signal;
    const activate = () => this.acceptIncomingFile(record, generation, signal);
    this.incomingActivation = this.incomingActivation.then(activate, activate);
    return this.incomingActivation;
  }

  private async acceptIncomingFile(record: FileRecord, generation: number, signal: AbortSignal): Promise<boolean> {
    if (!this.isActiveIncomingOffer(record, generation, signal)) return false;
    await this.temporaryFileCleanup;
    if (!this.isActiveIncomingOffer(record, generation, signal)) return false;
    if (record.size > FILE_PERSISTENCE_THRESHOLD) {
      await this.requestPersistentStorage();
      if (!this.isActiveIncomingOffer(record, generation, signal)) return false;
    }
    const storageError = await this.storagePreflightError(record.size);
    if (!this.isActiveIncomingOffer(record, generation, signal)) return false;
    if (storageError) {
      this.fail(record, storageError);
      return false;
    }
    try {
      record.target = await this.createTarget(record, generation, signal);
      if (!this.isActiveIncomingOffer(record, generation, signal)) {
        void this.removeTemporaryFile(record);
        return false;
      }
      this.pauseOtherIncoming(record.id);
      record.state = "transferring";
      this.startTransfer(record);
      this.callbacks.sendControl({ type: "FILE_ACCEPT", transferId: record.id, credit: this.initialCredit(), completedBlocks: [...record.completedBlocks] });
      this.callbacks.sendControl({ type: "FLOW_UPDATE", transferId: record.id, credit: this.initialCredit() });
      this.emit(record);
      return true;
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentRecord(record)) return false;
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
    if (this.disposed) return;
    this.resetSendGeneration();
    for (const record of this.files.values()) {
      if (record.state === "complete" || record.state === "cancelled" || record.state === "error") continue;
      if (record.direction === "outgoing") {
        record.inFlightBlocks.clear();
        record.inFlightBytes = 0;
        record.blockSizes.clear();
        record.nextBlockIndex = 0;
        while (record.completedBlocks.has(record.nextBlockIndex)) record.nextBlockIndex += 1;
        this.callbacks.sendControl({ type: "FILE_OFFER", transferId: record.id, name: record.name, size: record.size, mimeType: record.mimeType, completedBlocks: [...record.completedBlocks] });
      } else if (record.state === "transferring") {
        this.callbacks.sendControl({ type: record.paused ? "PAUSE" : "FILE_ACCEPT", transferId: record.id, credit: this.initialCredit(), completedBlocks: [...record.completedBlocks] });
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

  private scheduleBlockSend(record: FileRecord, blockIndex: number): void {
    if (!record.file || !this.isCurrentRecord(record) || record.state !== "transferring") return;
    if (record.inFlightBlocks.has(blockIndex) || record.completedBlocks.has(blockIndex) || record.sendTasks.has(blockIndex)) return;
    const generation = this.sendGeneration;
    const signal = this.sendAbortController.signal;
    record.inFlightBlocks.add(blockIndex);

    let task!: Promise<void>;
    task = this.sendNextBlock(record, blockIndex, generation, signal)
      .catch((error) => {
        if (isAbortError(error) || !this.isActiveSend(record, generation, signal)) return;
        this.releaseInFlightBlock(record, blockIndex);
        this.fail(record, error instanceof Error ? error.message : "Unable to send the file block.");
      })
      .finally(() => {
        if (record.sendTasks.get(blockIndex) === task) record.sendTasks.delete(blockIndex);
        this.activeSendTasks.delete(task);
      });
    record.sendTasks.set(blockIndex, task);
    this.activeSendTasks.add(task);
  }

  private async sendNextBlock(record: FileRecord, blockIndex: number, generation: number, signal: AbortSignal): Promise<void> {
    const file = record.file;
    if (!file || !this.isActiveSend(record, generation, signal)) return;
    const offset = blockIndex * FILE_BLOCK_SIZE;
    const data = await file.slice(offset, Math.min(offset + FILE_BLOCK_SIZE, record.size)).arrayBuffer();
    if (!this.isActiveSend(record, generation, signal)) return;
    record.blockSizes.set(blockIndex, data.byteLength);
    record.inFlightBytes += data.byteLength;
    const segmentCount = Math.ceil(data.byteLength / FILE_SEGMENT_SIZE);
    const hash = await sha256(data);
    if (!this.isActiveSend(record, generation, signal)) return;
    record.blockHashes[blockIndex] = hash;
    while (!this.callbacks.sendControl({ type: "BLOCK_META", transferId: record.id, blockIndex, blockLength: data.byteLength, segmentCount, hash })) {
      if (!await this.waitForSendRetry(signal) || !this.isActiveSend(record, generation, signal)) return;
    }
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (!this.isActiveSend(record, generation, signal)) return;
      const start = segmentIndex * FILE_SEGMENT_SIZE;
      const payload = data.slice(start, Math.min(start + FILE_SEGMENT_SIZE, data.byteLength));
      const encoded = encodeSegment({ blockIndex, blockLength: data.byteLength, payload, segmentCount, segmentIndex, transferId: record.id });
      let sent = this.callbacks.sendBulk(encoded);
      while (!sent && this.isActiveSend(record, generation, signal)) {
        if (!await this.waitForSendRetry(signal) || !this.isActiveSend(record, generation, signal)) return;
        sent = this.callbacks.sendBulk(encoded);
      }
      if (!sent || !this.isActiveSend(record, generation, signal)) return;
      record.transferredBytes = Math.min(record.size, record.transferredBytes + payload.byteLength);
      this.updateRate(record);
      this.emit(record);
    }
  }

  private pumpOutgoing(record: FileRecord): void {
    while (this.isCurrentRecord(record) && !record.paused && record.state === "transferring" && record.inFlightBlocks.size < this.maxInFlightBlocks() && record.inFlightBytes < record.remoteCredit && record.nextBlockIndex * FILE_BLOCK_SIZE < record.size) {
      const blockIndex = record.nextBlockIndex;
      record.nextBlockIndex += 1;
      this.scheduleBlockSend(record, blockIndex);
    }
  }

  private releaseInFlightBlock(record: FileRecord, blockIndex: number): void {
    record.inFlightBlocks.delete(blockIndex);
    record.inFlightBytes = Math.max(0, record.inFlightBytes - (record.blockSizes.get(blockIndex) ?? 0));
    record.blockSizes.delete(blockIndex);
  }

  private waitForSendRetry(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        signal.removeEventListener("abort", handleAbort);
        resolve(ready);
      };
      const handleAbort = () => finish(false);
      const timer = window.setTimeout(() => finish(true), 40);
      signal.addEventListener("abort", handleAbort, { once: true });
    });
  }

  private initialCredit(): number {
    return this.connectionRoute === "relay" ? FILE_RELAY_INITIAL_CREDIT : FILE_INITIAL_CREDIT;
  }

  private maxInFlightBlocks(): number {
    return this.connectionRoute === "relay" ? FILE_RELAY_MAX_IN_FLIGHT_BLOCKS : FILE_DIRECT_MAX_IN_FLIGHT_BLOCKS;
  }

  private async completeReceivedBlock(result: { blockIndex: number; byteLength: number; transferId: string }): Promise<void> {
    const record = this.files.get(result.transferId);
    if (!record || record.direction !== "incoming" || record.state !== "transferring" || !this.isCurrentRecord(record)) return;
    const generation = this.sessionGeneration;
    const signal = this.sessionAbortController.signal;
    record.writeChain = record.writeChain.then(async () => {
      if (!this.isActiveIncomingTransfer(record, generation, signal)) return;
      record.completedBlocks.add(result.blockIndex);
      record.confirmedBytes = Math.min(record.size, record.confirmedBytes + result.byteLength);
      record.receiverBlocks.delete(result.blockIndex);
      this.callbacks.sendControl({ type: "BLOCK_ACK", transferId: record.id, blockIndex: result.blockIndex });
      this.updateRate(record);
      if (record.confirmedBytes >= record.size) {
        await this.closeReceiver(record, generation, signal);
        if (!this.isActiveIncomingTransfer(record, generation, signal)) return;
        record.state = "complete";
        record.speed = record.averageSpeed;
        record.duration = record.startedAt ? Date.now() - record.startedAt : null;
        const url = await this.createDownloadUrl(record);
        if (!this.isCurrentRecord(record) || generation !== this.sessionGeneration || signal.aborted) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        record.url = url;
        this.callbacks.sendControl({ type: "FILE_ACK", transferId: record.id });
        this.downloadFile(record.id);
      }
      this.emit(record);
    }).catch((error) => {
      if (isAbortError(error) || !this.isCurrentRecord(record)) return;
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

  private async createTarget(record: FileRecord, generation: number, signal: AbortSignal): Promise<FileSystemWritableFileStream | undefined> {
    if (typeof navigator.storage?.getDirectory === "function") {
      const root = await navigator.storage.getDirectory();
      if (!this.isActiveIncomingOffer(record, generation, signal)) throw abortError();
      const targetName = this.temporaryFileName();
      const worker = this.worker;
      record.targetName = targetName;
      try {
        const handle = await root.getFileHandle(targetName, { create: true });
        if (!this.isActiveIncomingOffer(record, generation, signal)) throw abortError();
        record.fileHandle = handle;
        await this.waitForWorkerOperation(this.receiverReady, record.id, worker, signal, () => {
          worker.postMessage({ type: "initialize", transferId: record.id, targetName });
        });
        if (!this.isActiveIncomingOffer(record, generation, signal)) throw abortError();
        return undefined;
      } catch (error) {
        if (record.targetName === targetName && (isAbortError(error) || worker !== this.worker || !this.isCurrentRecord(record))) {
          record.targetName = undefined;
          record.fileHandle = undefined;
          await this.deleteTemporaryFileName(targetName);
        }
        throw error;
      }
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

  private async closeReceiver(record: FileRecord, generation: number, signal: AbortSignal): Promise<void> {
    if (!record.targetName) return;
    if (!this.isActiveIncomingTransfer(record, generation, signal)) throw abortError();
    const worker = this.worker;
    await this.waitForWorkerOperation(this.receiverClosed, record.id, worker, signal, () => {
      worker.postMessage({ type: "close", transferId: record.id });
    });
  }

  private async waitForWorkerOperation(
    operations: Map<string, PendingWorkerOperation>,
    id: string,
    worker: Worker,
    signal: AbortSignal,
    start: () => void,
  ): Promise<void> {
    if (signal.aborted || worker !== this.worker) throw abortError();
    const pending = pendingWorkerOperation();
    operations.get(id)?.reject(abortError());
    operations.set(id, pending);
    const handleAbort = () => pending.reject(abortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    try {
      start();
      await pending.promise;
      if (signal.aborted || worker !== this.worker) throw abortError();
    } finally {
      signal.removeEventListener("abort", handleAbort);
      if (operations.get(id) === pending) operations.delete(id);
    }
  }

  private temporaryFileName(): string {
    const nonce = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${FILE_TEMP_PREFIX}${nonce}${FILE_TEMP_SUFFIX}`;
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
    const worker = this.worker;
    const signal = this.sessionAbortController.signal;
    let discarded = false;
    try {
      await record.writeChain.catch(() => undefined);
      if (this.disposed || worker !== this.worker || record.generation !== this.sessionGeneration || signal.aborted) throw abortError();
      await this.waitForWorkerOperation(this.receiverClosed, record.id, worker, signal, () => {
        worker.postMessage({ type: "discard", transferId: record.id, targetName });
      });
      discarded = true;
    } catch (error) {
      if (!isAbortError(error)) console.warn("ZestSend could not remove a temporary file", error);
    } finally {
      if (!discarded) await this.deleteTemporaryFileName(targetName);
      record.target = undefined;
      record.fileHandle = undefined;
    }
  }

  private async removeTemporaryFileAfterWorkerReset(record: FileRecord): Promise<void> {
    const targetName = record.targetName;
    record.targetName = undefined;
    record.target = undefined;
    record.fileHandle = undefined;
    if (targetName) await this.deleteTemporaryFileName(targetName);
  }

  private async deleteTemporaryFileName(targetName: string): Promise<void> {
    if (typeof navigator.storage?.getDirectory !== "function") return;
    let lastError: unknown;
    for (const delay of [0, 50, 200]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(targetName);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") return;
        lastError = error;
      }
    }
    console.warn("ZestSend could not remove a temporary file", lastError);
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
    const { file: _file, fileHandle: _handle, targetName: _targetName, transferStartedAt: _transferStartedAt, throughputEwma: _throughputEwma, completedBlocks: _blocks, receiverBlocks: _receiver, chunks: _chunks, retryCount: _retry, target: _target, blockHashes: _hashes, inFlightBlocks: _inFlight, pendingCompleted: _pending, nextBlockIndex: _next, blockSizes: _sizes, inFlightBytes: _inFlightBytes, remoteCredit: _credit, writeChain: _writeChain, generation: _generation, sendTasks: _sendTasks, ...snapshot } = record;
    return snapshot;
  }

  private emit(record: FileRecord): void {
    if (!this.isCurrentRecord(record)) return;
    this.callbacks.onUpdate(this.snapshot(record));
  }

  private emitRemoved(id: string): void {
    this.callbacks.onRemove?.(id);
  }

  private removeRecord(record: FileRecord): void {
    if (this.files.get(record.id) !== record) return;
    record.state = "cancelled";
    this.files.delete(record.id);
    if (record.url) {
      URL.revokeObjectURL(record.url);
      record.url = undefined;
    }
    void this.removeTemporaryFile(record);
    this.emitRemoved(record.id);
  }

  private fail(record: FileRecord, error: string): void {
    if (record.state === "error" || !this.isCurrentRecord(record)) return;
    record.state = "error";
    record.error = error;
    void this.removeTemporaryFile(record);
    console.error("ZestSend file transfer failed", { error, id: record.id, name: record.name });
    this.callbacks.onError(record.id, error);
    this.emit(record);
  }
}
