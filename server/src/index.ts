import { Room, type PlayerData, type PlayerSocket } from "./game";
import { MsgType, readType } from "./protocol";

const PORT = 3001;

// One waiting room per Discord Activity instance (or "local" outside
// Discord), so two unrelated groups launching the Activity at the same time
// never get matched with each other.
const waitingRooms = new Map<string, Room>();

function getRoomForNewPlayer(instanceKey: string): Room {
  let room = waitingRooms.get(instanceKey);
  if (!room || room.isFull()) {
    room = new Room(
      (r) => waitingRooms.set(instanceKey, r), // dropped to 1 player — stays matchable
      () => waitingRooms.delete(instanceKey) // dropped to 0 players — stop leaking it
    );
    waitingRooms.set(instanceKey, room);
  }
  return room;
}

// Server side half of the Discord Activity OAuth2 flow: the client gets a
// one-time `code` from discordSdk.commands.authorize(), sends it here, and
// we exchange it for an access_token using the client secret (which must
// never be exposed to the browser). Configure DISCORD_CLIENT_ID and
// DISCORD_CLIENT_SECRET in server/.env (Bun loads it automatically).
async function handleTokenExchange(req: Request): Promise<Response> {
  const { code } = (await req.json()) as { code?: string };
  if (!code) {
    return new Response(JSON.stringify({ error: "missing code" }), { status: 400 });
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET missing — check server/.env");
    return new Response(JSON.stringify({ error: "server not configured" }), { status: 500 });
  }

  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!tokenResponse.ok) {
    console.error("Discord token exchange failed:", tokenResponse.status, await tokenResponse.text());
    return new Response(JSON.stringify({ error: "token exchange failed" }), { status: 502 });
  }

  const { access_token } = (await tokenResponse.json()) as { access_token: string };
  return new Response(JSON.stringify({ access_token }), {
    headers: { "Content-Type": "application/json" },
  });
}

Bun.serve<PlayerData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Match on the path tail rather than an exact string: depending on how
    // the Discord proxy forwards requests, the URL Mapping prefix may or
    // may not still be present by the time it reaches us.
    if (req.method === "POST" && url.pathname.endsWith("/api/token")) {
      return handleTokenExchange(req);
    }

    const instanceKey = url.searchParams.get("instance") || "local";
    const upgraded = server.upgrade(req, {
      data: { playerId: crypto.randomUUID(), instanceKey },
    });
    if (upgraded) return undefined;
    return new Response("Samurai Kirby server is running.", { status: 200 });
  },
  websocket: {
    open(ws: PlayerSocket) {
      const room = getRoomForNewPlayer(ws.data.instanceKey);
      ws.data.room = room;
      room.addPlayer(ws);
    },
    message(ws: PlayerSocket, message) {
      if (typeof message === "string") return;
      const type = readType(message);
      if (type === MsgType.C2S_ACTION) {
        ws.data.room?.handleAction(ws, message);
      } else if (type === MsgType.C2S_SET_NAME) {
        ws.data.room?.setName(ws, message);
      } else if (type === MsgType.C2S_READY_REMATCH) {
        ws.data.room?.requestRematch(ws);
      }
    },
    close(ws: PlayerSocket) {
      ws.data.room?.removePlayer(ws);
    },
  },
});

console.log(`Samurai Kirby server listening on ws://localhost:${PORT}`);
