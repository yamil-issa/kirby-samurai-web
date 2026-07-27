import type { ServerWebSocket } from "bun";
import {
  MsgType,
  encodeSignal,
  encodeResult,
  encodeSimple,
  encodeMatched,
  encodeNames,
  decodeAction,
  decodeSetName,
} from "./protocol";

export type PlayerData = { playerId: string; room?: Room };
export type PlayerSocket = ServerWebSocket<PlayerData>;

const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 68000; // matches samurai-kirby.wav duration (1m08s)
const PRESENTATION_DELAY_MS = 1600; // how long the character banners stay up
const DEFAULT_NAMES: [string, string] = ["Joueur 1", "Joueur 2"];

export class Room {
  private players: PlayerSocket[] = [];
  private signalSentAt: number | null = null;
  private actions: Map<PlayerSocket, number> = new Map();
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private names: [string, string] = [...DEFAULT_NAMES];

  isFull() {
    return this.players.length >= 2;
  }

  addPlayer(ws: PlayerSocket) {
    this.players.push(ws);
    if (this.players.length === 2) {
      this.presentPlayers();
    }
  }

  removePlayer(ws: PlayerSocket) {
    this.players = this.players.filter((p) => p !== ws);
    if (this.roundTimer) clearTimeout(this.roundTimer);
  }

  setName(ws: PlayerSocket, data: Uint8Array) {
    const index = this.players.indexOf(ws);
    if (index === -1) return;
    const name = decodeSetName(data).trim();
    if (!name) return;
    this.names[index] = name;
    const frame = encodeNames(this.names[0], this.names[1]);
    for (const p of this.players) p.send(frame);
  }

  private presentPlayers() {
    this.players.forEach((p, index) => {
      p.send(encodeMatched(index === 0 ? 0 : 1));
    });
    // Send whatever names we already have (defaults, most likely) right
    // away — a client that set its name will trigger a fresh broadcast.
    const namesFrame = encodeNames(this.names[0], this.names[1]);
    for (const p of this.players) p.send(namesFrame);
    this.roundTimer = setTimeout(() => this.startRound(), PRESENTATION_DELAY_MS);
  }

  private startRound() {
    this.actions.clear();
    this.signalSentAt = null;

    for (const p of this.players) {
      p.send(encodeSimple(MsgType.S2C_ROUND_WAIT));
    }

    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    this.roundTimer = setTimeout(() => this.sendSignal(), delay);
  }

  private sendSignal() {
    this.signalSentAt = performance.now();
    const frame = encodeSignal(this.signalSentAt);
    for (const p of this.players) p.send(frame);
  }

  handleAction(ws: PlayerSocket, data: Uint8Array) {
    const receivedAt = performance.now(); // server-authoritative clock
    void decodeAction(data); // client timestamp kept only for future debugging/telemetry

    if (this.signalSentAt === null) {
      // Pressed before the signal was even sent: instant foul, restart the round.
      ws.send(encodeSimple(MsgType.S2C_FOUL));
      const other = this.players.find((p) => p !== ws);
      other?.send(encodeSimple(MsgType.S2C_FOUL));
      this.startRound();
      return;
    }

    if (!this.actions.has(ws)) {
      this.actions.set(ws, receivedAt - this.signalSentAt);
    }

    if (this.actions.size === this.players.length) {
      this.resolveRound();
    }
  }

  private resolveRound() {
    const [p1, p2] = this.players;
    const t1 = this.actions.get(p1)!;
    const t2 = this.actions.get(p2)!;

    const winnerForP1 = t1 < t2 ? 0 : t1 > t2 ? 1 : 2;
    const winnerForP2 = winnerForP1 === 2 ? 2 : winnerForP1 === 0 ? 1 : 0;

    p1.send(encodeResult({ winner: winnerForP1, yourReactionMs: t1, opponentReactionMs: t2 }));
    p2.send(encodeResult({ winner: winnerForP2, yourReactionMs: t2, opponentReactionMs: t1 }));
  }
}
