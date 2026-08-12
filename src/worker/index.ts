import { Hono } from "hono";
import { Room } from "./room";

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

function roomFor(env: ApiBindings, roomId: string) {
  return env.ROOMS.getByName(roomId);
}

function methodNotAllowed(message: string): Response {
  return Response.json({ message }, { status: 405 });
}

app.get("/api/rooms/:roomId/ws", async (context) => {
  const roomId = context.req.param("roomId");
  if (!roomIsValid(roomId)) return context.json({ message: "Invalid room ID." }, 400);
  if (context.req.header("Upgrade") !== "websocket") {
    return context.json({ message: "Expected a WebSocket upgrade." }, 426);
  }

  return roomFor(context.env, roomId).fetch(context.req.raw);
});

app.post("/api/turn/credentials", async (context) => {
  if (!context.env.TURN_ID || !context.env.TURN_TOKEN) {
    return context.json(
      {
        error: "TURN credentials are not configured.",
        message: "TURN_ID and TURN_TOKEN must be set as Worker secrets.",
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
      { error: "TURN credentials could not be generated.", message: "TURN API request failed." },
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
