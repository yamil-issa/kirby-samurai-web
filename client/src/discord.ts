import { DiscordSDK } from "@discord/embedded-app-sdk";

export type DiscordSession = {
  discordSdk: DiscordSDK;
  displayName: string;
  instanceId: string;
};

// Runs the standard Discord Activity handshake:
//  1. wait for the SDK to be ready (postMessage bridge with the Discord client)
//  2. ask Discord to authorize this activity for the given scopes (opens an
//     OAuth prompt only if the user hasn't already granted it)
//  3. send the resulting one-time code to OUR OWN backend, which exchanges
//     it for an access_token using the client secret (kept server-side only)
//  4. hand that access_token back to the SDK to finish authentication
export async function setupDiscordSdk(clientId: string): Promise<DiscordSession> {
  const discordSdk = new DiscordSDK(clientId);
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  const { access_token } = (await response.json()) as { access_token: string };

  const auth = await discordSdk.commands.authenticate({ access_token });
  if (!auth) {
    throw new Error("discordSdk.commands.authenticate returned null");
  }

  // global_name is the user's chosen display name; falls back to their
  // username (the @handle) if they haven't set one.
  const displayName = auth.user?.global_name || auth.user?.username || "Joueur";

  // instanceId is unique per Activity launch and shared by everyone who
  // joins it from the same voice channel — used to scope matchmaking so
  // two unrelated groups launching the Activity at the same time never get
  // matched with each other.
  return { discordSdk, displayName, instanceId: discordSdk.instanceId };
}

// Discord Activities are always loaded with a `frame_id` query param — this
// is the standard way to detect "am I actually running inside Discord" vs
// "someone just opened the dev server URL directly in a normal browser".
export function isRunningInsideDiscord(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

// Outside Discord (plain browser testing) instanceId is always "local" —
// there's no risk of collision since it's just you testing solo/with a
// friend, and it keeps local dev working exactly as before.
export function getWebSocketUrl(instanceId: string = "local"): string {
  const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const base = isLocalDev
    ? "ws://localhost:3001"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  return `${base}?instance=${encodeURIComponent(instanceId)}`;
}
