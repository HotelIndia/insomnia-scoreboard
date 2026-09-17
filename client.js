// Shared scoreboard client logic (browser-only, works on GitHub Pages)
// Provides: persistent state (localStorage), cross-tab updates (BroadcastChannel + storage event fallback),
// timer management, action handlers, and a default updateUI that pages can override.

const STORAGE_KEY = "scoreboard_state_v1";
const CHANNEL_NAME = "scoreboard_channel_v1";
const DEFAULT_TIMER_SECONDS = 20 * 60; // 20:00

const DEFAULT_STATE = {
  team1: { score: 0, fouls: 0, name: "Team 1" },
  team2: { score: 0, fouls: 0, name: "Team 2" },
  timerSeconds: DEFAULT_TIMER_SECONDS,
  timerRunning: false,
  sidesSwitched: false
};

let _state = null;
let _interval = null;
let _channel = null;

// Load state from localStorage (or default)
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // Merge with defaults to ensure missing fields
    return Object.assign(clone(DEFAULT_STATE), parsed);
  } catch (e) {
    console.warn("Failed to load state, using defaults", e);
    return clone(DEFAULT_STATE);
  }
}

function saveState(state) {
  _state = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  broadcastState(state);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function broadcastState(state) {
  // BroadcastChannel (fast) if available
  try {
    if (!_channel && typeof BroadcastChannel !== "undefined") {
      _channel = new BroadcastChannel(CHANNEL_NAME);
      _channel.onmessage = (ev) => {
        if (ev.data) applyIncomingState(ev.data);
      };
    }
    if (_channel) {
      _channel.postMessage(state);
      return;
    }
  } catch (e) {
    console.warn("BroadcastChannel failed", e);
  }
  // Fallback: write a mirror item to localStorage to trigger storage events in other tabs
  try {
    localStorage.setItem(`${STORAGE_KEY}_signal`, Date.now().toString());
  } catch (e) {}
}

function applyIncomingState(newState) {
  // Replace local state and rerender
  _state = Object.assign(clone(DEFAULT_STATE), newState);
  // If timerRunning is true in incoming state, ensure local interval is running
  if (_state.timerRunning && !_interval) startInterval();
  if (!_state.timerRunning && _interval) stopInterval();
  triggerRender();
}

// Listen for storage fallback signals
window.addEventListener("storage", (e) => {
  if (!e.key) return;
  if (e.key === STORAGE_KEY) {
    try {
      const incoming = JSON.parse(e.newValue);
      applyIncomingState(incoming);
    } catch (err) {
      console.warn("Failed to parse incoming storage state", err);
    }
  }
  if (e.key === `${STORAGE_KEY}_signal`) {
    // re-read the canonical state value
    const fresh = loadState();
    applyIncomingState(fresh);
  }
});

// Timer interval tick
function startInterval() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!_state) return;
    if (!_state.timerRunning) return;
    if (_state.timerSeconds <= 0) {
      // stop, play buzzer if present
      _state.timerRunning = false;
      saveState(_state);
      stopInterval();
      try {
        const buzzer = document.getElementById("buzzer");
        if (buzzer && typeof buzzer.play === "function") buzzer.play();
      } catch (e) {}
      return;
    }
    _state.timerSeconds = Math.max(0, _state.timerSeconds - 1);
    // Persist every tick so other tabs stay in sync
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    broadcastState(_state);
    triggerRender();
  }, 1000);
}

function stopInterval() {
  if (!_interval) return;
  clearInterval(_interval);
  _interval = null;
}

