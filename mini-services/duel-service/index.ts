/**
 * Sovereign Chess — Live Duel Service (port 3003).
 *
 * The authoritative referee for human-vs-human duels:
 *  - two real players race in real time from two devices;
 *  - every move is validated here with full chess.js rules;
 *  - Fischer clocks (5+0) tick server-side — no client can cheat time;
 *  - REAL-MONEY STAKES (client-side Diamond Vault): each device locks a
 *    1 💎 entry stake when the duel goes live, and this service declares
 *    the pot — winner 2 💎 · draw refund 1 💎 each · loser consumed;
 *    every rematch bumps the room generation (gen) so a fresh stake
 *    locks for the fresh game;
 *  - 90s reconnect grace, rematch with swapped colors, 30min room cleanup.
 *
 * Zero database — in-memory rooms only (cost-effective by design).
 * The client keeps its own durable diamond ledger on-device.
 */

import { createServer } from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";

const PORT = 3003;
const TIME_CONTROL_MS = 5 * 60 * 1000; // 5 minutes each
const RECONNECT_GRACE_MS = 90_000; // seat held for 90s after a drop
const ROOM_TTL_MS = 30 * 60 * 1000; // idle rooms are swept after 30 min
const TICK_MS = 250;

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — the gateway forwards on this path
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

type Side = "w" | "b";

interface Seat {
  socketId: string;
  deviceId: string;
  name: string;
  connected: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface DuelResult {
  winner: Side | null; // null = draw
  reason: string;
  rewards: { w: number; b: number }; // diamonds per side
}

interface Room {
  code: string;
  /** game generation — increments on every rematch (new stake, new pot) */
  gen: number;
  seats: { w: Seat | null; b: Seat | null };
  game: Chess;
  clocks: { w: number; b: number };
  running: boolean;
  lastTick: number;
  status: "waiting" | "live" | "ended";
  result: DuelResult | null;
  rematch: Set<Side>;
  createdAt: number;
  updatedAt: number;
}

const rooms = new Map<string, Room>();

/* ---------------- helpers ---------------- */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion

function makeCode(): string {
  let code = "";
  do {
    code = Array.from({ length: 5 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function other(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function seatSummary(room: Room) {
  return {
    w: room.seats.w
      ? { name: room.seats.w.name, connected: room.seats.w.connected }
      : null,
    b: room.seats.b
      ? { name: room.seats.b.name, connected: room.seats.b.connected }
      : null,
  };
}

/** Full room state sent to a client (fen, clocks, seats, result, rematch). */
function roomState(room: Room, myColor: Side | null) {
  const hist = room.game.history({ verbose: true });
  const last = hist.length > 0 ? hist[hist.length - 1] : null;
  return {
    code: room.code,
    gen: room.gen,
    status: room.status,
    myColor,
    turn: room.game.turn(),
    fen: room.game.fen(),
    lastMove: last ? { from: last.from, to: last.to } : null,
    inCheck: room.game.inCheck(),
    checkedSquare: room.game.inCheck() ? findCheckedKing(room.game) : null,
    ply: hist.length,
    moves: hist.map((m) => m.san),
    clocks: room.clocks,
    seats: seatSummary(room),
    result: room.result,
    rematch: [...room.rematch],
    timeControl: TIME_CONTROL_MS,
  };
}

function findCheckedKing(game: Chess): string | null {
  const turn = game.turn();
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.type === "k" && sq.color === turn) return sq.square;
    }
  }
  return null;
}

function broadcastState(room: Room) {
  room.updatedAt = Date.now();
  for (const side of ["w", "b"] as Side[]) {
    const seat = room.seats[side];
    if (seat?.connected) {
      io.to(seat.socketId).emit("duel:state", roomState(room, side));
    }
  }
}

/** Server-side verdict: classify the finished game and price the diamonds. */
function endRoom(room: Room, winner: Side | null, reason: string) {
  if (room.status === "ended") return;
  room.status = "ended";
  room.running = false;
  // the pot: winner pockets both stakes (2 💎) · draw refunds 1 💎 each ·
  // the loser's stake is consumed — that is the real-money economy
  room.result = {
    winner,
    reason,
    rewards: winner === null ? { w: 1, b: 1 } : { [winner]: 2, [other(winner)]: 0 },
  };
  for (const side of ["w", "b"] as Side[]) {
    const seat = room.seats[side];
    if (seat?.connected) {
      io.to(seat.socketId).emit("duel:ended", { state: roomState(room, side) });
    }
  }
  broadcastState(room);
}

/* ---------------- clock engine ---------------- */

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === "live" && room.running) {
      const side = room.game.turn() as Side;
      const dt = now - room.lastTick;
      room.clocks[side] = Math.max(0, room.clocks[side] - dt);
      room.lastTick = now;
      if (room.clocks[side] <= 0) {
        endRoom(room, other(side), "Flag fell — out of time");
        continue;
      }
      // push clock updates ~ every second to keep payloads light
      if (Math.floor(room.clocks[side] / 1000) !==
          Math.floor((room.clocks[side] + dt) / 1000)) {
        broadcastState(room);
      }
    }
    // sweep dead rooms
    if (now - room.updatedAt > ROOM_TTL_MS && now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(room.code);
    }
  }
}, TICK_MS);

