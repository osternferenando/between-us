// ====== Between Us — app.js ======
// Wires together the UI, the question bank, and Firebase (which is what
// lets multiple phones see each other's answers in real time).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, onSnapshot, runTransaction, serverTimestamp,
  collection, addDoc, query, orderBy, limit, where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUESTIONS, CATEGORY_META } from "./questions.js";

// ---------- Firebase init ----------
const CONFIG_MISSING = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_");
let db = null;
let rtdb = null;
let rtdbApi = null; 

if (!CONFIG_MISSING) {
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);

  if (firebaseConfig.databaseURL) {
    import("https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js")
      .then((mod) => {
        rtdbApi = mod;
        rtdb = mod.getDatabase(fbApp);
        if (roomId && playerId) setupPresence(roomId, playerId);
      })
      .catch((err) => {
        console.error("Realtime Database presence unavailable (rest of the app still works):", err);
      });
  }
}

// ---------- DOM references ----------
const el = (id) => document.getElementById(id);

const themeToggleBtn = el("theme-toggle");
const soundToggleBtn = el("sound-toggle");
const toastEl = el("toast");
const configWarningEl = el("config-warning");

const screens = {
  landing: el("screen-landing"),
  packCreator: el("screen-pack-creator"),
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
const conversationModeToggle = el("conversation-mode-toggle");
const customCodeInput = el("custom-code-input");
const maxPlayersSelect = el("max-players-select");
const questionCountSelect = el("question-count-select");
const createRoomBtn = el("create-room-btn");
const joinCodeInput = el("join-code-input");
const joinRoomBtn = el("join-room-btn");

const packPanelEl = el("pack-panel");
const packCodeInput = el("pack-code-input");
const loadPackBtn = el("load-pack-btn");
const packStatusEl = el("pack-status");
const openPackCreatorBtn = el("open-pack-creator-btn");

const packTitleInput = el("pack-title-input");
const packQuestionsInput = el("pack-questions-input");
const savePackBtn = el("save-pack-btn");
const packCreatorBackBtn = el("pack-creator-back-btn");
const packSavedPanelEl = el("pack-saved-panel");
const packCodeDisplayEl = el("pack-code-display");
const packCopyLinkBtn = el("pack-copy-link-btn");
const packUseNowBtn = el("pack-use-now-btn");

const roomCodeDisplayEl = el("room-code-display");
const copyLinkBtn = el("copy-link-btn");
const whatsappBtn = el("whatsapp-btn");
const waitingPlayersEl = el("waiting-players");
const waitingHintEl = el("waiting-hint");
const startGameBtn = el("start-game-btn");

const playersRowEl = el("players-row");
const progressTextEl = el("progress-text");
const categoryTagEl = el("category-tag");
const questionNumberEl = el("question-number");
const questionCardEl = el("question-card");
const questionTextEl = el("question-text");
const favoriteBtn = el("favorite-btn");
const answerFormEl = el("answer-form");
const answerInput = el("answer-input");
const skipBtn = el("skip-btn");
const voteFormEl = el("vote-form");
const voteButtonsEl = el("vote-buttons");
const voteSkipBtn = el("vote-skip-btn");
const typingIndicatorEl = el("typing-indicator");
const leaveRoomBtn = el("leave-room-btn");
const cancelWaitingBtn = el("cancel-waiting-btn");
const memoryToggleBtn = el("memory-toggle");
const memoryBackBtn = el("memory-back-btn");
const memoryListEl = el("memory-list");
const confettiLayerEl = el("confetti-layer");
const waitingForOtherEl = el("waiting-for-other");
const revealEl = el("reveal");
const revealListEl = el("reveal-list");
const revealQuoteEl = el("reveal-quote");
const nextBtn = el("next-btn");
const exportKeepsakeBtn = el("export-keepsake-btn");
const exportKeepsakeBtnEnd = el("export-keepsake-btn-end");
// NOTE: Gemini is no longer called directly from the frontend.
// Set this to your deployed Vercel backend URL (protects your API key).
const MEDIATOR_BACKEND_URL = "https://between-us-backend.vercel.app/api/mediator";

// Pending mediator question - stored until player draws next card
let pendingMediatorQuestion = null;

const endCountEl = el("end-count");
const playAgainBtn = el("play-again-btn");

// ---------- State ----------
let playerId = null;
let roomId = null;
let selectedCategory = "mix";
let currentRoomData = null;
let lastAnimatedIndex = -1;
let lastRevealedIndex = -1;
let celebratedIndex = -1;
let unsubscribeRoom = null;
let unsubscribePresence = null;
let typingTimer = null;
let isTypingFlagged = false;
let loadedPack = null; 
let presenceData = {};
let stallCount = 0; // Tracks how often they dodge questions
let briefNudgeStreak = 0; // Tracks THIS player's own brief-answer streak, for the private nudge
let journalGenerationInFlight = false; // prevents duplicate journal calls from rapid snapshot updates
let endCelebrated = false; // fires the completion confetti exactly once per finished deck

// ========== Chat Feature Variables ==========
let chatToggleBtn = null;
let chatOverlayEl = null;
let chatMessagesEl = null;
let chatInputEl = null;
let chatTypingIndicatorEl = null;
let chatSendBtn = null;
let unsubscribeMessages = null;
let chatMessages = [];
let chatOverlayOpen = false;
let lastSeenMessageCount = 0;
let isChatTypingFlagged = false;
let chatTypingTimer = null;
let bubbleLongPressTimer = null;
let bubbleLongPressStart = null;
let suppressNextBubbleClick = false;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
const MAX_VOICE_SECONDS = 30;


const SKIPPED = "__SKIPPED__";
const MILESTONES = [5, 10, 25, 50, 100];
const CONFETTI_COLORS = ["#c9a15a", "#9c3348", "#2f6f65", "#f6efe1", "#3d3a75"];
const QUOTES = [
  "Great conversations build stronger connections.",
  "That's one more thing you know about each other now.",
  "Small answers, big closeness.",
  "This is how you get to know someone, one card at a time.",
  "Worth remembering — that one's going in the Memory Book.",
  "Some of the best conversations start with a random question.",
  "You just learned something you didn't know this morning.",
];

let soundEnabled = localStorage.getItem("bu_sound") !== "off";
let favorites = getFavorites();

// ---------- Helpers ----------
function showScreen(name) {
  const currentScreen = Object.entries(screens).find(([key, node]) => !node.classList.contains("hidden"));
  const nextScreen = screens[name];
  
  if (currentScreen && currentScreen[1] !== nextScreen) {
    nextScreen.classList.add("screen-entering");
    currentScreen[1].classList.add("hidden");
    nextScreen.classList.remove("hidden");
    void nextScreen.offsetWidth; // Force reflow
    requestAnimationFrame(() => {
      nextScreen.classList.remove("screen-entering");
    });
  } else {
    Object.entries(screens).forEach(([key, node]) => {
      node.classList.toggle("hidden", key !== name);
    });
  }
  
  memoryToggleBtn.classList.toggle("hidden", !["game", "end"].includes(name));
  if (homeToggleBtn) homeToggleBtn.classList.toggle("hidden", ["landing", "packCreator"].includes(name));
  if (chatToggleBtn) chatToggleBtn.classList.toggle("chat-toggle-docked", name !== "game");
}

function saveGameState(code, id) {
  if (code && id && db) {
    localStorage.setItem("bu_activeRoom", code);
    localStorage.setItem("bu_activePlayerId", id);
  }
}

function clearGameState() {
  localStorage.removeItem("bu_activeRoom");
  localStorage.removeItem("bu_activePlayerId");
}

async function restoreGameState() {
  const savedRoom = localStorage.getItem("bu_activeRoom");
  const savedPlayerId = localStorage.getItem("bu_activePlayerId");
  
  if (savedRoom && savedPlayerId && db) {
    try {
      const snap = await getDoc(doc(db, "rooms", savedRoom));
      if (snap.exists()) {
        roomId = savedRoom;
        playerId = savedPlayerId;
        listenToRoom(savedRoom);
        setupPresence(savedRoom, savedPlayerId);
        console.log("✅ Game state restored:", savedRoom);
        return true;
      }
    } catch (err) {
      console.error("Failed to restore game state:", err);
    }
    clearGameState();
  }
  return false;
}

function leaveRoom() {
  if (unsubscribeRoom) unsubscribeRoom();
  if (unsubscribePresence) unsubscribePresence();
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeRoom = null;
  unsubscribePresence = null;
  unsubscribeMessages = null;
  chatMessages = [];
  lastSeenMessageCount = 0;
  if (chatToggleBtn) chatToggleBtn.classList.add("hidden");
  closeChatOverlay();
  roomId = null;
  currentRoomData = null;
  presenceData = {};
  lastAnimatedIndex = -1;
  lastRevealedIndex = -1;
  celebratedIndex = -1;
  endCelebrated = false;
  clearGameState();
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

function getFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem("bu_favorites") || "[]"));
  } catch {
    return new Set();
  }
}
function saveFavorites() {
  localStorage.setItem("bu_favorites", JSON.stringify([...favorites]));
}
function updateFavoriteBtn(text) {
  const isFav = favorites.has(text);
  favoriteBtn.textContent = isFav ? "♥" : "♡";
  favoriteBtn.classList.toggle("active", isFav);
}

// ---------- Sound ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function playTone(freq, duration, type, startGain) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(startGain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
}
function playShuffleSound() {
  playTone(300, 0.12, "triangle", 0.06);
  setTimeout(() => playTone(420, 0.1, "triangle", 0.05), 60);
}
function playRevealSound() {
  playTone(520, 0.18, "sine", 0.07);
  setTimeout(() => playTone(660, 0.22, "sine", 0.06), 90);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden", "toast-exiting");
  
  clearTimeout(toast._t);
  clearTimeout(toast._exitT);
  
  toast._t = setTimeout(() => {
    toastEl.classList.add("toast-exiting");
    toast._exitT = setTimeout(() => {
      toastEl.classList.add("hidden");
      toastEl.classList.remove("toast-exiting");
    }, 300);
  }, 3200);
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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
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
  return generateRoomCode() + Math.floor(Math.random() * 9); 
}

async function generateUniquePackCode() {
  for (let i = 0; i < 5; i++) {
    const code = "PACK-" + generateRoomCode();
    const snap = await getDoc(doc(db, "packs", code));
    if (!snap.exists()) return code;
  }
  return "PACK-" + generateRoomCode() + Math.floor(Math.random() * 9);
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function isCategoryExplicit(key) {
  return !!(CATEGORY_META[key] && CATEGORY_META[key].explicit);
}

function buildShuffledQuestions(category, conversationMode) {
  if (category === "custompack") {
    return loadedPack ? shuffle(loadedPack.questions) : [];
  }
  // "mix" never includes 18+ categories — those require an explicit,
  // deliberate chip selection (gated by the age-confirmation modal below).
  const pool = category === "mix"
    ? Object.entries(QUESTIONS).filter(([key]) => !isCategoryExplicit(key)).flatMap(([, list]) => list)
    : QUESTIONS[category];
  if (!conversationMode) {
    return shuffle(pool).map((item) => item.text);
  }
  const byLevel = { 1: [], 2: [], 3: [], 4: [] };
  pool.forEach((item) => byLevel[item.level].push(item));
  return [1, 2, 3, 4]
    .flatMap((lvl) => shuffle(byLevel[lvl]))
    .map((item) => item.text);
}

function shareUrl() {
  return `${location.origin}${location.pathname}?room=${roomId}`;
}
function packShareUrl(code) {
  return `${location.origin}${location.pathname}?pack=${code}`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function sortedPlayerIds(data) {
  return Object.keys(data.players || {}).sort((a, b) => data.players[a].joinedAt - data.players[b].joinedAt);
}

// ---------- Category chips ----------
function renderCategoryChips() {
  const order = ["mix", "love", "friendship", "family", "deep", "funny", "party", "firstImpressions", "wouldYouRather", "confessions", "dares", "wyd", "vote", "vibeCheck", "dilemmas", "growth", "intimate", "custompack"];
  categoryChipsEl.innerHTML = "";
  order.forEach((key) => {
    const meta = CATEGORY_META[key];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (key === selectedCategory ? " selected" : "");
    chip.style.setProperty("--chip-color", meta.color);
    chip.textContent = meta.explicit ? `${meta.emoji} ${meta.label} 🔞` : `${meta.emoji} ${meta.label}`;
    chip.addEventListener("click", () => {
      selectCategoryWithGate(key, () => {
        selectedCategory = key;
        [...categoryChipsEl.children].forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        packPanelEl.classList.toggle("hidden", key !== "custompack");
        if (key === "vote" && Number(maxPlayersSelect.value) < 3) {
          maxPlayersSelect.value = "3";
        }
      });
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

// ---------- Custom packs: load / create ----------
loadPackBtn.addEventListener("click", async () => {
  if (!db) return;
  const code = packCodeInput.value.trim().toUpperCase();
  if (!code) {
    toast("Enter a pack code first.");
    return;
  }
  loadPackBtn.disabled = true;
  loadPackBtn.textContent = "Loading...";
  try {
    const snap = await getDoc(doc(db, "packs", code));
    if (!snap.exists()) {
      packStatusEl.textContent = "Couldn't find that pack code.";
      packStatusEl.classList.remove("ok");
      loadedPack = null;
      return;
    }
    const data = snap.data();
    loadedPack = { code, title: data.title, questions: data.questions };
    packStatusEl.textContent = `✓ Loaded "${data.title}" — ${data.questions.length} questions by ${data.author}`;
    packStatusEl.classList.add("ok");
    ensureReportPackButton();
  } catch (err) {
    console.error(err);
    toast("Couldn't load that pack — try again.");
  } finally {
    loadPackBtn.disabled = false;
    loadPackBtn.textContent = "Load Pack";
  }
});

openPackCreatorBtn.addEventListener("click", () => {
  showScreen("packCreator");
  packSavedPanelEl.classList.add("hidden");
});
packCreatorBackBtn.addEventListener("click", () => {
  showScreen("landing");
});

savePackBtn.addEventListener("click", async () => {
  if (!db) return;
  const title = packTitleInput.value.trim();
  const lines = packQuestionsInput.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!title) {
    toast("Give your pack a title.");
    return;
  }
  if (lines.length < 3) {
    toast("Add at least 3 questions, one per line.");
    return;
  }
  savePackBtn.disabled = true;
  savePackBtn.textContent = "Saving...";
  try {
    const code = await generateUniquePackCode();
    const author = nameInput.value.trim() || "Anonymous";
    await setDoc(doc(db, "packs", code), {
      title,
      author,
      questions: lines,
      createdAt: serverTimestamp(),
    });
    packCodeDisplayEl.textContent = code;
    packSavedPanelEl.classList.remove("hidden");
    packSavedPanelEl._code = code;
    toast("Pack saved!");
  } catch (err) {
    console.error(err);
    toast("Couldn't save the pack — check your Firebase setup.");
  } finally {
    savePackBtn.disabled = false;
    savePackBtn.textContent = "Save Pack";
  }
});

packCopyLinkBtn.addEventListener("click", async () => {
  const url = packShareUrl(packSavedPanelEl._code);
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard API unavailable");
    await navigator.clipboard.writeText(url);
    toast("Link copied!");
  } catch {
    window.prompt("Copy this link:", url);
  }
});

packUseNowBtn.addEventListener("click", async () => {
  const code = packSavedPanelEl._code;
  const pack = {
    code,
    title: packTitleInput.value.trim(),
    questions: packQuestionsInput.value.split("\n").map((l) => l.trim()).filter(Boolean),
  };
  packCodeInput.value = code;
  packStatusEl.textContent = `✓ Loaded "${pack.title}" — ${pack.questions.length} questions by you`;
  packStatusEl.classList.add("ok");
  showScreen("landing");
  if (!requireName()) return;
  createStep.classList.remove("hidden");
  joinStep.classList.add("hidden");
  selectCategoryWithGate("custompack", () => {
    loadedPack = pack;
    selectedCategory = "custompack";
    renderCategoryChips();
    packPanelEl.classList.remove("hidden");
  });
});

// ---------- Create room ----------
createRoomBtn.addEventListener("click", async () => {
  if (!requireName() || !db) return;
  if (selectedCategory === "custompack" && !loadedPack) {
    toast("Load or write a question pack first.");
    return;
  }
  let maxPlayers = Number(maxPlayersSelect.value) || 2;
  if (selectedCategory === "vote" && maxPlayers < 3) {
    toast("Vote Prompts needs at least 3 players — bumped you up to 3.");
    maxPlayers = 3;
    maxPlayersSelect.value = "3";
  }
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = "Creating...";
  try {
    playerId = getPlayerId();
    const conversationMode = conversationModeToggle.checked;

    let code;
    const customCode = customCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
    if (customCode) {
      const existing = await getDoc(doc(db, "rooms", customCode));
      if (existing.exists()) {
        toast("Welcome back — joining your existing room 👋");
        await attemptJoinRoom(customCode);
        return;
      }
      code = customCode;
    } else {
      code = await generateUniqueRoomCode();
    }

    let questions = buildShuffledQuestions(selectedCategory, conversationMode);

if (!questions.length) {
  toast("That pack has no questions — try another.");
  return;
}

const desiredCount = questionCountSelect.value; // "10" | "20" | "30" | "50" | "all"
if (desiredCount !== "all") {
  const n = Number(desiredCount);
  if (n > 0 && n < questions.length) {
    questions = questions.slice(0, n);
  }
}
    const roomDoc = {
      category: selectedCategory,
      conversationMode,
      questions,
      currentIndex: 0,
      maxPlayers,
      hostId: playerId,
      started: false,
      createdAt: serverTimestamp(),
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 
      players: { [playerId]: { name: nameInput.value.trim(), joinedAt: Date.now() } },
      answers: {},
      votes: {},
      typing: {},
    };
    if (selectedCategory === "custompack" && loadedPack) {
      roomDoc.packId = loadedPack.code;
      roomDoc.packTitle = loadedPack.title;
    }
    await setDoc(doc(db, "rooms", code), roomDoc);
    roomId = code;
    playerId = playerId; // Already set above
    saveGameState(code, playerId);
    saveRecentRoom(code, selectedCategory);
    roomCodeDisplayEl.textContent = code;
    showScreen("waiting");
    listenToRoom(code);
    setupPresence(code, playerId);
  } catch (err) {
    console.error(err);
    toast("Couldn't create the room — check your Firebase setup.");
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
  }
});

// ---------- Join room (reusable — also used by Recent Rooms and the
// "welcome back" redirect when creating with a code that already exists) ----------
async function attemptJoinRoom(code) {
  playerId = getPlayerId();
  const ref = doc(db, "rooms", code);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("That room code doesn't exist.");
    return false;
  }
  const data = snap.data();
  const alreadyIn = data.players && data.players[playerId];
  const playerCount = Object.keys(data.players || {}).length;
  const maxPlayers = data.maxPlayers || 2;
  if (!alreadyIn && data.started) {
    toast("That game has already started.");
    return false;
  }
  if (!alreadyIn && playerCount >= maxPlayers) {
    toast(`That room already has ${maxPlayers} players.`);
    return false;
  }
  if (!alreadyIn) {
    const updates = { [`players.${playerId}`]: { name: nameInput.value.trim(), joinedAt: Date.now() } };
    if (maxPlayers === 2 && playerCount + 1 >= 2) {
      updates.started = true;
    }
    await updateDoc(ref, updates);
  }
  roomId = code;
  saveGameState(code, playerId);
  saveRecentRoom(code, data.category);
  listenToRoom(code);
  setupPresence(code, playerId);
  return true;
}

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
    await attemptJoinRoom(code);
  } catch (err) {
    console.error(err);
    toast("Couldn't join the room — check your Firebase setup.");
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = "Join Room";
  }
});

// ---------- Start Game (group / vote rooms only) ----------
startGameBtn.addEventListener("click", async () => {
  if (!currentRoomData || !roomId) return;
  const playerCount = Object.keys(currentRoomData.players || {}).length;
  if (playerCount < 2) {
    toast("Need at least 2 players to start.");
    return;
  }
  try {
    await updateDoc(doc(db, "rooms", roomId), { started: true });
  } catch (err) {
    console.error(err);
    toast("Couldn't start the game — try again.");
  }
});

// ---------- Realtime Database presence ----------
function setupPresence(code, id) {
  if (!rtdb || !rtdbApi) return;
  if (unsubscribePresence) unsubscribePresence();

  const { ref, onValue, onDisconnect, set: rtdbSet, serverTimestamp: rtdbServerTimestamp } = rtdbApi;

  const myPresenceRef = ref(rtdb, `presence/${code}/${id}`);
  const connectedRef = ref(rtdb, ".info/connected");
  const stopConnListener = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(myPresenceRef)
      .set({ online: false, lastSeen: rtdbServerTimestamp() })
      .then(() => {
        rtdbSet(myPresenceRef, { online: true, lastSeen: rtdbServerTimestamp() });
      })
      .catch(() => {});
  });

  const roomPresenceRef = ref(rtdb, `presence/${code}`);
  const stopPresenceListener = onValue(roomPresenceRef, (snap) => {
    presenceData = snap.val() || {};
    if (currentRoomData) render(currentRoomData);
  });

  unsubscribePresence = () => {
    stopConnListener();
    stopPresenceListener();
    rtdbSet(myPresenceRef, { online: false, lastSeen: rtdbServerTimestamp() }).catch(() => {});
  };
}

