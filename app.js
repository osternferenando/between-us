// ====== Between Us — app.js ======
// Wires together the UI, the question bank, and Firebase (which is what
// lets multiple phones see each other's answers in real time).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp,
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
  unsubscribeRoom = null;
  unsubscribePresence = null;
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

function buildShuffledQuestions(category, conversationMode) {
  if (category === "custompack") {
    return loadedPack ? shuffle(loadedPack.questions) : [];
  }
  const pool = category === "mix" ? Object.values(QUESTIONS).flat() : QUESTIONS[category];
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
  const order = ["mix", "love", "friendship", "family", "deep", "funny", "party", "firstImpressions", "wouldYouRather", "confessions", "dares", "wyd", "vote", "custompack"];
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
      packPanelEl.classList.toggle("hidden", key !== "custompack");
      if (key === "vote" && Number(maxPlayersSelect.value) < 3) {
        maxPlayersSelect.value = "3";
      }
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
  loadedPack = {
    code,
    title: packTitleInput.value.trim(),
    questions: packQuestionsInput.value.split("\n").map((l) => l.trim()).filter(Boolean),
  };
  selectedCategory = "custompack";
  packCodeInput.value = code;
  packStatusEl.textContent = `✓ Loaded "${loadedPack.title}" — ${loadedPack.questions.length} questions by you`;
  packStatusEl.classList.add("ok");
  showScreen("landing");
  if (!requireName()) return;
  createStep.classList.remove("hidden");
  joinStep.classList.add("hidden");
  renderCategoryChips();
  packPanelEl.classList.remove("hidden");
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
        toast("That code's taken — try another or leave it blank.");
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
    const maxPlayers = data.maxPlayers || 2;
    if (!alreadyIn && data.started) {
      toast("That game has already started.");
      return;
    }
    if (!alreadyIn && playerCount >= maxPlayers) {
      toast(`That room already has ${maxPlayers} players.`);
      return;
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
    listenToRoom(code);
    setupPresence(code, playerId);
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
  categoryTagEl.style.setProperty("--stamp", meta.color);
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
  categoryTagEl.style.setProperty("--stamp", meta.color);
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
  
  // Try to restore active game first (if user refreshed mid-game)
  if (await restoreGameState()) {
    return; // Game state restored, no need to show landing page
  }

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
        loadedPack = { code: prefillPack.toUpperCase(), title: data.title, questions: data.questions };
        selectedCategory = "custompack";
        packCodeInput.value = prefillPack.toUpperCase();
        packStatusEl.textContent = `✓ Loaded "${data.title}" — ${data.questions.length} questions by ${data.author}`;
        packStatusEl.classList.add("ok");
        renderCategoryChips();
        packPanelEl.classList.remove("hidden");
        toast("Pack loaded — type your name and create a room");
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
