import { PUNISHMENT_CARDS, createShuffledDeck, getCardById } from "./cards.js";

const { Realtime } = window.Ably;

// สมัครฟรีที่ ably.com แล้วเอา API Key มาใส่ที่นี่
const ABLY_KEY = "vkDjcQ.KTzJog:kYvV_ttByjz83bTGag3BG5r2mZsggOjix35_N9UZt5k";

const LOBBY_CHANNEL = "wongpai:lobby";
const DEFAULT_ROOM_NAME = "วงไพ่สายดื่ม";
const REVEAL_ANIMATION_MS = 1400;

const CATEGORY_THEME = {
  "แพ้กิน": { accent: "#ff7b6b", glow: "#ffb09a", icon: "▲", tone: "red", label: "Loser Drinks" },
  "ชนะสั่ง": { accent: "#ffd36d", glow: "#ffe6a7", icon: "◆", tone: "gold", label: "Winner Chooses" },
  "รอบวง": { accent: "#69d2ff", glow: "#abedff", icon: "●", tone: "blue", label: "Whole Table" },
  "มินิเกม": { accent: "#8f80ff", glow: "#c8bbff", icon: "✦", tone: "violet", label: "Mini Game" },
  "โกลาหล": { accent: "#ff63b0", glow: "#ffa8d5", icon: "✕", tone: "pink", label: "Chaos" },
  "รอด": { accent: "#52e0a6", glow: "#a6ffd9", icon: "☼", tone: "green", label: "Safe" }
};

if (!sessionStorage.getItem("party-client-id")) {
  sessionStorage.setItem("party-client-id", `player-${Math.random().toString(36).slice(2, 10)}`);
}

const state = {
  ably: null,
  connectionState: "connecting",
  clientId: sessionStorage.getItem("party-client-id"),
  isHost: false,
  hostState: null,
  room: null,
  publicRooms: [],
  playerName: localStorage.getItem("party-player-name") || "",
  roomName: DEFAULT_ROOM_NAME,
  joinCode: "",
  lobbyError: "",
  toast: "",
  copied: "",
  revealPulse: false,
  lastRoomCode: null,
  lastDrawnCount: 0,
  roomChannel: null,
  lobbyChannel: null,
  popup: null
};

let inLobbyPresence = false;
let lastPopupDrawnCount = -1;

const app = document.querySelector("#app");

// ── Utilities ──────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function cardNumber(cardId) {
  return Number(String(cardId).split("-").pop() || 0);
}

function cardTheme(card) {
  return CATEGORY_THEME[card?.category] || { accent: "#7ed8ff", glow: "#c6f4ff", icon: "◼", tone: "blue", label: "Party Card" };
}

function setToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(setToast.timerId);
  setToast.timerId = window.setTimeout(() => { state.toast = ""; render(); }, 2200);
}

function setCopied(message) {
  state.copied = message;
  render();
  window.clearTimeout(setCopied.timerId);
  setCopied.timerId = window.setTimeout(() => { state.copied = ""; render(); }, 1800);
}

function triggerRevealPulse() {
  state.revealPulse = true;
  render();
  window.clearTimeout(triggerRevealPulse.timerId);
  triggerRevealPulse.timerId = window.setTimeout(() => { state.revealPulse = false; render(); }, REVEAL_ANIMATION_MS);
}

function normalizePlayerName(name) { return String(name || "").trim().slice(0, 24); }
function normalizeRoomName(name) { return String(name || "").trim().slice(0, 40); }
function currentUserIsHost() { return Boolean(state.room && state.room.hostId === state.clientId); }
function currentCard() { return state.room?.game?.currentCard ?? null; }
function cardsRemainingLabel(room) { return `${room.game.remainingCount} / ${room.game.totalCount}`; }

function roomShareUrl() {
  if (!state.room) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room.code);
  return url.toString();
}

function syncUrlWithRoom(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  window.history.replaceState({}, "", url);
}

function clearRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

// ── Room state ─────────────────────────────────────────────────────────────────

