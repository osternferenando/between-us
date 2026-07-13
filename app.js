// ====== Between Us — app.js ======
// Wires together the UI, the question bank, and Firebase (which is what
// lets two different phones see each other's answers in real time).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUESTIONS, CATEGORY_META } from "./questions.js";

// ---------- Firebase init ----------
const CONFIG_MISSING = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_");
let db = null;
if (!CONFIG_MISSING) {
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
}

// ---------- DOM references ----------
const el = (id) => document.getElementById(id);

const themeToggleBtn = el("theme-toggle");
const toastEl = el("toast");
const configWarningEl = el("config-warning");

const screens = {
  landing: el("screen-landing"),
  waiting: el("screen-waiting"),
  game: el("screen-game"),
  end: el("screen-end"),
  memory: el("screen-memory"),
};

const nameInput = el("name-input");
const showCreateBtn = el("show-create-btn");
const showJoinBtn = el("show-join-btn");
const createStep = el("create-step");
const joinStep = el("join-step");
const categoryChipsEl = el("category-chips");
const createRoomBtn = el("create-room-btn");
const joinCodeInput = el("join-code-input");
const joinRoomBtn = el("join-room-btn");

const roomCodeDisplayEl = el("room-code-display");
const copyLinkBtn = el("copy-link-btn");
const whatsappBtn = el("whatsapp-btn");

const playersRowEl = el("players-row");
const progressTextEl = el("progress-text");
const categoryTagEl = el("category-tag");
const questionNumberEl = el("question-number");
const questionCardEl = el("question-card");
const questionTextEl = el("question-text");
const answerFormEl = el("answer-form");
const answerInput = el("answer-input");
const skipBtn = el("skip-btn");
const leaveRoomBtn = el("leave-room-btn");
const cancelWaitingBtn = el("cancel-waiting-btn");
const memoryToggleBtn = el("memory-toggle");
const memoryBackBtn = el("memory-back-btn");
const memoryListEl = el("memory-list");
const confettiLayerEl = el("confetti-layer");
const waitingForOtherEl = el("waiting-for-other");
const revealEl = el("reveal");
const revealMineEl = el("reveal-mine");
const revealTheirsNameEl = el("reveal-theirs-name");
const revealTheirsEl = el("reveal-theirs");
const nextBtn = el("next-btn");

const endCountEl = el("end-count");
const playAgainBtn = el("play-again-btn");

// ---------- State ----------
let playerId = null;
let roomId = null;
let selectedCategory = "mix";
let currentRoomData = null;
let lastAnimatedIndex = -1;
let celebratedIndex = -1;
let unsubscribeRoom = null;

const SKIPPED = "__SKIPPED__";
const MILESTONES = [5, 10, 25, 50, 100];
const CONFETTI_COLORS = ["#c9a15a", "#9c3348", "#2f6f65", "#f6efe1", "#3d3a75"];

// ---------- Helpers ----------
function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.classList.toggle("hidden", key !== name);
  });
  memoryToggleBtn.classList.toggle("hidden", !["game", "end"].includes(name));
}

function leaveRoom() {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = null;
  roomId = null;
  currentRoomData = null;
  lastAnimatedIndex = -1;
  celebratedIndex = -1;
  createStep.classList.add("hidden");
  joinStep.classList.add("hidden");
  showScreen("landing");
}

function fireConfetti() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
    piece.style.animationDelay = Math.random() * 0.3 + "s";
    confettiLayerEl.appendChild(piece);
    setTimeout(() => piece.remove(), 3600);
  }
}

function setRevealText(node, value) {
  if (value === SKIPPED) {
    node.textContent = "Skipped this one";
    node.classList.add("skipped");
  } else {
    node.textContent = value;
    node.classList.remove("skipped");
  }
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add("hidden"), 3200);
}

function getPlayerId() {
  let id = localStorage.getItem("bu_playerId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("bu_playerId", id);
  }
  return id;
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I — easy to read aloud
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function generateUniqueRoomCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateRoomCode();
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) return code;
  }
  return generateRoomCode() + Math.floor(Math.random() * 9); // vanishingly unlikely fallback
}

function buildShuffledQuestions(category) {
  const pool = category === "mix" ? Object.values(QUESTIONS).flat() : QUESTIONS[category];
  return [...pool].sort(() => Math.random() - 0.5);
}

