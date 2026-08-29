document.documentElement.style.visibility = "hidden";

const API_URL = "https://xobdle-api.supportxobdle.workers.dev";

let puzzleDate = null;
let keys = [];
let yesterdayAnswer = "";
let keyboardRows = [];
let apiState = "loading";

const MAX_GUESSES = 5;
const WORD_LENGTH = 5;

let currentGuess = [];
let guesses = [];
let evaluations = [];
let gameOver = false;
let gameStartedAt = null;
let gameFinishedAt = null;
let elapsedSeconds = 0;
let timerInterval = null;

function getISTNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const v = Object.fromEntries(
    parts.filter(p => p.type !== "literal").map(p => [p.type, p.value])
  );

  return {
    year: Number(v.year),
    month: Number(v.month),
    day: Number(v.day),
    hour: Number(v.hour),
    minute: Number(v.minute),
    second: Number(v.second)
  };
}

function isoDateFromParts(p) {
  return [
    String(p.year),
    String(p.month).padStart(2, "0"),
    String(p.day).padStart(2, "0")
  ].join("-");
}

function getISTISODate(offsetDays = 0) {
  const p = getISTNowParts();
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays, 12, 0, 0));
  return [
    base.getUTCFullYear(),
    String(base.getUTCMonth() + 1).padStart(2, "0"),
    String(base.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function formattedISTDate(offsetDays = 0) {
  const iso = getISTISODate(offsetDays);
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

function todayStorageKey() {
  return `xobdle-${getISTISODate(0)}`;
}

function getSiteState() {
  return apiState;
}

async function fetchPuzzleState() {
  try {
    const response = await fetch(API_URL + "/puzzle", {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) throw new Error("Puzzle request failed.");

    const data = await response.json();

    if (data.status === "live") {
      apiState = "live";
      puzzleDate = data.date || getISTISODate(0);
      keys = Array.isArray(data.keys) ? data.keys : [];
      yesterdayAnswer = data.yesterdayAnswer || "";

      keyboardRows = [
        keys.slice(0, 8),
        keys.slice(8, 16),
        keys.slice(16, 24),
        keys.slice(24, 28)
      ];
    } else {
      apiState = "cooking";
      puzzleDate = null;
      keys = [];
      yesterdayAnswer = "";
      keyboardRows = [];
    }

    return data;
  } catch (error) {
    console.warn("Could not load Xobdle API:", error);
    apiState = "cooking";
    return { status: "cooking" };
  }
}

async function checkGuessWithAPI(guess) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({ guess })
  });

  if (!response.ok) throw new Error("Guess request failed.");
  return await response.json();
}

function showStatusPage() {
  document.getElementById("gamePage").classList.add("hidden");
  document.getElementById("resultPage").classList.add("hidden");
  document.getElementById("statusPage").classList.remove("hidden");

  const message = document.getElementById("statusMessage");
  const sub = document.getElementById("statusSubmessage");

  message.textContent = "Today’s Xobdle is being cooked. 🍳";
  sub.innerHTML =
    'Come back soon.<br><a href="mailto:xobdlesupport@gmail.com">xobdlesupport@gmail.com</a>';

  refitSoon();
}

function saveTodayState() {
  const state = {
    completed: gameOver,
    guesses,
    evaluations,
    currentGuess,
    elapsedSeconds,
    startedAt: gameStartedAt,
    finishedAt: gameFinishedAt
  };
  try {
    localStorage.setItem(todayStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save today's Xobdle state:", error);
  }
}

function loadTodayState() {
  try {
    const raw = localStorage.getItem(todayStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Could not load today's Xobdle state:", error);
    return null;
  }
}

function restoreTodayState() {
  const state = loadTodayState();
  if (!state) return false;

  guesses = Array.isArray(state.guesses) ? state.guesses : [];
  evaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
  currentGuess = Array.isArray(state.currentGuess) ? state.currentGuess : [];
  elapsedSeconds = Number(state.elapsedSeconds || 0);
  gameStartedAt = state.startedAt || null;

  if (state.completed) {
    gameOver = true;
    gameFinishedAt = state.finishedAt || Date.now();
  }

  renderBoard();
  updateKeyboardStatuses();

  if (state.completed) showResult();
  return true;
}

const board = document.getElementById("board");
const keyboard = document.getElementById("keyboard");
const message = document.getElementById("message");
const resultCanvas = document.getElementById("resultCanvas");
const ctx = resultCanvas.getContext("2d");

const COLORS = {
  background: "#ffffff",
  card: "#ffffff",
  text: "#202020",
  muted: "#8b877f",
  green: "#4f8c65",
  yellow: "#c39a3b",
  gray: "#aaa49c",
  emptyBorder: "#d4cec5",
  orange: "#d96f32"
};

const yesterdayOverlay = document.getElementById("yesterdayOverlay");
const yesterdayBtn = document.getElementById("yesterdayBtn");
const yesterdayClose = document.getElementById("yesterdayClose");

function updateYesterdayPopup() {
  document.getElementById("yesterdayDate").textContent = formattedISTDate(-1);
  document.getElementById("yesterdayAnswer").textContent = yesterdayAnswer || "";
}

yesterdayBtn.addEventListener("click", () => yesterdayOverlay.classList.remove("hidden"));
yesterdayClose.addEventListener("click", () => yesterdayOverlay.classList.add("hidden"));
yesterdayOverlay.addEventListener("click", event => {
  if (event.target === yesterdayOverlay) yesterdayOverlay.classList.add("hidden");
});

const instructionsOverlay = document.getElementById("instructionsOverlay");
const helpBtn = document.getElementById("helpBtn");
const instructionsClose = document.getElementById("instructionsClose");

function openInstructions() {
  instructionsOverlay.classList.remove("hidden");
  refitSoon();
}

function closeInstructions() {
  instructionsOverlay.classList.add("hidden");
  localStorage.setItem("xobdleInstructionsSeen", "1");
  refitSoon();
}

helpBtn.addEventListener("click", openInstructions);
instructionsClose.addEventListener("click", closeInstructions);
instructionsOverlay.addEventListener("click", event => {
  if (event.target === instructionsOverlay) closeInstructions();
});

function formattedDate() {
  if (!puzzleDate) return formattedISTDate(0);

  const [y, m, d] = puzzleDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

function buildBoard() {
  board.innerHTML = "";
  for (let i = 0; i < MAX_GUESSES * WORD_LENGTH; i++) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.row = Math.floor(i / WORD_LENGTH);
    tile.dataset.col = i % WORD_LENGTH;
    board.appendChild(tile);
  }
}

function makeKey(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key";
  button.textContent = label;
  button.dataset.key = label;
  button.addEventListener("click", () => handleKey(label));
  return button;
}

function makeActionKey(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key action";
  button.textContent = label;
  button.dataset.action = action;
  button.addEventListener("click", () => {
    if (action === "enter") submitGuess();
    if (action === "backspace") backspace();
  });
  return button;
}

function buildKeyboard() {
  keyboard.innerHTML = "";
  keyboardRows.forEach((rowKeys, rowIndex) => {
    const row = document.createElement("div");
    row.className = "key-row";
    if (rowIndex === 1) row.classList.add("indent-1");
    if (rowIndex === 2) row.classList.add("indent-2");

    if (rowIndex < 3) {
      rowKeys.forEach(key => row.appendChild(makeKey(key)));
    } else {
      const backspaceKey = makeActionKey("⌫", "backspace");
      backspaceKey.classList.add("backspace-key");
      row.appendChild(backspaceKey);
      rowKeys.forEach(key => row.appendChild(makeKey(key)));
      row.appendChild(makeActionKey("ENTER", "enter"));
    }
    keyboard.appendChild(row);
  });
}

function renderBoard() {
  const tiles = [...board.children];
  for (let row = 0; row < MAX_GUESSES; row++) {
    for (let col = 0; col < WORD_LENGTH; col++) {
      const index = row * WORD_LENGTH + col;
      const tile = tiles[index];
      tile.className = "tile";
      tile.textContent = "";

      if (row < guesses.length) {
        tile.textContent = guesses[row][col];
        tile.classList.add(evaluations[row][col]);
      } else if (row === guesses.length) {
        const value = currentGuess[col];
        if (value) {
          tile.textContent = value;
          tile.classList.add("filled");
        }
      }
    }
  }
}

function handleKey(key) {
  if (gameOver || getSiteState() !== "live") return;
  if (currentGuess.length >= WORD_LENGTH) return;

  if (!gameStartedAt) {
    gameStartedAt = Date.now();
    startGameTimer();
  }

  currentGuess.push(key);
  message.textContent = "";
  renderBoard();
  saveTodayState();
  refitSoon();
}

function backspace() {
  if (gameOver || getSiteState() !== "live") return;
  currentGuess.pop();
  message.textContent = "";
  renderBoard();
  saveTodayState();
  refitSoon();
}

async function submitGuess() {
  if (gameOver || getSiteState() !== "live") return;
  if (currentGuess.length !== WORD_LENGTH) {
    message.textContent = "";
    return;
  }

  const guess = [...currentGuess];

  try {
    const data = await checkGuessWithAPI(guess);

    if (data.status !== "live") {
      apiState = "cooking";
      showStatusPage();
      return;
    }

    if (!Array.isArray(data.result) || data.result.length !== WORD_LENGTH) {
      throw new Error("Invalid evaluation returned by API.");
    }

    const evaluation = data.result;

    guesses.push(guess);
    evaluations.push(evaluation);
    currentGuess = [];

    saveTodayState();
    renderBoard();
    updateKeyboardStatuses();

    const won = Boolean(data.won);

    if (won) {
      gameOver = true;
      stopGameTimer();
      message.textContent = "";
      saveTodayState();
      window.setTimeout(() => animateWinningRow(guesses.length - 1), 120);
      window.setTimeout(showResult, 3000);
      return;
    }

    if (guesses.length >= MAX_GUESSES) {
      gameOver = true;
      stopGameTimer();
      message.textContent = "";
      saveTodayState();
      setTimeout(showResult, 5000);
    }

    refitSoon();
  } catch (error) {
    console.warn("Could not check guess:", error);
    message.textContent = "";
  }
}

function statusRank(status) {
  return { absent: 1, present: 2, correct: 3 }[status] || 0;
}

function updateKeyboardStatuses() {
  const best = {};
  guesses.forEach((guess, rowIndex) => {
    guess.forEach((key, colIndex) => {
      const status = evaluations[rowIndex][colIndex];
      if (!best[key] || statusRank(status) > statusRank(best[key])) best[key] = status;
    });
  });

  keyboard.querySelectorAll(".key[data-key]").forEach(button => {
    button.classList.remove("correct", "present", "absent");
    const status = best[button.dataset.key];
    if (status) button.classList.add(status);
  });
}

function animateWinningRow(rowIndex) {
  const tiles = Array.from(board.querySelectorAll(`.tile[data-row="${rowIndex}"]`));
  tiles.forEach((tile, index) => {
    window.setTimeout(() => {
      tile.style.transformOrigin = "center center";
      tile.animate(
        [
          { transform: "perspective(500px) rotateX(0deg)" },
          { transform: "perspective(500px) rotateX(90deg)", offset: 0.5 },
          { transform: "perspective(500px) rotateX(0deg)" }
        ],
        { duration: 500, easing: "ease-in-out" }
      );
    }, index * 500);
  });
}

function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function formatElapsedWords(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const secondLabel = seconds === 1 ? "second" : "seconds";
  if (minutes === 0) return seconds + " " + secondLabel;
  const minuteLabel = minutes === 1 ? "minute" : "minutes";
  if (seconds === 0) return minutes + " " + minuteLabel;
  return minutes + " " + minuteLabel + " " + seconds + " " + secondLabel;
}

function updateTimerDisplay() {
  if (gameStartedAt && !gameFinishedAt) {
    elapsedSeconds = Math.max(0, Math.floor((Date.now() - gameStartedAt) / 1000));
  }
  const timer = document.getElementById("gameTimer");
  if (timer) {
    timer.innerHTML =
      '<span class="timer-emoji">⏳</span><span class="timer-value">' +
      formatElapsed(elapsedSeconds) +
      '</span>';
  }
}

function startGameTimer() {
  if (!gameStartedAt || timerInterval || gameOver) return;
  updateTimerDisplay();
  timerInterval = window.setInterval(updateTimerDisplay, 1000);
}

function stopGameTimer() {
  if (gameFinishedAt) return;
  gameFinishedAt = Date.now();
  elapsedSeconds = gameStartedAt
    ? Math.max(0, Math.floor((gameFinishedAt - gameStartedAt) / 1000))
    : 0;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  updateTimerDisplay();
}

function resultStatusAt(rowIndex, colIndex) {
  if (rowIndex >= evaluations.length) return "empty";
  return evaluations[rowIndex][colIndex];
}

function renderResultGrid() {
  const grid = document.getElementById("resultGrid");
  grid.innerHTML = "";
  for (let row = 0; row < MAX_GUESSES; row++) {
    for (let col = 0; col < WORD_LENGTH; col++) {
      const square = document.createElement("div");
      square.className = "result-square " + resultStatusAt(row, col);
      grid.appendChild(square);
    }
  }
}

function didWin() {
  return evaluations.some(
    row => Array.isArray(row) && row.every(status => status === "correct")
  );
}

function showResult() {
  document.getElementById("statusPage").classList.add("hidden");
  document.getElementById("gamePage").classList.add("hidden");
  document.getElementById("resultPage").classList.remove("hidden");
  document.getElementById("resultDate").textContent = formattedDate();

  const wonGame = didWin();
  document.getElementById("lossResultMessage").classList.toggle("show", !wonGame);

  const resultTime = document.getElementById("resultTime");
  const resultSocial = document.querySelector(".result-social");

  if (wonGame) {
    resultTime.textContent =
      "Done in " + formatElapsedWords(elapsedSeconds) + " today! 🥳 Visit again tomorrow for a new Xobdle 😊";
    resultTime.style.display = "";
    resultSocial.style.display = "";
  } else {
    resultTime.textContent = "";
    resultTime.style.display = "none";
    resultSocial.style.display = "none";
  }

  renderResultGrid();
  document.getElementById("shareNote").textContent = "";
  refitSoon();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function createResultPNG() {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const W = resultCanvas.width;
  const H = resultCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, W, H);

  const cardX = 90, cardY = 70, cardW = 900, cardH = 1210;
  roundRect(ctx, cardX, cardY, cardW, cardH, 38);
  ctx.fillStyle = COLORS.card;
  ctx.fill();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = '700 92px "Poppins", sans-serif';

  const mainLogoWidth = ctx.measureText("Xobdle").width;
  const suffixWidth = ctx.measureText(".in").width;
  const logoX = (W - mainLogoWidth - suffixWidth) / 2;

  ctx.fillStyle = COLORS.text;
  ctx.fillText("Xobdle", logoX, 205);
  ctx.fillStyle = COLORS.orange;
  ctx.fillText(".in", logoX + mainLogoWidth, 205);

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 32px "Poppins", sans-serif';
  ctx.fillText(formattedDate(), W / 2, 320);

  const tile = 112, gap = 18;
  const gridWidth = tile * 5 + gap * 4;
  const startX = (W - gridWidth) / 2;
  const startY = 420;

  for (let row = 0; row < MAX_GUESSES; row++) {
    for (let col = 0; col < WORD_LENGTH; col++) {
      const status = resultStatusAt(row, col);
      const x = startX + col * (tile + gap);
      const y = startY + row * (tile + gap);
      roundRect(ctx, x, y, tile, tile, 18);

      if (status === "empty") {
        ctx.fillStyle = COLORS.card;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = COLORS.emptyBorder;
        ctx.stroke();
      } else {
        ctx.fillStyle = {
          correct: COLORS.green,
          present: COLORS.yellow,
          absent: COLORS.gray
        }[status];
        ctx.fill();
      }
    }
  }

  // Only winners get completion-time and Instagram text on the PNG.
  if (didWin()) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 34px "Poppins", sans-serif';
    ctx.fillText("Done in " + formatElapsedWords(elapsedSeconds) + " today!", W / 2, 1100);

    const socialLead = "Tag us on Instagram · ";
    const socialHandle = "@xobdle";

    ctx.font = '500 27px "Poppins", sans-serif';
    const leadWidth = ctx.measureText(socialLead).width;
    ctx.font = '600 27px "Poppins", sans-serif';
    const handleWidth = ctx.measureText(socialHandle).width;
    const socialX = (W - leadWidth - handleWidth) / 2;

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.font = '500 27px "Poppins", sans-serif';
    ctx.fillText(socialLead, socialX, 1160);
    ctx.fillStyle = COLORS.orange;
    ctx.font = '600 27px "Poppins", sans-serif';
    ctx.fillText(socialHandle, socialX + leadWidth, 1160);
  }

  return new Promise(resolve => resultCanvas.toBlob(resolve, "image/png", 1));
}

async function sharePNG() {
  const note = document.getElementById("shareNote");
  note.textContent = "";
  const blob = await createResultPNG();
  if (!blob) {
    note.textContent = "Could not create PNG.";
    return;
  }

  const file = new File([blob], "xobdle-result.png", { type: "image/png" });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }

  downloadPNG(blob);
  note.textContent = "Direct image sharing is unavailable here, so the PNG was saved.";
}

async function savePNG() {
  const note = document.getElementById("shareNote");
  note.textContent = "";
  const blob = await createResultPNG();
  if (!blob) {
    note.textContent = "Could not create PNG.";
    return;
  }
  downloadPNG(blob);
  note.textContent = "PNG saved.";
}

function downloadPNG(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "xobdle-result.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getViewportSize() {
  const viewport = window.visualViewport;
  return {
    width: viewport ? viewport.width : window.innerWidth,
    height: viewport ? viewport.height : window.innerHeight
  };
}

function getActivePage() {
  if (!document.getElementById("statusPage").classList.contains("hidden")) {
    return document.getElementById("statusPage");
  }
  return document.getElementById("gamePage").classList.contains("hidden")
    ? document.getElementById("resultPage")
    : document.getElementById("gamePage");
}

function fitActivePage() {
  const page = getActivePage();
  if (!page) return;
  page.style.transform = "scale(1)";
  const viewport = getViewportSize();
  const naturalWidth = 460;
  const naturalHeight = page.scrollHeight;
  const widthScale = (viewport.width - 8) / naturalWidth;
  const heightScale = (viewport.height - 8) / naturalHeight;
  const scale = Math.min(1, widthScale, heightScale);
  page.style.transform = "scale(" + scale + ")";
}

function refitSoon() {
  requestAnimationFrame(() => requestAnimationFrame(fitActivePage));
}

document.getElementById("shareBtn").addEventListener("click", sharePNG);
document.getElementById("saveBtn").addEventListener("click", savePNG);

buildBoard();
renderBoard();
updateTimerDisplay();

async function initializeXobdle() {
  const data = await fetchPuzzleState();

  if (data.status === "live") {
    document.getElementById("gameDate").textContent = formattedDate();
    updateYesterdayPopup();
    buildKeyboard();

    const restoredToday = restoreTodayState();

    if (restoredToday) {
      if (gameStartedAt && !gameOver) startGameTimer();
    } else {
      document.getElementById("statusPage").classList.add("hidden");
      document.getElementById("resultPage").classList.add("hidden");
      document.getElementById("gamePage").classList.remove("hidden");
    }

    if (!gameOver && !localStorage.getItem("xobdleInstructionsSeen")) {
      openInstructions();
    }
  } else {
    showStatusPage();
  }

  document.documentElement.style.visibility = "visible";
  refitSoon();
}

initializeXobdle();

window.setInterval(async () => {
  if (apiState === "cooking") {
    const data = await fetchPuzzleState();
    if (data.status === "live") location.reload();
    return;
  }

  if (puzzleDate && puzzleDate !== getISTISODate(0)) {
    apiState = "cooking";

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    showStatusPage();
  }
}, 60000);

refitSoon();
window.addEventListener("load", refitSoon);
window.addEventListener("resize", refitSoon);
window.addEventListener("orientationchange", refitSoon);

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", refitSoon);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(refitSoon);
}
