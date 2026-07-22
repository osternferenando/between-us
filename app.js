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
let journalGenerationInFlight = false; // prevents duplicate journal calls from rapid snapshot updates


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
  Object.entries(screens).forEach(([key, node]) => {
    node.classList.toggle("hidden", key !== name);
  });
  memoryToggleBtn.classList.toggle("hidden", !["game", "end"].includes(name));
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
  for (let i = 0; i < data.currentIndex; i++) {
    if (data.category === "vote") {
      const votesForQ = (data.votes && data.votes[i]) || {};
      const complete = sortedIds.every((id) => votesForQ[id] !== undefined);
      if (!complete) continue;
      const tally = {};
      sortedIds.forEach((id) => (tally[id] = 0));
      Object.values(votesForQ).forEach((t) => {
        if (t !== SKIPPED && tally[t] !== undefined) tally[t] += 1;
      });
      const winnerId = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      entries.push(
        `<div class="memory-entry"><span class="index-number">No. ${String(i + 1).padStart(3, "0")}</span>` +
        `<p class="memory-q">${favorites.has(data.questions[i]) ? "♥ " : ""}${escapeHtml(data.questions[i])}</p>` +
        `<p class="memory-a"><b>Most votes</b>${escapeHtml(data.players[winnerId]?.name || "—")} (${tally[winnerId] || 0})</p></div>`
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
    entries.push(
      `<div class="memory-entry"><span class="index-number">No. ${String(i + 1).padStart(3, "0")}</span>` +
      `<p class="memory-q">${favorites.has(data.questions[i]) ? "♥ " : ""}${escapeHtml(data.questions[i])}</p>${answerRows}</div>`
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
exportKeepsakeBtn.addEventListener("click", async () => {
    // 1. Prevent spam clicking
    exportKeepsakeBtn.disabled = true;
    exportKeepsakeBtn.textContent = "Snapping... 📸";

    // 2. Temporarily hide the UI buttons we don't want in the final picture
    const originalNextBtnDisplay = nextBtn.style.display;
    nextBtn.style.display = "none";
    exportKeepsakeBtn.style.display = "none";
    leaveRoomBtn.style.display = "none";

    try {
        // 3. Take a high-res snapshot of the whole app container
        const captureArea = el("app");
        const canvas = await html2canvas(captureArea, {
            backgroundColor: getComputedStyle(document.body).backgroundColor, // Matches dark/light mode
            scale: 2, // Doubles the resolution for crisp social media sharing
            useCORS: true // Ensures custom fonts load correctly in the image
        });

        // 4. Convert the canvas into a downloadable PNG file
        const image = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = image;
        link.download = `BetweenUs-Memory-${Math.floor(Math.random() * 10000)}.png`;
        
        // 5. Trigger the download!
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast("Image saved to your device! 📸");
    } catch (err) {
        console.error("Export failed:", err);
        toast("Couldn't save the image right now.");
    } finally {
        // 6. Bring all the buttons back so the game can continue
        nextBtn.style.display = originalNextBtnDisplay;
        exportKeepsakeBtn.style.display = "block";
        leaveRoomBtn.style.display = "block";
        exportKeepsakeBtn.disabled = false;
        exportKeepsakeBtn.textContent = "Save as Image 📸";
    }
});

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
        <button class="journal-close" onclick="this.closest('.journal-modal').remove()">×</button>
      </div>
      
      <div class="journal-content">
        <div class="journal-category">${journalData.category}</div>
        <p class="journal-text">${journalData.journalEntry}</p>
        <div class="journal-meta">
          <span>${journalData.duration} minutes</span>
          <span>${new Date(journalData.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div class="journal-actions">
        <button class="journal-btn" onclick="saveJournal('${journalData.category}', '${journalData.timestamp}', '${journalData.journalEntry.replace(/'/g, "\\'")}')">
          💾 Save Entry
        </button>
        <button class="journal-btn" onclick="exportJournal('${journalData.category}', '${journalData.journalEntry.replace(/'/g, "\\'")}')">
          📥 Export
        </button>
        <button class="journal-btn" onclick="this.closest('.journal-modal').remove()">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

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
const journalStyles = `
<style>
.journal-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.journal-container {
  background: white;
  border-radius: 16px;
  max-width: 500px;
  width: 90%;
  padding: 30px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.4s ease;
}

@keyframes slideUp {
  from { transform: translateY(40px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.journal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  border-bottom: 2px solid #f0f0f0;
  padding-bottom: 15px;
}

.journal-header h2 {
  margin: 0;
  font-size: 24px;
  color: #333;
}

.journal-close {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: #999;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.journal-close:hover {
  color: #333;
}

.journal-content {
  margin-bottom: 25px;
}

.journal-category {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  margin-bottom: 15px;
}

.journal-text {
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  font-style: italic;
  margin: 15px 0;
  padding: 15px;
  background: #f9f9f9;
  border-left: 4px solid #667eea;
  border-radius: 4px;
}

.journal-meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #999;
  padding-top: 10px;
}

.journal-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.journal-btn {
  flex: 1;
  min-width: 120px;
  padding: 12px 16px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s;
}

.journal-btn:hover {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

.journal-btn:active {
  transform: translateY(0);
}
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
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.8);
      display: flex; align-items: center; justify-content: center;
      z-index: 1100; padding: 20px; backdrop-filter: blur(4px);
    }
    .agegate-modal {
      background: var(--card, #f6efe1); color: var(--on-card, #241c30);
      border-radius: 16px; max-width: 380px; width: 100%;
      padding: 30px 24px; text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      font-family: 'Fraunces', serif;
      animation: agegate-in 0.25s ease-out;
    }
    @keyframes agegate-in {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    .agegate-icon { font-size: 38px; margin: 0 0 8px; }
    .agegate-title { margin: 0 0 10px; font-size: 20px; }
    .agegate-text { font-size: 14px; line-height: 1.5; opacity: 0.85; margin: 0 0 22px; }
    .agegate-actions { display: flex; flex-direction: column; gap: 10px; }
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

let chatToggleBtn = null;
let chatOverlayEl = null;
let chatMessagesEl = null;
let chatInputEl = null;
let chatTypingIndicatorEl = null;

let unsubscribeMessages = null;
let chatMessages = [];
let chatOverlayOpen = false;
let lastSeenMessageCount = 0;

let isChatTypingFlagged = false;
let chatTypingTimer = null;

let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
const MAX_VOICE_SECONDS = 30;

// ---------- Build the UI once ----------
function ensureChatUI() {
  if (chatOverlayEl) return;
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
      <div class="chat-header">
        <span class="chat-header-title">💬 Just Chatting</span>
        <div class="chat-header-actions">
          <button type="button" id="capsule-open-btn" class="chat-header-icon-btn" aria-label="Seal a time capsule">🔒</button>
          <button type="button" id="chat-close-btn" class="chat-close-btn" aria-label="Close chat">×</button>
        </div>
      </div>
      <div id="chat-messages" class="chat-messages"></div>
      <p id="chat-typing-indicator" class="typing-indicator hidden"></p>
      <form id="chat-form" class="chat-form">
        <textarea id="chat-input" rows="1" maxlength="500" placeholder="Type a message..."></textarea>
        <button type="button" id="chat-voice-btn" class="chat-voice-btn" aria-label="Hold to record a voice note">🎤</button>
        <button type="submit" class="chat-send-btn" aria-label="Send">➤</button>
      </form>
    </div>
  `;
  document.body.appendChild(chatOverlayEl);

  chatMessagesEl = document.getElementById("chat-messages");
  chatInputEl = document.getElementById("chat-input");
  chatTypingIndicatorEl = document.getElementById("chat-typing-indicator");

  document.getElementById("chat-close-btn").addEventListener("click", closeChatOverlay);
  document.getElementById("capsule-open-btn").addEventListener("click", openCapsuleComposer);
  ensureCapsuleUI();
  startCapsuleWatcher();
  chatOverlayEl.addEventListener("click", (e) => {
    if (e.target === chatOverlayEl) closeChatOverlay();
  });

  chatMessagesEl.addEventListener("click", handleChatAction);

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInputEl.value;
    if (!text.trim()) return;
    sendChatMessage(text);
    chatInputEl.value = "";
    stopChatTyping();
  });
  chatInputEl.addEventListener("input", handleChatTypingInput);

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
}

function openChatOverlay() {
  ensureChatUI();
  chatOverlayOpen = true;
  chatOverlayEl.classList.remove("hidden");
  renderChatMessages();
  chatInputEl.focus();
}

function closeChatOverlay() {
  chatOverlayOpen = false;
  if (chatOverlayEl) chatOverlayEl.classList.add("hidden");
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
  chatMessagesEl.innerHTML = chatMessages.map(renderChatMessageHTML).join("");
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  lastSeenMessageCount = chatMessages.length;
  updateChatBadge();
}

function renderChatMessageHTML(msg) {
  const isMe = msg.senderId === playerId;
  const reactions = msg.reactions || {};
  const myReact = reactions[playerId];
  const theirEntry = Object.entries(reactions).find(([id]) => id !== playerId);
  const theirReact = theirEntry ? theirEntry[1] : null;

  if (msg.type === "capsule") {
    return renderCapsuleBubbleHTML(msg, isMe, myReact, theirReact);
  }

  let bodyHTML;
  if (msg.type === "voice") {
    bodyHTML = `
      <button class="voice-play-btn" data-action="play-voice" data-msg-id="${msg.id}" type="button">▶</button>
      <span class="voice-duration">${msg.audioDuration || 0}s voice note</span>
    `;
  } else {
    bodyHTML = `<p>${escapeHtml(msg.text || "")}</p>`;
  }

  const cardBtn = msg.type === "text"
    ? `<button class="chat-to-card-btn" data-action="to-card" data-msg-id="${msg.id}" type="button" title="Turn into a question card">🎴</button>`
    : "";

  const reactBtns = !isMe
    ? `<div class="chat-reaction-bar">
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="❤️" class="${myReact === "❤️" ? "active" : ""}" type="button">❤️</button>
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="😂" class="${myReact === "😂" ? "active" : ""}" type="button">😂</button>
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="🔥" class="${myReact === "🔥" ? "active" : ""}" type="button">🔥</button>
      </div>`
    : "";

  return `<div class="chat-bubble ${isMe ? "me" : "them"}">
    ${bodyHTML}
    ${theirReact ? `<span class="msg-reaction-shown">${theirReact}</span>` : ""}
    <div class="chat-bubble-actions">${cardBtn}${reactBtns}</div>
  </div>`;
}

function handleChatAction(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, msgId, emoji } = btn.dataset;
  const msg = chatMessages.find((m) => m.id === msgId);
  if (!msg) return;

  if (action === "play-voice") {
    playVoiceMessage(msg);
  } else if (action === "to-card") {
    if (msg.text) {
      pendingMediatorQuestion = msg.text;
      toast("Queued — it'll show up as your next card 🎴");
    }
  } else if (action === "react") {
    reactToChatMessage(msgId, emoji);
  }
}