// ---------- Realtime listener (Firestore — game state) ----------
function listenToRoom(code) {
  if (unsubscribeRoom) unsubscribeRoom();
  ensureChatUI();
  chatToggleBtn.classList.remove("hidden");
  listenToMessages(code);
  unsubscribeRoom = onSnapshot(
    doc(db, "rooms", code),
    (snap) => {
      if (!snap.exists()) return;
      currentRoomData = snap.data();
      checkForNewReactions(currentRoomData); // Trigger emoji checks
      render(currentRoomData);
    },
    (err) => {
      console.error(err);
      toast("Lost connection to the room.");
    }
  );
}

function render(data) {
  updateChatTypingIndicator(data);
  updateChatOnlineStatus(data);
  const playerIds = sortedPlayerIds(data);
  if (playerIds.length < 2 || !data.started) {
    showScreen("waiting");
    renderWaiting(data, playerIds);
    return;
  }
  if (data.currentIndex >= data.questions.length) {
  renderEnd(data);

  // JOURNAL: Generate post-game reflection (guarded so it only ever fires once)
  if (!data.journalGenerated && !journalGenerationInFlight) {
    journalGenerationInFlight = true;

    const sessionAnswers = [];
    if (data.answers) {
      for (let i = 0; i < Math.min(5, data.questions.length); i++) {
        const answerObj = data.answers[i] || {};
        const answers = Object.values(answerObj);
        sessionAnswers.push(answers.join(" & "));
      }
    }

    const createdMs = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
    const durationMs = Date.now() - createdMs;

    // Mark it immediately so a second Firestore snapshot can't trigger this twice
    updateDoc(doc(db, "rooms", roomId), { journalGenerated: true }).catch(() => {});

    generateJournal(
      data.category || "Connection",
      sessionAnswers,
      durationMs,
      { laughs: 0, deepest: "meaningful conversation" }
    ).then(journalData => {
      journalGenerationInFlight = false;
      if (journalData) {
        displayJournal(journalData);
      }
    }).catch(() => {
      journalGenerationInFlight = false;
    });
  }

  return;
}

  if (data.category === "vote") {
    renderVoteGame(data, playerIds);
  } else {
    renderGame(data, playerIds);
  }
}

function renderWaiting(data, playerIds) {
  roomCodeDisplayEl.textContent = roomId;
  const names = playerIds.map((id) => data.players[id].name + (id === playerId ? " (you)" : ""));
  const isGroup = (data.maxPlayers || 2) > 2;
  waitingPlayersEl.textContent = isGroup
    ? `${playerIds.length}/${data.maxPlayers} joined: ${names.join(", ")}`
    : "";
  const isHost = playerId === data.hostId;
  startGameBtn.classList.toggle("hidden", !(isGroup && isHost && playerIds.length >= 2 && !data.started));
  waitingHintEl.innerHTML = !isGroup
    ? 'Waiting for your person to join<span class="dots"><span>.</span><span>.</span><span>.</span></span>'
    : isHost
    ? "Start when everyone's in, or wait for more people to join."
    : "Waiting for the host to start the game...";
}

function playerDot(id) {
  const presence = presenceData[id];
  if (presence && presence.online === false) return '<span class="dot-offline">⚪</span>';
  return '<span class="dot-online">🟢</span>';
}

function renderPlayersRow(data, playerIds) {
  playersRowEl.innerHTML = playerIds
    .map((id) => {
      const label = escapeHtml(data.players[id].name) + (id === playerId ? " (you)" : "");
      return `<span class="player-tag">${playerDot(id)} ${label}</span>`;
    })
    .join("");
}

function categoryLabel(data) {
  if (data.category === "custompack") {
    return { emoji: "📦", label: data.packTitle || "Custom Pack", color: CATEGORY_META.custompack.color };
  }
  return CATEGORY_META[data.category];
}

// ---------- THE RENDER GAME FUNCTION (With fixed brackets!) ----------
function renderGame(data, sortedIds) {
  showScreen("game");
  const idx = data.currentIndex;

  renderPlayersRow(data, sortedIds);
  answerFormEl.classList.remove("hidden");
  voteFormEl.classList.add("hidden");

  progressTextEl.textContent = (data.conversationMode ? "🌙 " : "") + `${idx + 1} / ${data.questions.length}`;
  const meta = categoryLabel(data);
  applyCardTheme(meta, idx, data.questions.length);
  categoryTagEl.textContent = `${meta.emoji} ${meta.label}`;
  questionNumberEl.textContent = `No. ${String(idx + 1).padStart(3, "0")}`;
  questionTextEl.textContent = data.questions[idx];

  if (idx !== lastAnimatedIndex) {
    questionCardEl.classList.remove("animate");
    void questionCardEl.offsetWidth; 
    questionCardEl.classList.add("animate");
    lastAnimatedIndex = idx;
    answerInput.value = "";
    playShuffleSound();
  }
  updateFavoriteBtn(data.questions[idx]);

  const answersForQ = (data.answers && data.answers[idx]) || {};
  const myAnswer = answersForQ[playerId];
  const othersIds = sortedIds.filter((id) => id !== playerId);
  const iAnswered = myAnswer !== undefined;
  const allAnswered = sortedIds.every((id) => answersForQ[id] !== undefined);
  const waitingOnIds = othersIds.filter((id) => answersForQ[id] === undefined);

  const typingNames = othersIds
    .filter((id) => data.typing && data.typing[id] && answersForQ[id] === undefined)
    .map((id) => data.players[id].name);
  typingIndicatorEl.classList.toggle("hidden", typingNames.length === 0);
  if (typingNames.length) typingIndicatorEl.textContent = `✍️ ${typingNames.join(", ")} typing...`;

  answerFormEl.classList.toggle("hidden", iAnswered);
  waitingForOtherEl.classList.toggle("hidden", !iAnswered || allAnswered || waitingOnIds.length === 0);
  if (iAnswered && !allAnswered && waitingOnIds.length) {
    const names = waitingOnIds.map((id) => data.players[id].name);
    waitingForOtherEl.textContent = `Waiting for ${names.join(", ")} to answer...`;
  }

  revealEl.classList.toggle("hidden", !allAnswered);
  nextBtn.classList.toggle("hidden", !allAnswered);
  exportKeepsakeBtn.classList.toggle("hidden", !allAnswered);
 
  // Inside renderGame, after checking if everyone answered:
  const answers = Object.values(answersForQ);

// Check if they are stalling (short answers or skips)
const isStalling = answers.every(ans => ans.length < 5 || ans === SKIPPED);

if (allAnswered && isStalling) {
    stallCount++;
    console.log(`⚠️ Stalling detected! Count: ${stallCount}/2`, answers);
    if (stallCount >= 2) { // After 2 stale rounds in a row, the AI steps in
        console.log("🚨 STALL THRESHOLD REACHED — Summoning Mediator...");
        autoIntervene(data);
        stallCount = 0; // Reset
    }
} else if (allAnswered) {
    if (stallCount > 0) console.log("✅ Good engagement — stall counter reset");
    stallCount = 0; // They are engaging well, reset the counter
}

// Private nudge — only shown on THIS player's own screen, never synced
// anywhere, never visible to the other player. Catches the asymmetric
// case (one person brief, the other genuinely engaged) that the shared
// mediator deliberately does NOT trigger on, so it never becomes a
// shared "gotcha" moment. Each client independently checks its own
// player's answer, so nothing about this is transmitted or shared.
if (allAnswered) {
  const myAnswer = answersForQ[playerId];
  const iWasBrief = myAnswer === SKIPPED || (typeof myAnswer === "string" && myAnswer.trim().length < 8);
  const othersEngaged = othersIds.some((id) => {
    const a = answersForQ[id];
    return a !== SKIPPED && typeof a === "string" && a.trim().length >= 25;
  });
  if (iWasBrief && othersEngaged) {
    briefNudgeStreak++;
    if (briefNudgeStreak >= 2) {
      const partnerName = othersIds.length ? data.players[othersIds[0]].name : "they";
      toast(`${partnerName} is really opening up, maybe give a little more next round 💭`);
      briefNudgeStreak = 0;
    }
  } else {
    briefNudgeStreak = 0;
  }
}

  if (allAnswered) {
    const reactionsForQ = (data.reactions && data.reactions[idx]) || {};

    revealListEl.innerHTML = sortedIds
      .map((id) => {
        const isMe = id === playerId;
        const label = isMe ? "You" : escapeHtml(data.players[id].name);
        const raw = answersForQ[id];
        const shown = raw === SKIPPED ? '<span class="skipped">Skipped this one</span>' : escapeHtml(raw);
        
        let reactionHTML = '';
        if (!isMe && raw !== SKIPPED) {
            const targetReactions = reactionsForQ[id] || {};
            const myReact = targetReactions[playerId];

            reactionHTML = `
            <div class="reaction-bar" id="reaction-bar-${id}">
                <button class="reaction-btn ${myReact === '❤️' ? 'active' : ''}" onclick="window.castReaction(${idx}, '${id}', '❤️', event)">❤️</button>
                <button class="reaction-btn ${myReact === '😂' ? 'active' : ''}" onclick="window.castReaction(${idx}, '${id}', '😂', event)">😂</button>
                <button class="reaction-btn ${myReact === '😮' ? 'active' : ''}" onclick="window.castReaction(${idx}, '${id}', '😮', event)">😮</button>
            </div>
            `;
        }

        return `<div class="answer-bubble ${isMe ? "me" : "them"}" id="bubble-${id}"><span class="bubble-label">${label}</span><p>${shown}</p>${reactionHTML}</div>`;
      })
      .join("");

    if (idx !== lastRevealedIndex) {
      lastRevealedIndex = idx;
      playRevealSound();
      revealQuoteEl.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    }

    if (idx !== celebratedIndex && MILESTONES.includes(idx + 1)) {
      celebratedIndex = idx;
      toast(`🎉 ${idx + 1} questions in — nice streak!`);
      fireConfetti();
    }
  }
} // <--- THIS WAS THE MISSING BRACKET THAT FROZE THE APP!

// ---------- Vote mode ----------
function renderVoteGame(data, sortedIds) {
  showScreen("game");
  const idx = data.currentIndex;

  renderPlayersRow(data, sortedIds);
  answerFormEl.classList.add("hidden");
  voteFormEl.classList.remove("hidden");
  typingIndicatorEl.classList.add("hidden");

  progressTextEl.textContent = `${idx + 1} / ${data.questions.length}`;
  const meta = categoryLabel(data);
  applyCardTheme(meta, idx, data.questions.length);
  categoryTagEl.textContent = `${meta.emoji} ${meta.label}`;
  questionNumberEl.textContent = `No. ${String(idx + 1).padStart(3, "0")}`;
  questionTextEl.textContent = data.questions[idx];

  if (idx !== lastAnimatedIndex) {
    questionCardEl.classList.remove("animate");
    void questionCardEl.offsetWidth;
    questionCardEl.classList.add("animate");
    lastAnimatedIndex = idx;
    playShuffleSound();
  }
  updateFavoriteBtn(data.questions[idx]);

  const votesForQ = (data.votes && data.votes[idx]) || {};
  const myVote = votesForQ[playerId];
  const iVoted = myVote !== undefined;
  const allVoted = sortedIds.every((id) => votesForQ[id] !== undefined);
  const waitingOnIds = sortedIds.filter((id) => id !== playerId && votesForQ[id] === undefined);

  voteFormEl.classList.toggle("hidden", iVoted);
  if (!iVoted) {
    voteButtonsEl.innerHTML = "";
    sortedIds
      .filter((id) => id !== playerId)
      .forEach((id) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vote-option";
        btn.textContent = data.players[id].name;
        btn.addEventListener("click", () => castVote(idx, id));
        voteButtonsEl.appendChild(btn);
      });
  }

  waitingForOtherEl.classList.toggle("hidden", !iVoted || allVoted || waitingOnIds.length === 0);
  if (iVoted && !allVoted && waitingOnIds.length) {
    const names = waitingOnIds.map((id) => data.players[id].name);
    waitingForOtherEl.textContent = `Waiting for ${names.join(", ")} to vote...`;
  }

  revealEl.classList.toggle("hidden", !allVoted);
  nextBtn.classList.toggle("hidden", !allVoted);
  if (allVoted) {
    const tally = {};
    sortedIds.forEach((id) => (tally[id] = 0));
    Object.values(votesForQ).forEach((targetId) => {
      if (targetId !== SKIPPED && tally[targetId] !== undefined) tally[targetId] += 1;
    });
    const maxVotes = Math.max(0, ...Object.values(tally));
    const ranked = [...sortedIds].sort((a, b) => tally[b] - tally[a]);

    revealListEl.innerHTML = ranked
      .map((id) => {
        const count = tally[id];
        const pct = maxVotes ? Math.round((count / maxVotes) * 100) : 0;
        const isWinner = count === maxVotes && maxVotes > 0;
        const iVotedForThem = myVote === id;
        return `<div class="tally-row ${isWinner ? "winner" : ""}">
          <div class="tally-top"><span>${escapeHtml(data.players[id].name)}${id === playerId ? " (you)" : ""}</span><span>${count} vote${count === 1 ? "" : "s"}</span></div>
          <div class="tally-bar-track"><div class="tally-bar-fill" style="width:${pct}%"></div></div>
          ${iVotedForThem ? '<p class="tally-you-voted">✓ You voted for them</p>' : ""}
        </div>`;
      })
      .join("");

    if (idx !== lastRevealedIndex) {
      lastRevealedIndex = idx;
      playRevealSound();
      revealQuoteEl.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    }
    if (idx !== celebratedIndex && MILESTONES.includes(idx + 1)) {
      celebratedIndex = idx;
      toast(`🎉 ${idx + 1} questions in — nice streak!`);
      fireConfetti();
    }
  }
}

