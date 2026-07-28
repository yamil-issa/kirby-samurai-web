// Single-process entry point for running inside Discord

import { Room, type PlayerData, type PlayerSocket } from "./game";
import { MsgType, readType } from "./protocol";

const PORT = Number(Bun.env.PORT ?? 3001);
const CLIENT_ID = Bun.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = Bun.env.DISCORD_CLIENT_SECRET;
const CLIENT_DIST = decodeURIComponent(new URL("../../client/dist", import.meta.url).pathname);
const LEGAL_DIR = decodeURIComponent(new URL("../legal", import.meta.url).pathname);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET. Create server/.env (see .env.example)."
  );
  process.exit(1);
}

// One waiting room per Discord Activity instance, so two unrelated groups
// launching the Activity at the same time never get matched with each other.
const waitingRooms = new Map<string, Room>();

function getRoomForNewPlayer(instanceKey: string): Room {
  let room = waitingRooms.get(instanceKey);
  if (!room || room.isFull()) {
    room = new Room(
      (r) => waitingRooms.set(instanceKey, r),
      () => waitingRooms.delete(instanceKey)
    );
    waitingRooms.set(instanceKey, room);
  }
  return room;
}

// Exchanges the Discord OAuth code for an access token. Must happen
// server-side: this is the only place CLIENT_SECRET is allowed to exist.
async function handleTokenExchange(req: Request): Promise<Response> {
  const { code } = (await req.json()) as { code?: string };
  if (!code) return Response.json({ error: "missing code" }, { status: 400 });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("Discord token exchange failed:", tokenRes.status, text);
    return Response.json({ error: "token exchange failed" }, { status: 502 });
  }

  const data = (await tokenRes.json()) as { access_token: string };
  return Response.json({ access_token: data.access_token });
}

async function serveStatic(pathname: string): Promise<Response> {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${CLIENT_DIST}${relative}`);
  if (await file.exists()) return new Response(file);
  // Not a known asset — fall back to index.html (simple SPA-style fallback).
  const index = Bun.file(`${CLIENT_DIST}/index.html`);
  if (await index.exists()) return new Response(index);
  return new Response(
    "Client build not found. Run `bun run build` in client/ first (see README).",
    { status: 500 }
  );
}

Bun.serve<PlayerData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/api/token" && req.method === "POST") {
      return handleTokenExchange(req);
    }

    if (url.pathname === "/ws") {
      const instanceKey = url.searchParams.get("instance") || "local";
      const upgraded = server.upgrade(req, {
        data: { playerId: crypto.randomUUID(), instanceKey },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/terms") {
      return new Response(Bun.file(`${LEGAL_DIR}/terms.html`));
    }
    if (url.pathname === "/privacy") {
      return new Response(Bun.file(`${LEGAL_DIR}/privacy.html`));
    }

    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws: PlayerSocket) {
      const room = getRoomForNewPlayer(ws.data.instanceKey);
      ws.data.room = room;
      room.addPlayer(ws);
    },
    message(ws: PlayerSocket, message) {
      if (typeof message === "string") return;
      const type = readType(message as Uint8Array);
      if (type === MsgType.C2S_ACTION) {
        ws.data.room?.handleAction(ws, message as Uint8Array);
      } else if (type === MsgType.C2S_SET_NAME) {
        ws.data.room?.setName(ws, message as Uint8Array);
      } else if (type === MsgType.C2S_READY_REMATCH) {
        ws.data.room?.requestRematch(ws);
      }
    },
    close(ws: PlayerSocket) {
      ws.data.room?.removePlayer(ws);
    },
  },
});

console.log(`Discord-ready server on http://localhost:${PORT} (frontend + /ws + /api/token)`);
console.log(`Serving pre-built client from: ${CLIENT_DIST}`);
