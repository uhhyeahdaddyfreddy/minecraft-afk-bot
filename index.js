"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const mcping = require("mc-ping-updated");
const config = require("./settings.json");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 5000;

let sessionActive = false;
let appInstance = null;
let checkInterval = null;

// ============================================================
// WEB DASHBOARD
// ============================================================
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>System Dashboard</title></head>
      <body style="background:#0d1117; color:#e6edf3; font-family:sans-serif; text-align:center; padding:50px;">
        <h1>System Management Dashboard</h1>
        <p>Status: <span id="status">Checking...</span></p>
        <p>Monitoring Address: ${config.server.ip}</p>
        <div id="logs" style="background:#161b22; padding:20px; border-radius:10px; text-align:left; max-height:300px; overflow-y:auto; margin-top:20px;">
          ${getLogs().map(l => `<div>${l}</div>`).join('')}
        </div>
        <script>
          setInterval(() => {
            fetch('/health').then(r => r.json()).then(data => {
              document.getElementById('status').innerText = data.session ? "Session Active (Keeping server awake)" : "Standby (Real players online)";
            });
          }, 5000);
        </script>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({ session: sessionActive });
});

app.get("/ping", (req, res) => res.send("pong"));

app.listen(PORT, () => {
  addLog(`[System] Interface active on port ${PORT}`);
  startMonitoring(); // Start player count monitoring
});

// ============================================================
// MONITORING & SESSION LOGIC
// ============================================================

function startMonitoring() {
  addLog("[System] Player count monitoring started...");
  
  checkInterval = setInterval(() => {
    mcping(config.server.ip, config.server.port, (err, res) => {
      if (err) {
        addLog("[Monitor] Server unreachable (likely offline).");
        return;
      }

      const playersOnline = res.players.online;
      addLog(`[Monitor] Online players: ${playersOnline}`);

      // LOGIC: If 0 players, start session. If > 0 players, end session.
      if (playersOnline === 0 && !sessionActive) {
        addLog("[Logic] Server empty. Initiating session...");
        initSession();
      } else if (playersOnline > 1 && sessionActive) {
        // Here > 1 because the bot itself is 1 player. 
        // If players > 1, it means a real player is there.
        addLog("[Logic] Real player detected. Ending session to save resources...");
        closeSession();
      }
    });
  }, 60000); // Check every 1 minute
}

function initSession() {
  if (sessionActive) return;

  try {
    appInstance = mineflayer.createBot({
      host: config.server.ip,
      port: config.server.port,
      username: config["bot-account"].username,
      version: config.server.version || false,
      hideErrors: true
    });

    appInstance.on('spawn', () => {
      sessionActive = true;
      addLog("[Session] Successfully joined the server.");
      
      // Basic AFK movement to prevent internal kick
      appInstance.setControlState('sneak', true);
    });

    appInstance.on('end', () => {
      sessionActive = false;
      addLog("[Session] Disconnected from server.");
    });

    appInstance.on('error', (err) => {
      addLog(`[Error] Session error: ${err.message}`);
    });

  } catch (e) {
    addLog(`[Error] Initialization failed: ${e.message}`);
  }
}

function closeSession() {
  if (appInstance) {
    appInstance.quit();
    appInstance = null;
    sessionActive = false;
  }
}

// Graceful Shutdown for Render
process.on("SIGTERM", () => {
  addLog("[System] Shutdown signal received.");
  closeSession();
  process.exit(0);
});
