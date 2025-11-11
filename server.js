// Using websocket to connect html files to the "gameState"


// server.js
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Game state managed on the server
let gameState = {
  team1: { score: 0, fouls: 0},
  team2: { score: 0, fouls: 0},
//   team2: { score: 0, fouls: 0, name: "Team 2", color: "#0000ff" },
  timer: { seconds: 1200, running: false, initialSeconds: 1200 }, // 20:00 in seconds
  sidesSwitched: false
};

// Broadcast function (send state to all connected clients)
function broadcastState() {
  const stateString = JSON.stringify({ type: "state", data: gameState });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(stateString); // sending JSON file for gameState
    }
  });
}

// Handle WebSocket connections
wss.on("connection", ws => {
  console.log("New client connected");

  // Send current state immediately
  ws.send(JSON.stringify({ type: "state", data: gameState }));

  ws.on("message", message => {
    const msg = JSON.parse(message);

    // Process commands from controller (or other html files ... if needed)
    if (msg.type === "command") {
      switch (msg.action) {
        case "incScore":
          gameState[msg.team].score++;
          break;
        case "decScore":
        //   gameState[msg.team].score--;
          gameState[msg.team].score = Math.max(0, gameState[msg.team].score - 1);
          break;
        case "incFoul":
          gameState[msg.team].fouls++;
          break;
        case "decFoul":
        //   gameState[msg.team].fouls--;
          gameState[msg.team].fouls = Math.max(0, gameState[msg.team].fouls - 1);
          break;
        case "Timer":
          gameState.timer.running = true;
          break;
        case "stopTimer":
          gameState.timer.running = false;
          break;
        case "startTimer":
          gameState.timer.running = true;
          break;
        case "resetTimer":
          gameState.timer.seconds = gameState.timer.initialSeconds;
          gameState.timer.running = false;
          break;
        case "setTimerDuration":
          const totalSeconds = msg.minutes * 60 + msg.seconds;
          gameState.timer.initialSeconds = totalSeconds;
          gameState.timer.seconds = totalSeconds;
          gameState.timer.running = false;
          break;
        case "switchSides":
          gameState.sidesSwitched = !gameState.sidesSwitched;
          break;
        case "setTeam":
          if (msg.team === "team1") {
            gameState.team1.name = msg.teamName;
            gameState.team1.color = msg.teamColor;
          } else if (msg.team === "team2") {
            gameState.team2.name = msg.teamName;
            gameState.team2.color = msg.teamColor;
          }
          break;
      }

      // Broadcast new state
      broadcastState();
    }
  });
});

let lastTick = Date.now();

setInterval(() => {
  if (gameState.timer.running) {
    const now = Date.now();
    const elapsed = Math.floor((now - lastTick) / 1000);

    if (elapsed >= 1) {
      lastTick = now;

      if (gameState.timer.seconds > 1) {
        gameState.timer.seconds -= elapsed;
        broadcastState();
      } else if (gameState.timer.seconds === 1) {
        gameState.timer.seconds = 0;
        gameState.timer.running = false;
        broadcastState();

        // Send buzzer event now
        const buzzerMsg = JSON.stringify({ type: "buzzer" });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(buzzerMsg);
          }
        });
      }
    }
  } else {
    lastTick = Date.now(); // reset reference when paused
  }
}, 200); // check 5x per second for smoother timing



// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
