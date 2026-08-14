export type SharedPlaybackKind = "audio" | "video";

export type SharedPlaybackCommand = "play" | "pause" | "seek" | "rate" | "stop";

export type SharedPlaybackMessage =
  | {
      currentTime: number;
      duration: number;
      id: string;
      kind: SharedPlaybackKind;
      name: string;
      playbackRate: number;
      playing: boolean;
      type: "shared-playback-state";
    }
  | {
      command: SharedPlaybackCommand;
      currentTime?: number;
      id: string;
      playbackRate?: number;
      type: "shared-playback-command";
    }
  | {
      id: string;
      type: "shared-playback-stopped";
    };

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlaybackId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function isSharedPlaybackMessage(value: unknown): value is SharedPlaybackMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SharedPlaybackMessage>;
  if (!isPlaybackId(message.id)) return false;

  if (message.type === "shared-playback-stopped") return true;
  if (message.type === "shared-playback-command") {
    if (message.command !== "play" && message.command !== "pause" && message.command !== "seek" && message.command !== "rate" && message.command !== "stop") return false;
    if (message.currentTime !== undefined && !isFiniteTime(message.currentTime)) return false;
    return message.playbackRate === undefined || (typeof message.playbackRate === "number" && Number.isFinite(message.playbackRate) && message.playbackRate >= 0.25 && message.playbackRate <= 4);
  }

  return message.type === "shared-playback-state"
    && (message.kind === "audio" || message.kind === "video")
    && typeof message.name === "string"
    && message.name.length > 0
    && message.name.length <= 512
    && isFiniteTime(message.currentTime)
    && isFiniteTime(message.duration)
    && typeof message.playing === "boolean"
    && typeof message.playbackRate === "number"
    && Number.isFinite(message.playbackRate)
    && message.playbackRate >= 0.25
    && message.playbackRate <= 4;
}
