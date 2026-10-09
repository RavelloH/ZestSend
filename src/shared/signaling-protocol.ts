export const SIGNALING_HEARTBEAT_CAPABILITY = "auto-response-heartbeat-v3";
export const SIGNALING_HEARTBEAT_REQUEST = "zestsend:heartbeat:v3";
export const SIGNALING_HEARTBEAT_RESPONSE = "zestsend:heartbeat:v3:ack";
export const SIGNALING_HEARTBEAT_INTERVAL_MS = 30_000;

export const ROOM_DISCONNECTED_LEASE_MS = 30_000;
export const ACTIVE_SIGNALING_TIMEOUT_MS = 180_000;

export type SignalingHeartbeatProtocol = "legacy-json" | "auto-response-v3";