async function castVote(idx, targetId) {
  if (!currentRoomData || !roomId) return;
  try {
    await updateDoc(doc(db, "rooms", roomId), { [`votes.${idx}.${playerId}`]: targetId });
  } catch (err) {
    console.error(err);
    toast("Couldn't submit your vote — try again.");
  }
}

voteSkipBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const idx = currentRoomData.currentIndex;
  try {
    await updateDoc(doc(db, "rooms", roomId), { [`votes.${idx}.${playerId}`]: SKIPPED });
  } catch (err) {
    console.error(err);
    toast("Couldn't skip — try again.");
  }
});

function renderEnd(data) {
  showScreen("end");
  const total = data.questions.length;
  const sortedIds = sortedPlayerIds(data);

  // Recap maths — at completion every round is fully answered, so
  // "answered together" + "skipped" always sums to the cards drawn.
  let answered = 0;
  let skippedRounds = 0;
  for (let i = 0; i < total; i++) {
    const a = (data.answers && data.answers[i]) || {};
    const vals = sortedIds.map((id) => a[id]);
    const allDefined = vals.every((v) => v !== undefined);
    const anySkip = vals.some((v) => v === SKIPPED);
    if (allDefined && !anySkip) answered++;
    else skippedRounds++;
  }

  // Cards from this deck the player has hearted (global favourites set).
  let favs = 0;
  for (let i = 0; i < total; i++) if (favorites.has(data.questions[i])) favs++;

  // Time spent together, from the room's createdAt timestamp.
  const createdMs = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null;
  const minutes = createdMs ? Math.max(1, Math.round((Date.now() - createdMs) / 60000)) : 0;

  const meta = categoryLabel(data);
  const names = sortedIds.map((id) => data.players[id].name).join("  ·  ");

  // Fill the recap tiles (guarded so a missing node never throws).
  endCountEl.textContent = total;
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  set("end-answered", answered);
  set("end-skipped", skippedRounds);
  set("end-favorites", favs);
  set("end-duration", minutes || "—");
  const subEl = document.getElementById("end-sub");
  if (subEl) subEl.textContent = `${meta.emoji}  ${meta.label}  ·  ${sortedIds.length} of you, ${total} cards deep`;
  const metaEl = document.getElementById("end-meta");
  if (metaEl) metaEl.textContent = names ? `A conversation between ${names}.` : "";

  // The payoff moment — celebrate exactly once per finished deck.
  if (!endCelebrated) {
    endCelebrated = true;
    fireConfetti();
  }
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

favoriteBtn.addEventListener("click", () => {
  if (!currentRoomData) return;
  const text = currentRoomData.questions[currentRoomData.currentIndex];
  if (favorites.has(text)) favorites.delete(text);
  else favorites.add(text);
  saveFavorites();
  updateFavoriteBtn(text);
});

// ---------- Typing indicator ----------
answerInput.addEventListener("input", () => {
  if (!currentRoomData || !roomId || !db) return;
  if (!isTypingFlagged) {
    isTypingFlagged = true;
    updateDoc(doc(db, "rooms", roomId), { [`typing.${playerId}`]: true }).catch(() => {});
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTypingFlagged = false;
    updateDoc(doc(db, "rooms", roomId), { [`typing.${playerId}`]: false }).catch(() => {});
  }, 1500);
});

// ---------- Leave / cancel ----------
leaveRoomBtn.addEventListener("click", leaveRoom);
cancelWaitingBtn.addEventListener("click", leaveRoom);

// ---------- Memory Book ----------
function renderMemoryBook(data) {
  const sortedIds = sortedPlayerIds(data);
  const entries = [];
  let favCount = 0;

  for (let i = 0; i < data.currentIndex; i++) {
    const qText = data.questions[i];
    const isFav = favorites.has(qText);
    const num = String(i + 1).padStart(3, "0");
    const delay = Math.min(i, 14); // cap the stagger so a long book never lags
    const qAttr = escapeHtml(qText).replace(/"/g, "&quot;");
    const favBtn =
      `<button type="button" class="memory-fav-btn${isFav ? " active" : ""}" data-q="${qAttr}" ` +
      `aria-pressed="${isFav}" aria-label="${isFav ? "Remove from favorites" : "Save to favorites"}">${isFav ? "♥" : "♡"}</button>`;
    const head =
      `<header class="memory-entry-head"><span class="index-number">No. ${num}</span>${favBtn}</header>`;

    if (data.category === "vote") {
      const votesForQ = (data.votes && data.votes[i]) || {};
      const complete = sortedIds.every((id) => votesForQ[id] !== undefined);
      if (!complete) continue;
      const tally = {};
      sortedIds.forEach((id) => (tally[id] = 0));
      Object.values(votesForQ).forEach((t) => { if (t !== SKIPPED && tally[t] !== undefined) tally[t] += 1; });
      const winnerId = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      if (isFav) favCount++;
      entries.push(
        `<article class="memory-entry${isFav ? " is-favorite" : ""}" style="--i:${delay}">` + head +
        `<p class="memory-q">${escapeHtml(qText)}</p>` +
        `<div class="memory-answers"><p class="memory-a"><b>Most votes</b>${escapeHtml(data.players[winnerId]?.name || "—")} (${tally[winnerId] || 0})</p></div>` +
        `</article>`
      );
      continue;
    }

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
    if (isFav) favCount++;
    entries.push(
      `<article class="memory-entry${isFav ? " is-favorite" : ""}" style="--i:${delay}">` + head +
      `<p class="memory-q">${escapeHtml(qText)}</p>` +
      `<div class="memory-answers">${answerRows}</div>` +
      `</article>`
    );
  }

  // Header summary — the nodes live in the static section markup (guarded).
  const totalEl = document.getElementById("memory-total");
  const favPillCountEl = document.getElementById("memory-fav-count");
  const allPillCountEl = document.getElementById("memory-all-count");
  const headEl = document.getElementById("memory-head");
  if (totalEl) totalEl.textContent = entries.length;
  if (favPillCountEl) favPillCountEl.textContent = favCount;
  if (allPillCountEl) allPillCountEl.textContent = entries.length;
  if (headEl) headEl.classList.toggle("hidden", entries.length === 0);

  if (entries.length) {
    memoryListEl.innerHTML =
      `<p class="memory-fav-empty hidden">No favorites here yet — tap the ♡ on any memory to keep it close.</p>` +
      entries.join("");
  } else {
    memoryListEl.innerHTML = `<p class="waiting-text">No completed questions yet — answer a few and check back.</p>`;
  }
  syncMemoryFilter(); // re-apply the active filter + sync the empty note
}

memoryToggleBtn.addEventListener("click", () => {
  if (!currentRoomData) return;
  renderMemoryBook(currentRoomData);
  showScreen("memory");
});
memoryBackBtn.addEventListener("click", () => {
  if (currentRoomData) render(currentRoomData);
});
// ---------- Memory Book: in-place favorite toggle + All/Favorites filter ----------
// Pure presentation over the existing `favorites` Set + saveFavorites() — the
// exact same source of truth the in-game heart uses, so the two stay in sync.
// No game state, no Firestore, no renamed selectors.
function currentMemoryFilter() {
  return memoryListEl.dataset.filter === "fav" ? "fav" : "all";
}
function syncMemoryFilter() {
  const filter = currentMemoryFilter();
  const allBtn = document.getElementById("memory-filter-all");
  const favBtn = document.getElementById("memory-filter-fav");
  if (allBtn) allBtn.classList.toggle("active", filter === "all");
  if (favBtn) favBtn.classList.toggle("active", filter === "fav");
  const note = memoryListEl.querySelector(".memory-fav-empty");
  if (note) {
    const favVisible = memoryListEl.querySelectorAll(".memory-fav-btn.active").length;
    note.classList.toggle("hidden", !(filter === "fav" && favVisible === 0));
  }
}
function setMemoryFilter(filter) {
  memoryListEl.dataset.filter = filter;
  syncMemoryFilter();
}
memoryListEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".memory-fav-btn");
  if (!btn) return;
  const q = btn.dataset.q;
  if (!q) return;
  const nowFav = !favorites.has(q);
  if (nowFav) favorites.add(q); else favorites.delete(q);
  saveFavorites();
  btn.classList.toggle("active", nowFav);
  btn.setAttribute("aria-pressed", String(nowFav));
  btn.setAttribute("aria-label", nowFav ? "Remove from favorites" : "Save to favorites");
  btn.textContent = nowFav ? "♥" : "♡";
  const entry = btn.closest(".memory-entry");
  if (entry) entry.classList.toggle("is-favorite", nowFav);
  const favPillCountEl = document.getElementById("memory-fav-count");
  if (favPillCountEl) favPillCountEl.textContent = memoryListEl.querySelectorAll(".memory-fav-btn.active").length;
  syncMemoryFilter();
  btn.classList.remove("bounce"); void btn.offsetWidth; btn.classList.add("bounce"); // tactile pop
});
const memoryFilterAllBtn = document.getElementById("memory-filter-all");
const memoryFilterFavBtn = document.getElementById("memory-filter-fav");
if (memoryFilterAllBtn) memoryFilterAllBtn.addEventListener("click", () => setMemoryFilter("all"));
if (memoryFilterFavBtn) memoryFilterFavBtn.addEventListener("click", () => setMemoryFilter("fav"));

// ---------- Pack Creator: live question counter + live preview ----------
// Reads the textarea only — never touches savePackBtn's validation or Firestore.
function updatePackPreview() {
  const lines = packQuestionsInput.value.split("\n").map((l) => l.trim()).filter(Boolean);
  const n = lines.length;
  const countEl = document.getElementById("pack-question-count");
  const previewEl = document.getElementById("pack-preview");
  if (countEl) {
    countEl.textContent = n === 0 ? "No questions yet" : `${n} question${n === 1 ? "" : "s"} detected`;
    countEl.classList.toggle("ok", n >= 3);
    countEl.classList.toggle("warn", n > 0 && n < 3);
  }
  if (previewEl) {
    if (n === 0) {
      previewEl.classList.add("hidden");
      previewEl.innerHTML = "";
    } else {
      previewEl.classList.remove("hidden");
      previewEl.innerHTML =
        `<p class="pack-preview-title">Preview</p>` +
        lines.slice(0, 3).map((q) => `<p class="pack-preview-q">• ${escapeHtml(q)}</p>`).join("") +
        (n > 3 ? `<p class="pack-preview-more">+ ${n - 3} more</p>` : "");
    }
  }
}
packQuestionsInput.addEventListener("input", updatePackPreview);
updatePackPreview();

// ---------- Next question ----------
nextBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const ref = doc(db, "rooms", roomId);
  const myIdx = currentRoomData.currentIndex;
  
  try {
    // If there's a pending mediator question, insert it now
    if (pendingMediatorQuestion) {
      console.log("🤖 Injecting pending mediator question into next position");
      const nextIndex = myIdx + 1;
      const newQuestions = [...currentRoomData.questions];
      
      // Insert the mediator question at the next index
      newQuestions.splice(nextIndex, 0, pendingMediatorQuestion);
      
      console.log("🤖 Question injected, clearing pending queue");
      pendingMediatorQuestion = null;
      
      // Update database with new questions array
      await updateDoc(ref, { 
        questions: newQuestions,
        currentIndex: nextIndex
      });
    } else {
      // Normal flow - just advance to next question
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (data.currentIndex === myIdx) {
          tx.update(ref, { currentIndex: myIdx + 1 });
        }
      });
    }
  } catch (err) {
    console.error(err);
  }
});

// ---------- Play again ----------
playAgainBtn.addEventListener("click", async () => {
  if (!currentRoomData) return;
  const newQuestions = buildShuffledQuestions(currentRoomData.category, currentRoomData.conversationMode);
  lastAnimatedIndex = -1;
  lastRevealedIndex = -1;
  celebratedIndex = -1;
  endCelebrated = false;
  try {
    await updateDoc(doc(db, "rooms", roomId), { questions: newQuestions, currentIndex: 0, answers: {}, votes: {} });
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
    window.prompt("Copy this link:", url);
  }
});
whatsappBtn.addEventListener("click", () => {
  const text = encodeURIComponent(`Play a question game with me 👀 ${shareUrl()}`);
  window.open(`https://wa.me/?text=${text}`, "_blank");
});

// ---------- Theme ----------
themeToggleBtn.addEventListener("click", () => {
  const isLight = document.body.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  themeToggleBtn.textContent = next === "light" ? "🌙" : "☀️";
  localStorage.setItem("bu_theme", next);
});

soundToggleBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";
  localStorage.setItem("bu_sound", soundEnabled ? "on" : "off");
  if (soundEnabled) getAudioCtx();
});

// ---------- Init ----------
async function init() {
  renderCategoryChips();
  ensureDeckBuilderButton();
  
  // Try to restore active game first (if user refreshed mid-game)
  if (await restoreGameState()) {
    return; // Game state restored, no need to show landing page
  }

  renderRecentRoomsSection();

  const savedTheme = localStorage.getItem("bu_theme");
  if (savedTheme === "light") {
    document.body.setAttribute("data-theme", "light");
    themeToggleBtn.textContent = "🌙";
  }
  soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";

  if (CONFIG_MISSING) {
    configWarningEl.classList.remove("hidden");
    showCreateBtn.disabled = true;
    showJoinBtn.disabled = true;
  }

  const params = new URLSearchParams(location.search);
  const prefillRoom = params.get("room");
  const prefillPack = params.get("pack");
  if (prefillRoom) {
    joinCodeInput.value = prefillRoom.toUpperCase();
    toast("Room code filled in — add your name and tap Join a Room");
  } else if (prefillPack && db) {
    try {
      const snap = await getDoc(doc(db, "packs", prefillPack.toUpperCase()));
      if (snap.exists()) {
        const data = snap.data();
        const pack = { code: prefillPack.toUpperCase(), title: data.title, questions: data.questions };
        packCodeInput.value = prefillPack.toUpperCase();
        packStatusEl.textContent = `✓ Loaded "${data.title}" — ${data.questions.length} questions by ${data.author}`;
        packStatusEl.classList.add("ok");
        ensureReportPackButton();
        toast("Pack loaded — type your name and create a room");
        selectCategoryWithGate("custompack", () => {
          loadedPack = pack;
          selectedCategory = "custompack";
          renderCategoryChips();
          packPanelEl.classList.remove("hidden");
        });
      }
    } catch (err) {
      console.error(err);
    }
  }
}

init();

// ---------- Reactions Logic & Animation ----------
let knownReactions = {}; 

window.castReaction = async function(idx, targetId, emoji, event) {
  if (!currentRoomData || !roomId) return;
  
  spawnFloatingReaction(emoji, event.clientX, event.clientY);

  try {
    await updateDoc(doc(db, "rooms", roomId), { 
        [`reactions.${idx}.${targetId}.${playerId}`]: emoji 
    });
  } catch (err) {
    console.error(err);
    toast("Couldn't send reaction.");
  }
};

function spawnFloatingReaction(emoji, x, y) {
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (x - 20) + 'px';
    el.style.top = (y - 20) + 'px';
    document.body.appendChild(el);
    
    setTimeout(() => el.remove(), 1500);
}

function checkForNewReactions(data) {
    if (!data.started || !data.reactions) return;
    const idx = data.currentIndex;
    const currentReactions = data.reactions[idx] || {};
    
    const myReactions = currentReactions[playerId] || {};
    
    Object.entries(myReactions).forEach(([reactorId, emoji]) => {
        const uniqueKey = `${idx}-${reactorId}-${emoji}`;
        if (!knownReactions[uniqueKey]) {
            knownReactions[uniqueKey] = true;
            
            const myBubble = document.getElementById(`bubble-${playerId}`);
            if (myBubble && reactorId !== playerId) {
                const rect = myBubble.getBoundingClientRect();
                spawnFloatingReaction(emoji, rect.left + (rect.width / 2), rect.top);
            }
        }
    });
}

