// client.js
const socket = new WebSocket(`ws://${window.location.host}`);

socket.onopen = () => {
  console.log("Connected to server");
};

socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "state") {
    updateUI(msg.data);
  }
  else if (msg.type === "buzzer") {
    const buzzer = document.getElementById("buzzer");
    if (buzzer) {
      buzzer.currentTime = 0; // rewind to start
      buzzer.play().catch(err => console.error("Buzzer play error:", err));
    }
  }
};

function sendCommand(action, team) {
  if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "command",
      action,
      team
    }));
  }
}

function setTimerDuration() {
  const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
  const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;
  
  if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "command",
      action: "setTimerDuration",
      minutes: minutes,
      seconds: seconds
    }));
  }
}

function setTeam(team) {
  const select = document.getElementById(team + '-select');
  const selectedOption = select.options[select.selectedIndex];
  const teamName = selectedOption.value;
  const teamColor = selectedOption.getAttribute('data-color');
  
  // Map the dropdown to the correct team based on current sides state
  let actualTeam = team;
  if (currentState && currentState.sidesSwitched) { // true if on same side?
    // If sides are switched, map the dropdowns to the opposite teams
    actualTeam = team === 'team1' ? 'team2' : 'team1';
  }
  
  if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "command",
      action: "setTeam",
      team: actualTeam,
      teamName: teamName,
      teamColor: teamColor
    }));
  }
}

// Global variable to track current state for dropdown mapping
let currentState = null;

//Note
// when I switch sides, I need the left score button to map to team2
function updateUI(state) {
  // Store current state for dropdown mapping
  currentState = state;
  
  // If elements exist, update them

  // Determine which team is on which side based on sidesSwitched
  const leftTeam = state.sidesSwitched ? state.team2 : state.team1;
  const rightTeam = state.sidesSwitched ? state.team1 : state.team2;

  // Team 1 (left side)
  if (document.getElementById("team1-score")) {
    document.getElementById("team1-score").textContent = leftTeam.score;
    document.getElementById("team1-score").style.color = leftTeam.color;
  }

  if (document.getElementById("team1-fouls")) {
    document.getElementById("team1-fouls").textContent = leftTeam.fouls;
    document.getElementById("team1-fouls").style.color = leftTeam.color;
  }

  // Update dropdown to show current team
  if (document.getElementById("team1-select")) {
    const select = document.getElementById("team1-select");
    select.value = leftTeam.name;
    select.style.color = leftTeam.color;
  }

  // Team 2 (right side)
  if (document.getElementById("team2-score")) {
    document.getElementById("team2-score").textContent = rightTeam.score;
    document.getElementById("team2-score").style.color = rightTeam.color;
  }

  if (document.getElementById("team2-fouls")) {
    document.getElementById("team2-fouls").textContent = rightTeam.fouls;
    document.getElementById("team2-fouls").style.color = rightTeam.color;
  }

  // Update dropdown to show current team
  if (document.getElementById("team2-select")) {
    const select = document.getElementById("team2-select");
    select.value = rightTeam.name;
    select.style.color = rightTeam.color;
  }

  // Timer
  if (document.getElementById("timer")) {
    const minutes = Math.floor(state.timer.seconds / 60);
    const seconds = state.timer.seconds % 60;
    document.getElementById("timer").textContent =
      `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  // Updating the timer button to show the right action
  timerRunning = state.timer.running;
  updateToggleButton();

  // Keep screen awake only while timer is running
  if (state.timer.running) {
    requestWakeLock();
    // play no_sound audio
    const no_sound = document.getElementById("no_sound");
    if (no_sound) {
      no_sound.currentTime = 0; // rewind to start
      no_sound.play().catch(err => console.error("No_sound play error:", err));
    }

    // const buzzer = document.getElementById("buzzer");
    // if (buzzer) {
    //   buzzer.currentTime = 0; // rewind to start
    //   buzzer.play().catch(err => console.error("Buzzer play error:", err));
    // }

  } else {
    releaseWakeLock();
  }

}

// Track current timer state
let timerRunning = false;

function toggleTimer() {
  const action = timerRunning ? "stopTimer" : "startTimer";
  sendCommand(action);
  timerRunning = !timerRunning;
  updateToggleButton();
}

function updateToggleButton() {
  const btn = document.getElementById("toggle-timer");
  if (btn) {
    btn.textContent = timerRunning ? "Stop" : "Start";
  }
}

// Allow spacebar to toggle timer
document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault(); // Prevent scrolling
    toggleTimer();
  }
});

function sendCommand(action, team) {
  if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {

    // Adjust for switched sides if applicable
    let actualTeam = team;
    if (currentState && currentState.sidesSwitched && team) {
      actualTeam = team === "team1" ? "team2" : "team1";
    }

    socket.send(JSON.stringify({
      type: "command",
      action,
      team: actualTeam
    }));
  }
}

// ------------------------------
// Screen Wake Lock logic
// ------------------------------

let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log("Screen Wake Lock activated");

      const indicator = document.getElementById("wake-lock-indicator");
      if (indicator) indicator.style.opacity = "1";

      wakeLock.addEventListener('release', () => {
        console.log("Screen Wake Lock released");
        if (indicator) indicator.style.opacity = "0";
      });
    }
  } catch (err) {
    console.error("Wake Lock request failed:", err);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    console.log("Screen Wake Lock manually released");
  }
  const indicator = document.getElementById("wake-lock-indicator");
  if (indicator) indicator.style.opacity = "0";
}

// Reacquire lock if tab becomes visible again
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentState?.timer.running) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
});




