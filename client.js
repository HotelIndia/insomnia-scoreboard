// Shared scoreboard client logic (browser-only, works on GitHub Pages)
// Provides persistent scoreboard state, a shared timer, action handlers, and UI rendering.

const STORAGE_KEY = "scoreboard_state_v1";
const TIMER_STORAGE_KEY = "timer";
const TIMER_CHANNEL_NAME = "scoreboard_timer_channel_v1";
const CENTISECONDS_PER_SECOND = 100;
const DEFAULT_TIMER_CENTISECONDS = 20 * 60 * CENTISECONDS_PER_SECOND;
const TIMER_UPDATE_INTERVAL_MS = 50;
const TEAMS = {
  riverdale: { name: "Riverdale FC", color: "green" },
  grizzlies: { name: "Grizzlies FC", color: "blue" },
  northOf60: { name: "North of 60", color: "red" },
  latinLovers: { name: "Latin Lovers", color: "magenta" },
  porcupine: { name: "Porcupine FC", color: "whitesmoke" },
  goodVibes: { name: "Good Vibes FC", color: "lightblue" }
};

const DEFAULT_STATE = {
  teams: Object.fromEntries(Object.keys(TEAMS).map((teamId) => [
    teamId,
    { score: 0, fouls: 0 }
  ])),
  team1Id: "riverdale",
  team2Id: "grizzlies",
  sidesSwitched: false
};

let _state = null;
let _interval = null;
let timer = DEFAULT_TIMER_CENTISECONDS;
let timerRunning = false;
let lastTimerUpdate = 0;
let timerStatusTimeout = null;
const timerChannel = typeof BroadcastChannel === "undefined"
  ? null
  : new BroadcastChannel(TIMER_CHANNEL_NAME);

// load saved state or start with the defaults
function loadDefaultState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return clone(DEFAULT_STATE);

  try {
    return normalizeScoreboardState(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not load saved scoreboard state; using defaults", error);
    return clone(DEFAULT_STATE);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeScoreboardState(savedState) {
  const state = Object.assign(clone(DEFAULT_STATE), savedState);
  if (!TEAMS[state.team1Id]) state.team1Id = DEFAULT_STATE.team1Id;
  if (!TEAMS[state.team2Id]) state.team2Id = DEFAULT_STATE.team2Id;
  state.teams = Object.fromEntries(Object.keys(TEAMS).map((teamId) => [
    teamId,
    Object.assign(
      clone(DEFAULT_STATE.teams[teamId]),
      savedState.teams?.[teamId] ?? {}
    )
  ]));
  if (!savedState.teams) {
    if (savedState.team1) {
      state.teams[state.team1Id] = {
        score: savedState.team1.score || 0,
        fouls: savedState.team1.fouls || 0
      };
    }
    if (savedState.team2) {
      state.teams[state.team2Id] = {
        score: savedState.team2.score || 0,
        fouls: savedState.team2.fouls || 0
      };
    }
  }
  delete state.team1;
  delete state.team2;
  delete state.timer;
  delete state.timerRunning;
  return state;
}

// save scoreboard state across tabs
function saveState(state) {
  _state = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// handle html input
function sendCommand(action, team) {
  if (action === "toggleTimer") {
    toggleTimer();
    return;
  }
  if (action === "resetTimer") {
    resetTimer();
    return;
  }

  const s = _state;
  const teamId = team === "team-left"
    ? (s.sidesSwitched ? s.team2Id : s.team1Id)
    : (s.sidesSwitched ? s.team1Id : s.team2Id);
  const selectedTeam = s.teams[teamId];

  switch (action) {
    case "incScore":
      selectedTeam.score += 1;
      break;
    case "decScore":
      selectedTeam.score = Math.max(0, selectedTeam.score - 1);
      break;
    case "incFoul":
      selectedTeam.fouls += 1;
      break;
    case "decFoul":
      selectedTeam.fouls = Math.max(0, selectedTeam.fouls - 1);
      break;
    case "switchSides":
      s.sidesSwitched = !s.sidesSwitched;
      break;
    default:
      console.warn("Unknown action", action);
      return;
  }
  saveState(s);
  triggerRender();
}

// handle setting html timer
function setTimerDuration(minutes, seconds) {
  const wasRunning = timerRunning;
  const total = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  timer = Math.max(0, Math.floor(total * CENTISECONDS_PER_SECOND));
  timerRunning = false;
  saveTimer();
  stopTimer();
  broadcastTimer();
  if (wasRunning) showTimerStatus();
  triggerRender();
}

function selectTeam(side, teamId) {
  if (!Object.hasOwn(TEAMS, teamId)) {
    console.warn("Unknown team", teamId);
    return;
  }

  const stateKey = side === "team-left"
    ? (_state.sidesSwitched ? "team2Id" : "team1Id")
    : (_state.sidesSwitched ? "team1Id" : "team2Id");
  _state[stateKey] = teamId;
  saveState(_state);
  triggerRender();
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    _state = normalizeScoreboardState(JSON.parse(event.newValue));
    triggerRender();
  } catch (error) {
    console.warn("Could not read scoreboard update", error);
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== TIMER_STORAGE_KEY || event.newValue === null) return;
  timer = Math.max(0, Number(event.newValue) || 0);
  if (timerRunning) lastTimerUpdate = Date.now();
  triggerRender();
});

timerChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || !Number.isFinite(message.timer)) return;
  const timerJustExpired = timerRunning && !message.running && message.timer === 0;
  const runningStateChanged = timerRunning !== Boolean(message.running);
  timer = Math.max(0, Math.floor(message.timer));
  timerRunning = Boolean(message.running) && timer > 0;
  lastTimerUpdate = Date.now();
  if (timerRunning) startTimer();
  else stopTimer();
  syncTimerAudio();
  if (timerJustExpired) playBuzzer();
  if (runningStateChanged) showTimerStatus();
  triggerRender();
});

