import { PUNISHMENT_CARDS } from "./cards.js";

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

const state = {
  socket: null,
  connectionState: "connecting",
  clientId: null,
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
  lastDrawnCount: 0
};

const app = document.querySelector("#app");

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function cardNumber(cardId) {
  return Number(String(cardId).split("-").pop() || 0);
}

function cardTheme(card) {
  return CATEGORY_THEME[card?.category] || {
    accent: "#7ed8ff",
    glow: "#c6f4ff",
    icon: "◼",
    tone: "blue",
    label: "Party Card"
  };
}

function setToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(setToast.timerId);
  setToast.timerId = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function setCopied(message) {
  state.copied = message;
  render();
  window.clearTimeout(setCopied.timerId);
  setCopied.timerId = window.setTimeout(() => {
    state.copied = "";
    render();
  }, 1800);
}

function triggerRevealPulse() {
  state.revealPulse = true;
  render();
  window.clearTimeout(triggerRevealPulse.timerId);
  triggerRevealPulse.timerId = window.setTimeout(() => {
    state.revealPulse = false;
    render();
  }, REVEAL_ANIMATION_MS);
}

function normalizePlayerName(name) {
  return name.trim().slice(0, 24);
}

function normalizeRoomName(name) {
  return name.trim().slice(0, 40);
}

function currentUserIsHost() {
  return Boolean(state.room && state.clientId && state.room.hostId === state.clientId);
}

function roomShareUrl() {
  if (!state.room) {
    return "";
  }

  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room.code);
  return url.toString();
}

function currentCard() {
  return state.room?.game?.currentCard ?? null;
}

function cardsRemainingLabel(room) {
  return `${room.game.remainingCount} / ${room.game.totalCount}`;
}

function sendMessage(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    state.lobbyError = "ยังไม่เชื่อมต่อเซิร์ฟเวอร์";
    render();
    return;
  }

  state.socket.send(JSON.stringify({ type, ...payload }));
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

function handleRoomState(room) {
  const prevRoomCode = state.lastRoomCode;
  const prevDrawnCount = state.lastDrawnCount;
  const sameRoom = prevRoomCode === room.code;

  if (sameRoom && room.game.drawnCount > prevDrawnCount) {
    triggerRevealPulse();
  }

  if (!sameRoom) {
    state.revealPulse = false;
  }

  state.lastRoomCode = room.code;
  state.lastDrawnCount = room.game.drawnCount;
  state.room = room;
  state.roomName = room.name;
  state.lobbyError = "";
  syncUrlWithRoom(room.code);
}

function connectSocket() {
  const socket = new WebSocket(socketUrl());
  state.socket = socket;
  state.connectionState = "connecting";
  render();

  socket.addEventListener("open", () => {
    state.connectionState = "connected";
    state.lobbyError = "";
    render();
    tryAutoJoinFromUrl();
  });

  socket.addEventListener("close", () => {
    state.connectionState = "disconnected";
    state.room = null;
    state.revealPulse = false;
    render();
    window.setTimeout(connectSocket, 1200);
  });

  socket.addEventListener("error", () => {
    state.connectionState = "error";
    render();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case "welcome":
        state.clientId = message.clientId;
        break;
      case "public-rooms":
        state.publicRooms = message.rooms;
        break;
      case "room-state":
        handleRoomState(message.room);
        break;
      case "room-left":
        state.room = null;
        state.lastRoomCode = null;
        state.lastDrawnCount = 0;
        state.revealPulse = false;
        clearRoomFromUrl();
        break;
      case "error":
        state.lobbyError = message.message;
        setToast(message.message);
        break;
      case "notice":
        setToast(message.message);
        break;
      default:
        break;
    }

    render();
  });
}

function tryAutoJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  const playerName = normalizePlayerName(state.playerName);

  if (!roomCode || state.room || !playerName) {
    return;
  }

  sendMessage("join-room", {
    roomCode,
    playerName
  });
}

function handleCreateRoom(isPublic) {
  const playerName = normalizePlayerName(state.playerName);
  const roomName = normalizeRoomName(state.roomName) || DEFAULT_ROOM_NAME;

  localStorage.setItem("party-player-name", playerName);

  if (!playerName) {
    state.lobbyError = "ใส่ชื่อเล่นก่อนสร้างห้อง";
    render();
    return;
  }

  sendMessage("create-room", {
    playerName,
    roomName,
    isPublic
  });
}

