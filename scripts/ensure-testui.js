/**
 * ensure-testui.js
 * Ensures the Test Dashboard Server (port 3100) is running and opens the browser.
 * Used by smoke scripts and other interactive test runners.
 */

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const DASHBOARD_PORT = 3100;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const SERVER_SCRIPT = path.join(__dirname, "test-dashboard-server.js");

function pingDashboard() {
  return new Promise((resolve) => {
    const req = http.get(`${DASHBOARD_URL}/health`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "start"
    : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { shell: true, detached: true, stdio: "ignore" }).unref();
}

/**
 * Ensure test dashboard is running and open the browser.
 * @param {object} [opts]
 * @param {boolean} [opts.openBrowser=true] Open browser tab automatically
 * @returns {Promise<void>}
 */
async function ensureTestUI(opts = {}) {
  const shouldOpen = opts.openBrowser !== false;

  const already = await pingDashboard();
  if (!already) {
    console.log(`[testui] Starting Test Dashboard on port ${DASHBOARD_PORT}...`);
    spawn(process.execPath, [SERVER_SCRIPT], {
      detached: true,
      stdio: "ignore",
    }).unref();

    // Wait up to 5 seconds for it to come up
    let ready = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await pingDashboard()) { ready = true; break; }
    }
    if (ready) {
      console.log(`[testui] Test Dashboard ready: ${DASHBOARD_URL}`);
    } else {
      console.warn(`[testui] Test Dashboard did not start in time — skipping browser open`);
      return;
    }
  } else {
    console.log(`[testui] Test Dashboard already running: ${DASHBOARD_URL}`);
  }

  if (shouldOpen) {
    openBrowser(DASHBOARD_URL);
  }
}

module.exports = { ensureTestUI, DASHBOARD_URL };
