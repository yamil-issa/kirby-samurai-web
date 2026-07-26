import { Room, type PlayerData, type PlayerSocket } from "./game";
import { MsgType, readType } from "./protocol";

const PORT = 3001;

let waitingRoom: Room | null = null;

function getRoomForNewPlayer(): Room {
  if (!waitingRoom || waitingRoom.isFull()) {
    waitingRoom = new Room();
  }
  return waitingRoom;
}

Bun.serve<PlayerData>({
  port: PORT,
  fetch(req, server) {
    const upgraded = server.upgrade(req, {
      data: { playerId: crypto.randomUUID() },
    });
    if (upgraded) return undefined;
    return new Response("Samurai Kirby server is running.", { status: 200 });
  },
  websocket: {
    open(ws: PlayerSocket) {
      const room = getRoomForNewPlayer();
      ws.data.room = room;
      room.addPlayer(ws);
    },
    message(ws: PlayerSocket, message) {
      if (typeof message === "string") return;
      const type = readType(message);
      if (type === MsgType.C2S_ACTION) {
        ws.data.room?.handleAction(ws, message);
      }
    },
    close(ws: PlayerSocket) {
      ws.data.room?.removePlayer(ws);
    },
  },
});

console.log(`Samurai Kirby server listening on ws://localhost:${PORT}`);