function handleJoinRoom(roomCode = state.joinCode) {
  const playerName = normalizePlayerName(state.playerName);
  const normalizedCode = roomCode.trim().toUpperCase();

  localStorage.setItem("party-player-name", playerName);

  if (!playerName) {
    state.lobbyError = "ใส่ชื่อเล่นก่อนเข้าห้อง";
    render();
    return;
  }

  if (!normalizedCode) {
    state.lobbyError = "ใส่รหัสห้องก่อน";
    render();
    return;
  }

  sendMessage("join-room", {
    playerName,
    roomCode: normalizedCode
  });
}

async function copyText(value, copiedLabel) {
  try {
    await navigator.clipboard.writeText(value);
    setCopied(copiedLabel);
  } catch {
    setToast("คัดลอกไม่สำเร็จ ลองคัดลอกเองอีกครั้ง");
  }
}

function renderConnectionBadge() {
  const mapping = {
    connecting: "กำลังเชื่อมต่อ",
    connected: "ออนไลน์",
    disconnected: "หลุดจากเซิร์ฟเวอร์",
    error: "เชื่อมต่อผิดพลาด"
  };

  return `<span class="status-pill status-pill--${escapeHtml(state.connectionState)}">${escapeHtml(mapping[state.connectionState] || state.connectionState)}</span>`;
}

