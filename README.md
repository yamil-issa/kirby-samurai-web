# Samurai Kirby

Online reaction duel (in the style of the "Samurai Kirby" minigame from Smash Bros), meant to eventually run as a Discord Activity. This stage focuses purely on getting it running locally, without the Discord SDK.

## Architecture

```
samurai-kirby/
├── server/              # Bun + native WebSocket, game authority
│   └── src/
│       ├── index.ts     # server entry point, basic matchmaking (1 global room)
│       ├── game.ts       # Room: state machine for a single round
│       └── protocol.ts   # binary protocol (de)coding
└── client/              # Vanilla TS + Canvas
    ├── index.html
    ├── style.css
    └── src/
        ├── main.ts        # entry loop, keyboard/click input
        ├── network.ts     # WebSocket wrapper -> game events
        ├── renderer.ts    # canvas drawing based on scene state
        └── protocol.ts    # mirror of the server's protocol
```

### Architecture choices vs. the original plan

- **Backend**: Bun's native WebSocket instead of uWebSockets.js for the MVP. The binary protocol is identical either way; if we ever need uWebSockets.js's extra performance (a lot more concurrent rooms), we can swap the server without touching the protocol or the client.
- **Anti-cheat**: the server never trusts the timestamp sent by the client. Reaction time is calculated purely from the server's own receive time (`performance.now()` at the moment of the `message` event), minus the time the signal was sent. An action received before the signal was sent = instant foul, the round restarts.
- **Protocol**: 1 type byte + fixed payload (float64/float32), no JSON, to stay consistent with the "every millisecond counts" logic.
- **Frontend**: no external bundler (no Vite). We use Bun's built-in HTML server (`bun --hot index.html`), which transpiles TS on the fly. Separate HTML/CSS/JS files as preferred, no single-file bundle.

## Running locally

In two separate terminals (WSL):

```bash
# terminal 1
cd server
bun install
bun run dev

# terminal 2
cd client
bun install
bun run dev
```

Then open **two tabs** on the URL given by `bun --hot index.html` (usually `http://localhost:3000`) to simulate the two players. The server automatically matches the first two connections together.

Spacebar or click on the canvas = the player's action.

## Testing in Discord (via tunnel, before any real deployment)

The unified server (`server/src/discord-serve.ts`) serves everything from a single process: the frontend (already built), the WebSocket (`/ws`), and the OAuth exchange (`/api/token`). Only one tunnel / one URL Mapping is needed.

### 1. Configure credentials

- `server/.env` (copy from `server/.env.example`): `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and **also** `PUBLIC_DISCORD_CLIENT_ID` (same value as `DISCORD_CLIENT_ID` — yes, that's redundant: `bun run discord` bundles the client from this folder, so it needs the variable here too, not just on the client side).
- `client/.env.local` (copy from `client/.env.example`): `PUBLIC_DISCORD_CLIENT_ID` (useful for your own local builds/tests of the client alone).

### 2. Build the client, then run the unified server

```bash
cd client
bun install
bun run build          # generates client/dist, with the Client ID inlined

cd ../server
bun install
bun run discord         # serves everything on http://localhost:3001 (or the PORT from .env)
```

### 3. Tunnel

```bash
cloudflared tunnel --url http://localhost:3001
```

This gives you a URL like `https://xxxx-yyyy.trycloudflare.com`. Note it down (it changes every time the tunnel restarts).

### 4. Configure the Discord Developer Portal

- **Activities > URL Mappings** section: prefix `/` → target = the tunnel URL (without `https://`, just the host)
- Once the Mapping is filled in, the **Enable Activities** option should become available
- **OAuth2** section: check that the Client ID/Secret used match `server/.env`

### 5. Launch the activity

From a Discord voice channel (a test server), launch your Activity. The SDK handles auth automatically (see `client/src/discord.ts`), and the game detects it's running inside Discord via the `frame_id` URL parameter.

## Still missing

- Real multi-room matchmaking / queue (currently: a single global room, MVP)
- Ping measurement and latency compensation (currently: raw server-side arrival order)
- Replay without a page reload on the client if both sockets stay open after a result (to add)
- Discord Embedded App SDK