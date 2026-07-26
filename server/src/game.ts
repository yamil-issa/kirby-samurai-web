import type { ServerWebSocket } from "bun";
import {
  MsgType,
  encodeSignal,
  encodeResult,
  encodeSimple,
  decodeAction,
} from "./protocol";

export type PlayerData = { playerId: string; room?: Room };
export type PlayerSocket = ServerWebSocket<PlayerData>;

const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 4000;
const PRESENTATION_DELAY_MS = 5000; // how long the character banners stay up

export class Room {
  private players: PlayerSocket[] = [];
  private signalSentAt: number | null = null;
  private actions: Map<PlayerSocket, number> = new Map();
  private roundTimer: ReturnType<typeof setTimeout> | null = null;

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

  private presentPlayers() {
    for (const p of this.players) {
      p.send(encodeSimple(MsgType.S2C_MATCHED));
    }
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
