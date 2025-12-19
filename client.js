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

// Wait for gameStateRef to be available before setting up listener
function setupStateListener() {
  if (!window.gameStateRef) {
    console.warn("gameStateRef not ready, retrying...");
    setTimeout(setupStateListener, 100);
    return;
  }

  onValue(window.gameStateRef, (snapshot) => {
    try {
      const state = snapshot.val();
      if (!state) return;

      currentState = state;
      updateUI(state);
    } catch (error) {
      console.error("Error updating state:", error);
    }
  });
}

setupStateListener();

// ===================================================
// COMMAND SENDER (replaces WebSocket send)
// ===================================================

window.sendCommand = function (action, team) {
  if (!currentState) {
    console.warn("sendCommand: currentState is not initialized");
    return;
  }

  if (!window.gameStateRef) {
    console.error("sendCommand: window.gameStateRef is not defined");
    return;
  }

  try {
    switch (action) {
      case "incScore":
        const currentScore = currentState[team]?.score ?? 0;
        const newScore = currentScore + 1;
        console.log(`Updating ${team} score: ${currentScore} -> ${newScore}`);
        update(window.gameStateRef, {
          [`${team}/score`]: newScore
        }).catch(error => console.error("Error updating score:", error));
        break;

      case "decScore":
        const currentScoreDec = currentState[team]?.score ?? 0;
        const newScoreDec = Math.max(0, currentScoreDec - 1);
        console.log(`Updating ${team} score: ${currentScoreDec} -> ${newScoreDec}`);
        update(window.gameStateRef, {
          [`${team}/score`]: newScoreDec
        }).catch(error => console.error("Error updating score:", error));
        break;

      case "incFoul":
        const currentFouls = currentState[team]?.fouls ?? 0;
        const newFouls = currentFouls + 1;
        console.log(`Updating ${team} fouls: ${currentFouls} -> ${newFouls}`);
        update(window.gameStateRef, {
          [`${team}/fouls`]: newFouls
        }).catch(error => console.error("Error updating fouls:", error));
        break;

      case "decFoul":
        const currentFoulsDec = currentState[team]?.fouls ?? 0;
        const newFoulsDec = Math.max(0, currentFoulsDec - 1);
        console.log(`Updating ${team} fouls: ${currentFoulsDec} -> ${newFoulsDec}`);
        update(window.gameStateRef, {
          [`${team}/fouls`]: newFoulsDec
        }).catch(error => console.error("Error updating fouls:", error));
        break;

      case "startTimer":
        update(window.gameStateRef, { "timer/running": true })
          .catch(error => console.error("Error starting timer:", error));
        break;

      case "stopTimer":
        update(window.gameStateRef, { "timer/running": false })
          .catch(error => console.error("Error stopping timer:", error));
        break;

      case "resetTimer":
        if (!currentState.timer || typeof currentState.timer.initialSeconds !== "number") return;
        update(window.gameStateRef, {
          "timer/seconds": currentState.timer.initialSeconds,
          "timer/running": false
        }).catch(error => console.error("Error resetting timer:", error));
        break;

      case "switchSides":
        update(window.gameStateRef, {
          "sidesSwitched": !currentState.sidesSwitched
        }).catch(error => console.error("Error switching sides:", error));
        break;
    }
  } catch (error) {
    console.error("Error in sendCommand:", error);
  }
};

// ===================================================
// TIMER LOOP (controller-only authority)
// ===================================================

let lastTick = Date.now();

// Only run timer loop on controller page to prevent race conditions
if (window.isController) {
  setInterval(() => {
    if (!currentState?.timer?.running) {
      lastTick = Date.now();
      return;
    }

    if (!currentState.timer || typeof currentState.timer.seconds !== "number") {
      return;
    }

    const now = Date.now();
    if (now - lastTick >= 1000) {
      lastTick = now;

      const next = Math.max(0, currentState.timer.seconds - 1);

      update(window.gameStateRef, {
        "timer/seconds": next,
        "timer/running": next > 0
      }).catch(error => console.error("Error updating timer:", error));

      if (next === 0) {
        update(window.gameStateRef, {
          "lastBuzzer": Date.now()
        }).catch(error => console.error("Error setting buzzer:", error));
      }
    }
  }, 200);
}

// ===================================================
// BUZZER LISTENER (replaces WS event)
// ===================================================

function setupBuzzerListener() {
  if (!window.db) {
    console.warn("db not ready, retrying buzzer listener...");
    setTimeout(setupBuzzerListener, 100);
    return;
  }

  onValue(ref(window.db, "gameState/lastBuzzer"), (snapshot) => {
    try {
      if (snapshot.exists()) {
        playBuzzer();
      }
    } catch (error) {
      console.error("Error in buzzer listener:", error);
    }
  });
}

setupBuzzerListener();

// ===================================================
// CONTROLLER UI HELPERS
// ===================================================

window.setTimerDuration = function () {
  try {
    const minutes = parseInt(document.getElementById("timer-minutes").value) || 0;
    const seconds = parseInt(document.getElementById("timer-seconds").value) || 0;

    const total = minutes * 60 + seconds;

    update(window.gameStateRef, {
      "timer/initialSeconds": total,
      "timer/seconds": total,
      "timer/running": false
    }).catch(error => console.error("Error setting timer duration:", error));
  } catch (error) {
    console.error("Error in setTimerDuration:", error);
  }
};

window.setTeam = function (team) {
  if (!currentState) return;

  try {
    const select = document.getElementById(`${team}-select`);
    if (!select || !select.options || select.selectedIndex < 0) return;

    const option = select.options[select.selectedIndex];
    if (!option) return;

    let actualTeam = team;
    if (currentState.sidesSwitched) {
      actualTeam = team === "team1" ? "team2" : "team1";
    }

    update(window.gameStateRef, {
      [`${actualTeam}/name`]: option.value,
      [`${actualTeam}/color`]: option.dataset.color || ""
    }).catch(error => console.error("Error setting team:", error));
  } catch (error) {
    console.error("Error in setTeam:", error);
  }
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
  if (!state || !state.timer) return;

  const timerEl = document.getElementById("timer");
  if (timerEl && typeof state.timer.seconds === "number") {
    const m = Math.floor(state.timer.seconds / 60);
    const s = state.timer.seconds % 60;
    timerEl.textContent = `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }

  timerRunning = state.timer.running || false;
  updateToggleButton();

  if (state.timer.running) {
    requestWakeLock();
    playInaudibleSound();
  } else {
    releaseWakeLock();
  }
}

function updateUI(state) {
  if (!state || !state.team1 || !state.team2) return;

  try {
    const left = state.sidesSwitched ? state.team2 : state.team1;
    const right = state.sidesSwitched ? state.team1 : state.team2;

    updateLeftTeam(left);
    updateRightTeam(right);
    updateTimer(state);
  } catch (error) {
    console.error("Error in updateUI:", error);
  }
}

// Expose updateUI on window for scorebug.html to override
window.updateUI = updateUI;