/* ---------------- socket API ---------------- */

io.on("connection", (socket) => {
  console.log(`duel: connected ${socket.id}`);

  const findMyRoomAndSide = (deviceId: string) => {
    for (const room of rooms.values()) {
      for (const side of ["w", "b"] as Side[]) {
        const seat = room.seats[side];
        if (seat && seat.deviceId === deviceId) return { room, side };
      }
    }
    return null;
  };

  socket.on("duel:create", ({ deviceId, name }) => {
    if (!deviceId) return;
    // one open room per device — leaving any previous seat first
    const existing = findMyRoomAndSide(deviceId);
    if (existing) leaveSeat(existing.room, existing.side, socket.id);
    const room: Room = {
      code: makeCode(),
      gen: 0,
      seats: {
        w: { socketId: socket.id, deviceId, name: name || "White", connected: true, graceTimer: null },
        b: null,
      },
      game: new Chess(),
      clocks: { w: TIME_CONTROL_MS, b: TIME_CONTROL_MS },
      running: false,
      lastTick: Date.now(),
      status: "waiting",
      result: null,
      rematch: new Set(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    rooms.set(room.code, room);
    socket.join(room.code);
    socket.emit("duel:state", roomState(room, "w"));
  });

  socket.on("duel:join", ({ code, deviceId, name }) => {
    if (!deviceId || !code) return;
    const room = rooms.get(String(code).toUpperCase().trim());
    if (!room) {
      socket.emit("duel:error", { message: "No duel found with that code." });
      return;
    }
    // reconnect: same device returning to its seat (page refresh / drop)
    for (const side of ["w", "b"] as Side[]) {
      const seat = room.seats[side];
      if (seat && seat.deviceId === deviceId) {
        seat.socketId = socket.id;
        seat.connected = true;
        if (seat.graceTimer) {
          clearTimeout(seat.graceTimer);
          seat.graceTimer = null;
        }
        socket.join(room.code);
        socket.emit("duel:state", roomState(room, side));
        broadcastState(room);
        return;
      }
    }
    if (room.status !== "waiting" || room.seats.b) {
      socket.emit("duel:error", {
        message: room.status === "waiting" ? "This duel is already full." : "That duel has already finished.",
      });
      return;
    }
    room.seats.b = {
      socketId: socket.id,
      deviceId,
      name: name || "Black",
      connected: true,
      graceTimer: null,
    };
    socket.join(room.code);
    // the duel goes live — creator holds the white pieces
    room.status = "live";
    room.running = true;
    room.lastTick = Date.now();
    broadcastState(room);
  });

  socket.on("duel:move", ({ code, deviceId, from, to, promotion }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "live") return;
    const side = room.seats.w?.deviceId === deviceId ? "w" : room.seats.b?.deviceId === deviceId ? "b" : null;
    if (!side || room.game.turn() !== side) return;
    // settle the mover's clock before applying the move
    const now = Date.now();
    room.clocks[side] = Math.max(0, room.clocks[side] - (now - room.lastTick));
    room.lastTick = now;
    if (room.clocks[side] <= 0) {
      endRoom(room, other(side), "Flag fell — out of time");
      return;
    }
    try {
      const move = room.game.move({ from, to, promotion: promotion || "q" });
      if (!move) return;
    } catch {
      socket.emit("duel:error", { message: "Illegal move." });
      return;
    }
    room.updatedAt = Date.now();
    // terminal checks — full regulation rules
    if (room.game.isCheckmate()) {
      endRoom(room, side, "Checkmate");
      return;
    }
    if (room.game.isStalemate()) return endRoom(room, null, "Stalemate");
    if (room.game.isInsufficientMaterial()) return endRoom(room, null, "Insufficient material");
    if (room.game.isThreefoldRepetition()) return endRoom(room, null, "Threefold repetition");
    if (room.game.isDraw()) return endRoom(room, null, "Fifty-move rule");
    broadcastState(room);
  });

  socket.on("duel:resign", ({ code, deviceId }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "live") return;
    const side = room.seats.w?.deviceId === deviceId ? "w" : room.seats.b?.deviceId === deviceId ? "b" : null;
    if (!side) return;
    endRoom(room, other(side), `${side === "w" ? "White" : "Black"} resigned`);
  });

  socket.on("duel:rematch", ({ code, deviceId }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "ended") return;
    const side = room.seats.w?.deviceId === deviceId ? "w" : room.seats.b?.deviceId === deviceId ? "b" : null;
    if (!side) return;
    room.rematch.add(side);
    if (room.rematch.size === 2) {
      // swap colors, bump the generation (new stake + pot), go live again
      const w = room.seats.w;
      room.seats.w = room.seats.b;
      room.seats.b = w;
      room.gen += 1;
      room.game = new Chess();
      room.clocks = { w: TIME_CONTROL_MS, b: TIME_CONTROL_MS };
      room.running = true;
      room.lastTick = Date.now();
      room.status = "live";
      room.result = null;
      room.rematch = new Set();
      broadcastState(room);
    } else {
      broadcastState(room);
    }
  });

  function leaveSeat(room: Room, side: Side, bySocketId?: string) {
    const seat = room.seats[side];
    if (!seat) return;
    if (bySocketId && seat.socketId !== bySocketId) return; // old socket
    seat.connected = false;
    room.updatedAt = Date.now();
    if (room.status === "waiting") {
      if (side === "w") {
        // host abandoned the lobby — dissolve it
        for (const s of ["w", "b"] as Side[]) {
          if (room.seats[s]?.connected) io.to(room.seats[s]!.socketId).emit("duel:host-left", {});
        }
        rooms.delete(room.code);
        return;
      }
      room.seats.b = null;
      broadcastState(room);
      return;
    }
    if (room.status === "live") {
      broadcastState(room); // show "reconnecting…" on the other screen
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.graceTimer = setTimeout(() => {
        if (!seat.connected && room.status === "live") {
          endRoom(room, other(side), `${side === "w" ? "White" : "Black"} left the arena`);
        }
      }, RECONNECT_GRACE_MS);
    }
  }

  socket.on("duel:leave", ({ code, deviceId }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    for (const side of ["w", "b"] as Side[]) {
      if (room.seats[side]?.deviceId === deviceId) leaveSeat(room, side);
    }
  });

  socket.on("disconnect", () => {
    console.log(`duel: disconnected ${socket.id}`);
    for (const room of rooms.values()) {
      for (const side of ["w", "b"] as Side[]) {
        const seat = room.seats[side];
        if (seat && seat.socketId === socket.id && seat.connected) {
          leaveSeat(room, side);
        }
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`⚔️  Sovereign duel service listening on :${PORT}`);
});
