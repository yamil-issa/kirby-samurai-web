// Binary WebSocket protocol — 1 type byte + fixed payload, no JSON overhead.

export const MsgType = {
  C2S_JOIN: 0x01,
  S2C_MATCHED: 0x02,
  S2C_ROUND_WAIT: 0x03, // "Matte..." phase, client should arm itself
  S2C_SIGNAL: 0x04, // "SHOOT!" — go signal
  C2S_ACTION: 0x05, // player pressed/clicked
  S2C_RESULT: 0x06,
  S2C_FOUL: 0x07, // pressed before the signal
} as const;

export type ResultPayload = {
  winner: 0 | 1 | 2; // 0 = this player, 1 = opponent, 2 = draw
  yourReactionMs: number;
  opponentReactionMs: number;
};

export function encodeSimple(type: number): ArrayBuffer {
  const buf = new ArrayBuffer(1);
  new DataView(buf).setUint8(0, type);
  return buf;
}

// role: 0 = character1 (first connected, drawn on the left)
//       1 = character2 (second connected, drawn on the right)
export function encodeMatched(role: number): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, MsgType.S2C_MATCHED);
  view.setUint8(1, role);
  return buf;
}

// Tells a client which side it is: 0 = character1 (left), 1 = character2 (right).
// Needed so each client's local "win"/"lose" result maps to the correct
export function encodeMatched(slot: 0 | 1): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, MsgType.S2C_MATCHED);
  view.setUint8(1, slot);
  return buf;
}

export function encodeSignal(serverTimestamp: number): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, MsgType.S2C_SIGNAL);
  view.setFloat64(1, serverTimestamp);
  return buf;
}

export function encodeResult(payload: ResultPayload): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 1 + 4 + 4);
  const view = new DataView(buf);
  view.setUint8(0, MsgType.S2C_RESULT);
  view.setUint8(1, payload.winner);
  view.setFloat32(2, payload.yourReactionMs);
  view.setFloat32(6, payload.opponentReactionMs);
  return buf;
}

export function readType(data: Uint8Array): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint8(0);
}

export function decodeAction(data: Uint8Array): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(1);
}