function playVoiceMessage(msg) {
  if (!msg.audioData) return;
  const audio = new Audio(msg.audioData);
  audio.play().catch((err) => {
    console.error("Playback failed:", err);
    toast("Couldn't play that voice note.");
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
    .chat-toggle {
      position: fixed !important;
      top: 50% !important;
      left: auto !important;
      bottom: auto !important;
      right: 14px !important;
      transform: translateY(-50%);
      z-index: 500;
      width: 52px; height: 52px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.35);
    }
    .chat-toggle:active { transform: translateY(-50%) scale(0.94); }
    .chat-badge {
      position: absolute; top: -4px; right: -4px;
      background: #c9425a; color: #fff; border-radius: 999px;
      font-size: 11px; line-height: 1; padding: 3px 6px;
      font-family: 'IBM Plex Mono', monospace;
    }
    .chat-overlay {
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.72);
      display: flex; align-items: flex-end; justify-content: center;
      z-index: 950; backdrop-filter: blur(3px);
    }
    .chat-panel {
      background: var(--card, #f6efe1); color: var(--on-card, #241c30);
      width: 100%; max-width: 480px; height: 82vh; max-height: 720px;
      border-radius: 20px 20px 0 0; display: flex; flex-direction: column;
      box-shadow: 0 -10px 40px rgba(0,0,0,0.35);
      animation: chat-slide-up 0.25s ease-out;
    }
    @keyframes chat-slide-up {
      from { transform: translateY(24px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .chat-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 18px; border-bottom: 1px solid rgba(0,0,0,0.08);
      font-family: 'Fraunces', serif; font-size: 17px;
    }
    .chat-close-btn { background: none; border: none; font-size: 24px; cursor: pointer; color: inherit; opacity: 0.6; }
    .chat-close-btn:hover { opacity: 1; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .chat-bubble {
      max-width: 78%; padding: 10px 14px; border-radius: 16px;
      font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; line-height: 1.4;
      position: relative;
    }
    .chat-bubble.me { align-self: flex-end; background: var(--gold, #c9a15a); color: #241f14; border-bottom-right-radius: 4px; }
    .chat-bubble.them { align-self: flex-start; background: rgba(0,0,0,0.06); border-bottom-left-radius: 4px; }
    .chat-bubble p { margin: 0; white-space: pre-wrap; word-break: break-word; }
    .chat-bubble-actions { display: flex; gap: 6px; margin-top: 6px; opacity: 0.7; }
    .chat-to-card-btn, .chat-reaction-bar button {
      background: none; border: none; font-size: 13px; cursor: pointer; padding: 2px 4px; border-radius: 6px;
    }
    .chat-reaction-bar button.active { background: rgba(0,0,0,0.12); }
    .msg-reaction-shown { display: block; font-size: 13px; margin-top: 4px; }
    .voice-play-btn {
      background: rgba(0,0,0,0.15); border: none; border-radius: 999px;
      width: 30px; height: 30px; cursor: pointer; font-size: 13px; margin-right: 8px;
    }
    .voice-duration { font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
    .chat-form { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(0,0,0,0.08); align-items: flex-end; }
    .chat-form textarea {
      flex: 1; resize: none; border-radius: 14px; border: 1px solid rgba(0,0,0,0.15);
      padding: 10px 12px; font-family: inherit; font-size: 15px;
      min-height: 42px; max-height: 90px; margin-bottom: 0;
    }
    #chat-typing-indicator.typing-indicator {
      color: var(--on-card-soft, #6b5f78);
      margin: 0 16px 4px;
      text-align: left;
    }
    .chat-send-btn, .chat-voice-btn {
      border: none; border-radius: 999px; width: 42px; height: 42px; flex-shrink: 0;
      font-size: 17px; cursor: pointer; background: var(--gold, #c9a15a); color: #241f14;
    }
    .chat-voice-btn { background: rgba(0,0,0,0.08); color: inherit; touch-action: none; user-select: none; }
    .chat-voice-btn.recording { background: #c9425a; color: #fff; animation: chat-pulse 1s infinite; }
    @keyframes chat-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
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
  capsuleOverlayEl.innerHTML = `
    <div class="capsule-modal">
      <p class="capsule-modal-title">🔒 Seal a Time Capsule</p>
      <p class="capsule-modal-subtitle">Write something for later — it stays sealed until the date you pick.</p>
      <textarea id="capsule-text-input" rows="4" maxlength="2000" placeholder="Dear you, in the future..."></textarea>
      <label class="capsule-date-label" for="capsule-date-input">Unlocks on</label>
      <input type="datetime-local" id="capsule-date-input">
      <div class="capsule-modal-actions">
        <button type="button" id="capsule-cancel-btn" class="capsule-btn cancel">Cancel</button>
        <button type="button" id="capsule-seal-btn" class="capsule-btn seal">Seal it 🔒</button>
      </div>
    </div>
  `;
  document.body.appendChild(capsuleOverlayEl);

  document.getElementById("capsule-cancel-btn").addEventListener("click", closeCapsuleComposer);
  document.getElementById("capsule-seal-btn").addEventListener("click", sealTimeCapsule);
  capsuleOverlayEl.addEventListener("click", (e) => {
    if (e.target === capsuleOverlayEl) closeCapsuleComposer();
  });
}

function openCapsuleComposer() {
  ensureCapsuleUI();
  const dateInput = document.getElementById("capsule-date-input");
  dateInput.min = new Date(Date.now() + 60000).toISOString().slice(0, 16);
  document.getElementById("capsule-text-input").value = "";
  dateInput.value = "";
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
    toast("Sealed 🔒 — it'll unlock on the date you picked.");
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

function renderCapsuleBubbleHTML(msg, isMe, myReact, theirReact) {
  const isUnlocked = Date.now() >= msg.unlockAt;
  const senderName = isMe ? "You" : (currentRoomData?.players?.[msg.senderId]?.name || "Them");

  if (!isUnlocked) {
    return `<div class="chat-bubble capsule-bubble locked ${isMe ? "me" : "them"}">
      <p class="capsule-label">🔒 Time Capsule from ${escapeHtml(senderName)}</p>
      <p class="capsule-unlock-date">Opens ${formatCapsuleDate(msg.unlockAt)}</p>
    </div>`;
  }

  const reactBtns = !isMe
    ? `<div class="chat-reaction-bar">
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="❤️" class="${myReact === "❤️" ? "active" : ""}" type="button">❤️</button>
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="🥹" class="${myReact === "🥹" ? "active" : ""}" type="button">🥹</button>
        <button data-action="react" data-msg-id="${msg.id}" data-emoji="😭" class="${myReact === "😭" ? "active" : ""}" type="button">😭</button>
      </div>`
    : "";

  return `<div class="chat-bubble capsule-bubble unlocked ${isMe ? "me" : "them"}">
    <p class="capsule-label">📦 Time Capsule — opened</p>
    <p>${escapeHtml(msg.text || "")}</p>
    ${theirReact ? `<span class="msg-reaction-shown">${theirReact}</span>` : ""}
    ${reactBtns}
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
    .chat-header-actions { display: flex; align-items: center; gap: 10px; }
    .chat-header-icon-btn { background: none; border: none; font-size: 19px; cursor: pointer; opacity: 0.75; padding: 2px; }
    .chat-header-icon-btn:hover { opacity: 1; }

    .capsule-overlay {
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 1050; padding: 20px; backdrop-filter: blur(3px);
    }
    .capsule-modal {
      background: var(--card, #f6efe1); color: var(--on-card, #241c30);
      border-radius: 16px; max-width: 420px; width: 100%;
      padding: 26px 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      font-family: 'Plus Jakarta Sans', sans-serif;
      animation: agegate-in 0.25s ease-out;
    }
    .capsule-modal-title { font-family: 'Fraunces', serif; font-size: 19px; margin: 0 0 6px; }
    .capsule-modal-subtitle { font-size: 13px; opacity: 0.75; margin: 0 0 16px; line-height: 1.4; }
    #capsule-text-input {
      width: 100%; border-radius: 10px; border: 1px solid rgba(0,0,0,0.15);
      padding: 10px 12px; font-family: inherit; font-size: 15px; resize: vertical;
      margin-bottom: 14px;
    }
    .capsule-date-label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin-bottom: 6px; }
    #capsule-date-input {
      width: 100%; border-radius: 10px; border: 1px solid rgba(0,0,0,0.15);
      padding: 10px 12px; font-family: inherit; font-size: 15px;
    }
    .capsule-modal-actions { display: flex; gap: 10px; margin-top: 18px; }
    .capsule-btn { flex: 1; padding: 12px; border-radius: 10px; border: none; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 0.95rem; }
    .capsule-btn.cancel { background: rgba(0,0,0,0.08); color: inherit; }
    .capsule-btn.seal { background: var(--gold, #c9a15a); color: #241c30; }

    .chat-bubble.capsule-bubble {
      border: 1.5px dashed rgba(0,0,0,0.25);
      background: rgba(0,0,0,0.05);
      max-width: 88%;
    }
    .capsule-bubble.locked { text-align: center; }
    .capsule-label { margin: 0; font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; letter-spacing: 0.03em; opacity: 0.8; }
    .capsule-unlock-date { margin: 4px 0 0; font-size: 0.85rem; font-weight: 600; }
    .capsule-bubble.unlocked { border-style: solid; }
    .capsule-bubble.unlocked p:not(.capsule-label) { margin: 6px 0 0; font-family: 'Fraunces', serif; font-style: italic; }
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
      statusEl.textContent = `🔒 ${lockedCount} sealed — opens ${formatCapsuleDate(nextUnlock)}`;
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
      position: fixed; inset: 0; background: rgba(20, 18, 14, 0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 1050; padding: 20px; backdrop-filter: blur(3px);
    }
    .deckbuilder-modal {
      background: var(--card, #f6efe1); color: var(--on-card, #241c30);
      border-radius: 16px; max-width: 440px; width: 100%;
      padding: 26px 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      font-family: 'Plus Jakarta Sans', sans-serif;
      max-height: 86vh; overflow-y: auto;
    }
    .deckbuilder-title { font-family: 'Fraunces', serif; font-size: 19px; margin: 0 0 6px; }
    .deckbuilder-subtitle { font-size: 13px; opacity: 0.75; margin: 0 0 16px; line-height: 1.4; }
    #deckbuilder-description {
      width: 100%; border-radius: 10px; border: 1px solid rgba(0,0,0,0.15);
      padding: 10px 12px; font-family: inherit; font-size: 15px; resize: vertical;
      margin-bottom: 14px;
    }
    .deckbuilder-count-label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin-bottom: 6px; }
    #deckbuilder-count { margin-bottom: 6px; }
    .deckbuilder-preview {
      margin-top: 14px; padding: 12px; border-radius: 10px;
      background: rgba(0,0,0,0.05); font-size: 13px; line-height: 1.5;
    }
    .deckbuilder-preview-title { margin: 0 0 6px; font-weight: 700; opacity: 0.7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .deckbuilder-preview-q { margin: 3px 0; }
    .deckbuilder-preview-more { margin: 6px 0 0; opacity: 0.6; font-style: italic; }
    .deckbuilder-actions { display: flex; gap: 10px; margin-top: 18px; }
    .deckbuilder-btn { flex: 1; padding: 12px; border-radius: 10px; border: none; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 0.95rem; }
    .deckbuilder-btn.cancel { background: rgba(0,0,0,0.08); color: inherit; }
    .deckbuilder-btn.generate { background: var(--gold, #c9a15a); color: #241c30; }
    .deckbuilder-btn:disabled { opacity: 0.6; cursor: default; }
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