function handleRoomState(room) {
  const sameRoom = state.lastRoomCode === room.code;
  if (sameRoom && room.game.drawnCount > state.lastDrawnCount) {
    triggerRevealPulse();
    if (room.game.currentCard && room.game.drawnCount !== lastPopupDrawnCount) {
      lastPopupDrawnCount = room.game.drawnCount;
      showCardPopup(room.game.currentCard, room.game.lastDrawnBy);
    }
  }
  if (!sameRoom) {
    state.revealPulse = false;
    lastPopupDrawnCount = -1;
  }
  state.lastRoomCode = room.code;
  state.lastDrawnCount = room.game.drawnCount;
  state.room = room;
  state.roomName = room.name;
  state.lobbyError = "";
  syncUrlWithRoom(room.code);
}

// ── Host game logic ────────────────────────────────────────────────────────────

function generateRoomCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
  return code;
}

function buildRoomSnapshot(hs) {
  return {
    code: hs.code,
    name: hs.name,
    isPublic: hs.isPublic,
    hostId: hs.hostId,
    hostName: hs.players.find(p => p.id === hs.hostId)?.name ?? "Host",
    players: hs.players.map(p => ({ id: p.id, name: p.name })),
    game: {
      totalCount: PUNISHMENT_CARDS.length,
      drawnCount: hs.history.length,
      remainingCount: hs.deck.length,
      currentCard: hs.currentCardId ? getCardById(hs.currentCardId) : null,
      lastDrawnBy: hs.lastDrawnBy ?? null,
      history: hs.history.slice(-8).reverse().map(id => getCardById(id)).filter(Boolean)
    }
  };
}

function broadcastState() {
  if (!state.isHost || !state.hostState) return;
  const snapshot = buildRoomSnapshot(state.hostState);
  handleRoomState(snapshot);
  render();
  if (state.roomChannel) state.roomChannel.publish("state", { room: snapshot });
  updateLobbyPresence();
}

async function updateLobbyPresence() {
  if (!state.lobbyChannel || !state.isHost || !state.hostState) return;
  const hs = state.hostState;
  if (hs.isPublic) {
    const data = { code: hs.code, name: hs.name, isPublic: true, playerCount: hs.players.length, remainingCount: hs.deck.length };
    try {
      if (inLobbyPresence) {
        await state.lobbyChannel.presence.update(data);
      } else {
        await state.lobbyChannel.presence.enter(data);
        inLobbyPresence = true;
      }
    } catch {}
  } else if (inLobbyPresence) {
    try { await state.lobbyChannel.presence.leave(); } catch {}
    inLobbyPresence = false;
  }
}

function hostHandleAction(action) {
  if (!state.isHost || !state.hostState) return;
  const hs = state.hostState;
  switch (action.type) {
    case "join": {
      const name = normalizePlayerName(action.playerName);
      if (!name) break;
      hs.players = hs.players.filter(p => p.id !== action.playerId);
      hs.players.push({ id: action.playerId, name });
      broadcastState();
      break;
    }
    case "leave": {
      hs.players = hs.players.filter(p => p.id !== action.playerId);
      broadcastState();
      break;
    }
    case "draw-card": {
      const drawer = hs.players.find(p => p.id === action.playerId);
      hostDrawCard(drawer?.name);
      break;
    }
    case "reset-deck":
      hostResetDeck();
      break;
  }
}

function hostDrawCard(drawnByName) {
  const hs = state.hostState;
  if (!hs || !hs.deck.length) { setToast("เด็คหมดแล้ว กดสับไพ่ใหม่ก่อน"); return; }
  const cardId = hs.deck.shift();
  hs.currentCardId = cardId;
  hs.history.push(cardId);
  hs.lastDrawnBy = drawnByName || hs.players.find(p => p.id === hs.hostId)?.name || "Host";
  broadcastState();
}

function hostResetDeck() {
  const hs = state.hostState;
  if (!hs) return;
  hs.deck = createShuffledDeck();
  hs.history = [];
  hs.currentCardId = null;
  broadcastState();
}

function hostUpdateRoom(roomName, isPublic) {
  const hs = state.hostState;
  if (!hs) return;
  hs.name = roomName;
  hs.isPublic = isPublic;
  broadcastState();
}

function hostKickPlayer(playerId) {
  const hs = state.hostState;
  if (!hs || playerId === hs.hostId) return;
  hs.players = hs.players.filter(p => p.id !== playerId);
  if (state.roomChannel) {
    state.roomChannel.publish("notice", { targetId: playerId, message: "คุณถูกเตะออกจากห้อง", action: "kick" });
  }
  broadcastState();
}