function renderCardFace(card, options = {}) {
  const { featured = false, compact = false, back = false, badge = "", pulse = false } = options;
  const theme = cardTheme(card);
  const classes = [
    "playing-card",
    `playing-card--${theme.tone}`,
    featured ? "playing-card--featured" : "",
    compact ? "playing-card--compact" : "",
    back ? "playing-card--back" : "",
    pulse ? "playing-card--pulse" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const title = back ? "PARTY DECK" : card.title;
  const subtitle = back ? "DRAW NEXT" : card.category;
  const body = back ? "ยังไม่เปิด" : card.rule;
  const footer = back ? "100 cards" : card.note;
  const number = back ? "##" : String(cardNumber(card.id)).padStart(3, "0");

  return `
    <article class="${classes}" style="--card-accent:${theme.accent}; --card-glow:${theme.glow};">
      <div class="playing-card__noise"></div>
      <div class="playing-card__corner playing-card__corner--top">
        <span>${theme.icon}</span>
        <strong>${number}</strong>
      </div>
      <div class="playing-card__corner playing-card__corner--bottom">
        <span>${theme.icon}</span>
        <strong>${number}</strong>
      </div>
      <div class="playing-card__inner">
        <div class="playing-card__meta">
          <span>${escapeHtml(subtitle)}</span>
          ${badge ? `<b>${escapeHtml(badge)}</b>` : ""}
        </div>
        <div class="playing-card__crest">${theme.icon}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <small>${escapeHtml(footer)}</small>
      </div>
    </article>
  `;
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
        <div class="stat-tile">
          <strong>100</strong>
          <span>cards</span>
        </div>
        <div class="stat-tile">
          <strong>${state.publicRooms.length}</strong>
          <span>public rooms</span>
        </div>
        <div class="stat-tile">
          <strong>สด</strong>
          <span>realtime</span>
        </div>
      </div>
    </div>
  `;
}

function renderLobby() {
  return `
    <main class="page-shell">
      <section class="hero hero--lobby panel">
        <div class="hero__copy">
          <p class="eyebrow">PUBLIC PARTY HOST</p>
          <h1>สุ่มไพ่กินเหล้าให้จบเด็ค</h1>
          <p class="hero__lead">
            เปิดห้องให้เพื่อนเข้าเล่นได้จริง สุ่มไพ่ทีละใบ ตัดออกจากเด็คจนหมดเกม
            พร้อมปุ่มสุ่มเด่นและหน้าการ์ดแบบโต๊ะไพ่ชัดเจน
          </p>
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
            <div>
              <p class="section-label">เริ่มวง</p>
              <h2>สร้างห้องหรือเข้าห้อง</h2>
            </div>
          </div>

          <label class="field">
            <span>ชื่อเล่น</span>
            <input
              type="text"
              maxlength="24"
              value="${escapeHtml(state.playerName)}"
              data-model="player-name"
              placeholder="เช่น บาส / ม่อน / Ploy"
            />
          </label>

          <label class="field">
            <span>ชื่อห้อง</span>
            <input
              type="text"
              maxlength="40"
              value="${escapeHtml(state.roomName)}"
              data-model="room-name"
              placeholder="วงห้อง 308"
            />
          </label>

          <div class="action-row action-row--stack">
            <button class="primary-btn primary-btn--wide" data-action="create-public-room">เปิด Host Public</button>
            <button class="secondary-btn secondary-btn--wide" data-action="create-private-room">เปิดห้องส่วนตัว</button>
          </div>

          <div class="divider"></div>

          <label class="field">
            <span>เข้าห้องด้วยรหัส</span>
            <div class="inline-field">
              <input
                type="text"
                maxlength="6"
                value="${escapeHtml(state.joinCode)}"
                data-model="join-code"
                placeholder="ROOM42"
              />
              <button class="ghost-btn" data-action="join-room">เข้าห้อง</button>
            </div>
          </label>

          ${
            state.lobbyError
              ? `<p class="inline-error">${escapeHtml(state.lobbyError)}</p>`
              : `<p class="inline-note">ห้อง public จะขึ้นในรายการด้านขวา ส่วนห้อง private ใช้ลิงก์หรือรหัสห้องแชร์กันเอง</p>`
          }
        </div>

        <div class="panel public-panel">
          <div class="panel-head">
            <div>
              <p class="section-label">Public Rooms</p>
              <h2>ห้องที่กำลังเปิดเล่น</h2>
            </div>
            <button class="ghost-btn" data-action="refresh-public">รีเฟรช</button>
          </div>

          <div class="public-list">
            ${
              state.publicRooms.length
                ? state.publicRooms
                    .map(
                      (room) => `
                        <article class="public-room-card">
                          <div>
                            <strong>${escapeHtml(room.name)}</strong>
                            <p>โค้ด ${escapeHtml(room.code)} • ${room.playerCount} คน • เหลือ ${room.remainingCount} ใบ</p>
                          </div>
                          <button class="ghost-btn" data-action="join-public-room" data-room="${escapeHtml(room.code)}">เข้าเล่น</button>
                        </article>
                      `
                    )
                    .join("")
                : `<div class="empty-state">ยังไม่มีห้องสาธารณะ ใครสักคนเปิดวงก่อน</div>`
            }
          </div>
        </div>
      </section>

      <section class="panel sample-panel">
        <div class="panel-head">
          <div>
            <p class="section-label">Deck Preview</p>
            <h2>หน้าตาไพ่ในเกม</h2>
          </div>
          <span class="chip">ดื่มอย่างรับผิดชอบ</span>
        </div>
        <div class="sample-grid">
          ${PUNISHMENT_CARDS.slice(0, 4)
            .map((card) => renderCardFace(card, { compact: true }))
            .join("")}
        </div>
      </section>
    </main>
  `;
}

function renderDeckConsole(room, isHost) {
  const nextDrawDisabled = room.game.remainingCount === 0;
  const progress = (room.game.drawnCount / room.game.totalCount) * 100;

  return `
    <section class="panel deck-console">
      <div class="panel-head">
        <div>
          <p class="section-label">Draw Pile</p>
          <h2>กองไพ่ของห้องนี้</h2>
        </div>
        <span class="chip">${cardsRemainingLabel(room)}</span>
      </div>

      <div class="deck-console__stack">
        <div class="deck-stack ${nextDrawDisabled ? "deck-stack--empty" : ""}">
          <div class="deck-stack__shadow"></div>
          <div class="deck-stack__card deck-stack__card--a"></div>
          <div class="deck-stack__card deck-stack__card--b"></div>
          <div class="deck-stack__card deck-stack__card--c"></div>
          <div class="deck-stack__count">
            <strong>${room.game.remainingCount}</strong>
            <span>ใบที่เหลือ</span>
          </div>
        </div>
        <div class="deck-console__copy">
          <strong>${nextDrawDisabled ? "ไพ่หมดแล้ว" : "พร้อมสุ่มใบถัดไป"}</strong>
          <p>
            ${nextDrawDisabled
              ? "เปิดครบทั้งเด็คแล้ว กดสับใหม่เพื่อเริ่มเกมถัดไป"
              : "เมื่อกดสุ่ม ไพ่จะถูกตัดออกจากกองทันทีและจะไม่กลับมาอีกจนกว่าจะรีเซ็ต"}
          </p>
        </div>
      </div>

      <div class="progress-strip">
        <div class="progress-strip__bar"><span style="width:${progress}%"></span></div>
        <small>เปิดแล้ว ${room.game.drawnCount} / ${room.game.totalCount} ใบ</small>
      </div>

      ${
        isHost
          ? `
            <div class="action-column">
              <button class="draw-btn" data-action="draw-card" ${nextDrawDisabled ? "disabled" : ""}>
                <span class="draw-btn__label">สุ่มไพ่</span>
                <span class="draw-btn__meta">${nextDrawDisabled ? "เด็คหมด" : "จั่วใบถัดไปเดี๋ยวนี้"}</span>
              </button>
              <button class="ghost-btn" data-action="reset-deck">สับไพ่ใหม่ทั้งเด็ค</button>
            </div>
          `
          : `<p class="inline-note">รอ Host กดสุ่มไพ่ ใบที่เปิดจะขึ้นตรงกลางทันทีสำหรับทุกคนในห้อง</p>`
      }
    </section>
  `;
}

function renderPlayers(room) {
  return room.players
    .map(
      (player) => `
        <article class="player-card ${player.id === room.hostId ? "player-card--host" : ""}">
          <div class="player-card__avatar">${escapeHtml(player.name.charAt(0) || "?")}</div>
          <div class="player-card__body">
            <strong>${escapeHtml(player.name)}</strong>
            <p>${player.id === room.hostId ? "Host" : "Player"}</p>
          </div>
          ${
            currentUserIsHost() && player.id !== room.hostId
              ? `<button class="ghost-btn ghost-btn--small" data-action="kick-player" data-player="${escapeHtml(player.id)}">เตะ</button>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderHistory(room) {
  if (!room.game.history.length) {
    return `<div class="empty-state">ยังไม่มีไพ่ในกองทิ้ง กดสุ่มใบแรกเพื่อเริ่มเกม</div>`;
  }

  return room.game.history
    .map(
      (card, index) => `
        <article class="history-entry">
          <div class="history-entry__index">#${String(room.game.drawnCount - index).padStart(2, "0")}</div>
          <div class="history-entry__body">
            <strong>${escapeHtml(card.title)}</strong>
            <p>${escapeHtml(card.rule)}</p>
          </div>
          <span class="history-entry__tag">${escapeHtml(card.category)}</span>
        </article>
      `
    )
    .join("");
}

function renderCurrentCard(room) {
  const card = currentCard();

  if (!card) {
    return `
      <section class="panel reveal-panel reveal-panel--empty">
        <div class="reveal-panel__empty-copy">
          <p class="section-label">Ready</p>
          <h2>โต๊ะพร้อมแล้ว รอสุ่มใบแรก</h2>
          <p>เมื่อ Host กดสุ่ม ไพ่จะถูกเปิดกลางโต๊ะและถูกตัดออกจากเด็คทันที</p>
        </div>
        <div class="reveal-panel__empty-card">
          ${renderCardFace(PUNISHMENT_CARDS[0], { featured: true, back: true })}
        </div>
      </section>
    `;
  }

  const theme = cardTheme(card);
  const drawnText =
    room.game.remainingCount === 0
      ? "ใบสุดท้ายของเกมนี้เปิดแล้ว"
      : `เหลืออีก ${room.game.remainingCount} ใบก่อนหมดเด็ค`;

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
        <div class="draw-summary">
          <strong>${drawnText}</strong>
          <span>ถ้าเปิดครบ 100 ใบ ระบบจะหยุดให้สุ่มจนกว่า Host จะสับเด็คใหม่</span>
        </div>
      </div>
      <div class="reveal-panel__card">
        ${renderCardFace(card, {
          featured: true,
          badge: `#${String(room.game.drawnCount).padStart(2, "0")}`,
          pulse: state.revealPulse
        })}
      </div>
    </section>
  `;
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
          <p class="hero__lead">
            ${room.isPublic ? "ห้องนี้เปิด public อยู่ คนอื่นเข้าจาก lobby ได้ทันที" : "ห้องส่วนตัว แชร์รหัสหรือคัดลอกลิงก์ให้เพื่อนเข้าตรง"}
          </p>
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
              <div>
                <p class="section-label">Room Control</p>
                <h2>ตั้งค่าห้อง</h2>
              </div>
              <span class="chip">${isHost ? "คุณคือ Host" : `Host: ${escapeHtml(room.hostName)}`}</span>
            </div>

            <label class="field">
              <span>ชื่อห้อง</span>
              <input
                type="text"
                maxlength="40"
                value="${escapeHtml(state.roomName)}"
                data-model="room-name"
                ${isHost ? "" : "disabled"}
              />
            </label>

            <div class="toggle-row">
              <span>Public Lobby</span>
              <button class="toggle-btn ${room.isPublic ? "toggle-btn--on" : ""}" data-action="toggle-public-room" ${isHost ? "" : "disabled"}>
                ${room.isPublic ? "เปิดอยู่" : "ปิดอยู่"}
              </button>
            </div>

            ${
              isHost
                ? `<button class="ghost-btn room-settings__save" data-action="save-room-settings">บันทึกการตั้งค่า</button>`
                : `<p class="inline-note">เฉพาะ Host เท่านั้นที่แก้ชื่อห้องและเปิด/ปิด public ได้</p>`
            }
          </section>
        </aside>
      </section>

      <section class="info-grid">
        <section class="panel players-panel">
          <div class="panel-head">
            <div>
              <p class="section-label">Players</p>
              <h2>คนในวง</h2>
            </div>
            <span class="chip">${room.players.length} seats</span>
          </div>
          <div class="player-list">${renderPlayers(room)}</div>
        </section>

        <section class="panel history-panel">
          <div class="panel-head">
            <div>
              <p class="section-label">Discard Pile</p>
              <h2>ไพ่ที่เปิดไปแล้ว</h2>
            </div>
            <span class="chip">${room.game.history.length} recent</span>
          </div>
          <div class="history-list">${renderHistory(room)}</div>
        </section>
      </section>
    </main>
  `;
}

