import { Hono } from "hono";
import { Room, type IpInfo } from "./room";

type ApiBindings = Env & {
  TURN_ID?: string;
  TURN_TOKEN?: string;
};
type ApiContext = { Bindings: ApiBindings };

const app = new Hono<ApiContext>();

const SUPPORTED_LOCALES = ["en", "zh"] as const;
const DEFAULT_LOCALE = "en";
const LOCALE_COOKIE = "zestsend_locale";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type Locale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

function cookieValue(request: Request, name: string): string {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return value.join("=");
    }
  }
  return "";
}

function requestLocale(request: Request): Locale {
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    const preferred = acceptLanguage
      .split(",")
      .map((part) => part.trim().split(";")[0]?.toLowerCase() ?? "")
      .map((tag) => (tag.startsWith("zh") ? "zh" : tag.slice(0, 2)))
      .find(isSupportedLocale);
    if (preferred) return preferred;
  }

  const savedLocale = cookieValue(request, LOCALE_COOKIE);
  return isSupportedLocale(savedLocale) ? savedLocale : DEFAULT_LOCALE;
}

function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function localizedHomeResponse(request: Request, locale: Locale, assets: Fetcher): Promise<Response> {
  return assets.fetch(request).then((response) => {
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", localeCookie(locale));
    headers.set("Vary", "Cookie, Accept-Language");
    return new Response(response.body, { status: response.status, headers });
  });
}

app.get("/", (context) => {
  const url = new URL(context.req.raw.url);
  const locale = requestLocale(context.req.raw);
  url.pathname = `/${locale}`;
  const headers = new Headers({
    Location: url.toString(),
    Vary: "Cookie, Accept-Language",
  });
  headers.append("Set-Cookie", localeCookie(locale));
  return new Response(null, { status: 307, headers });
});

app.get("/en", (context) => localizedHomeResponse(context.req.raw, "en", context.env.ASSETS));
app.get("/zh", (context) => localizedHomeResponse(context.req.raw, "zh", context.env.ASSETS));

function roomIsValid(roomId: string | undefined): roomId is string {
  return /^\d{4}$/.test(roomId ?? "");
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("CF-Connecting-IP") ??
    forwarded?.split(",")[0]?.trim() ??
    "127.0.0.1"
  );
}

function roomFor(env: ApiBindings, roomId: string) {
  return env.ROOMS.getByName(roomId);
}

function methodNotAllowed(message: string): Response {
  return Response.json({ message }, { status: 405 });
}

app.get("/api/room/check", async (context) => {
  const roomId = context.req.query("roomId");
  if (!roomIsValid(roomId)) {
    return context.json({ message: "无效的房间ID" }, 400);
  }

  const exists = await roomFor(context.env, roomId).exists();
  return context.json({
    roomId,
    exists,
    message: exists ? "房间已存在" : "房间不存在, 将创建新房间",
  });
});

app.all("/api/room/check", () => methodNotAllowed("只允许GET请求"));

app.get("/api/room/init", async (context) => {
  const roomId = context.req.query("roomId");
  if (!roomIsValid(roomId)) {
    return context.json({ message: "无效的房间ID" }, 400);
  }

  const outcome = await roomFor(context.env, roomId).initialize(clientIp(context.req.raw));
  if (outcome.roomFull) {
    return context.json({ message: "房间已满，无法加入", roomFull: true }, 403);
  }

  return context.json({
    roomId,
    isInitiator: outcome.isInitiator,
    userIP: clientIp(context.req.raw),
    message: outcome.isInitiator ? "创建了新房间" : "加入了已存在的房间",
  });
});

app.all("/api/room/init", () => methodNotAllowed("只允许GET请求"));

app.post("/api/signaling/register", async (context) => {
  const body = await context.req.json<{
    roomId?: string;
    peerId?: string;
    isInitiator?: boolean;
  }>();

  if (!roomIsValid(body.roomId) || !body.peerId) {
    return context.json({ message: "缺少必要参数" }, 400);
  }

  const ip = clientIp(context.req.raw);
  const result = await roomFor(context.env, body.roomId).register(
    body.peerId,
    Boolean(body.isInitiator),
    ip,
  );

  if (!result.found) {
    return context.json({ message: "房间不存在" }, 404);
  }

  return context.json({
    success: true,
    peerId: body.peerId,
    roomId: body.roomId,
    ip,
    ...(result.alreadyRegistered ? { alreadyRegistered: true } : {}),
  });
});

