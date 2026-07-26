import { MsgType, readType, encodeAction, decodeResult } from "./protocol";

export type GameEvent =
  | { type: "matched" }
  | { type: "wait" }
  | { type: "signal" }
  | { type: "foul" }
  | { type: "result"; winner: 0 | 1 | 2; yourReactionMs: number; opponentReactionMs: number };

export class GameConnection {
  private ws: WebSocket;

  constructor(url: string, private onEvent: (e: GameEvent) => void) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => this.handleMessage(ev.data as ArrayBuffer);
  }

  private handleMessage(data: ArrayBuffer) {
    const type = readType(data);
    switch (type) {
      case MsgType.S2C_MATCHED:
        this.onEvent({ type: "matched" });
        break;
      case MsgType.S2C_ROUND_WAIT:
        this.onEvent({ type: "wait" });
        break;
      case MsgType.S2C_SIGNAL:
        this.onEvent({ type: "signal" });
        break;
      case MsgType.S2C_FOUL:
        this.onEvent({ type: "foul" });
        break;
      case MsgType.S2C_RESULT: {
        const r = decodeResult(data);
        this.onEvent({ type: "result", ...r });
        break;
      }
    }
  }

  sendAction() {
    this.ws.send(encodeAction(performance.now()));
  }
}
