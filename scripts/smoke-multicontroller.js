const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const axios = require("axios");

const ADAPTER_ROOT = path.join(__dirname, "..");
const SIMULATOR_EXE = path.join(
  ADAPTER_ROOT,
  ".tools",
  "uhppote-simulator",
  "uhppote-simulator.exe",
);
const SIMULATOR_DEVICES_DIR = path.join(
  ADAPTER_ROOT,
  ".tools",
  "uhppote-simulator",
  "devices",
);
const SIMULATOR_BIND_PORT = 60000;
const SIMULATOR_REST_PORT = 18000;
const SIMULATOR_BASE = `http://127.0.0.1:${SIMULATOR_REST_PORT}/uhppote/simulator`;
const ADMIN_URL = "http://127.0.0.1:8081";
const PROFILE_DIR = path.join(ADAPTER_ROOT, ".dev-server", "default");

const CONTROLLERS = [405419896, 405419897];
const TEST_CARDS = [
  { controller: 405419896, card: 10058400, pin: 1357 },
  { controller: 405419897, card: 10058400, pin: 1357 },
  { controller: 405419896, card: 10059999, pin: 0 },
  { controller: 405419896, card: 10051111, pin: 0 },
  { controller: 405419897, card: 10051111, pin: 0 },
];

let simulator;
let devServer;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await axios.get(url, { timeout: 2000 });
      if (response.status >= 200 && response.status < 500) {
        return response;
      }
    } catch {
      await delay(500);
    }
  }

  throw new Error(`Timeout waiting for ${url}`);
}

async function seedSimulatorData() {
  for (const controllerId of CONTROLLERS) {
    try {
      await axios.delete(`${SIMULATOR_BASE}/${controllerId}`, {
        timeout: 2000,
      });
    } catch {
      // Ignore missing controller.
    }

    await axios.post(
      SIMULATOR_BASE,
      {
        "device-id": controllerId,
        "device-type": "UT0311-L04",
        compressed: false,
      },
      { timeout: 2000 },
    );
  }

  for (const card of TEST_CARDS) {
    await axios.put(
      `${SIMULATOR_BASE}/${card.controller}/cards/${card.card}`,
      {
        "start-date": "2026-01-01",
        "end-date": "2027-12-31",
        doors: [1],
        PIN: card.pin,
      },
      { timeout: 2000 },
    );

    await axios.post(
      `${SIMULATOR_BASE}/${card.controller}/swipe`,
      {
        door: 1,
        "card-number": card.card,
        direction: 1,
        PIN: card.pin,
      },
      { timeout: 2000 },
    );
  }
}

function killProcessTreeWindows(pid) {
  if (!pid || process.platform !== "win32") {
    return;
  }

  spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
  });
}

async function run() {
  if (!fs.existsSync(SIMULATOR_EXE)) {
    throw new Error(
      `Simulator missing at ${SIMULATOR_EXE}. Run: npm run simulator:setup`,
    );
  }

  if (!fs.existsSync(path.join(ADAPTER_ROOT, "io-package.json"))) {
    throw new Error(
      "Run smoke test in adapter root repository (io-package.json missing).",
    );
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(
      "Dev-server profile .dev-server/default missing. Run once: npx @iobroker/dev-server setup",
    );
  }

  fs.mkdirSync(SIMULATOR_DEVICES_DIR, { recursive: true });

  simulator = spawn(
    SIMULATOR_EXE,
    [
      "--bind",
      `127.0.0.1:${SIMULATOR_BIND_PORT}`,
      "--rest",
      `127.0.0.1:${SIMULATOR_REST_PORT}`,
      "--devices",
      SIMULATOR_DEVICES_DIR,
    ],
    {
      cwd: ADAPTER_ROOT,
      stdio: "ignore",
    },
  );

  await waitForHttp(`${SIMULATOR_BASE}`, 20000);
  await seedSimulatorData();

  devServer = spawn("cmd.exe", ["/c", "npx @iobroker/dev-server run default"], {
    cwd: ADAPTER_ROOT,
    stdio: "ignore",
  });

  const adminResponse = await waitForHttp(ADMIN_URL, 90000);

  const body = String(adminResponse.data || "");
  if (!body.includes("ioBroker") && !body.includes("admin")) {
    throw new Error(
      `Admin URL is reachable but unexpected response body from ${ADMIN_URL}`,
    );
  }

  console.log("Smoke test passed.");
  console.log(`Admin URL reachable: ${ADMIN_URL}`);
  console.log(`Simulator REST reachable: ${SIMULATOR_BASE}`);
  console.log(`Controllers seeded: ${CONTROLLERS.join(", ")}`);
  console.log(`Card events seeded: ${TEST_CARDS.length}`);
}

(async () => {
  try {
    await run();
  } finally {
    killProcessTreeWindows(devServer && devServer.pid);
    killProcessTreeWindows(simulator && simulator.pid);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