function render() {
  app.innerHTML = `
    ${state.room ? renderRoom() : renderLobby()}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  switch (target.dataset.model) {
    case "player-name":
      state.playerName = target.value.slice(0, 24);
      break;
    case "room-name":
      state.roomName = target.value.slice(0, 40);
      break;
    case "join-code":
      state.joinCode = target.value.toUpperCase().slice(0, 6);
      break;
    default:
      break;
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const { action } = button.dataset;

  switch (action) {
    case "create-public-room":
      handleCreateRoom(true);
      break;
    case "create-private-room":
      handleCreateRoom(false);
      break;
    case "join-room":
      handleJoinRoom();
      break;
    case "join-public-room":
      handleJoinRoom(button.dataset.room);
      break;
    case "refresh-public":
      sendMessage("get-public-rooms");
      break;
    case "leave-room":
      sendMessage("leave-room");
      state.room = null;
      state.lastRoomCode = null;
      state.lastDrawnCount = 0;
      state.revealPulse = false;
      clearRoomFromUrl();
      render();
      break;
    case "save-room-settings":
      sendMessage("update-room", {
        roomName: normalizeRoomName(state.roomName) || DEFAULT_ROOM_NAME,
        isPublic: state.room ? state.room.isPublic : false
      });
      break;
    case "toggle-public-room":
      if (state.room) {
        state.room = {
          ...state.room,
          isPublic: !state.room.isPublic
        };
        render();
      }
      break;
    case "draw-card":
      sendMessage("draw-card");
      break;
    case "reset-deck":
      sendMessage("reset-deck");
      break;
    case "kick-player":
      sendMessage("kick-player", { playerId: button.dataset.player });
      break;
    case "copy-room-code":
      if (state.room) {
        copyText(state.room.code, "คัดลอกรหัสห้องแล้ว");
      }
      break;
    case "copy-room-link":
      if (state.room) {
        copyText(roomShareUrl(), "คัดลอกลิงก์แล้ว");
      }
      break;
    default:
      break;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !state.room) {
    handleJoinRoom();
  }
});

connectSocket();
render();