function shareUrl() {
  return `${location.origin}${location.pathname}?room=${roomId}`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Category chips ----------
function renderCategoryChips() {
  const order = ["mix", "love", "friendship", "deep", "funny", "wouldYouRather", "confessions", "dares", "wyd"];
  categoryChipsEl.innerHTML = "";
  order.forEach((key) => {
    const meta = CATEGORY_META[key];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (key === selectedCategory ? " selected" : "");
    chip.style.setProperty("--chip-color", meta.color);
    chip.textContent = `${meta.emoji} ${meta.label}`;
    chip.addEventListener("click", () => {
      selectedCategory = key;
      [...categoryChipsEl.children].forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    categoryChipsEl.appendChild(chip);
  });
}

// ---------- Landing flow ----------
function requireName() {
  if (!nameInput.value.trim()) {
    toast("Type your name first 🙂");
    nameInput.focus();
    return false;
  }
  return true;
}

showCreateBtn.addEventListener("click", () => {
  if (!requireName()) return;
  createStep.classList.remove("hidden");
  joinStep.classList.add("hidden");
});

showJoinBtn.addEventListener("click", () => {
  if (!requireName()) return;
  joinStep.classList.remove("hidden");
  createStep.classList.add("hidden");
});

// ---------- Create room ----------
createRoomBtn.addEventListener("click", async () => {
  if (!requireName() || !db) return;
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = "Creating...";
  try {
    playerId = getPlayerId();
    const code = await generateUniqueRoomCode();
    const questions = buildShuffledQuestions(selectedCategory);
    await setDoc(doc(db, "rooms", code), {
      category: selectedCategory,
      questions,
      currentIndex: 0,
      createdAt: serverTimestamp(),
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // auto-deleted after 30 days, see README
      players: { [playerId]: { name: nameInput.value.trim(), joinedAt: Date.now() } },
      answers: {},
    });
    roomId = code;
    roomCodeDisplayEl.textContent = code;
    showScreen("waiting");
    listenToRoom(code);
  } catch (err) {
    console.error(err);
    toast("Couldn't create the room — check your Firebase setup.");
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
  }
});

// ---------- Join room ----------
joinRoomBtn.addEventListener("click", async () => {
  if (!requireName() || !db) return;
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    toast("Enter a valid room code.");
    return;
  }
  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = "Joining...";
  try {
    playerId = getPlayerId();
    const ref = doc(db, "rooms", code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      toast("That room code doesn't exist.");
      return;
    }
    const data = snap.data();
    const alreadyIn = data.players && data.players[playerId];
    const playerCount = Object.keys(data.players || {}).length;
    if (!alreadyIn && playerCount >= 2) {
      toast("That room already has two players.");
      return;
    }
    if (!alreadyIn) {
      await updateDoc(ref, { [`players.${playerId}`]: { name: nameInput.value.trim(), joinedAt: Date.now() } });
    }
    roomId = code;
    listenToRoom(code);
  } catch (err) {
    console.error(err);
    toast("Couldn't join the room — check your Firebase setup.");
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = "Join Room";
  }
});

// ---------- Realtime listener ----------
function listenToRoom(code) {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = onSnapshot(
    doc(db, "rooms", code),
    (snap) => {
      if (!snap.exists()) return;
      currentRoomData = snap.data();
      render(currentRoomData);
    },
    (err) => {
      console.error(err);
      toast("Lost connection to the room.");
    }
  );
}

function render(data) {
  const playerIds = Object.keys(data.players || {});
  if (playerIds.length < 2) {
    showScreen("waiting");
    roomCodeDisplayEl.textContent = roomId;
    return;
  }
  if (data.currentIndex >= data.questions.length) {
    renderEnd(data);
    return;
  }
  renderGame(data);
}

function renderGame(data) {
  showScreen("game");
  const idx = data.currentIndex;

  const sortedIds = Object.keys(data.players).sort((a, b) => data.players[a].joinedAt - data.players[b].joinedAt);
  playersRowEl.innerHTML = sortedIds
    .map((id) => {
      const label = escapeHtml(data.players[id].name) + (id === playerId ? " (you)" : "");
      return `<span class="player-tag">🟢 ${label}</span>`;
    })
    .join("");

  progressTextEl.textContent = `${idx + 1} / ${data.questions.length}`;
  const meta = CATEGORY_META[data.category];
  categoryTagEl.style.setProperty("--stamp", meta.color);
  categoryTagEl.textContent = `${meta.emoji} ${meta.label}`;
  questionNumberEl.textContent = `No. ${String(idx + 1).padStart(3, "0")}`;
  questionTextEl.textContent = data.questions[idx];

  if (idx !== lastAnimatedIndex) {
    questionCardEl.classList.remove("animate");
    void questionCardEl.offsetWidth; // restart the CSS animation
    questionCardEl.classList.add("animate");
    lastAnimatedIndex = idx;
    answerInput.value = "";
  }

  const answersForQ = (data.answers && data.answers[idx]) || {};
  const myAnswer = answersForQ[playerId];
  const otherId = sortedIds.find((id) => id !== playerId);
  const otherAnswer = otherId ? answersForQ[otherId] : undefined;
  const otherName = otherId ? data.players[otherId].name : "your person";

  const iAnswered = myAnswer !== undefined;
  const bothAnswered = iAnswered && otherAnswer !== undefined;

  answerFormEl.classList.toggle("hidden", iAnswered);
  waitingForOtherEl.classList.toggle("hidden", !iAnswered || bothAnswered);
  if (iAnswered && !bothAnswered) {
    waitingForOtherEl.textContent = `Waiting for ${otherName} to answer...`;
  }

  revealEl.classList.toggle("hidden", !bothAnswered);
  nextBtn.classList.toggle("hidden", !bothAnswered);
  if (bothAnswered) {
    setRevealText(revealMineEl, myAnswer);
    revealTheirsNameEl.textContent = otherName;
    setRevealText(revealTheirsEl, otherAnswer);

    if (idx !== celebratedIndex && MILESTONES.includes(idx + 1)) {
      celebratedIndex = idx;
      toast(`🎉 ${idx + 1} questions in — nice streak!`);
      fireConfetti();
    }
  }
}

function renderEnd(data) {
  showScreen("end");
  endCountEl.textContent = data.questions.length;
}

// ---------- Answer submit ----------
answerFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = answerInput.value.trim();
  if (!text || !currentRoomData) return;
  const idx = currentRoomData.currentIndex;
  try {
    await updateDoc(doc(db, "rooms", roomId), { [`answers.${idx}.${playerId}`]: text });
  } catch (err) {
    console.error(err);
    toast("Couldn't submit your answer — try again.");
  }
});

skipBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const idx = currentRoomData.currentIndex;
  try {
    await updateDoc(doc(db, "rooms", roomId), { [`answers.${idx}.${playerId}`]: SKIPPED });
  } catch (err) {
    console.error(err);
    toast("Couldn't skip — try again.");
  }
});

// ---------- Leave / cancel ----------
leaveRoomBtn.addEventListener("click", leaveRoom);
cancelWaitingBtn.addEventListener("click", leaveRoom);

// ---------- Memory Book ----------
function renderMemoryBook(data) {
  const sortedIds = Object.keys(data.players).sort((a, b) => data.players[a].joinedAt - data.players[b].joinedAt);
  const entries = [];
  for (let i = 0; i < data.currentIndex; i++) {
    const answersForQ = (data.answers && data.answers[i]) || {};
    const complete = sortedIds.every((id) => answersForQ[id] !== undefined);
    if (!complete) continue;
    const answerRows = sortedIds
      .map((id) => {
        const raw = answersForQ[id];
        const shown = raw === SKIPPED ? "<em>Skipped</em>" : escapeHtml(raw);
        const label = escapeHtml(data.players[id].name) + (id === playerId ? " (you)" : "");
        return `<p class="memory-a"><b>${label}</b>${shown}</p>`;
      })
      .join("");
    entries.push(
      `<div class="memory-entry"><span class="index-number">No. ${String(i + 1).padStart(3, "0")}</span>` +
      `<p class="memory-q">${escapeHtml(data.questions[i])}</p>${answerRows}</div>`
    );
  }
  memoryListEl.innerHTML = entries.length
    ? entries.join("")
    : `<p class="waiting-text">No completed questions yet — answer a few and check back.</p>`;
}

memoryToggleBtn.addEventListener("click", () => {
  if (!currentRoomData) return;
  renderMemoryBook(currentRoomData);
  showScreen("memory");
});
memoryBackBtn.addEventListener("click", () => {
  if (currentRoomData) render(currentRoomData);
});

// ---------- Next question (transaction avoids a double-advance if both tap at once) ----------
nextBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const ref = doc(db, "rooms", roomId);
  const myIdx = currentRoomData.currentIndex;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (data.currentIndex === myIdx) {
        tx.update(ref, { currentIndex: myIdx + 1 });
      }
    });
  } catch (err) {
    console.error(err);
  }
});

// ---------- Play again ----------
playAgainBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const newQuestions = buildShuffledQuestions(currentRoomData.category);
  lastAnimatedIndex = -1;
  try {
    await updateDoc(doc(db, "rooms", roomId), { questions: newQuestions, currentIndex: 0, answers: {} });
  } catch (err) {
    console.error(err);
  }
});

// ---------- Share ----------
copyLinkBtn.addEventListener("click", async () => {
  const url = shareUrl();
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard API unavailable");
    await navigator.clipboard.writeText(url);
    toast("Link copied!");
  } catch {
    // Some in-app browsers (WhatsApp, Instagram) block the Clipboard API —
    // fall back to a native prompt the person can copy from manually.
    window.prompt("Copy this link:", url);
  }
});
whatsappBtn.addEventListener("click", () => {
  const text = encodeURIComponent(`Play a question game with me 👀 ${shareUrl()}`);
  window.open(`https://wa.me/?text=${text}`, "_blank");
});

// ---------- Theme (dark table / daylight table) ----------
themeToggleBtn.addEventListener("click", () => {
  const isLight = document.body.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  themeToggleBtn.textContent = next === "light" ? "🌙" : "☀️";
  localStorage.setItem("bu_theme", next);
});

// ---------- Init ----------
function init() {
  renderCategoryChips();

  const savedTheme = localStorage.getItem("bu_theme");
  if (savedTheme === "light") {
    document.body.setAttribute("data-theme", "light");
    themeToggleBtn.textContent = "🌙";
  }

  if (CONFIG_MISSING) {
    configWarningEl.classList.remove("hidden");
    showCreateBtn.disabled = true;
    showJoinBtn.disabled = true;
  }

  const params = new URLSearchParams(location.search);
  const prefillRoom = params.get("room");
  if (prefillRoom) {
    joinCodeInput.value = prefillRoom.toUpperCase();
    toast("Room code filled in — add your name and tap Join a Room");
  }
}

init();
