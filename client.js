

import {
    ref,
    update,
    onValue
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";

let currentState = null;

// state listener
onValue(window.gameStateRef, (snapshot) => {
  currentState = snapshot.val();
  if (!currentState) return;
  render(currentState);
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