// ── Ably connection ────────────────────────────────────────────────────────────

function initAbly() {
  if (ABLY_KEY === "YOUR_ABLY_API_KEY") {
    state.connectionState = "error";
    state.lobbyError = "ยังไม่ได้ตั้งค่า Ably API Key — ดูวิธีตั้งค่าใน README.md";
    render();
    return;
  }

  const ably = new Realtime({ key: ABLY_KEY, clientId: state.clientId });
  state.ably = ably;

  ably.connection.on("connected", async () => {
    state.connectionState = "connected";
    render();
    await initLobby();
    tryAutoJoinFromUrl();
  });

  ably.connection.on("connecting", () => { state.connectionState = "connecting"; render(); });
  ably.connection.on("disconnected", () => { state.connectionState = "disconnected"; render(); });
  ably.connection.on("suspended", () => { state.connectionState = "disconnected"; render(); });
  ably.connection.on("failed", () => { state.connectionState = "error"; render(); });
}

async function initLobby() {
  const channel = state.ably.channels.get(LOBBY_CHANNEL);
  state.lobbyChannel = channel;
  channel.presence.subscribe(() => refreshPublicRooms());
  await refreshPublicRooms();
}

async function refreshPublicRooms() {
  if (!state.lobbyChannel) return;
  try {
    const members = await state.lobbyChannel.presence.get();
    state.publicRooms = members
      .filter(m => m.data?.isPublic)
      .map(m => m.data)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
    render();
  } catch {}
}

// ── Room management ────────────────────────────────────────────────────────────

function leaveCurrentRoom() {
  const wasHost = state.isHost;
  const channel = state.roomChannel;
  const lobbyChannel = state.lobbyChannel;
  const wasInPresence = inLobbyPresence;

  state.isHost = false;
  state.hostState = null;
  state.room = null;
  state.roomChannel = null;
  state.lastRoomCode = null;
  state.lastDrawnCount = 0;
  state.revealPulse = false;
  inLobbyPresence = false;
  clearRoomFromUrl();
  render();

  if (wasHost) {
    if (channel) channel.publish("notice", { message: "Host ออกจากห้องแล้ว ห้องปิดแล้ว", action: "room-closed" });
    if (wasInPresence && lobbyChannel) lobbyChannel.presence.leave().catch(() => {});
  } else if (channel) {
    channel.publish("action", { type: "leave", playerId: state.clientId });
  }

  if (channel) {
    channel.unsubscribe();
    channel.detach().catch(() => {});
  }
}

async function handleCreateRoom(isPublic) {
  if (!state.ably) { state.lobbyError = "ยังไม่ได้ตั้งค่า Ably API Key — ดูวิธีใน README.md"; render(); return; }
  const playerName = normalizePlayerName(state.playerName);
  const roomName = normalizeRoomName(state.roomName) || DEFAULT_ROOM_NAME;
  if (!playerName) { state.lobbyError = "ใส่ชื่อเล่นก่อนสร้างห้อง"; render(); return; }
  localStorage.setItem("party-player-name", playerName);

  leaveCurrentRoom();

  const code = generateRoomCode();
  state.isHost = true;
  state.hostState = {
    code,
    name: roomName,
    isPublic,
    hostId: state.clientId,
    players: [{ id: state.clientId, name: playerName }],
    deck: createShuffledDeck(),
    history: [],
    currentCardId: null
  };

  const channel = state.ably.channels.get(`wongpai:room:${code}`);
  state.roomChannel = channel;
  channel.subscribe("action", (msg) => hostHandleAction(msg.data));

  broadcastState();
}

