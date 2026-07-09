const { spawn } = require("node:child_process");
const path = require("node:path");

const ADAPTER_ROOT = path.join(__dirname, "..");

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const executable = isWindows ? process.env.ComSpec || "cmd.exe" : command;
    const spawnArgs = isWindows
      ? ["/d", "/s", "/c", [command, ...args].map(quoteWinArg).join(" ")]
      : args;

    const child = spawn(executable, spawnArgs, {
      cwd: ADAPTER_ROOT,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function quoteWinArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  const escaped = value.replace(/"/gu, '\\"');
  return `"${escaped}"`;
}

async function run() {
  // Ensure simulator binary and dev-server profile are available.
  await runCommand("npm.cmd", ["run", "smoke:setup"]);

  // The regression suite is stateful and several user-ops checks rely on earlier setup tests.
  // Running the full simulator regression here is slower but stable and representative.
  await runCommand("npm.cmd", ["run", "test:regression"]);

  console.log("User-Ops multicontroller smoke passed.");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
