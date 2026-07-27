import { Room, type PlayerData, type PlayerSocket } from "./game";
import { MsgType, readType } from "./protocol";

const PORT = 3001;

let waitingRoom: Room | null = null;

function getRoomForNewPlayer(): Room {
  if (!waitingRoom || waitingRoom.isFull()) {
    waitingRoom = new Room();
  }
  return waitingRoom;
}

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

    const upgraded = server.upgrade(req, {
      data: { playerId: crypto.randomUUID() },
    });
    if (upgraded) return undefined;
    return new Response("Samurai Kirby server is running.", { status: 200 });
  },
  websocket: {
    open(ws: PlayerSocket) {
      const room = getRoomForNewPlayer();
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
      }
    },
    close(ws: PlayerSocket) {
      ws.data.room?.removePlayer(ws);
    },
  },
});

console.log(`Samurai Kirby server listening on ws://localhost:${PORT}`);
