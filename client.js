// Shared scoreboard client logic (browser-only, works on GitHub Pages)
// Provides: persistent state (localStorage), cross-tab updates (BroadcastChannel + storage event fallback),
// timer management, action handlers, and a default updateUI that pages can override.

const STORAGE_KEY = "scoreboard_state_v1";
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

// load default state
function loadDefaultState() {
    return sessionStorage.setItem(STORAGE_KEY, DEFAULT_STATE); 
}

// save state to localStorage
function saveState(state) {
  _state = state;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// handle html input
function sendCommand(action, team) {
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
  triggerRender();
}

// handle setting html timer
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

// calls updateUI with the current state!
function triggerRender() {
  updateUI(_state); 
}

// updates visual
function updateUI(state) {
  // timer
  const timer = document.getElementById("timer");
  if (timer) timer.textContent = formatTime(state.timerSeconds);

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
  if (minutesInput) minutesInput.value = Math.floor(state.timerSeconds / 60);
  if (secondsInput) secondsInput.value = state.timerSeconds % 60;

  // timer button label
  const toggle_timer = document.getElementById("toggle-timer");
  if (toggle_timer) toggle_timer.textContent = state.timerRunning ? "Pause" : "Start";

  // wake lock indicator (optional)
  const wake = document.getElementById("wake-lock-indicator");
  if (wake) wake.style.opacity = state.timerRunning ? "1" : "0";
}

// helper function for UpdateUI
function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startTimer(){
  // decrease _state.timerSeconds by 1 each second as long as _state.timerRunning is true
  triggerRender()
}

function stopTimer(){
  // if _state.timerRunning is false, stop the timer
}

// main
(function init() {
  _state = loadDefaultState(); // initialize defualt state
  
  // Expose functions globally html buttons can use functions
  window.sendCommand = sendCommand;
  window.setTimerDuration = function() {
    const m = document.getElementById("timer-minutes")?.value || 0;
    const s = document.getElementById("timer-seconds")?.value || 0;
    setTimerDuration(m, s);
  };
  
  triggerRender();

  // start interval if state says running
  if (_state.timerRunning) startTimer();
  if (!_state.timerRunning) stopTimer();

})();