function handleJoinRoom(roomCode = state.joinCode) {
  if (!state.ably) { state.lobbyError = "ยังไม่ได้ตั้งค่า Ably API Key — ดูวิธีใน README.md"; render(); return; }
  const playerName = normalizePlayerName(state.playerName);
  const normalizedCode = String(roomCode || "").trim().toUpperCase();
  localStorage.setItem("party-player-name", playerName);

  if (!playerName) { state.lobbyError = "ใส่ชื่อเล่นก่อนเข้าห้อง"; render(); return; }
  if (!normalizedCode) { state.lobbyError = "ใส่รหัสห้องก่อน"; render(); return; }

  leaveCurrentRoom();

  const channel = state.ably.channels.get(`wongpai:room:${normalizedCode}`);
  state.roomChannel = channel;
  state.isHost = false;

  let joinTimeout = setTimeout(() => {
    if (!state.room && state.roomChannel === channel) {
      state.lobbyError = "ไม่พบห้องนี้ หรือ Host ออฟไลน์อยู่";
      leaveCurrentRoom();
    }
  }, 6000);

  channel.subscribe("state", (msg) => {
    clearTimeout(joinTimeout);
    handleRoomState(msg.data.room);
    render();
  });

  channel.subscribe("notice", (msg) => {
    const d = msg.data;
    if (d.action === "room-closed") { setToast("Host ออกจากห้องแล้ว"); leaveCurrentRoom(); return; }
    if (!d.targetId || d.targetId === state.clientId) {
      setToast(d.message);
      if (d.action === "kick") leaveCurrentRoom();
    }
  });

  channel.publish("action", { type: "join", playerId: state.clientId, playerName });
  syncUrlWithRoom(normalizedCode);
  state.lobbyError = "";
  render();
}

function tryAutoJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  const playerName = normalizePlayerName(state.playerName);
  if (!roomCode || state.room || !playerName) return;
  handleJoinRoom(roomCode);
}

async function copyText(value, copiedLabel) {
  try {
    await navigator.clipboard.writeText(value);
    setCopied(copiedLabel);
  } catch {
    setToast("คัดลอกไม่สำเร็จ ลองคัดลอกเองอีกครั้ง");
  }
}

function showCardPopup(card, drawnBy) {
  state.popup = { card, drawnBy: drawnBy || "ผู้เล่น" };
  render();
}

