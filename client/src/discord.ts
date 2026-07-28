import { DiscordSDK } from "@discord/embedded-app-sdk";

export type DiscordSession = {
  discordSdk: DiscordSDK;
  displayName: string;
};

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

  return { discordSdk, displayName };
}

export function isRunningInsideDiscord(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

export function getWebSocketUrl(): string {
  const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isLocalDev) {
    return "ws://localhost:3001";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