// Core action application
function applyAction(action, team) {
  if (!_state) _state = loadState();
  const s = clone(_state);
  if (!s.sidesSwitched){
    if (team == "team-left") {team = "team1"} else (team = "team2")
    } 
  if (s.sidesSwitched){
    if (team == "team-left") {team = "team2"} else (team = "team1")
    } 

  switch (action) {
    case "incScore":
      s[team].score = (s[team].score || 0) + 1;
      break;
    case "decScore":
      s[team].score = Math.max(0, (s[team].score || 0) - 1);
      break;
    case "incFoul":
      s[team].fouls = (s[team].fouls || 0) + 1;
      break;
    case "decFoul":
      s[team].fouls = Math.max(0, (s[team].fouls || 0) - 1);
      break;
    case "switchSides":
      s.sidesSwitched = !s.sidesSwitched;
      break;
    case "toggleTimer":
      s.timerRunning = !s.timerRunning;
      break;
    case "resetTimer":
      s.timerSeconds = DEFAULT_TIMER_SECONDS;
      s.timerRunning = false;
      break;
    default:
      console.warn("Unknown action", action);
      return;
  }
  saveState(s);
  // Manage interval state
  if (s.timerRunning) startInterval(); else stopInterval();
  triggerRender();
}

// Exposed sendCommand used by index.html buttons
function sendCommand(action, team) {
  // team is optional for timer-related actions
  applyAction(action, team);
}

// Set timer from minutes/seconds
function setTimerDuration(minutes, seconds) {
  if (!_state) _state = loadState();
  const s = clone(_state);
  const total = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  s.timerSeconds = Math.max(0, Math.floor(total));
  s.timerRunning = false;
  saveState(s);
  stopInterval();
  triggerRender();
}

function toggleTimer() {
  applyAction("toggleTimer");
}

function resetTimer() {
  applyAction("resetTimer");
}

// Default UI update function. Pages can override this by reassigning window.updateUI after client.js loads.
function updateUI(state) {
  // timer
  const timerEl = document.getElementById("timer");
  if (timerEl) timerEl.textContent = formatTime(state.timerSeconds);

  // team scores
  const t1Score = document.getElementById("team-left-score");
  if (t1Score) t1Score.textContent = state.sidesSwitched ? state.team2.score : state.team1.score;
  const t2Score = document.getElementById("team-right-score");
  if (t2Score) t2Score.textContent = state.sidesSwitched ? state.team1.score : state.team2.score;

  // fouls
  const t1Fouls = document.getElementById("team-left-fouls");
  if (t1Fouls) t1Fouls.textContent = state.sidesSwitched ? state.team2.fouls : state.team1.fouls;
  const t2Fouls = document.getElementById("team-right-fouls");
  if (t2Fouls) t2Fouls.textContent = state.sidesSwitched ? state.team1.fouls : state.team2.fouls;

  // controller inputs (if present)
  const minutesInput = document.getElementById("timer-minutes");
  const secondsInput = document.getElementById("timer-seconds");
  if (minutesInput) minutesInput.value = Math.floor(state.timerSeconds / 60);
  if (secondsInput) secondsInput.value = state.timerSeconds % 60;

  // timer button label
  const toggleBtn = document.getElementById("toggle-timer");
  if (toggleBtn) toggleBtn.textContent = state.timerRunning ? "Pause" : "Start";

  // wake lock indicator (optional)
  const wake = document.getElementById("wake-lock-indicator");
  if (wake) wake.style.opacity = state.timerRunning ? "1" : "0";
}

function triggerRender() {
  if (!_state) _state = loadState();
  try { window.updateUI && window.updateUI(_state); } catch (e) { console.warn("updateUI threw", e); }
}

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// Initialize on load
(function init() {
  _state = loadState();
  // Expose functions globally so inline onclicks work (HTML uses sendCommand directly)
  window.sendCommand = sendCommand;
  window.setTimerDuration = function() {
    const m = document.getElementById("timer-minutes")?.value || 0;
    const s = document.getElementById("timer-seconds")?.value || 0;
    setTimerDuration(m, s);
  };
  window.toggleTimer = toggleTimer;
  window.resetTimer = resetTimer;
  // expose updateUI so pages like scorebug.html can capture and extend it
  window.updateUI = updateUI;

  // start interval if state says running
  if (_state.timerRunning) startInterval();

  // initial render
  triggerRender();
})();
