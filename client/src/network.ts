import { MsgType, readType, encodeAction, encodeSetName, decodeResult, decodeMatched, decodeNames } from "./protocol";

export type GameEvent =
  | { type: "matched"; slot: 0 | 1 }
  | { type: "wait" }
  | { type: "signal" }
  | { type: "foul" }
  | { type: "result"; winner: 0 | 1 | 2; yourReactionMs: number; opponentReactionMs: number }
  | { type: "names"; character1: string; character2: string };

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
        this.onEvent({ type: "matched", slot: decodeMatched(data) });
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
      case MsgType.S2C_NAMES: {
        const [character1, character2] = decodeNames(data);
        this.onEvent({ type: "names", character1, character2 });
        break;
      }
    }
  }

  sendAction() {
    this.ws.send(encodeAction(performance.now()));
  }

  sendName(name: string) {
    this.ws.send(encodeSetName(name));
  }
}