function closePopup() {
  state.popup = null;
  render();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function renderConnectionBadge() {
  const mapping = { connecting: "กำลังเชื่อมต่อ", connected: "ออนไลน์", disconnected: "หลุดการเชื่อมต่อ", error: "เชื่อมต่อผิดพลาด" };
  return `<span class="status-pill status-pill--${escapeHtml(state.connectionState)}">${escapeHtml(mapping[state.connectionState] || state.connectionState)}</span>`;
}

function renderCardFace(card, options = {}) {
  const { featured = false, compact = false, back = false, badge = "", pulse = false } = options;
  const theme = cardTheme(card);
  const classes = ["playing-card", `playing-card--${theme.tone}`, featured ? "playing-card--featured" : "", compact ? "playing-card--compact" : "", back ? "playing-card--back" : "", pulse ? "playing-card--pulse" : ""].filter(Boolean).join(" ");
  const title = back ? "PARTY DECK" : card.title;
  const subtitle = back ? "DRAW NEXT" : card.category;
  const body = back ? "ยังไม่เปิด" : card.rule;
  const footer = back ? "100 cards" : card.note;
  const number = back ? "##" : String(cardNumber(card.id)).padStart(3, "0");
  return `
    <article class="${classes}" style="--card-accent:${theme.accent}; --card-glow:${theme.glow};">
      <div class="playing-card__noise"></div>
      <div class="playing-card__corner playing-card__corner--top"><span>${theme.icon}</span><strong>${number}</strong></div>
      <div class="playing-card__corner playing-card__corner--bottom"><span>${theme.icon}</span><strong>${number}</strong></div>
      <div class="playing-card__inner">
        <div class="playing-card__meta"><span>${escapeHtml(subtitle)}</span>${badge ? `<b>${escapeHtml(badge)}</b>` : ""}</div>
        <div class="playing-card__crest">${theme.icon}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <small>${escapeHtml(footer)}</small>
      </div>
    </article>`;
}

function renderLobbyHeroCards() {
  return `
    <div class="hero-cards">
      <div class="hero-cards__stack">
        ${renderCardFace(PUNISHMENT_CARDS[17], { compact: true, badge: "สุ่มจริง" })}
        ${renderCardFace(PUNISHMENT_CARDS[63], { compact: true, badge: "ไม่ซ้ำ" })}
        ${renderCardFace(PUNISHMENT_CARDS[98], { compact: true, badge: "จบเด็ค" })}
      </div>
      <div class="hero-cards__stats">
        <div class="stat-tile"><strong>100</strong><span>cards</span></div>
        <div class="stat-tile"><strong>${state.publicRooms.length}</strong><span>public rooms</span></div>
        <div class="stat-tile"><strong>สด</strong><span>realtime</span></div>
      </div>
    </div>`;
}

function renderLobby() {
  return `
    <main class="page-shell">
      <section class="hero hero--lobby panel">
        <div class="hero__copy">
          <p class="eyebrow">PUBLIC PARTY HOST</p>
          <h1>สุ่มไพ่กินเหล้าให้จบเด็ค</h1>
          <p class="hero__lead">เปิดห้องให้เพื่อนเข้าเล่นได้จริง สุ่มไพ่ทีละใบ ตัดออกจากเด็คจนหมดเกม พร้อมปุ่มสุ่มเด่นและหน้าการ์ดแบบโต๊ะไพ่ชัดเจน</p>
          <div class="hero__chips">
            <span class="chip">100 บทลงโทษ</span>
            <span class="chip">ไม่ซ้ำจนหมดเด็ค</span>
            <span class="chip">Host / Public Room</span>
            ${renderConnectionBadge()}
          </div>
        </div>
        ${renderLobbyHeroCards()}
      </section>

      <section class="lobby-grid">
        <div class="panel lobby-panel">
          <div class="panel-head">
            <div><p class="section-label">เริ่มวง</p><h2>สร้างห้องหรือเข้าห้อง</h2></div>
          </div>
          <label class="field"><span>ชื่อเล่น</span><input type="text" maxlength="24" value="${escapeHtml(state.playerName)}" data-model="player-name" placeholder="เช่น บาส / ม่อน / Ploy" /></label>
          <label class="field"><span>ชื่อห้อง</span><input type="text" maxlength="40" value="${escapeHtml(state.roomName)}" data-model="room-name" placeholder="วงห้อง 308" /></label>
          <div class="action-row action-row--stack">
            <button class="primary-btn primary-btn--wide" data-action="create-public-room">เปิด Host Public</button>
            <button class="secondary-btn secondary-btn--wide" data-action="create-private-room">เปิดห้องส่วนตัว</button>
          </div>
          <div class="divider"></div>
          <label class="field">
            <span>เข้าห้องด้วยรหัส</span>
            <div class="inline-field">
              <input type="text" maxlength="6" value="${escapeHtml(state.joinCode)}" data-model="join-code" placeholder="ROOM42" />
              <button class="ghost-btn" data-action="join-room">เข้าห้อง</button>
            </div>
          </label>
          ${state.lobbyError ? `<p class="inline-error">${escapeHtml(state.lobbyError)}</p>` : `<p class="inline-note">ห้อง public จะขึ้นในรายการด้านขวา ส่วนห้อง private ใช้ลิงก์หรือรหัสห้องแชร์กันเอง</p>`}
        </div>

        <div class="panel public-panel">
          <div class="panel-head">
            <div><p class="section-label">Public Rooms</p><h2>ห้องที่กำลังเปิดเล่น</h2></div>
            <button class="ghost-btn" data-action="refresh-public">รีเฟรช</button>
          </div>
          <div class="public-list">
            ${state.publicRooms.length
              ? state.publicRooms.map(room => `
                  <article class="public-room-card">
                    <div><strong>${escapeHtml(room.name)}</strong><p>โค้ด ${escapeHtml(room.code)} • ${room.playerCount} คน • เหลือ ${room.remainingCount} ใบ</p></div>
                    <button class="ghost-btn" data-action="join-public-room" data-room="${escapeHtml(room.code)}">เข้าเล่น</button>
                  </article>`).join("")
              : `<div class="empty-state">ยังไม่มีห้องสาธารณะ ใครสักคนเปิดวงก่อน</div>`}
          </div>
        </div>
      </section>

      <section class="panel sample-panel">
        <div class="panel-head">
          <div><p class="section-label">Deck Preview</p><h2>หน้าตาไพ่ในเกม</h2></div>
          <span class="chip">ดื่มอย่างรับผิดชอบ</span>
        </div>
        <div class="sample-grid">
          ${PUNISHMENT_CARDS.slice(0, 4).map(card => renderCardFace(card, { compact: true })).join("")}
        </div>
      </section>
    </main>`;
}

function renderDeckConsole(room, isHost) {
  const nextDrawDisabled = room.game.remainingCount === 0;
  const progress = (room.game.drawnCount / room.game.totalCount) * 100;
  return `
    <section class="panel deck-console">
      <div class="panel-head">
        <div><p class="section-label">Draw Pile</p><h2>กองไพ่ของห้องนี้</h2></div>
        <span class="chip">${cardsRemainingLabel(room)}</span>
      </div>
      <div class="deck-console__stack">
        <div class="deck-stack ${nextDrawDisabled ? "deck-stack--empty" : ""}">
          <div class="deck-stack__shadow"></div>
          <div class="deck-stack__card deck-stack__card--a"></div>
          <div class="deck-stack__card deck-stack__card--b"></div>
          <div class="deck-stack__card deck-stack__card--c"></div>
          <div class="deck-stack__count"><strong>${room.game.remainingCount}</strong><span>ใบที่เหลือ</span></div>
        </div>
        <div class="deck-console__copy">
          <strong>${nextDrawDisabled ? "ไพ่หมดแล้ว" : "พร้อมสุ่มใบถัดไป"}</strong>
          <p>${nextDrawDisabled ? "เปิดครบทั้งเด็คแล้ว กดสับใหม่เพื่อเริ่มเกมถัดไป" : "เมื่อกดสุ่ม ไพ่จะถูกตัดออกจากกองทันทีและจะไม่กลับมาอีกจนกว่าจะรีเซ็ต"}</p>
        </div>
      </div>
      <div class="progress-strip">
        <div class="progress-strip__bar"><span style="width:${progress}%"></span></div>
        <small>เปิดแล้ว ${room.game.drawnCount} / ${room.game.totalCount} ใบ</small>
      </div>
      <div class="action-column">
        <button class="draw-btn" data-action="draw-card" ${nextDrawDisabled ? "disabled" : ""}>
          <span class="draw-btn__label">สุ่มไพ่</span>
          <span class="draw-btn__meta">${nextDrawDisabled ? "เด็คหมด" : "จั่วใบถัดไปเดี๋ยวนี้"}</span>
        </button>
        <button class="ghost-btn" data-action="reset-deck">สับไพ่ใหม่ทั้งเด็ค</button>
      </div>
    </section>`;
}

function renderPlayers(room) {
  return room.players.map(player => `
    <article class="player-card ${player.id === room.hostId ? "player-card--host" : ""}">
      <div class="player-card__avatar">${escapeHtml(player.name.charAt(0) || "?")}</div>
      <div class="player-card__body"><strong>${escapeHtml(player.name)}</strong><p>${player.id === room.hostId ? "Host" : "Player"}</p></div>
      ${currentUserIsHost() && player.id !== room.hostId ? `<button class="ghost-btn ghost-btn--small" data-action="kick-player" data-player="${escapeHtml(player.id)}">เตะ</button>` : ""}
    </article>`).join("");
}

function renderHistory(room) {
  if (!room.game.history.length) return `<div class="empty-state">ยังไม่มีไพ่ในกองทิ้ง กดสุ่มใบแรกเพื่อเริ่มเกม</div>`;
  return room.game.history.map((card, index) => `
    <article class="history-entry">
      <div class="history-entry__index">#${String(room.game.drawnCount - index).padStart(2, "0")}</div>
      <div class="history-entry__body"><strong>${escapeHtml(card.title)}</strong><p>${escapeHtml(card.rule)}</p></div>
      <span class="history-entry__tag">${escapeHtml(card.category)}</span>
    </article>`).join("");
}

function renderCurrentCard(room) {
  const card = currentCard();
  if (!card) {
    return `
      <section class="panel reveal-panel reveal-panel--empty">
        <div class="reveal-panel__empty-copy"><p class="section-label">Ready</p><h2>โต๊ะพร้อมแล้ว รอสุ่มใบแรก</h2><p>เมื่อ Host กดสุ่ม ไพ่จะถูกเปิดกลางโต๊ะและถูกตัดออกจากเด็คทันที</p></div>
        <div class="reveal-panel__empty-card">${renderCardFace(PUNISHMENT_CARDS[0], { featured: true, back: true })}</div>
      </section>`;
  }
  const theme = cardTheme(card);
  const drawnText = room.game.remainingCount === 0 ? "ใบสุดท้ายของเกมนี้เปิดแล้ว" : `เหลืออีก ${room.game.remainingCount} ใบก่อนหมดเด็ค`;
  return `
    <section class="panel reveal-panel">
      <div class="reveal-panel__copy">
        <p class="section-label">Current Draw</p>
        <h2>${escapeHtml(card.title)}</h2>
        <p class="reveal-panel__lead">${escapeHtml(card.rule)}</p>
        <div class="hero__chips">
          <span class="chip chip--accent" style="--chip-accent:${theme.accent};">${escapeHtml(card.category)}</span>
          <span class="chip">${escapeHtml(card.target)}</span>
          <span class="chip">ลำดับ ${cardNumber(card.id)}</span>
        </div>
        <p class="reveal-panel__note">${escapeHtml(card.note)}</p>
        <div class="draw-summary"><strong>${drawnText}</strong><span>ถ้าเปิดครบ 100 ใบ ระบบจะหยุดให้สุ่มจนกว่า Host จะสับเด็คใหม่</span></div>
      </div>
      <div class="reveal-panel__card">${renderCardFace(card, { featured: true, badge: `#${String(room.game.drawnCount).padStart(2, "0")}`, pulse: state.revealPulse })}</div>
    </section>`;
}

function renderRoom() {
  const room = state.room;
  const isHost = currentUserIsHost();
  const deckFinished = room.game.remainingCount === 0;
  return `
    <main class="page-shell room-shell">
      <section class="hero hero--room panel">
        <div class="hero__copy">
          <p class="eyebrow">ROOM ${escapeHtml(room.code)}</p>
          <h1>${escapeHtml(room.name)}</h1>
          <p class="hero__lead">${room.isPublic ? "ห้องนี้เปิด public อยู่ คนอื่นเข้าจาก lobby ได้ทันที" : "ห้องส่วนตัว แชร์รหัสหรือคัดลอกลิงก์ให้เพื่อนเข้าตรง"}</p>
          <div class="hero__chips">
            <span class="chip">${room.players.length} คนในห้อง</span>
            <span class="chip">${room.game.drawnCount} ใบที่เปิดแล้ว</span>
            <span class="chip">${room.game.remainingCount} ใบที่เหลือ</span>
            ${renderConnectionBadge()}
          </div>
        </div>
        <div class="hero__actions hero__actions--room">
          <button class="ghost-btn" data-action="copy-room-code">คัดลอกรหัส</button>
          <button class="ghost-btn" data-action="copy-room-link">คัดลอกลิงก์</button>
          <button class="ghost-btn" data-action="leave-room">ออกจากห้อง</button>
          ${state.copied ? `<small class="copy-note">${escapeHtml(state.copied)}</small>` : ""}
        </div>
      </section>

      <section class="table-grid">
        <div class="table-main">
          ${renderCurrentCard(room)}
          ${deckFinished ? `<div class="end-banner">เด็คถูกเปิดครบแล้ว เกมนี้จบกองแล้ว กดสับไพ่ใหม่เพื่อเริ่มรอบใหม่</div>` : ""}
        </div>
        <aside class="table-side">
          ${renderDeckConsole(room, isHost)}
          <section class="panel room-settings">
            <div class="panel-head">
              <div><p class="section-label">Room Control</p><h2>ตั้งค่าห้อง</h2></div>
              <span class="chip">${isHost ? "คุณคือ Host" : `Host: ${escapeHtml(room.hostName)}`}</span>
            </div>
            <label class="field"><span>ชื่อห้อง</span><input type="text" maxlength="40" value="${escapeHtml(state.roomName)}" data-model="room-name" ${isHost ? "" : "disabled"} /></label>
            <div class="toggle-row">
              <span>Public Lobby</span>
              <button class="toggle-btn ${room.isPublic ? "toggle-btn--on" : ""}" data-action="toggle-public-room" ${isHost ? "" : "disabled"}>${room.isPublic ? "เปิดอยู่" : "ปิดอยู่"}</button>
            </div>
            ${isHost ? `<button class="ghost-btn room-settings__save" data-action="save-room-settings">บันทึกการตั้งค่า</button>` : `<p class="inline-note">เฉพาะ Host เท่านั้นที่แก้ชื่อห้องและเปิด/ปิด public ได้</p>`}
          </section>
        </aside>
      </section>

      <section class="info-grid">
        <section class="panel players-panel">
          <div class="panel-head"><div><p class="section-label">Players</p><h2>คนในวง</h2></div><span class="chip">${room.players.length} seats</span></div>
          <div class="player-list">${renderPlayers(room)}</div>
        </section>
        <section class="panel history-panel">
          <div class="panel-head"><div><p class="section-label">Discard Pile</p><h2>ไพ่ที่เปิดไปแล้ว</h2></div><span class="chip">${room.game.history.length} recent</span></div>
          <div class="history-list">${renderHistory(room)}</div>
        </section>
      </section>
    </main>`;
}

function renderPopup() {
  const { card, drawnBy } = state.popup;
  const theme = cardTheme(card);
  return `
    <div class="card-popup">
      <div class="card-popup__backdrop" data-action="close-popup"></div>
      <div class="card-popup__modal">
        <div class="card-popup__drawer">
          <div class="card-popup__avatar" style="background: linear-gradient(135deg, ${theme.accent}, ${theme.glow});">
            ${escapeHtml((drawnBy || "?").charAt(0).toUpperCase())}
          </div>
          <div class="card-popup__who">
            <span class="card-popup__label">สุ่มไพ่โดย</span>
            <strong class="card-popup__name">${escapeHtml(drawnBy)}</strong>
          </div>
        </div>
        <div class="card-popup__card-wrap">
          ${renderCardFace(card, { featured: true })}
        </div>
        <span class="card-popup__hint">แตะที่ไหนก็ได้เพื่อปิด</span>
      </div>
    </div>`;
}

function render() {
  app.innerHTML = `
    ${state.room ? renderRoom() : renderLobby()}
    ${state.popup ? renderPopup() : ""}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}`;
}

// ── Event listeners ────────────────────────────────────────────────────────────

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  switch (target.dataset.model) {
    case "player-name": state.playerName = target.value.slice(0, 24); break;
    case "room-name": state.roomName = target.value.slice(0, 40); break;
    case "join-code": state.joinCode = target.value.toUpperCase().slice(0, 6); break;
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action } = button.dataset;

  switch (action) {
    case "create-public-room": handleCreateRoom(true); break;
    case "create-private-room": handleCreateRoom(false); break;
    case "join-room": handleJoinRoom(); break;
    case "join-public-room": handleJoinRoom(button.dataset.room); break;
    case "refresh-public": refreshPublicRooms(); break;
    case "leave-room": leaveCurrentRoom(); break;
    case "save-room-settings":
      if (state.isHost) hostUpdateRoom(normalizeRoomName(state.roomName) || DEFAULT_ROOM_NAME, state.room?.isPublic ?? false);
      break;
    case "toggle-public-room":
      if (state.room && state.isHost) { state.room = { ...state.room, isPublic: !state.room.isPublic }; render(); }
      break;
    case "draw-card":
      if (state.isHost) {
        const myName = state.hostState?.players.find(p => p.id === state.clientId)?.name;
        hostDrawCard(myName);
      } else if (state.roomChannel) {
        state.roomChannel.publish("action", { type: "draw-card", playerId: state.clientId });
      }
      break;
    case "reset-deck":
      if (state.isHost) hostResetDeck();
      else if (state.roomChannel) state.roomChannel.publish("action", { type: "reset-deck", playerId: state.clientId });
      break;
    case "kick-player": if (state.isHost) hostKickPlayer(button.dataset.player); break;
    case "copy-room-code": if (state.room) copyText(state.room.code, "คัดลอกรหัสห้องแล้ว"); break;
    case "copy-room-link": if (state.room) copyText(roomShareUrl(), "คัดลอกลิงก์แล้ว"); break;
    case "close-popup": closePopup(); break;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !state.room) handleJoinRoom();
});

// ── Init ───────────────────────────────────────────────────────────────────────

initAbly();
render();