function loadTimer() {
  const raw = localStorage.getItem(TIMER_STORAGE_KEY);
  if (raw) {
    const storedTimer = Number(raw);
    if (Number.isFinite(storedTimer)) return Math.max(0, Math.floor(storedTimer));

    try {
      const oldTimer = JSON.parse(raw);
      const remaining = Number(oldTimer.remainingCentiseconds);
      if (Number.isFinite(remaining)) {
        return Math.max(0, Math.floor(remaining));
      }
    } catch (error) {
      console.warn("Could not load saved timer; using the default duration", error);
    }
  }

  const legacySeconds = Number(_state.timer ?? _state.timerSeconds);
  return Number.isFinite(legacySeconds)
    ? Math.max(0, Math.floor(legacySeconds * CENTISECONDS_PER_SECOND))
    : DEFAULT_TIMER_CENTISECONDS;
}

function saveTimer() {
  localStorage.setItem(TIMER_STORAGE_KEY, String(timer));
}

function broadcastTimer() {
  timerChannel?.postMessage({ timer, running: timerRunning });
}

function toggleTimer() {
  updateTimer();
  if (timerRunning) {
    timerRunning = false;
    saveTimer();
    stopTimer();
  } else if (timer > 0) {
    timerRunning = true;
    lastTimerUpdate = Date.now();
    saveTimer();
    startTimer();
  }
  showTimerStatus();
  syncTimerAudio();
  broadcastTimer();
  triggerRender();
}

function resetTimer() {
  const wasRunning = timerRunning;
  timer = DEFAULT_TIMER_CENTISECONDS;
  timerRunning = false;
  saveTimer();
  stopTimer();
  if (wasRunning) showTimerStatus();
  syncTimerAudio();
  broadcastTimer();
  triggerRender();
}

function updateTimer() {
  if (!timerRunning) return;
  const now = Date.now();
  const elapsedCentiseconds = Math.floor((now - lastTimerUpdate) / 10);
  if (elapsedCentiseconds <= 0) return;

  timer = Math.max(0, timer - elapsedCentiseconds);
  lastTimerUpdate += elapsedCentiseconds * 10;
  if (timer === 0) {
    timerRunning = false;
    saveTimer();
    stopTimer();
    syncTimerAudio();
    playBuzzer();
    showTimerStatus();
    broadcastTimer();
  }
}

function showTimerStatus() {
  const border = document.getElementById("timer-status-border");
  if (!border) return;

  border.style.borderColor = timerRunning ? "green" : "red";
  border.classList.add("visible");
  if (timerStatusTimeout !== null) clearTimeout(timerStatusTimeout);
  timerStatusTimeout = setTimeout(() => {
    border.classList.remove("visible");
    timerStatusTimeout = null;
  }, 5000);
}

function syncTimerAudio() {
  const keepAlive = document.getElementById("no_sound");
  if (!keepAlive) return;

  keepAlive.loop = true;
  if (timerRunning) {
    if (keepAlive.paused) {
      const playback = keepAlive.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch((error) => console.warn("Timer keep-alive audio failed", error));
      }
    }
  } else {
    keepAlive.pause();
    keepAlive.currentTime = 0;
  }
}