app.all("/api/signaling/register", () => methodNotAllowed("只允许POST请求"));

app.get("/api/signaling/poll", async (context) => {
  const roomId = context.req.query("roomId");
  const peerId = context.req.query("peerId");
  if (!roomIsValid(roomId) || !peerId) {
    return context.json({ message: "缺少必要参数" }, 400);
  }

  const result = await roomFor(context.env, roomId).poll(peerId);
  if (!result.found) {
    return context.json({ message: "房间不存在" }, 404);
  }

  return context.json({
    roomId,
    peerId,
    remotePeerId: result.remotePeerId,
    remotePeerType: result.remotePeerType,
    ipInfo: result.ipInfo,
    selfIPInfo: result.selfIPInfo,
    timestamp: Date.now(),
    peerCount: result.peerCount,
    shouldInitiateConnection: result.shouldInitiateConnection,
    connectionPriority: result.connectionPriority,
  });
});

app.all("/api/signaling/poll", () => methodNotAllowed("只允许GET请求"));

app.get("/api/signaling/ip", async (context) => {
  const roomId = context.req.query("roomId");
  const peerId = context.req.query("peerId");
  if (!roomIsValid(roomId) || !peerId) {
    return context.json({ message: "缺少必要参数" }, 400);
  }

  return context.json({ ipInfo: await roomFor(context.env, roomId).getIpInfo(peerId) });
});

app.post("/api/signaling/ip", async (context) => {
  const body = await context.req.json<{
    roomId?: string;
    peerId?: string;
    ipInfo?: IpInfo;
  }>();
  if (!roomIsValid(body.roomId) || !body.peerId || !body.ipInfo) {
    return context.json({ message: "缺少必要参数 roomId、peerId 或 ipInfo" }, 400);
  }

  const stored = await roomFor(context.env, body.roomId).storeIpInfo(body.peerId, body.ipInfo);
  if (!stored) {
    return context.json({ message: "房间不存在" }, 404);
  }

  return context.json({ success: true, message: "IP信息存储成功", verified: true });
});

app.all("/api/signaling/ip", () => methodNotAllowed("不支持的请求方法"));

app.get("/api/ip", async (context) => {
  const roomId = context.req.query("roomId");
  const peerId = context.req.query("peerId");
  const requestCf = context.req.raw.cf as
    | {
        city?: string;
        region?: string;
        country?: string;
        latitude?: string | number;
        longitude?: string | number;
        timezone?: string;
        asOrganization?: string;
      }
    | undefined;
  const ipInfo: IpInfo = {
    ip: clientIp(context.req.raw),
    city: requestCf?.city ?? "Unknown",
    region: requestCf?.region ?? "Unknown",
    country_name: requestCf?.country ?? "Unknown",
    country_code: requestCf?.country ?? "Unknown",
    latitude: Number(requestCf?.latitude ?? 0),
    longitude: Number(requestCf?.longitude ?? 0),
    timezone: requestCf?.timezone ?? "Unknown",
    org: requestCf?.asOrganization ?? "Cloudflare",
  };

  if (roomIsValid(roomId) && peerId) {
    await roomFor(context.env, roomId).storeIpInfo(peerId, ipInfo);
  }

  return context.json(ipInfo);
});

app.all("/api/ip", () => methodNotAllowed("只允许GET请求"));

app.post("/api/turn/credentials", async (context) => {
  if (!context.env.TURN_ID || !context.env.TURN_TOKEN) {
    return context.json(
      {
        error: "TURN credentials not configured",
        message: "TURN_ID and TURN_TOKEN must be set as Worker secrets",
      },
      500,
    );
  }

  const body = await context.req.json<{ ttl?: number }>();
  const ttl = Math.min(Math.max(body.ttl ?? 86_400, 60), 86_400);
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${context.env.TURN_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.TURN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    },
  );

  if (!response.ok) {
    console.error(JSON.stringify({ event: "turn_credentials_failed", status: response.status }));
    return Response.json(
      { error: "Failed to generate TURN credentials", message: "TURN API request failed" },
      { status: response.status },
    );
  }

  return new Response(response.body, {
    headers: { "Content-Type": "application/json" },
  });
});

app.all("/api/turn/credentials", () => methodNotAllowed("Method not allowed"));

app.onError((error, context) => {
  console.error(JSON.stringify({ event: "api_error", path: context.req.path, message: error.message }));
  return context.json({ message: "服务器错误" }, 500);
});

export { Room };
export default app;
