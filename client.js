// ================= FIREBASE IMPORTS =================
import {
  ref,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";

// ===================================================
// GLOBAL STATE
// ===================================================

let currentState = null;
let timerRunning = false;
let wakeLock = null;

// ===================================================
// REALTIME STATE LISTENER (replaces WebSocket onmessage)
// ===================================================

onValue(window.gameStateRef, (snapshot) => {
  const state = snapshot.val();
  if (!state) return;

  currentState = state;
  updateUI(state);
});

// ===================================================
// COMMAND SENDER (replaces WebSocket send)
// ===================================================

window.sendCommand = function (action, team) {
  if (!currentState) return;

  switch (action) {
    case "incScore":
      update(window.gameStateRef, {
        [`${team}/score`]: currentState[team].score + 1
      });
      break;

    case "decScore":
      update(window.gameStateRef, {
        [`${team}/score`]: Math.max(0, currentState[team].score - 1)
      });
      break;

    case "incFoul":
      update(window.gameStateRef, {
        [`${team}/fouls`]: currentState[team].fouls + 1
      });
      break;

    case "decFoul":
      update(window.gameStateRef, {
        [`${team}/fouls`]: Math.max(0, currentState[team].fouls - 1)
      });
      break;

    case "startTimer":
      update(window.gameStateRef, { "timer/running": true });
      break;

    case "stopTimer":
      update(window.gameStateRef, { "timer/running": false });
      break;

    case "resetTimer":
      update(window.gameStateRef, {
        "timer/seconds": currentState.timer.initialSeconds,
        "timer/running": false
      });
      break;

    case "switchSides":
      update(window.gameStateRef, {
        "sidesSwitched": !currentState.sidesSwitched
      });
      break;
  }
};

// ===================================================
// TIMER LOOP (controller-only authority)
// ===================================================

let lastTick = Date.now();

setInterval(() => {
  if (!currentState?.timer?.running) {
    lastTick = Date.now();
    return;
  }

  const now = Date.now();
  if (now - lastTick >= 1000) {
    lastTick = now;

    const next = Math.max(0, currentState.timer.seconds - 1);

    update(window.gameStateRef, {
      "timer/seconds": next,
      "timer/running": next > 0
    });

    if (next === 0) {
      update(window.gameStateRef, {
        "lastBuzzer": Date.now()
      });
    }
  }
}, 200);

// ===================================================
// BUZZER LISTENER (replaces WS event)
// ===================================================

onValue(ref(window.db, "gameState/lastBuzzer"), () => {
  playBuzzer();
});

// ===================================================
// CONTROLLER UI HELPERS
// ===================================================

window.setTimerDuration = function () {
  const minutes = parseInt(document.getElementById("timer-minutes").value) || 0;
  const seconds = parseInt(document.getElementById("timer-seconds").value) || 0;

  const total = minutes * 60 + seconds;

  update(window.gameStateRef, {
    "timer/initialSeconds": total,
    "timer/seconds": total,
    "timer/running": false
  });
};

window.setTeam = function (team) {
  if (!currentState) return;

  const select = document.getElementById(`${team}-select`);
  const option = select.options[select.selectedIndex];

  let actualTeam = team;
  if (currentState.sidesSwitched) {
    actualTeam = team === "team1" ? "team2" : "team1";
  }

  update(window.gameStateRef, {
    [`${actualTeam}/name`]: option.value,
    [`${actualTeam}/color`]: option.dataset.color
  });
};

window.toggleTimer = function () {
  const action = timerRunning ? "stopTimer" : "startTimer";
  sendCommand(action);
};

// ===================================================
// KEYBOARD CONTROLS
// ===================================================

document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    toggleTimer();
  }
});

// ===================================================
// WAKE LOCK MANAGEMENT
// ===================================================

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentState?.timer.running) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
});

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");

      const indicator = document.getElementById("wake-lock-indicator");
      if (indicator) indicator.style.opacity = "1";

      wakeLock.addEventListener("release", () => {
        if (indicator) indicator.style.opacity = "0";
      });
    }
  } catch (err) {
    console.error("Wake Lock failed:", err);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
  const indicator = document.getElementById("wake-lock-indicator");
  if (indicator) indicator.style.opacity = "0";
}

// ===================================================
// AUDIO
// ===================================================

function playBuzzer() {
  const buzzer = document.getElementById("buzzer");
  if (buzzer) {
    buzzer.currentTime = 0;
    buzzer.play().catch(() => {});
  }
}

function playInaudibleSound() {
  const sound = document.getElementById("no_sound");
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}

// ===================================================
// UI UPDATE FUNCTIONS
// ===================================================

function updateLeftTeam(team) {
  updateTeamUI("team1", team);
}

function updateRightTeam(team) {
  updateTeamUI("team2", team);
}

function updateTeamUI(prefix, team) {
  const score = document.getElementById(`${prefix}-score`);
  const fouls = document.getElementById(`${prefix}-fouls`);
  const select = document.getElementById(`${prefix}-select`);

  if (score) {
    score.textContent = team.score;
    score.style.color = team.color;
  }

  if (fouls) {
    fouls.textContent = team.fouls;
    fouls.style.color = team.color;
  }

  if (select) {
    select.value = team.name;
    select.style.color = team.color;
  }
}

function updateToggleButton() {
  const btn = document.getElementById("toggle-timer");
  if (btn) btn.textContent = timerRunning ? "Stop" : "Start";
}

function updateTimer(state) {
  const timerEl = document.getElementById("timer");
  if (timerEl) {
    const m = Math.floor(state.timer.seconds / 60);
    const s = state.timer.seconds % 60;
    timerEl.textContent = `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }

  timerRunning = state.timer.running;
  updateToggleButton();

  if (state.timer.running) {
    requestWakeLock();
    playInaudibleSound();
  } else {
    releaseWakeLock();
  }
}

function updateUI(state) {
  const left = state.sidesSwitched ? state.team2 : state.team1;
  const right = state.sidesSwitched ? state.team1 : state.team2;

  updateLeftTeam(left);
  updateRightTeam(right);
  updateTimer(state);
}