// ---------- Keepsake Export Logic ----------
// Shared keepsake capture — used by both the in-game and the end-screen
// "Save as Image" buttons. Hides only the controls you don't want in the
// photo, snaps #app at 2×, then restores everything exactly as it was.
// Pure presentation: no game state, no Firestore, no logic touched.
async function captureAppAsImage(triggerBtn, hideEls) {
  triggerBtn.disabled = true;
  const originalLabel = triggerBtn.textContent;
  triggerBtn.textContent = "Snapping... 📸";
  const saved = hideEls.map((node) => ({ node, display: node.style.display }));
  saved.forEach(({ node }) => { node.style.display = "none"; });
  try {
    const canvas = await html2canvas(el("app"), {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      scale: 2,
      useCORS: true,
    });
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `BetweenUs-Memory-${Math.floor(Math.random() * 10000)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Image saved to your device! 📸");
  } catch (err) {
    console.error("Export failed:", err);
    toast("Couldn't save the image right now.");
  } finally {
    saved.forEach(({ node, display }) => { node.style.display = display; });
    triggerBtn.disabled = false;
    triggerBtn.textContent = originalLabel;
  }
}
exportKeepsakeBtn.addEventListener("click", () =>
  captureAppAsImage(exportKeepsakeBtn, [nextBtn, exportKeepsakeBtn, leaveRoomBtn])
);
exportKeepsakeBtnEnd.addEventListener("click", () =>
  captureAppAsImage(exportKeepsakeBtnEnd, [playAgainBtn, exportKeepsakeBtnEnd])
);

async function autoIntervene(data) {
    // 1. Only run if we haven't already created a pending mediator question
    if (pendingMediatorQuestion) {
        console.log("🤖 Mediator: Already have a pending question, skipping.");
        return;
    }

    if (!MEDIATOR_BACKEND_URL || MEDIATOR_BACKEND_URL.includes("YOUR-PROJECT")) {
        console.warn("⚠️ Mediator: MEDIATOR_BACKEND_URL is not configured yet.");
        return;
    }

    // 2. Build the context to send to our backend
    const idx = data.currentIndex;
    const question = data.questions[idx];
    const answers = Object.values(data.answers[idx] || {});

    console.log("🤖 ════════════════════════════════════");
    console.log("🤖 MEDIATOR WORKING IN BACKGROUND");
    console.log("🤖 ════════════════════════════════════");
    console.log("🤖 Question:", question);
    console.log("🤖 Answers:", answers);

    try {
        console.log("🤖 → Calling backend to generate question...");
        const response = await fetch(MEDIATOR_BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, answers })
        });

        console.log("🤖 ← Backend responded with HTTP", response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("🤖 ❌ Backend error:", response.status, errorData);
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success || !result.bridgeQuestion) {
            console.error("🤖 ❌ Invalid response:", result);
            throw new Error("Invalid response from mediator backend");
        }

        const aiQuestion = result.bridgeQuestion.trim();
        
        if (!aiQuestion) {
            console.error("🤖 ❌ Empty question");
            throw new Error("Bridge question is empty");
        }

        // 3. STORE the question - don't display yet!
        pendingMediatorQuestion = aiQuestion;
        
        console.log("🤖 ════════════════════════════════════");
        console.log("🤖 ✅ QUESTION GENERATED & STORED");
        console.log("🤖 ════════════════════════════════════");
        console.log("🤖 Question ready for next card:");
        console.log("🤖 " + aiQuestion);
        console.log("🤖 (Will display when player clicks 'Draw Next Card')");
        
    } catch (e) {
        console.error("🤖 ❌ Mediator failed:", e.message);
        toast("Couldn't reach the mediator — check the backend deploy.");
        pendingMediatorQuestion = null; // Reset on error
    }
}

// Add these functions to your app.js

// Configuration - UPDATE THIS with your Vercel URL
const JOURNAL_API_URL = "https://between-us-backend.vercel.app/api/journal";

// Generate journal after game ends
async function generateJournal(category, answers, duration, sessionStats) {
  console.log("📖 Generating relationship journal...");
  
  try {
    const response = await fetch(JOURNAL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        answers,
        duration,
        sessionStats
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Journal API error:", errorData);
      return null;
    }

    const data = await response.json();
    
    if (data.success && data.journalEntry) {
      console.log("✅ Journal generated:", data.journalEntry);
      return data;
    }
  } catch (error) {
    console.error("❌ Failed to generate journal:", error);
  }
  
  return null;
}

// Display journal in a beautiful modal
function displayJournal(journalData) {
  if (!journalData) return;
  const modal = document.createElement("div");
  modal.className = "journal-modal";
  modal.innerHTML = `
    <div class="journal-container">
      <div class="journal-header">
        <h2>✨ Your Moment</h2>
        <button class="journal-close" onclick="this.closest('.journal-modal').remove()" aria-label="Close">×</button>
      </div>
      <div class="journal-content">
        <div class="journal-category">${escapeHtml(journalData.category)}</div>
        <p class="journal-text">${escapeHtml(journalData.journalEntry)}</p>
        <div class="journal-meta">
          <span>${journalData.duration} minutes</span>
          <span>${new Date(journalData.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="journal-actions">
        <button class="journal-btn primary" onclick="saveJournal('${journalData.category}', '${journalData.timestamp}', '${journalData.journalEntry.replace(/'/g, "\\'")}')">💾 Save Entry</button>
        <button class="journal-btn secondary" onclick="exportJournal('${journalData.category}', '${journalData.journalEntry.replace(/'/g, "\\'")}')">📥 Export</button>
        <button class="journal-btn secondary" onclick="this.closest('.journal-modal').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

// Journal styles are now in style.css using CSS variables.
// No more hardcoded purple/white injection.

// Save journal to Firebase
async function saveJournal(category, timestamp, entry) {
  if (!roomId || !playerId) return;

  try {
    const journalRef = doc(db, "rooms", roomId, "journals", timestamp);
    await setDoc(journalRef, {
      category,
      entry,
      timestamp,
      savedBy: playerId,
      createdAt: new Date()
    });
    
    console.log("✅ Journal saved to Firebase");
    toast("Entry saved to your memory book");
  } catch (error) {
    console.error("Failed to save journal:", error);
    toast("Failed to save entry");
  }
}

// Export journal as markdown
function exportJournal(category, entry) {
  const markdown = `# ${category}

${entry}

---
Generated: ${new Date().toLocaleString()}
Between Us - Relationship Journal
  `;

  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `between-us-${category}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// Expose to window since these are invoked from inline onclick="" attributes
// in the journal modal HTML — those run in global scope, and this file is a
// module, so top-level functions are NOT automatically attached to window.
window.saveJournal = saveJournal;
window.exportJournal = exportJournal;

// CSS Styles - Add to your stylesheet or <head>
// Journal modal styles — design-system (CSS variables), injected at runtime
// exactly like the chat / capsule / age-gate / deck-builder modals, so the
// journal themes correctly in BOTH dark and light mode. (The old hardcoded
// #667eea / white sheet that used to live here is gone.)
const journalStyles = `
<style>
.journal-modal {
  position: fixed; inset: 0;
  background: rgba(20, 18, 14, 0.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 1100; padding: 20px;
  backdrop-filter: blur(6px) saturate(120%); -webkit-backdrop-filter: blur(6px) saturate(120%);
  animation: journal-backdrop-in 0.25s ease-out;
}
@keyframes journal-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
.journal-container {
  background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 30%, rgba(0,0,0,0.015) 100%), var(--card, #f6efe1);
  color: var(--on-card, #241c30);
  border: 1px solid var(--border-card, rgba(36,28,48,0.08));
  border-radius: 22px; max-width: 500px; width: 100%; padding: 30px 26px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.03);
  animation: journal-modal-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes journal-modal-in { from { opacity: 0; transform: scale(0.94) translateY(12px); } to { opacity: 1; transform: none; } }
.journal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-card, rgba(36,28,48,0.1)); }
.journal-header h2 { margin: 0; font-family: var(--font-display, 'Fraunces', serif); font-size: 1.5rem; font-weight: 550; letter-spacing: -0.01em; font-optical-sizing: auto; }
.journal-close { background: none; border: none; font-size: 26px; cursor: pointer; color: var(--on-card-soft, #6b5f78); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 999px; transition: background 0.2s ease, color 0.2s ease; }
.journal-close:hover { background: rgba(0,0,0,0.05); color: var(--on-card, #241c30); }
.journal-content { margin-bottom: 8px; }
.journal-category { display: inline-block; background: var(--gold, #c9a15a); color: #241c30; padding: 6px 14px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 14px; font-family: var(--font-mono, 'IBM Plex Mono', monospace); }
.journal-text { font-family: var(--font-display, 'Fraunces', serif); font-style: italic; font-size: 1.05rem; line-height: 1.65; margin: 14px 0; padding: 18px 20px; background: var(--card-2, #fffaf1); color: var(--on-card, #241c30); border-left: 3px solid var(--garnet, #9c3348); border-radius: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); font-optical-sizing: auto; }
.journal-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--on-card-soft, #6b5f78); font-family: var(--font-mono, 'IBM Plex Mono', monospace); letter-spacing: 0.04em; padding-top: 6px; }
.journal-actions { display: flex; gap: 12px; margin-top: 22px; flex-wrap: wrap; }
.journal-btn { flex: 1; min-width: 120px; padding: 14px; border-radius: 12px; border: none; font-weight: 600; cursor: pointer; font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif); font-size: 0.95rem; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, filter 0.15s ease; }
.journal-btn:active { transform: translateY(2px) scale(0.97); }
.journal-btn.primary { background: var(--gold, #c9a15a); color: #241c30; box-shadow: 0 2px 0 var(--garnet, #9c3348), 0 6px 16px rgba(156, 51, 72, 0.22); }
.journal-btn.primary:active { box-shadow: 0 0 0 var(--garnet, #9c3348); filter: brightness(0.97); }
.journal-btn.secondary { background: var(--card-2, #fffaf1); color: var(--on-card, #241c30); border: 1px solid var(--border-card, rgba(36,28,48,0.12)); box-shadow: 0 2px 0 var(--border-card, rgba(36,28,48,0.12)), 0 4px 12px rgba(36, 28, 48, 0.05); }
.journal-btn.secondary:active { box-shadow: 0 0 0 var(--border-card, rgba(36,28,48,0.12)); filter: brightness(0.98); }
@media (hover: hover) and (pointer: fine) {
  .journal-btn.primary:hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 3px 0 var(--garnet, #9c3348), 0 10px 22px rgba(156, 51, 72, 0.30); }
  .journal-btn.secondary:hover { transform: translateY(-1px); box-shadow: 0 3px 0 var(--border-card, rgba(36,28,48,0.12)), 0 8px 18px rgba(36, 28, 48, 0.10); }
}
@media (prefers-reduced-motion: reduce) { .journal-modal, .journal-container { animation: none !important; } }
</style>
`;


// Insert styles into document
if (!document.querySelector("style[data-journal]")) {
  const styleTag = document.createElement("style");
  styleTag.setAttribute("data-journal", "true");
  styleTag.textContent = journalStyles.replace(/<\/?style>/g, "");
  document.head.appendChild(styleTag);
}

// ====== Visual & Animation Enhancements ======
// These power the category-colored card glow and the animated progress bar.
// (This is the piece that was missing — applyCardTheme was being called
// above in renderGame/renderVoteGame but was never defined, which crashed
// every render with a ReferenceError. That's what caused the blank card
// and the frozen Submit/Skip buttons.)

function ensureProgressBar() {
  if (document.getElementById("progress-track")) return;
  const track = document.createElement("div");
  track.id = "progress-track";
  track.className = "progress-track";
  track.innerHTML = '<div id="progress-fill" class="progress-fill"></div>';
  progressTextEl.insertAdjacentElement("afterend", track);
}

function applyCardTheme(meta, idx, total) {
  ensureProgressBar();
  questionCardEl.style.setProperty("--accent", meta.color);
  categoryTagEl.style.setProperty("--stamp", meta.color);
  const fill = document.getElementById("progress-fill");
  if (fill) {
    const pct = total ? Math.round(((idx + 1) / total) * 100) : 0;
    fill.style.width = pct + "%";
    fill.style.background = meta.color;
    fill.classList.remove("pulse");
    void fill.offsetWidth;
    fill.classList.add("pulse");
  }
}

// ====== Content Safety: 18+ gate & pack reporting ======

const EXPLICIT_AGE_KEY = "bu_ageConfirmed18";

function showAgeGateModal(onConfirm, message) {
  injectAgeGateStyles();
  const overlay = document.createElement("div");
  overlay.className = "agegate-overlay";
  const text = message || "This category includes sexually explicit questions written for consenting adults. You must be 18 or older to continue.";
  overlay.innerHTML = `
    <div class="agegate-modal">
      <p class="agegate-icon">🔞</p>
      <h3 class="agegate-title">18+ Content</h3>
      <p class="agegate-text">${text}</p>
      <div class="agegate-actions">
        <button class="btn btn-primary agegate-continue-btn" type="button">I'm 18+ — Continue</button>
        <button class="btn btn-secondary agegate-back-btn" type="button">Go Back</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".agegate-back-btn").addEventListener("click", close);
  overlay.querySelector(".agegate-continue-btn").addEventListener("click", () => {
    localStorage.setItem(EXPLICIT_AGE_KEY, "true");
    close();
    onConfirm();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// Single source of truth for the 18+ check — every path that can select a
// gated category (chip clicks, write-your-own-pack, shared pack links, and
// the AI deck builder) routes through this instead of duplicating the check.
function selectCategoryWithGate(key, onSelected) {
  if (!isCategoryExplicit(key) || localStorage.getItem(EXPLICIT_AGE_KEY) === "true") {
    onSelected();
    return;
  }
  const message = key === "custompack"
    ? "Custom packs are written by players and aren't reviewed — they may include mature or explicit content. You must be 18 or older to continue."
    : undefined;
  showAgeGateModal(onSelected, message);
}

function injectAgeGateStyles() {
  if (document.getElementById("agegate-styles")) return;
  const style = document.createElement("style");
  style.id = "agegate-styles";
  style.textContent = `
    .agegate-overlay { 
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.65); 
      display: flex; align-items: center; justify-content: center; 
      z-index: 1100; padding: 20px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: agegate-backdrop-in 0.25s ease-out;
    }
    @keyframes agegate-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    
    .agegate-modal { 
      background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 30%, rgba(0,0,0,0.015) 100%), var(--card, #f6efe1); 
      color: var(--on-card, #241c30); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.08));
      border-radius: 22px; max-width: 380px; width: 100%; padding: 32px 26px; text-align: center; 
      box-shadow: 0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.03); 
      font-family: 'Plus Jakarta Sans', sans-serif; 
      animation: agegate-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); 
    } 
    @keyframes agegate-in { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } } 
    
    .agegate-icon { font-size: 42px; margin: 0 0 12px; } 
    .agegate-title { margin: 0 0 10px; font-size: 22px; font-family: 'Fraunces', serif; font-weight: 500; letter-spacing: -0.01em; font-optical-sizing: auto; } 
    .agegate-text { font-size: 14.5px; line-height: 1.55; opacity: 0.8; margin: 0 0 24px; font-family: 'Plus Jakarta Sans', sans-serif; } 
    .agegate-actions { display: flex; flex-direction: column; gap: 10px; }
    
    /* Re-use the main app's button styles for the age gate */
    .agegate-actions .btn { margin-bottom: 0; }
  `;
  document.head.appendChild(style);
}

// ---------- Pack reporting ----------
function ensureReportPackButton() {
  if (document.getElementById("report-pack-btn")) return;
  const btn = document.createElement("button");
  btn.id = "report-pack-btn";
  btn.type = "button";
  btn.className = "leave-link report-pack-link";
  btn.textContent = "🚩 Report this pack";
  packStatusEl.insertAdjacentElement("afterend", btn);
  btn.addEventListener("click", reportCurrentPack);
}

async function reportCurrentPack() {
  if (!loadedPack || !db) return;
  const btn = document.getElementById("report-pack-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Reporting...";
  }
  try {
    await setDoc(doc(db, "packReports", `${loadedPack.code}_${Date.now()}`), {
      packCode: loadedPack.code,
      packTitle: loadedPack.title || "",
      reportedAt: serverTimestamp(),
      reportedBy: playerId || "anonymous",
    });
    toast("Thanks — this pack has been flagged for review.");
    if (btn) btn.textContent = "✓ Reported";
  } catch (err) {
    console.error("Couldn't submit pack report:", err);
    toast("Couldn't submit the report — try again.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚩 Report this pack";
    }
  }
}

// ====== Conversation Mode — live chat inside a room ======
// Built as an overlay (like the journal/age-gate modals) so it can open on
// top of Waiting, Game, or End without disturbing whatever's underneath.
// Messages live in a Firestore subcollection: rooms/{roomId}/messages/{id}

// ---------- Build the UI once ----------
function ensureChatUI() {
  if (chatOverlayEl) return;
  if (!memoryToggleBtn) {
    console.warn("Chat UI: memoryToggleBtn not found yet, deferring...");
    return;
  }
  injectChatStyles();
  injectCapsuleStyles();

  chatToggleBtn = document.createElement("button");
  chatToggleBtn.id = "chat-toggle-btn";
  chatToggleBtn.type = "button";
  chatToggleBtn.className = "memory-toggle chat-toggle hidden";
  chatToggleBtn.setAttribute("aria-label", "Open chat");
  chatToggleBtn.innerHTML = '💬<span id="chat-badge" class="chat-badge hidden"></span>';
  memoryToggleBtn.insertAdjacentElement("afterend", chatToggleBtn);
  chatToggleBtn.addEventListener("click", openChatOverlay);

  chatOverlayEl = document.createElement("div");
  chatOverlayEl.id = "chat-overlay";
  chatOverlayEl.className = "chat-overlay hidden";
  chatOverlayEl.innerHTML = `
    <div class="chat-panel">
      <div class="chat-sheet-handle" aria-hidden="true"></div>
      <div class="chat-header">
        <div class="chat-header-identity">
          <span class="chat-header-title">Between Us</span>
          <span id="chat-header-subtitle" class="chat-header-subtitle">Our little corner</span>
        </div>
        <div class="chat-header-actions">
          <button type="button" id="capsule-open-btn" class="chat-header-icon-btn" aria-label="Seal a time capsule">🔒</button>
          <button type="button" id="chat-close-btn" class="chat-close-btn" aria-label="Close chat">×</button>
        </div>
      </div>
      <div id="chat-messages" class="chat-messages"></div>
      <div id="chat-context-menu" class="chat-context-menu hidden" role="menu"></div>
      <p id="chat-typing-indicator" class="typing-indicator hidden"></p>
      <form id="chat-form" class="chat-form">
        <textarea id="chat-input" rows="1" maxlength="500" placeholder="Type a message..."></textarea>
        <button type="button" id="chat-voice-btn" class="chat-voice-btn" aria-label="Hold to record a voice note">🎤</button>
        <button type="submit" id="chat-send-btn" class="chat-send-btn" aria-label="Send" disabled>➤</button>
      </form>
    </div>
  `;
  document.body.appendChild(chatOverlayEl);

  chatMessagesEl = document.getElementById("chat-messages");
  chatInputEl = document.getElementById("chat-input");
  chatTypingIndicatorEl = document.getElementById("chat-typing-indicator");
  chatSendBtn = document.getElementById("chat-send-btn");

  document.getElementById("chat-close-btn").addEventListener("click", closeChatOverlay);
  document.getElementById("capsule-open-btn").addEventListener("click", openCapsuleComposer);
  ensureCapsuleUI();
  startCapsuleWatcher();
  chatOverlayEl.addEventListener("click", (e) => {
    if (e.target === chatOverlayEl) closeChatOverlay();
  });

  chatMessagesEl.addEventListener("click", (e) => {
    if (suppressNextBubbleClick) {
      suppressNextBubbleClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleChatAction(e);
  });
  attachBubbleLongPress();

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInputEl.value;
    if (!text.trim()) return;
    sendChatMessage(text);
    chatInputEl.value = "";
    stopChatTyping();
    updateChatSendState();
    autoGrowChatInput();
  });
  chatInputEl.addEventListener("input", () => {
    handleChatTypingInput();
    updateChatSendState();
    autoGrowChatInput();
  });

  const voiceBtn = document.getElementById("chat-voice-btn");
  if (navigator.mediaDevices && window.MediaRecorder) {
    voiceBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    voiceBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startVoiceRecording();
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
      voiceBtn.addEventListener(evt, stopVoiceRecording)
    );
  } else {
    voiceBtn.classList.add("hidden");
  }

  // Keep the sheet's true height in sync with the visual viewport so the
  // mobile keyboard pushes the panel up instead of covering the composer.
  // Purely presentational — no chat/game logic depends on this.
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncChatOverlayViewport);
    window.visualViewport.addEventListener("scroll", syncChatOverlayViewport);
  }

  setupSheetDragToDismiss();
}

// Native-feeling "drag the handle down to close" gesture. Scoped to the
// handle only so it never competes with scrolling the message list or
// tapping the header buttons. Purely presentational on top of the existing
// closeChatOverlay()/openChatOverlay() functions — no new state is stored.
function setupSheetDragToDismiss() {
  const panel = chatOverlayEl.querySelector(".chat-panel");
  const handle = chatOverlayEl.querySelector(".chat-sheet-handle");
  if (!panel || !handle) return;

  let dragging = false;
  let startY = 0;
  let dragDistance = 0;
  const dismissThreshold = 90;

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    startY = e.clientY;
    panel.style.transition = "none";
    handle.setPointerCapture?.(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dragDistance = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dragDistance}px)`;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dragDistance > dismissThreshold) closeChatOverlay();
    dragDistance = 0;
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function autoGrowChatInput() {
  if (!chatInputEl) return;
  chatInputEl.style.height = "auto";
  chatInputEl.style.height = `${Math.min(chatInputEl.scrollHeight, 100)}px`;
}

function syncChatOverlayViewport() {
  if (!chatOverlayEl || !window.visualViewport) return;
  const vv = window.visualViewport;
  chatOverlayEl.style.height = `${vv.height}px`;
  chatOverlayEl.style.top = `${vv.offsetTop}px`;
}

function updateChatSendState() {
  if (!chatSendBtn || !chatInputEl) return;
  chatSendBtn.disabled = !chatInputEl.value.trim();
}

function openChatOverlay() {
  ensureChatUI();
  chatOverlayOpen = true;
  chatOverlayEl.classList.remove("hidden", "chat-closing");
  syncChatOverlayViewport();
  renderChatMessages();
  if (currentRoomData) updateChatOnlineStatus(currentRoomData);
  chatInputEl.focus();
}

function updateChatOnlineStatus(data) {
  const subtitleEl = document.getElementById("chat-header-subtitle");
  if (!subtitleEl || !data?.players) return;
  const ids = Object.keys(data.players);
  if (ids.length <= 2) {
    subtitleEl.textContent = "Our little corner";
    return;
  }
  const onlineCount = ids.filter((id) => {
    const presence = presenceData[id];
    return !presence || presence.online !== false;
  }).length;
  subtitleEl.textContent = `${onlineCount} of ${ids.length} online`;
}

function closeChatOverlay() {
  if (!chatOverlayOpen) return;
  chatOverlayOpen = false;
  
  // Desktop sidebar mode
  document.body.classList.remove("chat-open-desktop");
  
  if (!chatOverlayEl) return;
  cancelBubbleLongPress();
  closeChatContextMenu();
  const panel = chatOverlayEl.querySelector(".chat-panel");
  const finishClose = () => {
    chatOverlayEl.classList.add("hidden");
    chatOverlayEl.classList.remove("chat-closing");
  };
  
  // Skip animation on desktop
  if (window.innerWidth >= 900) {
    finishClose();
    return;
  }
  
  chatOverlayEl.classList.add("chat-closing");
  if (panel) {
    panel.addEventListener("animationend", finishClose, { once: true });
    setTimeout(finishClose, 300);
  } else {
    finishClose();
  }
}

// ---------- Firestore: listen + send ----------
function listenToMessages(code) {
  if (unsubscribeMessages) unsubscribeMessages();
  const messagesQuery = query(collection(db, "rooms", code, "messages"), orderBy("createdAt", "asc"), limit(200));
  unsubscribeMessages = onSnapshot(
    messagesQuery,
    (snap) => {
      chatMessages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (chatOverlayOpen) {
        renderChatMessages();
      } else {
        updateChatBadge();
      }
    },
    (err) => {
      console.error("Chat listener error:", err);
      if (err.code === "permission-denied") {
        toast("Can't load chat — Firestore rules are blocking the messages subcollection.");
      }
    }
  );
}

async function sendChatMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || !roomId || !db) return;
  try {
    await addDoc(collection(db, "rooms", roomId, "messages"), {
      senderId: playerId,
      type: "text",
      text: trimmed,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    if (err.code === "permission-denied") {
      toast("Chat blocked by Firestore rules — see the note about the messages subcollection.");
    } else {
      toast("Couldn't send that message — try again.");
    }
  }
}

// ---------- Rendering ----------
function renderChatMessages() {
  if (!chatMessagesEl || !currentRoomData) return;
  closeChatContextMenu();
  chatMessagesEl.innerHTML = chatMessages
    .map((msg, i) => {
      const prev = chatMessages[i - 1];
      const next = chatMessages[i + 1];
      const sameAsPrev = prev && prev.senderId === msg.senderId && prev.type !== "capsule" && msg.type !== "capsule";
      const sameAsNext = next && next.senderId === msg.senderId && next.type !== "capsule" && msg.type !== "capsule";
      return renderChatMessageHTML(msg, { groupStart: !sameAsPrev, groupEnd: !sameAsNext });
    })
    .join("");
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  lastSeenMessageCount = chatMessages.length;
  updateChatBadge();
}

function renderChatMessageHTML(msg, group) {
  const { groupStart, groupEnd } = group || { groupStart: true, groupEnd: true };
  const isMe = msg.senderId === playerId;
  const reactions = msg.reactions || {};
  const myReact = reactions[playerId];
  const theirEntry = Object.entries(reactions).find(([id]) => id !== playerId);
  const theirReact = theirEntry ? theirEntry[1] : null;
  // On my own messages, the reaction worth showing is the other player's.
  // On their messages, it's mine — that's the confirmation that was missing.
  const shownReact = isMe ? theirReact : myReact;

  if (msg.type === "capsule") {
    return renderCapsuleBubbleHTML(msg, isMe, shownReact);
  }

  const totalPlayers = currentRoomData?.players ? Object.keys(currentRoomData.players).length : 0;
  const senderLabel = (!isMe && groupStart && totalPlayers > 2)
    ? `<span class="bubble-label chat-sender-label">${escapeHtml(currentRoomData?.players?.[msg.senderId]?.name || "Someone")}</span>`
    : "";

  let bodyHTML;
  if (msg.type === "voice") {
    bodyHTML = `
      <div class="voice-message">
        <button class="voice-play-btn" data-action="play-voice" data-msg-id="${msg.id}" type="button" aria-label="Play voice note">▶</button>
        <span class="voice-wave" aria-hidden="true">${"<span></span>".repeat(11)}</span>
        <span class="voice-duration">${msg.audioDuration || 0}s</span>
      </div>
    `;
  } else {
    bodyHTML = `<p>${escapeHtml(msg.text || "")}</p>`;
  }

  const bubbleClasses = [
    "chat-bubble",
    isMe ? "me" : "them",
    groupStart ? "group-start" : "group-continued",
    groupEnd ? "group-end" : "",
    shownReact ? "has-shown-reaction" : "",
  ].filter(Boolean).join(" ");

  return `<div class="${bubbleClasses}" data-msg-id="${msg.id}">
    ${senderLabel}
    ${bodyHTML}
    ${shownReact ? `<span class="msg-reaction-shown">${shownReact}</span>` : ""}
  </div>`;
}

function handleChatAction(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, msgId, emoji } = btn.dataset;
  const msg = chatMessages.find((m) => m.id === msgId);
  if (!msg) return;

  if (action === "play-voice") {
    playVoiceMessage(msg, btn);
  } else if (action === "to-card") {
    if (msg.text) {
      pendingMediatorQuestion = msg.text;
      toast("Queued — it'll show up as your next card 🎴");
    }
  } else if (action === "react") {
    reactToChatMessage(msgId, emoji);
  }
}

// ---------- Long-press context menu (reactions + turn-into-card) ----------
// Native iOS-style: hold a bubble, a small menu pops up above/below it.
// Reuses the exact same data-action/data-msg-id contract as before — only
// how you reach these actions changed, not what they do or how they're stored.
function attachBubbleLongPress() {
  chatMessagesEl.addEventListener("pointerdown", (e) => {
    const bubble = e.target.closest(".chat-bubble");
    if (!bubble || !bubble.dataset.msgId) return;
    bubbleLongPressStart = { x: e.clientX, y: e.clientY };
    bubbleLongPressTimer = setTimeout(() => {
      bubbleLongPressTimer = null;
      openChatContextMenu(bubble);
    }, 420);
  });
  chatMessagesEl.addEventListener("pointermove", (e) => {
    if (!bubbleLongPressTimer || !bubbleLongPressStart) return;
    const dx = e.clientX - bubbleLongPressStart.x;
    const dy = e.clientY - bubbleLongPressStart.y;
    if (Math.hypot(dx, dy) > 10) cancelBubbleLongPress();
  });
  chatMessagesEl.addEventListener("pointerup", cancelBubbleLongPress);
  chatMessagesEl.addEventListener("pointerleave", cancelBubbleLongPress);
  chatMessagesEl.addEventListener("pointercancel", cancelBubbleLongPress);
  chatMessagesEl.addEventListener("scroll", () => {
    cancelBubbleLongPress();
    closeChatContextMenu();
  }, { passive: true });

  const menu = document.getElementById("chat-context-menu");
  menu.addEventListener("click", (e) => {
    handleChatAction(e);
    closeChatContextMenu();
  });
}

function cancelBubbleLongPress() {
  if (bubbleLongPressTimer) {
    clearTimeout(bubbleLongPressTimer);
    bubbleLongPressTimer = null;
  }
}

function openChatContextMenu(bubbleEl) {
  const msgId = bubbleEl.dataset.msgId;
  const msg = chatMessages.find((m) => m.id === msgId);
  if (!msg) return;
  const isMe = msg.senderId === playerId;
  const reactions = msg.reactions || {};
  const myReact = reactions[playerId];

  let canReact = false;
  let emojiSet = [];
  let canCard = false;

  if (msg.type === "capsule") {
    canReact = !isMe && Date.now() >= msg.unlockAt;
    emojiSet = ["❤️", "🥹", "😭"];
  } else {
    canReact = !isMe;
    emojiSet = ["❤️", "😂", "🔥"];
    canCard = msg.type === "text";
  }
  if (!canReact && !canCard) return;

  const menu = document.getElementById("chat-context-menu");
  menu.innerHTML = `
    ${canReact ? `<div class="chat-context-reactions">${emojiSet.map((em) =>
      `<button data-action="react" data-msg-id="${msg.id}" data-emoji="${em}" class="${myReact === em ? "active" : ""}" type="button" aria-label="React with ${em}">${em}</button>`
    ).join("")}</div>` : ""}
    ${canCard ? `<button class="chat-context-card-btn" data-action="to-card" data-msg-id="${msg.id}" type="button">🎴 Turn into a card</button>` : ""}
  `;

  suppressNextBubbleClick = true;
  setTimeout(() => { suppressNextBubbleClick = false; }, 500); // safety net in case click never follows

  positionContextMenu(menu, bubbleEl);
  document.addEventListener("pointerdown", handleContextMenuOutsideClick, { capture: true });
}

function positionContextMenu(menu, bubbleEl) {
  const panelEl = chatOverlayEl.querySelector(".chat-panel");
  const panelRect = panelEl.getBoundingClientRect();
  const bubbleRect = bubbleEl.getBoundingClientRect();
  menu.classList.remove("hidden", "visible", "flipped");
  menu.style.visibility = "hidden";
  // Measure TRUE layout size. offsetWidth/Height ignore the CSS scale(0.85)
  // entrance transform, which getBoundingClientRect does NOT — that mismatch
  // is exactly what let the menu overflow the right edge on right-aligned
  // (your) bubbles. Pure positioning fix; no logic changes.
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  menu.style.visibility = "";
  let top = bubbleRect.top - menuH - 10;
  let flipped = false;
  if (top < panelRect.top + 8) {
    top = bubbleRect.bottom + 10;
    flipped = true;
  }
  let left = bubbleRect.left + bubbleRect.width / 2 - menuW / 2;
  left = Math.min(Math.max(left, panelRect.left + 8), panelRect.right - menuW - 8);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.classList.toggle("flipped", flipped);
  requestAnimationFrame(() => menu.classList.add("visible"));
}

function closeChatContextMenu() {
  const menu = document.getElementById("chat-context-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  menu.classList.remove("visible");
  document.removeEventListener("pointerdown", handleContextMenuOutsideClick, { capture: true });
  setTimeout(() => menu.classList.add("hidden"), 200);
}

function handleContextMenuOutsideClick(e) {
  const menu = document.getElementById("chat-context-menu");
  if (menu && !menu.contains(e.target)) closeChatContextMenu();
}

function playVoiceMessage(msg, btn) {
  if (!msg.audioData) return;
  const audio = new Audio(msg.audioData);
  const voiceMessageEl = btn ? btn.closest(".voice-message") : null;
  const resetPlaybackUI = () => {
    if (btn) btn.textContent = "▶";
    if (voiceMessageEl) voiceMessageEl.classList.remove("playing");
  };
  if (btn) btn.textContent = "⏸";
  if (voiceMessageEl) voiceMessageEl.classList.add("playing");
  audio.addEventListener("ended", resetPlaybackUI);
  audio.play().catch((err) => {
    console.error("Playback failed:", err);
    toast("Couldn't play that voice note.");
    resetPlaybackUI();
  });
}

async function reactToChatMessage(messageId, emoji) {
  if (!roomId || !db) return;
  try {
    await updateDoc(doc(db, "rooms", roomId, "messages", messageId), { [`reactions.${playerId}`]: emoji });
  } catch (err) {
    console.error(err);
    toast("Couldn't send that reaction.");
  }
}

function updateChatBadge() {
  const badge = document.getElementById("chat-badge");
  if (!badge) return;
  const unread = chatMessages.length - lastSeenMessageCount;
  if (!chatOverlayOpen && unread > 0) {
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// ---------- Typing indicator (separate from the card-answer one) ----------
function handleChatTypingInput() {
  if (!roomId || !db) return;
  if (!isChatTypingFlagged) {
    isChatTypingFlagged = true;
    updateDoc(doc(db, "rooms", roomId), { [`chatTyping.${playerId}`]: true }).catch(() => {});
  }
  clearTimeout(chatTypingTimer);
  chatTypingTimer = setTimeout(stopChatTyping, 1500);
}

function stopChatTyping() {
  isChatTypingFlagged = false;
  clearTimeout(chatTypingTimer);
  if (roomId && db) {
    updateDoc(doc(db, "rooms", roomId), { [`chatTyping.${playerId}`]: false }).catch(() => {});
  }
}

function updateChatTypingIndicator(data) {
  if (!chatTypingIndicatorEl || !data || !data.players) return;
  const others = Object.keys(data.players).filter((id) => id !== playerId);
  const typingNames = others
    .filter((id) => data.chatTyping && data.chatTyping[id])
    .map((id) => data.players[id].name);
  chatTypingIndicatorEl.classList.toggle("hidden", typingNames.length === 0);
  if (typingNames.length) chatTypingIndicatorEl.textContent = `✍️ ${typingNames.join(", ")} typing...`;
}

// ---------- Voice notes (press-and-hold, capped at 30s, stored as base64) ----------
async function startVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      finishVoiceRecording(mediaRecorder.mimeType || "audio/webm");
    };
    mediaRecorder.start();
    recordingStartTime = Date.now();
    updateVoiceRecordingUI(true);
    recordingTimerInterval = setInterval(() => {
      const elapsed = (Date.now() - recordingStartTime) / 1000;
      if (elapsed >= MAX_VOICE_SECONDS) stopVoiceRecording();
    }, 200);
  } catch (err) {
    console.error("Mic access failed:", err);
    toast("Couldn't access your microphone.");
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  clearInterval(recordingTimerInterval);
  updateVoiceRecordingUI(false);
}

function finishVoiceRecording(mimeType) {
  const duration = Math.round((Date.now() - recordingStartTime) / 1000);
  if (duration < 1) return; // too short — probably an accidental tap
  const blob = new Blob(recordedChunks, { type: mimeType });
  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64 = reader.result;
    if (base64.length > 900000) {
      toast("That voice note is too long — try a shorter one.");
      return;
    }
    try {
      await addDoc(collection(db, "rooms", roomId, "messages"), {
        senderId: playerId,
        type: "voice",
        audioData: base64,
        audioDuration: duration,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      if (err.code === "permission-denied") {
        toast("Chat blocked by Firestore rules — see the note about the messages subcollection.");
      } else {
        toast("Couldn't send that voice note — try again.");
      }
    }
  };
  reader.readAsDataURL(blob);
}

function updateVoiceRecordingUI(isRecording) {
  const voiceBtn = document.getElementById("chat-voice-btn");
  if (!voiceBtn) return;
  voiceBtn.classList.toggle("recording", isRecording);
  voiceBtn.textContent = isRecording ? "⏺" : "🎤";
}

// ---------- Styles (self-contained, no style.css edits needed) ----------
function injectChatStyles() {
  if (document.getElementById("chat-styles")) return;
  const style = document.createElement("style");
  style.id = "chat-styles";
  style.textContent = `
    .chat-toggle { position: fixed !important; top: 50% !important; left: auto !important; bottom: auto !important; right: 14px !important; transform: translateY(-50%); z-index: 500; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: 0 6px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.1); transition: top 0.2s var(--ease-smooth, ease), bottom 0.2s var(--ease-smooth, ease); } 
    .chat-toggle:active { transform: translateY(-50%) scale(0.94); } 
    .chat-toggle.chat-toggle-docked { top: auto !important; bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important; transform: none !important; } 
    .chat-toggle.chat-toggle-docked:active { transform: scale(0.94) !important; } 
    
    .chat-badge { position: absolute; top: -4px; right: -4px; background: #c9425a; color: #fff; border-radius: 999px; font-size: 11px; line-height: 1; padding: 3px 6px; font-family: 'IBM Plex Mono', monospace; box-shadow: 0 2px 4px rgba(0,0,0,0.2); } 
    
    .chat-overlay { position: fixed; top: 0; left: 0; right: 0; height: 100dvh; background: rgba(20, 16, 12, 0.45); display: flex; align-items: flex-end; justify-content: center; z-index: 950; backdrop-filter: blur(4px) saturate(120%); -webkit-backdrop-filter: blur(4px) saturate(120%); animation: chat-backdrop-in 0.28s var(--ease-smooth, ease-out); } 
    .chat-overlay.chat-closing { animation: chat-backdrop-out 0.24s var(--ease-smooth, ease-out) forwards; } 
    
    .chat-panel { 
      background: linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 15%, rgba(0,0,0,0.02) 100%), var(--card, #f6efe1); 
      color: var(--on-card, #241c30); 
      width: 100%; max-width: 480px; height: 100%; max-height: min(82vh, 760px); 
      border-radius: 28px 28px 0 0; display: flex; flex-direction: column; 
      box-shadow: 0 -16px 48px rgba(0,0,0,0.25), 0 -2px 0 rgba(255,255,255,0.1) inset, inset 0 1px 0 rgba(255,255,255,0.6); 
      animation: chat-sheet-in 0.4s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)); 
      transition: transform 0.3s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)); 
    } 
    .chat-overlay.chat-closing .chat-panel { animation: chat-sheet-out 0.26s var(--ease-smooth, ease-in) forwards; } 
    
    @keyframes chat-sheet-in { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } } 
    @keyframes chat-sheet-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(60px); opacity: 0; } } 
    @keyframes chat-backdrop-in { from { opacity: 0; } to { opacity: 1; } } 
    @keyframes chat-backdrop-out { from { opacity: 1; } to { opacity: 0; } } 
    
    .chat-sheet-handle { flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 12px 0 8px; touch-action: none; cursor: grab; } 
    .chat-sheet-handle::before { content: ""; width: 38px; height: 5px; border-radius: 999px; background: var(--on-card-soft, #6b5f78); opacity: 0.25; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1); } 
    
    .chat-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 4px 18px 12px; border-bottom: 1px solid var(--border-card, rgba(0,0,0,0.06)); } 
    .chat-header-identity { display: flex; flex-direction: column; gap: 2px; } 
    .chat-header-title { font-family: var(--font-display, 'Fraunces', serif); font-weight: 500; font-size: 19px; line-height: 1.15; font-optical-sizing: auto; letter-spacing: -0.01em; } 
    .chat-header-subtitle { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-card-soft, #6b5f78); opacity: 0.8; } 
    .chat-header-actions { display: flex; align-items: center; gap: 2px; } 
    
    .chat-header-icon-btn, .chat-close-btn { background: none; border: none; cursor: pointer; color: inherit; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 999px; opacity: 0.7; font-size: 16px; transition: opacity 0.2s var(--ease-smooth, ease), background 0.2s var(--ease-smooth, ease), transform 0.15s var(--ease-spring, ease); } 
    .chat-close-btn { font-size: 22px; } 
    .chat-header-icon-btn:hover, .chat-close-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); } 
    .chat-header-icon-btn:active, .chat-close-btn:active { opacity: 1; background: rgba(0,0,0,0.08); transform: scale(0.92); } 
    
    @media (min-width: 640px) { 
      .chat-overlay { align-items: center; } 
      .chat-sheet-handle { display: none; } 
      .chat-panel { height: min(640px, 82vh); max-height: calc(100dvh - 48px); border-radius: var(--radius-lg, 26px); box-shadow: 0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6); } 
      @keyframes chat-sheet-in { from { transform: translateY(16px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } } 
      @keyframes chat-sheet-out { from { transform: translateY(0) scale(1); opacity: 1; } to { transform: translateY(10px) scale(0.98); opacity: 0; } } 
    } 
    
    .chat-messages { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 18px; display: flex; flex-direction: column; } 
    
    .chat-bubble { 
      max-width: min(76%, 320px); padding: 11px 15px; border-radius: 18px; 
      font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif); font-size: 15px; line-height: 1.48; 
      position: relative; margin-top: 8px; 
      box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6); 
    } 
    .chat-bubble:first-child { margin-top: 0; } 
    .chat-bubble.group-continued { margin-top: 2px; } 
    .chat-bubble.has-shown-reaction { margin-bottom: 14px; } 
    
    .chat-bubble.me { align-self: flex-end; background: var(--gold, #c9a15a); color: #241f14; box-shadow: 0 2px 8px rgba(156, 51, 72, 0.18), inset 0 1px 0 rgba(255,255,255,0.25); } 
    .chat-bubble.me.group-end { border-bottom-right-radius: 6px; } 
    
    .chat-bubble.them { align-self: flex-start; background: var(--card-2, #fffaf1); border: 1px solid var(--border-card, rgba(36,28,48,0.08)); color: var(--on-card, #241c30); } 
    .chat-bubble.them.group-end { border-bottom-left-radius: 6px; } 
    
    .chat-bubble p { margin: 0; white-space: pre-wrap; word-break: break-word; } 
    .chat-bubble .chat-sender-label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; } 
    .chat-bubble { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; } 
    
    .msg-reaction-shown { position: absolute; bottom: -12px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 13px; border-radius: 999px; background: var(--card-2, #fffaf1); border: 1px solid var(--border-card, rgba(36,28,48,0.08)); box-shadow: 0 2px 6px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.8); } 
    .chat-bubble.me .msg-reaction-shown { left: 12px; } 
    .chat-bubble.them .msg-reaction-shown { right: 12px; } 
    
    .chat-context-menu { 
      position: fixed; z-index: 1000; 
      background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 40%), var(--card, #f6efe1); 
      color: var(--on-card, #241c30); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.08)); border-radius: 18px; 
      box-shadow: 0 14px 44px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.7); 
      padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 200px; 
      opacity: 0; transform: scale(0.85); transform-origin: center bottom; 
      transition: opacity 0.16s var(--ease-smooth, ease), transform 0.2s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)); pointer-events: none; 
    } 
    .chat-context-menu.flipped { transform-origin: center top; } 
    .chat-context-menu.visible { opacity: 1; transform: scale(1); pointer-events: auto; } 
    
    .chat-context-reactions { display: flex; justify-content: space-around; gap: 2px; padding: 6px 4px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--border-card, rgba(36,28,48,0.08)); } 
    .chat-context-reactions button { background: none; border: none; font-size: 26px; cursor: pointer; width: 44px; height: 44px; border-radius: 999px; display: flex; align-items: center; justify-content: center; transition: transform 0.15s var(--ease-spring, ease), background 0.15s ease; } 
    .chat-context-reactions button:active { transform: scale(1.2); background: rgba(0,0,0,0.04); } 
    .chat-context-reactions button.active { background: rgba(0,0,0,0.06); animation: chat-reaction-pop 0.35s var(--ease-spring, ease); } 
    @keyframes chat-reaction-pop { 0% { transform: scale(1); } 45% { transform: scale(1.25); } 100% { transform: scale(1); } } 
    
    .chat-context-card-btn { background: none; border: none; text-align: left; cursor: pointer; font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif); font-size: 14.5px; font-weight: 500; color: inherit; padding: 11px 12px; border-radius: 11px; transition: background 0.15s ease; } 
    .chat-context-card-btn:active { background: rgba(0,0,0,0.06); } 
    
    .voice-message { display: flex; align-items: center; } 
    .voice-play-btn { background: rgba(0,0,0,0.08); border: none; border-radius: 999px; width: 32px; height: 32px; flex-shrink: 0; cursor: pointer; font-size: 12px; color: inherit; display: flex; align-items: center; justify-content: center; transition: transform 0.15s var(--ease-spring, ease), background 0.15s ease; box-shadow: inset 0 1px 0 rgba(255,255,255,0.4); } 
    .chat-bubble.me .voice-play-btn { background: rgba(0,0,0,0.15); box-shadow: inset 0 1px 0 rgba(255,255,255,0.2); } 
    .voice-play-btn:active { transform: scale(0.9); } 
    
    .voice-wave { display: inline-flex; align-items: center; gap: 2.5px; height: 20px; margin: 0 10px; } 
    .voice-wave span { width: 3px; border-radius: 2px; background: currentColor; opacity: 0.4; display: block; } 
    .voice-wave span:nth-child(1) { height: 35%; } .voice-wave span:nth-child(2) { height: 60%; } .voice-wave span:nth-child(3) { height: 90%; } .voice-wave span:nth-child(4) { height: 50%; } .voice-wave span:nth-child(5) { height: 75%; } .voice-wave span:nth-child(6) { height: 40%; } .voice-wave span:nth-child(7) { height: 95%; } .voice-wave span:nth-child(8) { height: 55%; } .voice-wave span:nth-child(9) { height: 70%; } .voice-wave span:nth-child(10) { height: 45%; } .voice-wave span:nth-child(11) { height: 65%; } 
    .voice-message.playing .voice-wave span { opacity: 0.85; animation: chat-wave-bounce 0.9s ease-in-out infinite; } 
    .voice-message.playing .voice-wave span:nth-child(odd) { animation-delay: 0.15s; } 
    .voice-message.playing .voice-wave span:nth-child(3n) { animation-delay: 0.3s; } 
    @keyframes chat-wave-bounce { 0%, 100% { transform: scaleY(0.6); } 50% { transform: scaleY(1); } } 
    .voice-duration { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 12.5px; opacity: 0.8; letter-spacing: 0.02em; } 
    
    .chat-form { 
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; 
      margin: 4px 16px calc(10px + env(safe-area-inset-bottom, 0px)); 
      padding: 6px 6px 6px 16px; 
      background: var(--card-2, #fffaf1); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.08)); border-radius: 24px; 
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.03), 0 1px 0 rgba(255,255,255,0.8); 
      transition: box-shadow 0.2s var(--ease-smooth, ease), border-color 0.2s var(--ease-smooth, ease); 
    } 
    .chat-form:focus-within { border-color: var(--gold, #c9a15a); box-shadow: inset 0 2px 4px rgba(0,0,0,0.03), 0 0 0 3px var(--gold-soft, rgba(201,161,90,0.16)); } 
    .chat-form textarea { flex: 1; resize: none; border: none; background: transparent; outline: none; padding: 9px 4px; font-family: inherit; font-size: 15.5px; line-height: 1.4; color: inherit; min-height: 36px; max-height: 100px; margin-bottom: 0; } 
    .chat-form textarea::placeholder { color: var(--on-card-soft, #6b5f78); opacity: 0.6; } 
    
    #chat-typing-indicator.typing-indicator { color: var(--on-card-soft, #6b5f78); margin: 0 18px 8px; text-align: left; flex-shrink: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.02em; } 
    #chat-typing-indicator.typing-indicator:not(.hidden) { animation: chat-typing-breathe 1.6s ease-in-out infinite; } 
    @keyframes chat-typing-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } } 
    
    .chat-send-btn, .chat-voice-btn { border: none; border-radius: 999px; width: 44px; height: 44px; flex-shrink: 0; font-size: 16px; cursor: pointer; background: var(--gold, #c9a15a); color: #241f14; display: flex; align-items: center; justify-content: center; transition: transform 0.18s var(--ease-spring, ease), opacity 0.18s ease, background 0.18s ease; box-shadow: 0 2px 6px rgba(156, 51, 72, 0.2), inset 0 1px 0 rgba(255,255,255,0.3); } 
    .chat-send-btn:active, .chat-voice-btn:active { transform: scale(0.92); box-shadow: 0 0 0 rgba(156, 51, 72, 0.2), inset 0 1px 2px rgba(0,0,0,0.1); } 
    .chat-send-btn:disabled { opacity: 0.35; cursor: default; box-shadow: none; } 
    .chat-send-btn:disabled:active { transform: none; } 
    .chat-voice-btn { background: var(--card, #f6efe1); color: var(--on-card, #241c30); touch-action: none; user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6); border: 1px solid var(--border-card, rgba(36,28,48,0.08)); } 
    .chat-voice-btn.recording { background: #c9425a; color: #fff; border-color: #c9425a; animation: chat-pulse 1s infinite; box-shadow: 0 2px 8px rgba(201, 66, 90, 0.3); } 
    @keyframes chat-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } } 
    
    #chat-messages > .chat-bubble:last-child { animation: chat-bubble-in 0.28s var(--ease-out, ease-out); } 
    @keyframes chat-bubble-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } } 
    
    @media (prefers-reduced-motion: reduce) { 
      .chat-overlay, .chat-panel, .chat-overlay.chat-closing, .chat-overlay.chat-closing .chat-panel, #chat-messages > .chat-bubble:last-child, .chat-context-reactions button.active, #chat-typing-indicator.typing-indicator:not(.hidden), .voice-message.playing .voice-wave span, .chat-voice-btn.recording { animation: none !important; } 
      .chat-panel, .chat-context-menu { transition: none !important; } 
    }
  `;
  document.head.appendChild(style);
}

// ====== Time Capsule — seal a message, unlocks on a future date ======
// Lives as a special message type inside the same messages subcollection,
// so it appears right in the chat timeline, sorted by when it was sealed —
// just locked until msg.unlockAt passes.

let capsuleOverlayEl = null;
let celebratedCapsules = new Set();
let capsuleWatcherInterval = null;

function ensureCapsuleUI() {
  if (capsuleOverlayEl) return;
  capsuleOverlayEl = document.createElement("div");
  capsuleOverlayEl.id = "capsule-overlay";
  capsuleOverlayEl.className = "capsule-overlay hidden";
  capsuleOverlayEl.innerHTML = `<div class="capsule-modal"> <p class="capsule-eyebrow">✦ A letter to your future selves</p> <div class="capsule-head"> <span class="capsule-seal-mark" aria-hidden="true">🔒</span> <div class="capsule-head-text"> <p class="capsule-modal-title">Seal a Time Capsule</p> </div> </div> <p class="capsule-modal-subtitle">Write something for later, it stays sealed until the date you pick.</p> <textarea id="capsule-text-input" rows="4" maxlength="2000" placeholder="Dear you, in the future…"></textarea> <div class="capsule-field"> <label class="capsule-date-label" for="capsule-date-input">Unlocks on</label> <input type="datetime-local" id="capsule-date-input"> <p id="capsule-countdown" class="capsule-countdown"></p> </div> <div class="capsule-modal-actions"> <button type="button" id="capsule-cancel-btn" class="capsule-btn cancel">Cancel</button> <button type="button" id="capsule-seal-btn" class="capsule-btn seal">Seal it 🔒</button> </div> </div>`;
  document.body.appendChild(capsuleOverlayEl);
  document.getElementById("capsule-cancel-btn").addEventListener("click", closeCapsuleComposer);
  document.getElementById("capsule-seal-btn").addEventListener("click", sealTimeCapsule);
  document.getElementById("capsule-date-input").addEventListener("input", updateCapsuleCountdown);
  capsuleOverlayEl.addEventListener("click", (e) => {
    if (e.target === capsuleOverlayEl) closeCapsuleComposer();
  });
}

// Live "sealed for N days · opens …" line under the date picker.
// Presentation only — never read by sealTimeCapsule, never stored, never
// synced. It just updates as the player moves the date (and once on open).
function updateCapsuleCountdown() {
  const line = document.getElementById("capsule-countdown");
  const input = document.getElementById("capsule-date-input");
  if (!line || !input) return;
  if (!input.value) { line.textContent = ""; return; }
  const ms = new Date(input.value).getTime();
  if (isNaN(ms)) { line.textContent = ""; return; }
  const days = Math.ceil((ms - Date.now()) / 86400000);
  const dateStr = new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (days <= 0) line.textContent = "Pick a date in the future";
  else if (days === 1) line.textContent = `Opens tomorrow · ${dateStr}`;
  else line.textContent = `Sealed for ${days} days · opens ${dateStr}`;
}

function openCapsuleComposer() {
  ensureCapsuleUI();
  const dateInput = document.getElementById("capsule-date-input");
  dateInput.min = new Date(Date.now() + 60000).toISOString().slice(0, 16);
  document.getElementById("capsule-text-input").value = "";
  // Sensible default so the field never reads as an empty void — a letter
  // sealed for a month from now. Pure presentation: the future-date
  // validation inside sealTimeCapsule is completely unchanged.
  dateInput.value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  updateCapsuleCountdown();
  capsuleOverlayEl.classList.remove("hidden");
}

function closeCapsuleComposer() {
  if (capsuleOverlayEl) capsuleOverlayEl.classList.add("hidden");
}

async function sealTimeCapsule() {
  const text = document.getElementById("capsule-text-input").value.trim();
  const dateVal = document.getElementById("capsule-date-input").value;

  if (!text) {
    toast("Write something for the capsule first.");
    return;
  }
  if (!dateVal) {
    toast("Pick an unlock date.");
    return;
  }
  const unlockAt = new Date(dateVal).getTime();
  if (isNaN(unlockAt) || unlockAt <= Date.now()) {
    toast("Pick a date in the future.");
    return;
  }
  if (!roomId || !db) return;

  const sealBtn = document.getElementById("capsule-seal-btn");
  sealBtn.disabled = true;
  sealBtn.textContent = "Sealing...";
  try {
    await addDoc(collection(db, "rooms", roomId, "messages"), {
      senderId: playerId,
      type: "capsule",
      text,
      unlockAt,
      createdAt: serverTimestamp(),
    });
    closeCapsuleComposer();
    toast("Sealed 🔒, it'll unlock on the date you picked.");
  } catch (err) {
    console.error(err);
    if (err.code === "permission-denied") {
      toast("Blocked by Firestore rules — same messages subcollection as chat.");
    } else {
      toast("Couldn't seal that capsule — try again.");
    }
  } finally {
    sealBtn.disabled = false;
    sealBtn.textContent = "Seal it 🔒";
  }
}

function renderCapsuleBubbleHTML(msg, isMe, shownReact) {
  const isUnlocked = Date.now() >= msg.unlockAt;
  const senderName = isMe ? "You" : (currentRoomData?.players?.[msg.senderId]?.name || "Them");

  if (!isUnlocked) {
    return `<div class="chat-bubble capsule-bubble locked ${isMe ? "me" : "them"}" data-msg-id="${msg.id}">
      <p class="capsule-label">🔒 Time Capsule from ${escapeHtml(senderName)}</p>
      <p class="capsule-unlock-date">Opens ${formatCapsuleDate(msg.unlockAt)}</p>
    </div>`;
  }

  return `<div class="chat-bubble capsule-bubble unlocked ${isMe ? "me" : "them"}" data-msg-id="${msg.id}">
    <p class="capsule-label">📦 Time Capsule — opened</p>
    <p>${escapeHtml(msg.text || "")}</p>
    ${shownReact ? `<span class="msg-reaction-shown">${shownReact}</span>` : ""}
  </div>`;
}

function formatCapsuleDate(ms) {
  const d = new Date(ms);
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const daysAway = Math.ceil((ms - Date.now()) / 86400000);
  if (daysAway <= 0) return dateStr;
  if (daysAway === 1) return `${dateStr} (tomorrow)`;
  if (daysAway <= 60) return `${dateStr} (in ${daysAway} days)`;
  return dateStr;
}

// Re-checks lock state over time (not just on new Firestore writes) so a
// capsule visibly unlocks the moment its date passes while chat is open,
// and celebrates ones that unlocked recently rather than stale old ones.
function checkCapsuleUnlocks() {
  const now = Date.now();
  let justUnlockedAny = false;
  chatMessages.forEach((msg) => {
    if (msg.type !== "capsule") return;
    const recentlyUnlocked = msg.unlockAt <= now && now - msg.unlockAt < 120000;
    if (recentlyUnlocked && !celebratedCapsules.has(msg.id)) {
      celebratedCapsules.add(msg.id);
      justUnlockedAny = true;
    }
  });
  if (justUnlockedAny) {
    fireConfetti();
    toast("📦 A time capsule just opened!");
  }
}

function startCapsuleWatcher() {
  if (capsuleWatcherInterval) return;
  capsuleWatcherInterval = setInterval(() => {
    checkCapsuleUnlocks();
    if (chatOverlayOpen) renderChatMessages();
  }, 20000);
}

function injectCapsuleStyles() {
  if (document.getElementById("capsule-styles")) return;
  const style = document.createElement("style");
  style.id = "capsule-styles";
  style.textContent = `
    /* ---- Composer overlay: lit-on-the-table backdrop ---- */
    .capsule-overlay {
      position: fixed; inset: 0;
      background:
        radial-gradient(ellipse 70% 50% at 50% 36%, rgba(201,161,90,0.12), transparent 62%),
        rgba(20, 18, 14, 0.66);
      display: flex; align-items: center; justify-content: center;
      z-index: 1050; padding: 20px;
      backdrop-filter: blur(7px) saturate(120%); -webkit-backdrop-filter: blur(7px) saturate(120%);
      animation: capsule-backdrop-in 0.28s var(--ease-smooth, ease-out);
    }
    @keyframes capsule-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

    /* ---- The card: thick cream cardstock with a warm halo ---- */
    .capsule-modal {
      position: relative; overflow: hidden;            /* clips the glow + guarantees no field escape */
      background:
        linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 26%, rgba(0,0,0,0.015) 100%),
        var(--card, #f6efe1);
      color: var(--on-card, #241c30);
      border: 1px solid var(--border-card, rgba(36,28,48,0.10));
      border-radius: 24px; max-width: 420px; width: 100%;
      padding: 30px 26px 26px;
      box-shadow:
        0 28px 70px rgba(0,0,0,0.40),
        0 0 0 1px rgba(255,255,255,0.04),
        inset 0 1px 0 rgba(255,255,255,0.7),
        inset 0 -1px 0 rgba(0,0,0,0.03);
      font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif);
      animation: capsule-modal-in 0.42s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1));
    }
    .capsule-modal::before {                            /* soft lamplight pooling at the top */
      content: ""; position: absolute; top: -42%; left: 50%; transform: translateX(-50%);
      width: 150%; height: 80%;
      background: radial-gradient(ellipse at center, var(--gold-soft, rgba(201,161,90,0.20)), transparent 70%);
      pointer-events: none; z-index: 0;
    }
    .capsule-modal > * { position: relative; z-index: 1; }
    @keyframes capsule-modal-in { from { opacity: 0; transform: scale(0.94) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }

    /* ---- Staggered entrance for the inner fields ---- */
    .capsule-eyebrow, .capsule-head, .capsule-modal-subtitle,
    #capsule-text-input, .capsule-field, .capsule-modal-actions {
      animation: capsule-field-rise 0.5s var(--ease-out, ease-out) backwards;
    }
    .capsule-head { animation-delay: 0.06s; }
    .capsule-modal-subtitle { animation-delay: 0.12s; }
    #capsule-text-input { animation-delay: 0.18s; }
    .capsule-field { animation-delay: 0.24s; }
    .capsule-modal-actions { animation-delay: 0.30s; }
    @keyframes capsule-field-rise { from { opacity: 0; transform: translateY(9px); } }

    /* ---- Brand eyebrow + wax-seal header lockup ---- */
    .capsule-eyebrow {
      font-family: var(--font-mono, 'IBM Plex Mono', monospace);
      font-size: 0.62rem; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--gold, #c9a15a); font-weight: 600; margin: 0 0 14px;
    }
    .capsule-head { display: flex; align-items: center; gap: 14px; margin: 0 0 6px; }
    .capsule-seal-mark {
      width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0; position: relative;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.15rem; line-height: 1; color: #fff9ef;
      background:
        radial-gradient(circle at 35% 30%, rgba(255,255,255,0.38), transparent 46%),
        radial-gradient(circle at 50% 52%, #b8405a, var(--garnet, #9c3348) 72%);
      box-shadow: 0 3px 9px rgba(156,51,72,0.42), inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -2px 5px rgba(0,0,0,0.28);
    }
    .capsule-seal-mark::after {                          /* scalloped wax-edge hint */
      content: ""; position: absolute; inset: -3px; border-radius: 50%;
      border: 1.5px dashed rgba(156,51,72,0.35);
    }
    .capsule-head-text { display: flex; flex-direction: column; }
    .capsule-modal-title {
      font-family: var(--font-display, 'Fraunces', serif);
      font-size: 1.5rem; margin: 0; font-weight: 550; letter-spacing: -0.012em;
      line-height: 1.1; font-optical-sizing: auto;
    }
    .capsule-modal-subtitle { font-size: 0.92rem; opacity: 0.72; margin: 0 0 18px; line-height: 1.5; }

    /* ---- The letter: debossed, placeholder begins the note in italic serif ---- */
    #capsule-text-input {
      width: 100%; max-width: 100%; box-sizing: border-box;
      border-radius: 14px; border: 1.5px solid var(--border-card, rgba(36,28,48,0.12));
      padding: 14px 16px; font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif);
      font-size: 15.5px; line-height: 1.55; resize: vertical; min-height: 96px;
      margin: 0 0 18px; background: var(--card-2, #fffaf1); color: var(--on-card, #241c30);
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.6);
      transition: border-color 0.2s var(--ease-smooth, ease), box-shadow 0.2s var(--ease-smooth, ease);
    }
    #capsule-text-input::placeholder {
      font-family: var(--font-display, 'Fraunces', serif);
      font-style: italic; font-size: 1.05rem; opacity: 0.5;
    }
    #capsule-text-input:focus {
      outline: none; border-color: var(--garnet, #9c3348);
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.04), 0 0 0 4px var(--garnet-soft, rgba(156,51,72,0.16));
    }

    /* ---- Date field: calendar glyph so it's never a void; light UA chrome in dark mode ---- */
    .capsule-field { display: flex; flex-direction: column; min-width: 0; }
    .capsule-date-label {
      display: block; font-family: var(--font-mono, 'IBM Plex Mono', monospace);
      font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.12em;
      color: var(--on-card-soft, #6b5f78); opacity: 0.85; margin: 0 0 8px; font-weight: 600;
    }
    #capsule-date-input {
      width: 100%; max-width: 100%; box-sizing: border-box; color-scheme: light;
      border-radius: 14px; border: 1.5px solid var(--border-card, rgba(36,28,48,0.12));
      padding: 13px 16px 13px 44px; font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif);
      font-size: 15px; background-color: var(--card-2, #fffaf1); color: var(--on-card, #241c30);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236b5f78' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='3'/%3E%3Cline x1='3' y1='9' x2='21' y2='9'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: 15px center; background-size: 18px;
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.6);
      transition: border-color 0.2s var(--ease-smooth, ease), box-shadow 0.2s var(--ease-smooth, ease);
    }
    #capsule-date-input:focus {
      outline: none; border-color: var(--garnet, #9c3348);
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.04), 0 0 0 4px var(--garnet-soft, rgba(156,51,72,0.16));
    }

    /* ---- Live "sealed for N days" line ---- */
    .capsule-countdown {
      margin: 9px 2px 0; min-height: 1em;
      font-family: var(--font-mono, 'IBM Plex Mono', monospace);
      font-size: 0.72rem; letter-spacing: 0.01em; font-weight: 600;
      color: var(--garnet, #9c3348);
      display: flex; align-items: center; gap: 6px;
      transition: opacity 0.25s var(--ease-smooth, ease);
    }
    .capsule-countdown:empty { opacity: 0; }
    .capsule-countdown:not(:empty)::before { content: "\\23F3"; font-size: 0.82rem; }

    /* ---- Actions: harmonised with the main app's tactile buttons ---- */
    .capsule-modal-actions { display: flex; gap: 12px; margin-top: 22px; }
    .capsule-btn {
      flex: 1; padding: 14px; border-radius: 13px; border: none;
      font-weight: 600; cursor: pointer; font-family: var(--font-ui, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.96rem; letter-spacing: 0.005em;
      transition: transform 0.2s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)), box-shadow 0.2s ease, filter 0.15s ease;
    }
    .capsule-btn:active { transform: translateY(2px) scale(0.97); }
    .capsule-btn.cancel {
      background: var(--card-2, #fffaf1); color: var(--on-card, #241c30);
      border: 1px solid var(--border-card, rgba(36,28,48,0.12));
      box-shadow: 0 2px 0 var(--border-card, rgba(36,28,48,0.12)), 0 4px 12px rgba(36,28,48,0.06);
    }
    .capsule-btn.cancel:active { box-shadow: 0 0 0 var(--border-card, rgba(36,28,48,0.12)); filter: brightness(0.98); }
    .capsule-btn.seal {
      background: var(--gold, #c9a15a); color: #241c30;
      box-shadow: 0 2px 0 var(--garnet, #9c3348), 0 6px 16px rgba(156,51,72,0.24);
    }
    .capsule-btn.seal:active { box-shadow: 0 0 0 var(--garnet, #9c3348), 0 2px 6px rgba(156,51,72,0.18); filter: brightness(0.97); }
    .capsule-btn:disabled { opacity: 0.85; cursor: wait; animation: btn-processing 1.8s ease-in-out infinite; box-shadow: none; transform: none; }
    @media (hover: hover) and (pointer: fine) {
      .capsule-btn.cancel:hover { transform: translateY(-1px); box-shadow: 0 3px 0 var(--border-card, rgba(36,28,48,0.12)), 0 8px 18px rgba(36,28,48,0.10); }
      .capsule-btn.seal:hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 3px 0 var(--garnet, #9c3348), 0 10px 22px rgba(156,51,72,0.30); }
    }

    /* =========================================================
       In-timeline capsule BUBBLES (locked / unlocked) — carried
       over and harmonised; these live in the chat, not the modal.
       ========================================================= */
    .chat-bubble.capsule-bubble {
      align-self: center; max-width: 88%;
      border: 1.5px dashed var(--gold, #c9a15a);
      background: linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(201,161,90,0.08) 100%);
      box-shadow: 0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.5);
    }
    .capsule-bubble.locked { text-align: center; padding: 14px 18px; }
    .capsule-label {
      margin: 0; font-family: var(--font-mono, 'IBM Plex Mono', monospace);
      font-size: 0.66rem; letter-spacing: 0.06em; opacity: 0.85;
      text-transform: uppercase; font-weight: 600;
    }
    .capsule-unlock-date { margin: 6px 0 0; font-size: 0.86rem; font-weight: 600; color: var(--garnet, #9c3348); }
    .capsule-bubble.unlocked {
      border-style: solid; border-color: var(--border-card, rgba(36,28,48,0.12));
      background: var(--card-2, #fffaf1); padding: 14px 18px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8);
    }
    .capsule-bubble.unlocked p:not(.capsule-label) {
      margin: 8px 0 0; font-family: var(--font-display, 'Fraunces', serif);
      font-style: italic; font-size: 15px; line-height: 1.5; font-optical-sizing: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      .capsule-overlay, .capsule-modal, .capsule-eyebrow, .capsule-head,
      .capsule-modal-subtitle, #capsule-text-input, .capsule-field,
      .capsule-modal-actions, .capsule-btn:disabled { animation: none !important; }
      .capsule-eyebrow, .capsule-head, .capsule-modal-subtitle,
      #capsule-text-input, .capsule-field, .capsule-modal-actions { opacity: 1 !important; transform: none !important; }
    }
  `;
  document.head.appendChild(style);
}

// ====== Recent Rooms — the actual fix for "my capsule disappeared" ======
// Nothing in Firestore was ever deleted — the real problem was that once
// you left a room, the browser had no memory of the code to get back in.
// This keeps a small local list of rooms you've been in, with a live
// capsule-status check, so getting back is one tap instead of "hope you
// wrote the code down somewhere."

const RECENT_ROOMS_KEY = "bu_recentRooms";
const MAX_RECENT_ROOMS = 8;

function saveRecentRoom(code, category) {
  try {
    let recents = JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) || "[]");
    recents = recents.filter((r) => r.code !== code);
    recents.unshift({ code, category: category || "mix", lastVisited: Date.now() });
    recents = recents.slice(0, MAX_RECENT_ROOMS);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(recents));
  } catch (err) {
    console.error("Couldn't save recent room:", err);
  }
}

function getRecentRooms() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) || "[]");
  } catch {
    return [];
  }
}

function ensureRecentRoomsUI() {
  if (document.getElementById("recent-rooms-section")) return;
  const modeButtonsEl = document.getElementById("mode-buttons");
  if (!modeButtonsEl) return;
  injectRecentRoomsStyles();

  const section = document.createElement("div");
  section.id = "recent-rooms-section";
  section.className = "recent-rooms-section";
  section.innerHTML = `
    <p class="recent-rooms-label">↩ Your recent rooms</p>
    <div id="recent-rooms-list" class="recent-rooms-list"></div>
  `;
  modeButtonsEl.insertAdjacentElement("beforebegin", section);
}

async function renderRecentRoomsSection() {
  if (!db) return;
  const recents = getRecentRooms();
  if (!recents.length) return;

  ensureRecentRoomsUI();
  const listEl = document.getElementById("recent-rooms-list");
  if (!listEl) return;

  listEl.innerHTML = recents
    .map((r) => {
      const meta = CATEGORY_META[r.category] || CATEGORY_META.mix;
      return `<button type="button" class="recent-room-row" data-code="${escapeHtml(r.code)}">
        <span class="recent-room-main">
          <span class="recent-room-code">${escapeHtml(r.code)}</span>
          <span class="recent-room-category">${meta.emoji} ${escapeHtml(meta.label)}</span>
        </span>
        <span class="recent-room-status" id="recent-status-${escapeHtml(r.code)}">···</span>
      </button>`;
    })
    .join("");

  listEl.querySelectorAll(".recent-room-row").forEach((row) => {
    row.addEventListener("click", () => rejoinRecentRoom(row.dataset.code));
  });

  recents.forEach((r) => fetchCapsuleStatusForRoom(r.code));
}

async function fetchCapsuleStatusForRoom(code) {
  const statusEl = document.getElementById(`recent-status-${code}`);
  if (!statusEl) return;
  try {
    const capsulesQuery = query(collection(db, "rooms", code, "messages"), where("type", "==", "capsule"));
    const snap = await getDocs(capsulesQuery);
    const now = Date.now();
    let lockedCount = 0;
    let nextUnlock = null;
    snap.forEach((d) => {
      const data = d.data();
      if (data.unlockAt > now) {
        lockedCount++;
        if (nextUnlock === null || data.unlockAt < nextUnlock) nextUnlock = data.unlockAt;
      }
    });
    if (lockedCount > 0) {
      statusEl.textContent = `🔒 ${lockedCount} sealed, opens ${formatCapsuleDate(nextUnlock)}`;
      statusEl.classList.add("has-capsule");
    } else {
      statusEl.textContent = "Tap to reopen";
      statusEl.classList.remove("has-capsule");
    }
  } catch (err) {
    console.error("Couldn't check capsules for room", code, err);
    statusEl.textContent = "Tap to reopen";
  }
}

async function rejoinRecentRoom(code) {
  if (!requireName()) return;
  const row = document.querySelector(`.recent-room-row[data-code="${code}"]`);
  if (row) row.disabled = true;
  try {
    const ok = await attemptJoinRoom(code);
    if (!ok && row) row.disabled = false;
  } catch (err) {
    console.error(err);
    toast("Couldn't reconnect — try again.");
    if (row) row.disabled = false;
  }
}

function injectRecentRoomsStyles() {
  if (document.getElementById("recent-rooms-styles")) return;
  const style = document.createElement("style");
  style.id = "recent-rooms-styles";
  style.textContent = `
    .recent-rooms-section { margin-bottom: 18px; }
    .recent-rooms-label {
      font-family: var(--font-mono, monospace); font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--on-card-soft, #6b5f78); margin: 0 0 8px; font-weight: 500;
    }
    .recent-rooms-list { display: flex; flex-direction: column; gap: 8px; }
    .recent-room-row {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; padding: 12px 14px; border-radius: 10px;
      border: 1.5px dashed var(--border-card, rgba(36,28,48,0.18));
      background: var(--card-2, #fffaf1); color: var(--on-card, #241c30);
      font-family: inherit; cursor: pointer; text-align: left;
    }
    .recent-room-row:active { transform: scale(0.98); }
    .recent-room-row:disabled { opacity: 0.5; cursor: default; }
    .recent-room-main { display: flex; flex-direction: column; gap: 2px; }
    .recent-room-code { font-family: var(--font-mono, monospace); font-weight: 700; font-size: 0.92rem; letter-spacing: 0.04em; }
    .recent-room-category { font-size: 0.76rem; color: var(--on-card-soft, #6b5f78); }
    .recent-room-status { font-size: 0.76rem; color: var(--on-card-soft, #6b5f78); text-align: right; white-space: nowrap; margin-left: 10px; }
    .recent-room-status.has-capsule { color: var(--garnet, #9c3348); font-weight: 600; }
  `;
  document.head.appendChild(style);
}

// ====== AI Custom Deck Builder ======
// Describe a vibe/situation, Gemini writes a matching deck, it gets saved
// as a normal shareable pack (same packs/{code} structure, same report
// button, same 18+ gate as any other custom pack).

const DECKBUILDER_API_URL = "https://between-us-backend.vercel.app/api/deckbuilder";
let generatedDeckQuestions = [];
let deckBuilderOverlayEl = null;

function ensureDeckBuilderButton() {
  if (document.getElementById("deckbuilder-open-btn")) return;
  const anchorBtn = document.getElementById("open-pack-creator-btn");
  if (!anchorBtn) return;
  const btn = document.createElement("button");
  btn.id = "deckbuilder-open-btn";
  btn.type = "button";
  btn.className = "leave-link pack-creator-link";
  btn.textContent = "✨ Generate a deck with AI →";
  anchorBtn.insertAdjacentElement("afterend", btn);
  btn.addEventListener("click", openDeckBuilderModal);
}

function ensureDeckBuilderUI() {
  if (deckBuilderOverlayEl) return;
  injectDeckBuilderStyles();

  deckBuilderOverlayEl = document.createElement("div");
  deckBuilderOverlayEl.id = "deckbuilder-overlay";
  deckBuilderOverlayEl.className = "deckbuilder-overlay hidden";
  deckBuilderOverlayEl.innerHTML = `
    <div class="deckbuilder-modal">
      <p class="deckbuilder-title">✨ AI Deck Builder</p>
      <p class="deckbuilder-subtitle">Describe the vibe or situation — I'll write a custom deck for it.</p>
      <textarea id="deckbuilder-description" rows="3" maxlength="500" placeholder="e.g. together 6 months, want to go deeper — or game night with my best friends, keep it light and hilarious"></textarea>
      <label class="deckbuilder-count-label" for="deckbuilder-count">How many questions?</label>
      <select id="deckbuilder-count" class="select-input">
        <option value="10">10</option>
        <option value="20" selected>20</option>
        <option value="30">30</option>
      </select>
      <div id="deckbuilder-preview" class="deckbuilder-preview hidden"></div>
      <div class="deckbuilder-actions">
        <button type="button" id="deckbuilder-cancel-btn" class="deckbuilder-btn cancel">Cancel</button>
        <button type="button" id="deckbuilder-generate-btn" class="deckbuilder-btn generate">Generate ✨</button>
      </div>
    </div>
  `;
  document.body.appendChild(deckBuilderOverlayEl);

  document.getElementById("deckbuilder-cancel-btn").addEventListener("click", closeDeckBuilderModal);
  deckBuilderOverlayEl.addEventListener("click", (e) => {
    if (e.target === deckBuilderOverlayEl) closeDeckBuilderModal();
  });
  document.getElementById("deckbuilder-generate-btn").addEventListener("click", async () => {
    const genBtn = document.getElementById("deckbuilder-generate-btn");
    if (genBtn.dataset.ready === "true") {
      await useGeneratedDeck();
    } else {
      await generateDeckWithAI();
    }
  });
}

function openDeckBuilderModal() {
  ensureDeckBuilderUI();
  document.getElementById("deckbuilder-description").value = "";
  document.getElementById("deckbuilder-preview").classList.add("hidden");
  const genBtn = document.getElementById("deckbuilder-generate-btn");
  genBtn.textContent = "Generate ✨";
  genBtn.dataset.ready = "false";
  generatedDeckQuestions = [];
  deckBuilderOverlayEl.classList.remove("hidden");
}

function closeDeckBuilderModal() {
  if (deckBuilderOverlayEl) deckBuilderOverlayEl.classList.add("hidden");
}

async function generateDeckWithAI() {
  const description = document.getElementById("deckbuilder-description").value.trim();
  const count = document.getElementById("deckbuilder-count").value;
  if (!description) {
    toast("Describe the vibe first.");
    return;
  }
  const genBtn = document.getElementById("deckbuilder-generate-btn");
  const previewEl = document.getElementById("deckbuilder-preview");
  genBtn.disabled = true;
  genBtn.textContent = "Generating...";
  previewEl.classList.add("hidden");

  try {
    const res = await fetch(DECKBUILDER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, count }),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const result = await res.json();
    if (!result.success || !result.questions || !result.questions.length) {
      throw new Error("No questions returned");
    }

    generatedDeckQuestions = result.questions;
    previewEl.innerHTML =
      `<p class="deckbuilder-preview-title">Preview (${result.questions.length} questions):</p>` +
      result.questions.slice(0, 4).map((q) => `<p class="deckbuilder-preview-q">• ${escapeHtml(q)}</p>`).join("") +
      (result.questions.length > 4 ? `<p class="deckbuilder-preview-more">+ ${result.questions.length - 4} more</p>` : "");
    previewEl.classList.remove("hidden");

    genBtn.textContent = "Use This Deck ✓";
    genBtn.dataset.ready = "true";
  } catch (err) {
    console.error(err);
    toast("Couldn't generate a deck — try again.");
    genBtn.textContent = "Generate ✨";
    genBtn.dataset.ready = "false";
  } finally {
    genBtn.disabled = false;
  }
}

async function useGeneratedDeck() {
  if (!generatedDeckQuestions.length || !db) return;
  const genBtn = document.getElementById("deckbuilder-generate-btn");
  genBtn.disabled = true;
  genBtn.textContent = "Saving...";
  try {
    const code = await generateUniquePackCode();
    const description = document.getElementById("deckbuilder-description").value.trim();
    const author = nameInput.value.trim() || "Anonymous";
    const shortTitle = description.length > 40 ? description.slice(0, 40) + "…" : description;
    const title = `✨ ${shortTitle}`;

    await setDoc(doc(db, "packs", code), {
      title,
      author,
      questions: generatedDeckQuestions,
      createdAt: serverTimestamp(),
      aiGenerated: true,
    });

    const pack = { code, title, questions: generatedDeckQuestions };
    closeDeckBuilderModal();
    if (!requireName()) return;
    createStep.classList.remove("hidden");
    joinStep.classList.add("hidden");
    selectCategoryWithGate("custompack", () => {
      loadedPack = pack;
      selectedCategory = "custompack";
      packCodeInput.value = code;
      packStatusEl.textContent = `✓ Loaded "${title}" — ${generatedDeckQuestions.length} questions, code ${code}`;
      packStatusEl.classList.add("ok");
      renderCategoryChips();
      packPanelEl.classList.remove("hidden");
      ensureReportPackButton();
      toast(`Deck ready — saved as ${code}`);
    });
  } catch (err) {
    console.error(err);
    toast("Couldn't save that deck — try again.");
  } finally {
    genBtn.disabled = false;
  }
}

function injectDeckBuilderStyles() {
  if (document.getElementById("deckbuilder-styles")) return;
  const style = document.createElement("style");
  style.id = "deckbuilder-styles";
  style.textContent = `
    .deckbuilder-overlay { 
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.65); 
      display: flex; align-items: center; justify-content: center; 
      z-index: 1050; padding: 20px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: deckbuilder-backdrop-in 0.25s ease-out;
    }
    @keyframes deckbuilder-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    
    .deckbuilder-modal { 
      background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 30%, rgba(0,0,0,0.015) 100%), var(--card, #f6efe1); 
      color: var(--on-card, #241c30); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.08));
      border-radius: 22px; max-width: 440px; width: 100%; padding: 28px 24px; 
      box-shadow: 0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.03); 
      font-family: 'Plus Jakarta Sans', sans-serif; max-height: 86vh; overflow-y: auto;
      animation: deckbuilder-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes deckbuilder-in { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    
    .deckbuilder-title { font-family: 'Fraunces', serif; font-size: 22px; margin: 0 0 6px; font-weight: 500; letter-spacing: -0.01em; font-optical-sizing: auto; } 
    .deckbuilder-subtitle { font-size: 14px; opacity: 0.75; margin: 0 0 20px; line-height: 1.5; } 
    
    #deckbuilder-description { 
      width: 100%; border-radius: 12px; border: 1.5px solid var(--border-card, rgba(36,28,48,0.12)); 
      padding: 12px 14px; font-family: inherit; font-size: 15px; resize: vertical; margin-bottom: 16px; 
      background: var(--card-2, #fffaf1);
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.03), 0 1px 0 rgba(255,255,255,0.6);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    #deckbuilder-description:focus {
      outline: none; border-color: var(--garnet, #9c3348);
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.03), 0 0 0 4px rgba(156, 51, 72, 0.15);
    }
    
    .deckbuilder-count-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; margin-bottom: 8px; font-weight: 500; } 
    #deckbuilder-count { margin-bottom: 8px; } 
    
    .deckbuilder-preview { 
      margin-top: 16px; padding: 14px; border-radius: 12px; 
      background: var(--card-2, #fffaf1); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.08));
      font-size: 13.5px; line-height: 1.55; 
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
    } 
    .deckbuilder-preview-title { margin: 0 0 8px; font-weight: 600; opacity: 0.8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-family: 'IBM Plex Mono', monospace; } 
    .deckbuilder-preview-q { margin: 4px 0; color: var(--on-card, #241c30); } 
    .deckbuilder-preview-more { margin: 8px 0 0; opacity: 0.6; font-style: italic; } 
    
    .deckbuilder-actions { display: flex; gap: 12px; margin-top: 24px; } 
    .deckbuilder-btn { 
      flex: 1; padding: 14px; border-radius: 12px; border: none; 
      font-weight: 600; cursor: pointer; font-family: inherit; font-size: 0.95rem; 
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, filter 0.15s ease;
    } 
    .deckbuilder-btn:active { transform: translateY(2px) scale(0.97); }
    .deckbuilder-btn.cancel { 
      background: var(--card-2, #fffaf1); color: var(--on-card, #241c30); 
      border: 1px solid var(--border-card, rgba(36,28,48,0.12));
      box-shadow: 0 2px 0 var(--border-card), 0 4px 12px rgba(36, 28, 48, 0.05);
    }
    .deckbuilder-btn.cancel:active { box-shadow: 0 0 0 var(--border-card); filter: brightness(0.98); }
    .deckbuilder-btn.generate { 
      background: var(--gold, #c9a15a); color: #241c30; 
      box-shadow: 0 2px 0 var(--garnet, #9c3348), 0 6px 16px rgba(156, 51, 72, 0.22);
    }
    .deckbuilder-btn.generate:active { box-shadow: 0 0 0 var(--garnet, #9c3348), 0 2px 6px rgba(156, 51, 72, 0.18); filter: brightness(0.97); }
    .deckbuilder-btn:disabled { opacity: 0.85; cursor: wait; animation: btn-processing 1.8s ease-in-out infinite; box-shadow: none; transform: none; }
  `;
  document.head.appendChild(style);
}

// ====== PWA install support ======
// Registers the service worker so the browser offers "Add to Home Screen."
// Wrapped defensively — if this fails for any reason (unsupported browser,
// scope issue), it only logs a warning and never touches app functionality.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed (app still works fine without it):", err);
    });
  });
}

// ====== Premium Polish — micro-interactions ======
// Purely additive: these attach alongside the existing handlers above and
// only ever toggle a CSS animation class. Nothing here changes what
// actually happens on submit, skip, or favorite — same Firestore calls,
// same game flow, just visual feedback layered on top.

answerFormEl.addEventListener("submit", () => {
  const btn = answerFormEl.querySelector(".btn-primary");
  if (!btn) return;
  btn.classList.remove("success-flash");
  void btn.offsetWidth;
  btn.classList.add("success-flash");
});

skipBtn.addEventListener("click", () => {
  skipBtn.classList.remove("skip-btn-tap");
  void skipBtn.offsetWidth;
  skipBtn.classList.add("skip-btn-tap");
});

favoriteBtn.addEventListener("click", () => {
  favoriteBtn.classList.remove("bounce");
  void favoriteBtn.offsetWidth;
  favoriteBtn.classList.add("bounce");
});

// ====== Home button — a clear way back to the landing screen ======
// Additive: builds its own control, reuses leaveRoom() and the age-gate
// modal styles. No game logic, no Firebase, no renamed selectors.
// Mid-game it confirms first (a live conversation is worth protecting);
// from End / Memory / Waiting it goes straight home (the room is safely
// kept in Firestore + Recent Rooms, so nothing is ever lost).
let homeToggleBtn = null;
function ensureHomeButton() {
  if (homeToggleBtn) return;
  homeToggleBtn = document.createElement("button");
  homeToggleBtn.type = "button";
  homeToggleBtn.id = "home-toggle";
  homeToggleBtn.className = "home-toggle hidden";
  homeToggleBtn.setAttribute("aria-label", "Leave and go to the home screen");
  homeToggleBtn.title = "Leave & go home";
  homeToggleBtn.textContent = "🏠";
  memoryToggleBtn.insertAdjacentElement("beforebegin", homeToggleBtn);
  homeToggleBtn.addEventListener("click", goHome);
}
function goHome() {
  const total = currentRoomData && currentRoomData.questions ? currentRoomData.questions.length : 0;
  const inActiveGame = !!(currentRoomData && currentRoomData.started && currentRoomData.currentIndex < total);
  if (inActiveGame) showLeaveConfirm();
  else leaveRoom();
}
function showLeaveConfirm() {
  injectAgeGateStyles(); // re-use the on-brand modal skin already in the app
  const overlay = document.createElement("div");
  overlay.className = "agegate-overlay";
  overlay.innerHTML = `<div class="agegate-modal"> <p class="agegate-icon">🏠</p> <h3 class="agegate-title">Leave this conversation?</h3> <p class="agegate-text">You can jump back in any time from “Your recent rooms” on the home screen — nothing you've said is lost.</p> <div class="agegate-actions"> <button type="button" class="btn btn-secondary leave-confirm-stay">Stay &amp; keep playing</button> <button type="button" class="btn btn-primary leave-confirm-go">Leave &amp; go home</button> </div> </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".leave-confirm-stay").addEventListener("click", close);
  overlay.querySelector(".leave-confirm-go").addEventListener("click", () => { close(); leaveRoom(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
ensureHomeButton();
