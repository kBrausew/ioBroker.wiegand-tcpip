/**
 * Test Dashboard Server
 * Companion to the UHPPOTE Simulator UI (http://127.0.0.1:18000)
 * Serves the test dashboard at http://127.0.0.1:3100
 * - Proxies simulator REST API calls (CORS-free)
 * - Runs npm test suites and streams output
 */

"use strict";

const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const DASHBOARD_PORT = 3100;
const SIMULATOR_BASE = "http://127.0.0.1:18000";
const ADAPTER_ROOT = path.join(__dirname, "..");
const HTML_FILE = path.join(__dirname, "test-dashboard.html");

// ─── Simple HTTP proxy helper ──────────────────────────────────────────────

function proxyToSimulator(req, res, simPath, method, body) {
  const url = new URL(`${SIMULATOR_BASE}${simPath}`);
  const options = {
    hostname: url.hostname,
    port: Number(url.port) || 18000,
    path: url.pathname + url.search,
    method: method || req.method,
    headers: { "Content-Type": "application/json" },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Simulator unreachable: ${err.message}` }));
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

// ─── Spawn npm script and stream output as SSE ─────────────────────────────

function runNpmScript(script, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    Connection: "keep-alive",
  });

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  send("start", `Running: npm run ${script}`);

  const proc = spawn("npm", ["run", script], {
    cwd: ADAPTER_ROOT,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  proc.stdout.on("data", (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach((line) => send("stdout", line));
  });

  proc.stderr.on("data", (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach((line) => send("stderr", line));
  });

  proc.on("close", (code) => {
    send("done", code === 0 ? "PASSED" : `FAILED (exit ${code})`);
    res.end();
  });

  proc.on("error", (err) => {
    send("error", err.message);
    res.end();
  });
}

// ─── Router ────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${DASHBOARD_PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }

  // ── Serve dashboard HTML ──────────────────────────────────────────────
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(HTML_FILE));
    return;
  }

  // ── Proxy: /sim/* → simulator REST ───────────────────────────────────
  if (pathname.startsWith("/sim/")) {
    const simPath = pathname.replace(/^\/sim/, "");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => proxyToSimulator(req, res, simPath, req.method, body || undefined));
    return;
  }

  // ── Run test suite (SSE stream) ───────────────────────────────────────
  if (pathname.startsWith("/run/")) {
    const suite = pathname.replace(/^\/run\//, "");
    const allowed = ["test:unit", "test:package", "test:regression", "smoke:multicontroller", "smoke:userops", "check", "lint"];
    if (!allowed.includes(suite)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown suite: ${suite}` }));
      return;
    }
    runNpmScript(suite, res);
    return;
  }

  // ── Health check ──────────────────────────────────────────────────────
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: DASHBOARD_PORT }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(DASHBOARD_PORT, "127.0.0.1", () => {
  console.log(`Test Dashboard: http://127.0.0.1:${DASHBOARD_PORT}`);
  console.log(`Simulator proxy: /sim/* → ${SIMULATOR_BASE}`);
});
