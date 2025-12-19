import {
    ref,
    update,
    onValue
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";

let currentState = null;

// Track current timer state
let timerRunning = false;

let wakeLock = null;

// state listener
onValue(window.gameStateRef, (snapshot) => {
    currentState = snapshot.val();
    if (!currentState) return;
    updateUI(currentState);

    // else if (msg.type === "buzzer") {
    //     playBuzzer();
    // }
});

// command handler
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
      update(window.gameStateRef, {
        "timer/running": true
      });
      break;

    case "stopTimer":
      update(window.gameStateRef, {
        "timer/running": false
      });
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

// timer loop
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
        lastBuzzer: Date.now()
        //playBuzzer();?
      });
    }
  }
}, 200);

// buzzer
onValue(ref(window.db, "gameState/lastBuzzer"), () => {
  if (typeof buzzer !== "undefined") {
    buzzer.play();
  }
});

// -------------------------- html commands -------------------------------

// used for buttons on controller.html
function sendCommand(action, team) {
  if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "command",
      action,
      team
    }));
  }
}

// function sendCommand(action, team) {
//   if (typeof socket !== "undefined" && socket.readyState === WebSocket.OPEN) {

//     // Adjust for switched sides if applicable
//     let actualTeam = team;
//     if (currentState && currentState.sidesSwitched && team) {
//       actualTeam = team === "team1" ? "team2" : "team1";
//     }

//     socket.send(JSON.stringify({
//       type: "command",
//       action,
//       team: actualTeam
//     }));
//   }
// }

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

function toggleTimer() {
  const action = timerRunning ? "stopTimer" : "startTimer";
  sendCommand(action);
  timerRunning = !timerRunning;
  updateToggleButton();
}
// ------------------------------------------------------------------------

// Allow spacebar to toggle timer
document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault(); // Prevent scrolling
    toggleTimer();
  }
});

// Reacquire lock if tab becomes visible again
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentState?.timer.running) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
});

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

function playBuzzer(){
  const buzzer = document.getElementById("buzzer");
    if (buzzer) {
      buzzer.currentTime = 0; // rewind to start
      buzzer.play().catch(err => console.error("Buzzer play error:", err));
    }
}

function updateLeftTeam(leftTeam){

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
}

function updateRightTeam(rightTeam){

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
}

function updateToggleButton() {
  const btn = document.getElementById("toggle-timer");
  if (btn) {
    btn.textContent = timerRunning ? "Stop" : "Start";
  }
}

function playInaudibleSound(){
  const no_sound = document.getElementById("no_sound");
  if (no_sound) {
    no_sound.currentTime = 0; // rewind to start
    no_sound.play().catch(err => console.error("No_sound play error:", err));
  }
}

// handles WakeLock and inaudible sound
function updateTimer(state){

  if (document.getElementById("timer")) {
    const minutes = Math.floor(state.timer.seconds / 60);
    const seconds = state.timer.seconds % 60;
    document.getElementById("timer").textContent =
      `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`; // formating the timer
  }

  // Updating the timer button to show the right action
  timerRunning = state.timer.running; //state contains info if timer is running
  updateToggleButton();

  // Keep screen awake only while timer is running
  if (state.timer.running) {
    requestWakeLock();
    playInaudibleSound();
  } else {
    releaseWakeLock();
  }
}

function updateUI(state) {

  currentState = state;
  
  // Determine which team is on which side based on sidesSwitched
  const leftTeam = state.sidesSwitched ? state.team2 : state.team1;
  const rightTeam = state.sidesSwitched ? state.team1 : state.team2;
  
  // Left team
  updateLeftTeam(leftTeam)

  // Right team
  updateRightTeam(rightTeam)

  // Timer 
  updateTimer(state)
  

}



