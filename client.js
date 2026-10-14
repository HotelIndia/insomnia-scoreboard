// Shared scoreboard client logic (browser-only, works on GitHub Pages)
// Provides: tab-scoped state (sessionStorage) and updates between same-origin pages,
// timer management, action handlers, and a default updateUI that pages can override.

const STORAGE_KEY = "scoreboard_state_v1";
const TIMER_STORAGE_KEY = "timer";
const TIMER_CHANNEL_NAME = "scoreboard_timer_channel_v1";
const CENTISECONDS_PER_SECOND = 100;
const DEFAULT_TIMER_CENTISECONDS = 20 * 60 * CENTISECONDS_PER_SECOND;
const TIMER_UPDATE_INTERVAL_MS = 50;

const DEFAULT_STATE = {
  team1: { score: 0, fouls: 0, name: "Team 1" },
  team2: { score: 0, fouls: 0, name: "Team 2" },
  sidesSwitched: false
};

let _state = null;
let _interval = null;
let timer = DEFAULT_TIMER_CENTISECONDS;
let timerRunning = false;
let lastTimerUpdate = 0;
const timerChannel = typeof BroadcastChannel === "undefined"
  ? null
  : new BroadcastChannel(TIMER_CHANNEL_NAME);

// load saved state or start with the defaults
function loadDefaultState() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return clone(DEFAULT_STATE);

  try {
    const savedState = JSON.parse(raw);
    const state = Object.assign(clone(DEFAULT_STATE), savedState);
    delete state.timer;
    delete state.timerRunning;
    return state;
  } catch (error) {
    console.warn("Could not load saved scoreboard state; using defaults", error);
    return clone(DEFAULT_STATE);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// save state so the scoreboard page can receive updates
function saveState(state) {
  _state = state;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  if (!s.sidesSwitched){
    if (team == "team-left") {team = "team1"} else (team = "team2")
    } 
  if (s.sidesSwitched){
    if (team == "team-left") {team = "team2"} else (team = "team1")
    } 

  switch (action) {
    case "incScore":
      s[team].score = s[team].score + 1;
      break;
    case "decScore":
      s[team].score = Math.max(0, s[team].score - 1);
      break;
    case "incFoul":
      s[team].fouls = s[team].fouls + 1;
      break;
    case "decFoul":
      s[team].fouls = Math.max(0, s[team].fouls - 1);
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
  const total = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  timer = Math.max(0, Math.floor(total * CENTISECONDS_PER_SECOND));
  timerRunning = false;
  saveTimer();
  stopTimer();
  broadcastTimer();
  triggerRender();
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    _state = Object.assign(clone(DEFAULT_STATE), JSON.parse(event.newValue));
    delete _state.timer;
    delete _state.timerRunning;
    triggerRender();
  } catch (error) {
    console.warn("Could not read scoreboard update", error);
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== TIMER_STORAGE_KEY || event.newValue === null) return;
  timer = Math.max(0, Number(event.newValue) || 0);
  timerRunning = false;
  stopTimer();
  triggerRender();
});

timerChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || !Number.isFinite(message.timer)) return;
  timer = Math.max(0, Math.floor(message.timer));
  timerRunning = Boolean(message.running) && timer > 0;
  lastTimerUpdate = Date.now();
  if (timerRunning) startTimer();
  else stopTimer();
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
  broadcastTimer();
  triggerRender();
}

function resetTimer() {
  timer = DEFAULT_TIMER_CENTISECONDS;
  timerRunning = false;
  saveTimer();
  stopTimer();
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
    broadcastTimer();
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
  if (team_left_score) team_left_score.textContent = state.sidesSwitched ? state.team2.score : state.team1.score;
  const team_right_score = document.getElementById("team-right-score");
  if (team_right_score) team_right_score.textContent = state.sidesSwitched ? state.team1.score : state.team2.score;

  // fouls
  const team_left_fouls = document.getElementById("team-left-fouls");
  if (team_left_fouls) team_left_fouls.textContent = state.sidesSwitched ? state.team2.fouls : state.team1.fouls;
  const team_right_fouls = document.getElementById("team-right-fouls");
  if (team_right_fouls) team_right_fouls.textContent = state.sidesSwitched ? state.team1.fouls : state.team2.fouls;

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
  
  triggerRender();

  if (timerRunning) startTimer();

})();
