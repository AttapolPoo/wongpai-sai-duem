import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import { createShuffledDeck, getCardById, PUNISHMENT_CARDS } from "../cards.js";

const ROOT_DIR = path.resolve(".");
const PORT = Number(process.env.PORT || 4173);
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

const clients = new Map();
const rooms = new Map();

function createId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizePlayerName(name) {
  return String(name ?? "").trim().slice(0, 24);
}

function sanitizeRoomName(name) {
  return String(name ?? "").trim().slice(0, 40) || "วงไพ่สายดื่ม";
}

function getFilePath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  return path.join(ROOT_DIR, normalized);
}

function send(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function publicRoomsPayload() {
  return [...rooms.values()]
    .filter((room) => room.isPublic)
    .map((room) => ({
      code: room.code,
      name: room.name,
      playerCount: room.players.length,
      remainingCount: room.deck.length
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "th"));
}

function broadcastPublicRooms() {
  const payload = {
    type: "public-rooms",
    rooms: publicRoomsPayload()
  };

  for (const client of clients.values()) {
    send(client.socket, payload);
  }
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  while (true) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!rooms.has(code)) {
      return code;
    }
  }
}

function buildRoomSnapshot(room) {
  return {
    code: room.code,
    name: room.name,
    isPublic: room.isPublic,
    hostId: room.hostId,
    hostName: room.players.find((player) => player.id === room.hostId)?.name ?? "Host",
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name
    })),
    game: {
      totalCount: PUNISHMENT_CARDS.length,
      drawnCount: room.history.length,
      remainingCount: room.deck.length,
      currentCard: room.currentCardId ? getCardById(room.currentCardId) : null,
      history: room.history
        .slice(-8)
        .reverse()
        .map((cardId) => getCardById(cardId))
        .filter(Boolean)
    }
  };
}

function broadcastRoom(room) {
  const payload = {
    type: "room-state",
    room: buildRoomSnapshot(room)
  };

  for (const player of room.players) {
    const client = clients.get(player.id);
    if (client) {
      send(client.socket, payload);
    }
  }
}

function destroyRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (!room.players.length) {
    rooms.delete(roomCode);
  }
}

function leaveCurrentRoom(clientId, sendLeaveEvent = true) {
  const client = clients.get(clientId);
  if (!client?.roomCode) {
    return;
  }

  const room = rooms.get(client.roomCode);
  client.roomCode = null;

  if (!room) {
    if (sendLeaveEvent) {
      send(client.socket, { type: "room-left" });
    }
    return;
  }

  room.players = room.players.filter((player) => player.id !== clientId);

  if (room.hostId === clientId && room.players.length) {
    room.hostId = room.players[0].id;
  }

  destroyRoomIfEmpty(room.code);
  const maybeRoom = rooms.get(room.code);

  if (maybeRoom) {
    broadcastRoom(maybeRoom);
  }

  broadcastPublicRooms();

  if (sendLeaveEvent) {
    send(client.socket, { type: "room-left" });
  }
}

function createRoom(clientId, payload) {
  const playerName = sanitizePlayerName(payload.playerName);
  if (!playerName) {
    throw new Error("ใส่ชื่อเล่นก่อนสร้างห้อง");
  }

  leaveCurrentRoom(clientId, false);

  const room = {
    code: createRoomCode(),
    name: sanitizeRoomName(payload.roomName),
    isPublic: Boolean(payload.isPublic),
    hostId: clientId,
    players: [{ id: clientId, name: playerName }],
    deck: createShuffledDeck(),
    history: [],
    currentCardId: null
  };

  rooms.set(room.code, room);
  clients.get(clientId).roomCode = room.code;

  broadcastRoom(room);
  broadcastPublicRooms();
}

function joinRoom(clientId, payload) {
  const roomCode = String(payload.roomCode ?? "").trim().toUpperCase();
  const playerName = sanitizePlayerName(payload.playerName);
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error("ไม่พบห้องนี้");
  }

  if (!playerName) {
    throw new Error("ใส่ชื่อเล่นก่อนเข้าห้อง");
  }

  leaveCurrentRoom(clientId, false);

  room.players = room.players.filter((player) => player.id !== clientId);
  room.players.push({ id: clientId, name: playerName });
  clients.get(clientId).roomCode = room.code;

  broadcastRoom(room);
  broadcastPublicRooms();
}

function requireRoomAndHost(clientId) {
  const client = clients.get(clientId);
  const room = rooms.get(client?.roomCode);

  if (!room) {
    throw new Error("คุณยังไม่ได้อยู่ในห้อง");
  }

  if (room.hostId !== clientId) {
    throw new Error("เฉพาะ Host เท่านั้น");
  }

  return room;
}

function updateRoom(clientId, payload) {
  const room = requireRoomAndHost(clientId);
  room.name = sanitizeRoomName(payload.roomName);
  room.isPublic = Boolean(payload.isPublic);
  broadcastRoom(room);
  broadcastPublicRooms();
}

function drawCard(clientId) {
  const room = requireRoomAndHost(clientId);
  if (!room.deck.length) {
    throw new Error("เด็คหมดแล้ว กดสับไพ่ใหม่ก่อน");
  }

  const cardId = room.deck.shift();
  room.currentCardId = cardId;
  room.history.push(cardId);

  broadcastRoom(room);
  broadcastPublicRooms();
}

function resetDeck(clientId) {
  const room = requireRoomAndHost(clientId);
  room.deck = createShuffledDeck();
  room.history = [];
  room.currentCardId = null;
  broadcastRoom(room);
  broadcastPublicRooms();
}

function kickPlayer(clientId, payload) {
  const room = requireRoomAndHost(clientId);
  const playerId = String(payload.playerId ?? "");

  if (!playerId || playerId === room.hostId) {
    throw new Error("ไม่สามารถเตะ Host ได้");
  }

  const target = clients.get(playerId);
  if (!target || target.roomCode !== room.code) {
    throw new Error("ไม่พบผู้เล่นในห้อง");
  }

  leaveCurrentRoom(playerId, true);
  send(target.socket, { type: "notice", message: "คุณถูกเตะออกจากห้อง" });
}

const server = http.createServer(async (request, response) => {
  try {
    const filePath = getFilePath(request.url ?? "/");
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      response.writeHead(403);
      response.end("Directory listing is disabled.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(500);
    response.end("Internal server error");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  const clientId = createId("player");
  clients.set(clientId, {
    id: clientId,
    socket,
    roomCode: null
  });

  send(socket, {
    type: "welcome",
    clientId
  });

  send(socket, {
    type: "public-rooms",
    rooms: publicRoomsPayload()
  });

  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(String(raw));

      switch (payload.type) {
        case "create-room":
          createRoom(clientId, payload);
          break;
        case "join-room":
          joinRoom(clientId, payload);
          break;
        case "leave-room":
          leaveCurrentRoom(clientId, true);
          break;
        case "get-public-rooms":
          send(socket, { type: "public-rooms", rooms: publicRoomsPayload() });
          break;
        case "update-room":
          updateRoom(clientId, payload);
          break;
        case "draw-card":
          drawCard(clientId);
          break;
        case "reset-deck":
          resetDeck(clientId);
          break;
        case "kick-player":
          kickPlayer(clientId, payload);
          break;
        default:
          send(socket, { type: "error", message: "คำสั่งไม่ถูกต้อง" });
          break;
      }
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "เกิดข้อผิดพลาด"
      });
    }
  });

  socket.on("close", () => {
    leaveCurrentRoom(clientId, false);
    clients.delete(clientId);
    broadcastPublicRooms();
  });
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT_DIR} at http://localhost:${PORT}`);
});
