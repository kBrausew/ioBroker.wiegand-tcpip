const fs = require('fs');

const code = `"use strict";

/**
 * ioBroker Wiegand-TCPIP Adapter
 * Framework entry point: routes ioBroker events to application/presentation/wrapper layers
 *
 * Architecture:
 * - main.js: ioBroker framework interface
 * - lib/application.js: Adapter business logic (user management, jobs, events)
 * - lib/wrapper-api.js: UHPPOTE API abstraction
 * - lib/persist.js: State persistence (database, jobs)
 * - lib/presentation.js: UI/messagebox communication
 */

const utils = require("@iobroker/adapter-core");
const Application = require("./lib/application");
const WrapperAPI = require("./lib/wrapper-api");
const Persist = require("./lib/persist");
const Presentation = require("./lib/presentation");

class WiegandTcpip extends utils.Adapter {
  constructor(options) {
    super({
      ...options,
      name: "wiegand-tcpip",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));

    this.wrapperAPI = new WrapperAPI(this.log);
    this.persist = new Persist(this);
    this.app = new Application(this, this.wrapperAPI, this.persist);
    this.presentation = new Presentation(this, this.app, this.persist);
  }

  async onReady() {
    try {
      await this.app.init(this.config);
      await this.initUserManagement();
      this.config.settime = this.config.settime || 0;
      if (this.config.settime < 1200) {
        this.log.warn("Automatic clock setting disabled");
      }
      this.log.info("Adapter ready");
    } catch (err) {
      this.log.error(\`Failed to initialize: \${err.message}\`);
      this.restart();
    }
  }

  async initUserManagement() {
    await this.setObjectNotExists("cards", {
      type: "channel",
      common: { name: "Card and user management" },
      native: {},
    });

    const states = [
      ["db", "User/Credential database", "string", "json", "{}"],
      ["userCount", "Count of managed users", "number", "value", 0],
      ["credentialCount", "Count of managed credentials", "number", "value", 0],
      ["lastUpdate", "Last update timestamp", "string", "value", ""],
      ["reviewQueue", "Import review queue", "string", "json", "[]"],
      ["reviewPending", "Pending import review items", "number", "value", 0],
      ["jobs", "Background jobs", "string", "json", "[]"],
      ["lastJob", "Last background job", "string", "json", "{}"],
      ["lastSyncPreview", "Last sync preview", "string", "json", "{}"],
      ["lastSyncApply", "Last sync apply result", "string", "json", "{}"],
      ["lastValidation", "Last validation/reconcile report", "string", "json", "{}"],
      ["lastRestoreResync", "Last restore resync result", "string", "json", "{}"],
    ];

    for (const [id, name, type, role, defaultVal] of states) {
      await this.setObjectNotExists(\`cards.\${id}\`, {
        type: "state",
        common: {
          name,
          type,
          role,
          def: defaultVal,
          read: true,
          write: false,
        },
        native: {},
      });
    }

    const dbState = await this.getStateAsync("cards.db");
    if (dbState && typeof dbState.val === "string" && dbState.val.trim()) {
      try {
        const parsed = JSON.parse(dbState.val);
        if (parsed && typeof parsed === "object" && parsed.users) {
          this.app.userDb = parsed;
        }
      } catch (err) {
        this.log.warn(\`Could not parse cards.db. Resetting DB: \${err.message}\`);
        this.app.userDb = this.persist.createEmptyUserDb();
      }
    }

    if (!Array.isArray(this.app.userDb.reviewQueue)) {
      this.app.userDb.reviewQueue = [];
    }

    await this.persist.persistUserDb(this.app.userDb, "init");
    await this.persist.persistJobsState(this.app.getJobs());
  }

  async onStateChange(id, state) {
    if (!state) {
      this.log.debug(\`state \${id} deleted\`);
      return;
    }

    try {
      this.app.handleRemoteOpen(id, state);
    } catch (err) {
      this.log.error(\`State change handler error: \${err.message}\`);
    }
  }

  async onUnload(callback) {
    try {
      if (this.app.ulistener) {
        this.app.ulistener.close();
        this.app.ulistener = null;
        this.log.debug("CleanUp: Listener Close");
      }
    } catch (err) {
      this.log.debug(\`Listener close error: \${err.message}\`);
    }

    try {
      if (this.app.heartbeat) {
        this.clearInterval(this.app.heartbeat);
        this.app.heartbeat = null;
        this.log.debug("CleanUp: Clear interval");
      }
    } catch (err) {
      this.log.debug(\`Heartbeat clear error: \${err.message}\`);
    }

    callback();
  }

  async onMessage(obj) {
    try {
      await this.presentation.handle(obj);
    } catch (err) {
      this.log.error(\`Message handler error: \${err.message}\`);
      if (obj.callback) {
        this.sendTo(
          obj.from,
          obj.command,
          { error: true, err: { message: err.message } },
          obj.callback,
        );
      }
    }
  }
}

if (require.main !== module) {
  module.exports = (options) => new WiegandTcpip(options);
} else {
  new WiegandTcpip();
}
`;

fs.writeFileSync("main.js", code, "utf8");
console.log("✓ main.js written successfully");
