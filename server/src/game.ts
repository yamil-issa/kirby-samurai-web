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

export type PlayerData = { playerId: string; instanceKey: string; room?: Room };
export type PlayerSocket = ServerWebSocket<PlayerData>;

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 25000; // matches samurai-kirby.wav duration (1m08s)
const PRESENTATION_DELAY_MS = 1600; // how long the character banners stay up
const GRACE_PERIOD_MS = 2000; // once one player reacts, how long the other gets before auto-losing
const DEFAULT_NAMES: [string, string] = ["Joueur 1", "Joueur 2"];

export class Room {
  private players: PlayerSocket[] = [];
  private signalSentAt: number | null = null;
  private actions: Map<PlayerSocket, number> = new Map();
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private names: [string, string] = [...DEFAULT_NAMES];
  private readyForRematch: Set<PlayerSocket> = new Set();

  constructor(
    private onAvailable?: (room: Room) => void,
    private onEmpty?: (room: Room) => void
  ) {}

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
    const wasFull = this.isFull();
    this.players = this.players.filter((p) => p !== ws);
    this.readyForRematch.delete(ws);
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);

    if (wasFull && this.players.length === 1) {
      this.players[0].send(encodeSimple(MsgType.S2C_OPPONENT_LEFT));
      this.onAvailable?.(this);
    } else if (this.players.length === 0) {
      this.onEmpty?.(this);
    }
  }

  // Called when a client clicks "Rejouer". Once both remaining players have
  // done so, jump straight back to the Matte/Shoot loop — no need to redo
  // the presentation banners for a rematch between the same two people.
  requestRematch(ws: PlayerSocket) {
    if (!this.players.includes(ws)) return;
    this.readyForRematch.add(ws);
    if (this.isFull() && this.players.every((p) => this.readyForRematch.has(p))) {
      this.readyForRematch.clear();
      this.startRound();
    }
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
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }

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
      if (this.graceTimer) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
      this.resolveRound();
    } else if (this.actions.size === 1) {
      // One player reacted — give the other GRACE_PERIOD_MS before we just
      // call it: someone who never reacts shouldn't leave the round stuck.
      this.graceTimer = setTimeout(() => this.resolveAfterTimeout(), GRACE_PERIOD_MS);
    }
  }

  // Fires if the second player still hasn't reacted GRACE_PERIOD_MS after
  // the first one did. Assigns them a reaction time worse than the
  // responder's (never a draw from a timeout) and resolves anyway.
  private resolveAfterTimeout() {
    this.graceTimer = null;
    if (this.actions.size === this.players.length) return; // already resolved, safety net

    const respondedTime = [...this.actions.values()][0];
    for (const p of this.players) {
      if (!this.actions.has(p)) {
        this.actions.set(p, respondedTime + GRACE_PERIOD_MS);
      }
    }
    this.resolveRound();
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
