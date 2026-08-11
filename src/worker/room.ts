import { DurableObject } from "cloudflare:workers";

export type PeerRole = "initiator" | "receiver";

export interface PeerRecord {
  id?: string;
  type?: PeerRole;
  ip: string;
  joinedAt: string;
}

export interface IpInfo {
  ip: string;
  city: string;
  region: string;
  country_name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
  org: string;
  _fallback?: boolean;
}

interface RoomRecord {
  createdAt: string;
  expiresAt: number;
  peers: PeerRecord[];
  ipInfo: Record<string, IpInfo>;
}

const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * One Durable Object is assigned to each room code.  It replaces the former
 * short-lived Redis record while preserving its two-peer, IP-aware semantics.
 */
export class Room extends DurableObject<Env> {
  private async getActiveRoom(): Promise<RoomRecord | null> {
    const room = await this.ctx.storage.get<RoomRecord>("room");

    if (room && room.expiresAt <= Date.now()) {
      await this.ctx.storage.delete("room");
      return null;
    }

    return room ?? null;
  }

  private async saveRoom(room: RoomRecord): Promise<void> {
    room.expiresAt = Date.now() + ROOM_TTL_MS;
    await this.ctx.storage.put("room", room);
  }

  async exists(): Promise<boolean> {
    return (await this.getActiveRoom()) !== null;
  }

  async initialize(clientIp: string): Promise<
    | { roomFull: true }
    | { roomFull: false; isInitiator: boolean }
  > {
    let room = await this.getActiveRoom();
    const isInitiator = room === null;

    if (room) {
      const isKnownPeer = room.peers.some((peer) => peer.ip === clientIp);
      if (!isKnownPeer && room.peers.length >= 2) {
        return { roomFull: true };
      }
    } else {
      room = {
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + ROOM_TTL_MS,
        peers: [{ ip: clientIp, joinedAt: new Date().toISOString() }],
        ipInfo: {},
      };
      await this.saveRoom(room);
      return { roomFull: false, isInitiator: true };
    }

    if (!room.peers.some((peer) => peer.ip === clientIp)) {
      room.peers.push({ ip: clientIp, joinedAt: new Date().toISOString() });
      await this.saveRoom(room);
    }

    return { roomFull: false, isInitiator };
  }

  async register(peerId: string, isInitiator: boolean, clientIp: string): Promise<
    | { found: false }
    | { found: true; alreadyRegistered: boolean }
  > {
    const room = await this.getActiveRoom();
    if (!room) {
      return { found: false };
    }

    if (room.peers.some((peer) => peer.id === peerId)) {
      return { found: true, alreadyRegistered: true };
    }

    const peer: PeerRecord = {
      id: peerId,
      type: isInitiator ? "initiator" : "receiver",
      ip: clientIp,
      joinedAt: new Date().toISOString(),
    };
    const currentPeer = room.peers.findIndex((entry) => entry.ip === clientIp);

    if (currentPeer >= 0) {
      room.peers[currentPeer] = peer;
    } else {
      room.peers.push(peer);
    }

    await this.saveRoom(room);
    return { found: true, alreadyRegistered: false };
  }

  async poll(peerId: string): Promise<
    | { found: false }
    | {
        found: true;
        remotePeerId: string | null;
        remotePeerType: PeerRole | null;
        ipInfo: IpInfo | null;
        selfIPInfo: IpInfo | null;
        peerCount: number;
        shouldInitiateConnection: boolean;
        connectionPriority: "high" | "normal";
      }
  > {
    const room = await this.getActiveRoom();
    if (!room) {
      return { found: false };
    }

    const self = room.peers.find((peer) => peer.id === peerId);
    const remote = room.peers.find(
      (peer) => peer.id && peer.id !== peerId && peer.ip !== self?.ip,
    );
    const remotePeerId = remote?.id ?? null;
    const canConnect = remotePeerId !== null;

    return {
      found: true,
      remotePeerId,
      remotePeerType: remote?.type ?? null,
      ipInfo: remotePeerId ? room.ipInfo[remotePeerId] ?? null : null,
      selfIPInfo: room.ipInfo[peerId] ?? null,
      peerCount: room.peers.length,
      shouldInitiateConnection: canConnect,
      connectionPriority:
        canConnect && peerId.localeCompare(remotePeerId) < 0 ? "high" : "normal",
    };
  }

  async storeIpInfo(peerId: string, ipInfo: IpInfo): Promise<boolean> {
    const room = await this.getActiveRoom();
    if (!room) {
      return false;
    }

    room.ipInfo[peerId] = ipInfo;
    await this.saveRoom(room);
    return true;
  }

  async getIpInfo(peerId: string): Promise<IpInfo | null> {
    const room = await this.getActiveRoom();
    return room?.ipInfo[peerId] ?? null;
  }
}
