// Mirrors server/src/protocol.ts. Kept as a separate copy for now to avoid
// cross-project TS resolution headaches — keep both files in sync manually
// until we introduce a shared package.

export const MsgType = {
  C2S_JOIN: 0x01,
  S2C_MATCHED: 0x02,
  S2C_ROUND_WAIT: 0x03,
  S2C_SIGNAL: 0x04,
  C2S_ACTION: 0x05,
  S2C_RESULT: 0x06,
  S2C_FOUL: 0x07,
} as const;

export function readType(data: ArrayBuffer): number {
  return new DataView(data).getUint8(0);
}

export function encodeAction(clientTimestamp: number): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, MsgType.C2S_ACTION);
  view.setFloat64(1, clientTimestamp);
  return buf;
}

export function decodeSignal(data: ArrayBuffer): number {
  return new DataView(data).getFloat64(1);
}

export function decodeResult(data: ArrayBuffer) {
  const view = new DataView(data);
  return {
    winner: view.getUint8(1) as 0 | 1 | 2,
    yourReactionMs: view.getFloat32(2),
    opponentReactionMs: view.getFloat32(6),
  };
}