function playBuzzer() {
  const buzzer = document.getElementById("buzzer");
  if (!buzzer) return;

  buzzer.currentTime = 0;
  const playback = buzzer.play();
  if (playback && typeof playback.catch === "function") {
    playback.catch((error) => console.warn("Buzzer playback failed", error));
  }
}

// calls updateUI with the current state!
function triggerRender() {
  updateUI(_state);
}

// updates visual
function updateUI(state) {
  // timer
  const timerElement = document.getElementById("timer");
  const secondsRemaining = Math.ceil(timer / CENTISECONDS_PER_SECOND);
  if (timerElement) timerElement.textContent = formatTime(secondsRemaining);

  // team scores
  const team_left_score = document.getElementById("team-left-score");
  const leftTeamId = state.sidesSwitched ? state.team2Id : state.team1Id;
  const leftTeam = state.teams[leftTeamId];
  if (team_left_score) {
    team_left_score.textContent = leftTeam.score;
    team_left_score.style.color = TEAMS[leftTeamId]?.color ?? "inherit";
  }
  const team_right_score = document.getElementById("team-right-score");
  const rightTeamId = state.sidesSwitched ? state.team1Id : state.team2Id;
  const rightTeam = state.teams[rightTeamId];
  if (team_right_score) {
    team_right_score.textContent = rightTeam.score;
    team_right_score.style.color = TEAMS[rightTeamId]?.color ?? "inherit";
  }

  // fouls
  const team_left_fouls = document.getElementById("team-left-fouls");
  if (team_left_fouls) {
    team_left_fouls.textContent = leftTeam.fouls;
    team_left_fouls.style.color = TEAMS[leftTeamId]?.color ?? "inherit";
  }
  const team_right_fouls = document.getElementById("team-right-fouls");
  if (team_right_fouls) {
    team_right_fouls.textContent = rightTeam.fouls;
    team_right_fouls.style.color = TEAMS[rightTeamId]?.color ?? "inherit";
  }

  const leftTeamSelect = document.getElementById("team-left-select");
  const rightTeamSelect = document.getElementById("team-right-select");
  if (leftTeamSelect) leftTeamSelect.value = leftTeamId;
  if (rightTeamSelect) rightTeamSelect.value = rightTeamId;
  if (leftTeamSelect) leftTeamSelect.style.color = TEAMS[leftTeamId]?.color ?? "inherit";
  if (rightTeamSelect) rightTeamSelect.style.color = TEAMS[rightTeamId]?.color ?? "inherit";

  // controller inputs (if present)
  const minutesInput = document.getElementById("timer-minutes");
  const secondsInput = document.getElementById("timer-seconds");
  if (!timerRunning && minutesInput) minutesInput.value = Math.floor(secondsRemaining / 60);
  if (!timerRunning && secondsInput) secondsInput.value = secondsRemaining % 60;

  // timer button label
  const toggle_timer = document.getElementById("toggle-timer");
  if (toggle_timer) toggle_timer.textContent = timerRunning ? "Pause" : "Start";

  // wake lock indicator (optional)
  const wake = document.getElementById("wake-lock-indicator");
  if (wake) wake.style.opacity = timerRunning ? "1" : "0";
}

// helper function for UpdateUI
function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startTimer() {
  if (_interval) return;
  _interval = setInterval(() => {
    updateTimer();
    triggerRender();
  }, TIMER_UPDATE_INTERVAL_MS);
}

function stopTimer() {
  if (!_interval) return;
  clearInterval(_interval);
  _interval = null;
}

window.addEventListener("keydown", (event) => {
  if ((event.code !== "ArrowRight" && event.code !== "Space") || event.repeat) return;
  if (event.target?.closest?.("input, select, textarea, [contenteditable='true']")) return;

  event.preventDefault();
  toggleTimer();
});

// main
(function init() {
  _state = loadDefaultState();
  timer = loadTimer();
  saveTimer();
  
  // Expose functions globally html buttons can use functions
  window.sendCommand = sendCommand;
  window.setTimerDuration = function() {
    const m = document.getElementById("timer-minutes")?.value || 0;
    const s = document.getElementById("timer-seconds")?.value || 0;
    setTimerDuration(m, s);
  };
  window.selectTeam = selectTeam;
  
  triggerRender();

  if (timerRunning) startTimer();
  syncTimerAudio();

})();
