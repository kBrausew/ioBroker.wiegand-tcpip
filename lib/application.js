/**
 * Application Layer
 * Core adapter logic: user management, import/sync/restore operations, background jobs, UHPPOTE events
 */

class Application {
  /**
   * @param {any} adapter ioBroker adapter instance
   * @param {any} wrapperAPI UHPPOTE wrapper instance
   * @param {any} persist Persistence instance
   */
  constructor(adapter, wrapperAPI, persist) {
    this.adapter = adapter;
    this.wrapperAPI = wrapperAPI;
    this.persist = persist;

    // ioBroker state (from onReady initialization)
    this.ctrls = [];
    this.serials = {};
    this.devs = [];
    this.userDb = persist.createEmptyUserDb();
    this.cardDb = persist.createEmptyCardDb(); // V2.0 Card-centric DB

    this.jobs = {};
    this.jobSequence = 0;

    // Device management
    this.ulistener = null;
    this.heartbeat = null;
    this.assureRun_once = false;
  }

  /**
   * Initialize adapter (called from onReady)
   * @param {object} config Adapter config
   */
  async init(config) {
    const lCFG = this.wrapperAPI.createCFG(config);

    // Register cards.* state objects (must exist before any setState calls)
    await this.initCardsObjects();

    // Load user database (legacy support)
    this.userDb = await this.persist.loadUserDatabase();

    // Load card database (V2.0)
    this.cardDb = await this.persist.loadCardDatabase();

    // Parse controllers
    const itemNr_iter = { value: 1 };
    for (const dev of config.controllers || []) {
      await this.addController(dev, itemNr_iter.value++, lCFG);
    }

    // Clean up obsolete controller objects
    this.adapter.getDevices((err, res) => {
      if (!err && res) {
        res.forEach((obj) => {
          const spl = obj._id.split(".");
          if (spl.length == 4 && spl[2] == "controllers") {
            if (!this.serials[spl[3]]) {
              this.adapter.delObject(obj._id, { recursive: true }, (err) => {
                if (err) {
                  this.adapter.log.debug(`CleanUp device ${obj._id}: ${err.message}`);
                }
              });
              this.adapter.log.info(`Controller: ${obj._id} deleted`);
            }
          }
        });
      }
    });

    // Start listener and heartbeat
    const lCTX = this.wrapperAPI.createCTX("ctx", lCFG, this.devs, this.adapter.log.debug);
    this.adapter.log.silly(JSON.stringify(lCTX));

    this.ulistener = await this.wrapperAPI.listen(
      lCTX,
      this.onUapiEvent.bind(this),
      this.onUapiError.bind(this),
    );

    await this.assureRun();
    this.heartbeat = this.adapter.setInterval(
      this.assureRun.bind(this),
      lCFG.lHeartbeat,
    );
  }

  /**
   * Add and validate controller from config
   */
  async addController(dev, itemNr, lCFG) {
    if (this.serials[dev.serial]) {
      this.adapter.log.error(`Controller configured more than once: ${dev.serial}`);
      return;
    }

    const serial = parseInt(dev.serial, 10);
    if (isNaN(serial) || serial <= 0) {
      this.adapter.log.error(`Invalid serial number for controller: [${dev.serial}]`);
      return;
    }

    dev.serial = serial;
    this.serials[dev.serial] = true;
    dev.modelType = parseInt(dev.modelType, 10) || 4;
    dev.index = itemNr;
    dev.errorCount = 1;
    dev.heartbeatCount = 1;

    // Auto-complete network config
    if (dev.deviceIp && dev.exposedIP && dev.exposedPort) {
      dev.broadcast = false;
    } else if (dev.deviceIp || dev.exposedIP || dev.exposedPort) {
      if (!dev.deviceIp) dev.deviceIp = lCFG.lBroadcast;
      if (!dev.exposedIP) dev.exposedIP = lCFG.lBind;
      if (!dev.exposedPort) dev.exposedPort = lCFG.rPort;
      dev.broadcast = true;
      this.adapter.log.warn(`Incomplete controller-setup for broadcast: ${dev.serial}`);
    } else {
      dev.deviceIp = lCFG.lBroadcast;
      dev.exposedIP = lCFG.rBroadcast;
      dev.exposedPort = lCFG.rPort;
      dev.broadcast = true;
    }

    this.devs.push({
      deviceId: dev.serial,
      address: dev.deviceIp,
      forceBroadcast: dev.broadcast,
    });
    dev.run = false;
    dev.eventNr = 0;
    this.ctrls.push(dev);

    // Create state tree
    try {
      await this.treeStructure(dev.serial, dev.index, dev.modelType);
    } catch (err) {
      this.adapter.log.error(`Failed to create tree for ${dev.serial}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Register all cards.* state objects in ioBroker object tree.
   * Must be called once during init() before any setState calls.
   */
  async initCardsObjects() {
    await this.adapter.setObjectNotExists("cards", {
      type: "channel",
      common: { name: "Card & User Database" },
      native: {},
    });

    // Card-centric DB (V2.0)
    await this.createOneState("cards", "cardDb",          "Card Database (JSON)",       "string",  "value",       true, false, "{}");
    await this.createOneState("cards", "cardCount",       "Number of cards",            "number",  "value",       true, false, 0);
    await this.createOneState("cards", "cardDbLastUpdate","Card DB last update",         "string",  "value",       true, false, "");

    // User-centric DB (legacy / V1)
    await this.createOneState("cards", "db",              "User Database (JSON)",        "string",  "value",       true, false, "{}");
    await this.createOneState("cards", "userCount",       "Number of users",             "number",  "value",       true, false, 0);
    await this.createOneState("cards", "credentialCount", "Number of credentials",       "number",  "value",       true, false, 0);
    await this.createOneState("cards", "lastUpdate",      "DB last update",              "string",  "value",       true, false, "");
    await this.createOneState("cards", "reviewQueue",     "Review queue (JSON)",         "string",  "value",       true, false, "[]");
    await this.createOneState("cards", "reviewPending",   "Pending review count",        "number",  "value",       true, false, 0);

    // Job queue
    await this.createOneState("cards", "jobs",            "Job queue (JSON)",            "string",  "value",       true, false, "[]");
    await this.createOneState("cards", "lastJob",         "Last job (JSON)",             "string",  "value",       true, false, "{}");
  }

  /**
   * Create state tree for controller and doors
   */
  async treeStructure(serialNr, itemNr, noOfDoors) {
    const lSerialNr = serialNr.toString();
    const lRootPath = `controllers.${lSerialNr}`;

    this.adapter.log.info(`Create controller ${lSerialNr} for Model ${noOfDoors}-Door Objects`);

    await this.adapter.setObjectNotExists(lRootPath, {
      type: "device",
      common: { name: `Controller-${itemNr.toString()}` },
      native: {},
    });

    await this.createOneState(lRootPath, "eventNr", "Last Event #", "number", "value", true, false, 0);
    await this.createOneState(lRootPath, "reachable", "Device reachable", "boolean", "indicator.reachable", true, false, false);

    for (let i = 1; i <= 4; i++) {
      const lDoorPath = `${lRootPath}.${i.toString()}`;
      if (i <= noOfDoors) {
        await this.adapter.setObjectNotExists(lDoorPath, {
          type: "channel",
          common: { name: `Door-${i.toString()}` },
          native: {},
        });

        await this.createOneState(lDoorPath, "control", "Open Mode", "number", "value", true, false, 0, {
          0: "unknown", 1: "normally open", 2: "normally closed", 3: "controlled",
        });
        await this.createOneState(lDoorPath, "delay", "Switch delay", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "directionCode", "Direction #", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "directionText", "Direction", "string", "value", true, false, "");
        await this.createOneState(lDoorPath, "lastSwipe", "Card-/Unlock- Id", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "unauthorized", "Unauthorized Card-/Unlock- Id", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "lastGranted", "Access Grant / Denied", "boolean", "value", true, false, false);
        await this.createOneState(lDoorPath, "reasonCode", "Reason #", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "reasonText", "Reason", "string", "value", true, false, "");
        await this.createOneState(lDoorPath, "requestCode", "Request #", "number", "value", true, false, 0);
        await this.createOneState(lDoorPath, "requestText", "Request", "string", "value", true, false, "");
        await this.createOneState(lDoorPath, "remoteOpen", "Open Door", "boolean", "button.open.door", false, true, true);
        await this.createOneState(lDoorPath, "unlocked", "Door unlocked", "boolean", "value.lock", true, false, false);
        await this.adapter.subscribeStatesAsync(`${lDoorPath}.remoteOpen`);
      } else {
        try {
          this.adapter.unsubscribeStates(`${lDoorPath}.remoteOpen`);
          this.adapter.delObject(lDoorPath, { recursive: true }, (err) => {
            if (err) this.adapter.log.debug(`Deleted door not valid ${lDoorPath}: ${err.message}`);
          });
        } catch (error) {
          this.adapter.log.warn(`Error deactivating device: ${serialNr} / ${i}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Create a single state object
   */
  async createOneState(path, id, name, type, role, read, write, val, stat) {
    const lPath = `${path}.${id}`;
    await this.adapter.setObjectNotExists(lPath, {
      type: "state",
      common: {
        name,
        type,
        role,
        def: val,
        states: stat,
        read,
        write,
      },
      native: {},
    });
  }

  /**
   * Handle remoteOpen state change
   */
  handleRemoteOpen(id, state) {
    if (!state || state.ack) return;

    const id_part = id.split(".");
    if (
      id_part.length < 6 ||
      id_part[0] != this.adapter.name ||
      id_part[1] != this.adapter.instance.toString() ||
      id_part[2] != "controllers" ||
      id_part[5] != "remoteOpen"
    ) {
      this.adapter.log.error(`State not handled: ${id}`);
      return;
    }

    const lLocal = `system.adapter.${this.adapter.name}.${this.adapter.instance}`;
    const lFrom = state.from || lLocal;
    if (lFrom === lLocal) {
      this.adapter.log.silly("Ignore state change from myself");
      return;
    }

    const ldeviceId = parseInt(id_part[3], 10);
    const ldoorId = parseInt(id_part[4], 10);
    if (state.val == true && !isNaN(ldeviceId) && !isNaN(ldoorId)) {
      const dev = this.ctrls.find((d) => d.serial == ldeviceId);
      if (dev?.run) {
        this.doorOpenSpec(dev.serial, ldoorId);
      } else {
        this.adapter.log.error(`Cannot handle unreached device: ${ldeviceId}`);
      }
    }
  }

  /**
   * Open door via UHPPOTE API
   */
  doorOpenSpec(deviceId, doorId) {
    const lCTX = this.wrapperAPI.createCTX(
      "specRemOp",
      this.wrapperAPI.createCFG(this.adapter.config),
      this.devs,
      this.adapter.log.debug,
    );

    this.wrapperAPI
      .openDoor(lCTX, deviceId, doorId)
      .then((ret) => {
        this.adapter.log.debug(
          `Request remote open: ${deviceId} Door-${doorId}: ${JSON.stringify(ret)}`,
        );
      })
      .catch((err) => {
        this.adapter.log.error(`Error Remote Open Door: ${deviceId}/${doorId}: ${err.message}`);
      });
  }

  /**
   * Heartbeat: maintain device connections, time sync, event sync
   */
  async assureRun() {
    if (this.assureRun_once) {
      this.adapter.log.error("Heartbeat is too short for all required tasks");
      return;
    }

    this.assureRun_once = true;
    const lCFG = this.wrapperAPI.createCFG(this.adapter.config);
    const lCTX = this.wrapperAPI.createCTX("assureRun", lCFG, this.devs, this.adapter.log.debug);

    try {
      for (const dev of this.ctrls) {
        try {
          let eventNr = 0;
          const lStat = await this.wrapperAPI.getStatus(lCTX, dev.serial);

          if (lStat?.state?.event) {
            eventNr = parseInt(lStat.state.event.index, 10) || 0;
            if (dev.run && dev.eventNr != eventNr) {
              this.adapter.log.warn(
                `May connection lost (try re-connect device): ${dev.serial} / ${eventNr} / ${dev.eventNr}`,
              );
              dev.run = false;
            }
            ++dev.heartbeatCount;
          }

          this.checkTimeDiff(dev, lStat);

          if (dev.run && dev.heartbeatCount > 10) {
            const lList = await this.wrapperAPI.getListener(lCTX, dev.serial);
            if (lList) {
              const lHost = lList.address || "";
              const lPort = lList.port || 0;
              if (lHost != dev.exposedIP || lPort != dev.exposedPort) {
                this.adapter.log.warn(
                  `Extended heartbeat negative (try re-connect device): ${dev.serial}`,
                );
                dev.run = false;
              }
            }
            dev.heartbeatCount = 1;
          }

          if (!dev.run) {
            this.adapter.log.info(`Connect to controller: ${dev.serial}`);
            await this.wrapperAPI.recordSpecialEvents(lCTX, dev.serial, true);
            await this.wrapperAPI.setListener(lCTX, dev.serial, dev.exposedIP, dev.exposedPort);
            dev.eventNr = eventNr;
            dev.heartbeatCount = 1;
            dev.run = true;
            dev.setTime = true;
          }

          if (dev.setTime && this.adapter.config.settime >= 1200) {
            this.adapter.log.info(`Reset the device clock: ${dev.serial}`);
            await this.wrapperAPI.setTime(
              lCTX,
              dev.serial,
              this.adapter.formatDate(Date.now(), "YYYY-MM-DD hh:mm:ss"),
            );
            dev.setTime = false;
          }

          if (dev.heartbeatCount == 1) {
            for (let i = 1; i <= dev.modelType; i++) {
              try {
                const lContr = await this.wrapperAPI.getDoorControl(lCTX, dev.serial, i);
                let lDelay = 0;
                let lContr_n = 0;
                if (lContr?.doorControlState) {
                  lDelay = lContr.doorControlState.delay || 0;
                  if (lContr.doorControlState.control) {
                    lContr_n = lContr.doorControlState.control.value || 0;
                  }
                }
                this.adapter.setState(`controllers.${dev.serial}.${i}.delay`, { ack: true, val: lDelay });
                this.adapter.setState(`controllers.${dev.serial}.${i}.control`, { ack: true, val: lContr_n });
              } catch {
                // Skip door
              }
            }
            this.adapter.setState(`controllers.${dev.serial}.eventNr`, { ack: true, val: eventNr });
          }
        } catch (err) {
          dev.run = false;
          this.adapter.log.error(`Problem with controller ${dev.serial}: ${err.message}`);
        }

        try {
          const lReach = `controllers.${dev.serial}.reachable`;
          this.adapter.getState(lReach, (fErr, fStat) => {
            if (!fErr) {
              let lState = false;
              if (fStat) {
                lState = fStat.val || false;
              }
              if (lState != dev.run) {
                this.adapter.setState(lReach, { ack: true, val: dev.run });
              }
              dev.errorCount = 1;
            } else {
              if (dev.errorCount % 100 == 0) {
                this.adapter.log.error(`... controller ${dev.serial}: ${fErr.message}`);
              }
              if (dev.errorCount >= 3000) {
                this.adapter.log.error(`Major-Problem: Better restart... ${dev.serial}`);
                this.adapter.restart();
              }
              ++dev.errorCount;
            }
          });
        } catch (err) {
          dev.run = false;
          this.adapter.log.error(
            `Post-Constructor-Problem with controller ${dev.serial}: ${err.message}`,
          );
        }
      }
    } catch (e) {
      this.adapter.log.error(`Major-problem in heartbeat: ${e.message}`);
    }

    this.assureRun_once = false;
  }

  /**
   * Check device time drift
   */
  checkTimeDiff(pDev, pEvt) {
    if (
      this.adapter.config.settime &&
      this.adapter.config.settime > 1200 &&
      pEvt?.state?.system
    ) {
      if (pEvt.state.system.date && pEvt.state.system.time) {
        const lNow = new Date();
        const lDat = new Date(`${pEvt.state.system.date}T${pEvt.state.system.time}`);
        const lDiff = Math.abs(lDat.getTime() - lNow.getTime());
        if (lDiff > this.adapter.config.settime) {
          pDev.setTime = true;
          this.adapter.log.debug(
            `The device clock is no longer up to date: ${pDev.serial} difference ${lDiff}ms`,
          );
        }
      }
    }
  }

  /**
   * Handle UHPPOTE event
   */
  async onUapiEvent(evt) {
    if (!evt?.state?.serialNumber || !evt?.state?.event) {
      return;
    }

    const lEvt = evt.state.event;
    const ldeviceId = evt.state.serialNumber;
    const lGranted = lEvt.granted || false;
    const ldoorId = parseInt(lEvt.door, 10) || 0;
    const lCard = parseInt(lEvt.card, 10) || 0;
    const dev = this.ctrls.find((d) => d.serial == ldeviceId);

    if (!dev) {
      this.adapter.log.error(`Major-Problem with event receiving: unknown device ${ldeviceId}`);
      return;
    }

    if (ldoorId <= 0 || ldoorId > dev.modelType) {
      this.adapter.log.error(
        `Received Event has no valid Door Identifier: ${ldoorId} (Controller: ${ldeviceId})`,
      );
      return;
    }

    const lRoot = `controllers.${ldeviceId}.${ldoorId}`;
    let requestCode = 0, requestText = "", reasonCode = 0, reasonText = "", directionCode = 0, directionText = "";

    this.adapter.getState(`${lRoot}.unlocked`, (_fErr, fStat) => {
      if (!fStat) {
        this.adapter.log.error(`No state found: ${lRoot}.unlocked`);
        return;
      }

      if (lGranted) {
        this.adapter.setState(`${lRoot}.unlocked`, { ack: true, val: lGranted });
        this.adapter.setTimeout(() => {
          this.adapter.setState(`${lRoot}.unlocked`, { ack: true, val: false });
        }, 50);
      } else {
        this.adapter.setState(`${lRoot}.unauthorized`, { ack: true, val: lCard });
      }

      if (lEvt.type) {
        requestCode = lEvt.type.code || 0;
        requestText = lEvt.type.event || "";
      }
      if (lEvt.reason) {
        reasonCode = lEvt.reason.code || 0;
        reasonText = lEvt.reason.reason || "";
      }
      if (lEvt.direction) {
        directionCode = lEvt.direction.code || 0;
        directionText = lEvt.direction.direction || "";
      }

      this.adapter.setState(`${lRoot}.directionCode`, { ack: true, val: directionCode });
      this.adapter.setState(`${lRoot}.directionText`, { ack: true, val: directionText });
      this.adapter.setState(`${lRoot}.requestCode`, { ack: true, val: requestCode });
      this.adapter.setState(`${lRoot}.requestText`, { ack: true, val: requestText });
      this.adapter.setState(`${lRoot}.reasonCode`, { ack: true, val: reasonCode });
      this.adapter.setState(`${lRoot}.reasonText`, { ack: true, val: reasonText });
      this.adapter.setState(`${lRoot}.lastSwipe`, { ack: true, val: lCard });
      this.adapter.setState(`${lRoot}.lastGranted`, { ack: true, val: lGranted });

      this.registerCredentialObservation({
        cardNumber: lCard,
        controllerSerial: ldeviceId,
        doorId: ldoorId,
        granted: lGranted,
        requestCode,
        reasonCode,
        reasonText,
        directionCode,
      }).catch((mergeErr) => {
        this.adapter.log.warn(`Card merge update failed: ${mergeErr.message}`);
      });

      this.adapter.log.debug(
        `Controller: ${ldeviceId} Door: ${ldoorId} granted: ${lGranted} Card: ${lCard}`,
      );
    });

    if (lEvt.index) {
      ++dev.eventNr;
      if (dev.eventNr != lEvt.index) {
        this.adapter.log.error(
          `Timing problem expected: ${dev.eventNr} / receive: ${lEvt.index} Event`,
        );
      }
      this.adapter.setState(`controllers.${ldeviceId}.eventNr`, { ack: true, val: lEvt.index });
    }

    this.checkTimeDiff(dev, evt);
  }

  /**
   * Handle UHPPOTE error
   */
  async onUapiError(err) {
    this.adapter.log.error(`Event receive error: ${err.message}`);
  }

  // =================== USER MANAGEMENT ===================

  /**
   * Normalize credential from import/upsert
   */
  normalizeCredential(rawCredential) {
    const type = (rawCredential.type || "card").toString().toLowerCase();
    const valueSource =
      rawCredential.value != null
        ? rawCredential.value
        : rawCredential.card != null
          ? rawCredential.card
          : rawCredential.pin != null
            ? rawCredential.pin
            : "";
    const value = valueSource.toString();

    if (!value) {
      throw new Error("Credential value is required");
    }

    const id = (rawCredential.id || `${type}:${value}`).toString();
    const controllers = Array.isArray(rawCredential.controllers)
      ? rawCredential.controllers.map((it) => parseInt(it, 10)).filter((it) => !isNaN(it))
      : [];

    return {
      id,
      type,
      value,
      label: (rawCredential.label || "").toString(),
      controllers: [...new Set(controllers)],
      meta: { ...(rawCredential.meta || {}) },
    };
  }

  /**
   * Normalize user from import/upsert
   */
  normalizeUser(rawUser) {
    if (!rawUser || typeof rawUser !== "object") {
      throw new Error("Missing user object");
    }

    const id = (rawUser.id || rawUser.userId || "").toString();
    if (!id) {
      throw new Error("Missing user id");
    }

    const credentialsRaw = Array.isArray(rawUser.credentials) ? rawUser.credentials : [];
    const credentials = credentialsRaw.map((cred) => this.normalizeCredential(cred));

    return {
      id,
      displayName: (rawUser.displayName || rawUser.name || id).toString(),
      controllers: Array.isArray(rawUser.controllers)
        ? rawUser.controllers.map((it) => parseInt(it, 10)).filter((it) => !isNaN(it))
        : [],
      credentials,
      meta: { ...(rawUser.meta || {}) },
    };
  }

  /**
   * Upsert user into database
   */
  upsertUser(rawUser, source) {
    const normalized = this.normalizeUser(rawUser);
    const existing = this.userDb.users[normalized.id] || {
      id: normalized.id,
      displayName: normalized.displayName,
      controllers: [],
      credentials: [],
      meta: {},
    };

    existing.displayName = normalized.displayName;
    existing.meta = {
      ...(existing.meta || {}),
      ...(normalized.meta || {}),
      source: source || "manual",
      updatedAt: new Date().toISOString(),
    };

    const credentialMap = {};
    for (const credential of existing.credentials || []) {
      credentialMap[credential.id] = {
        ...credential,
        controllers: [...new Set(credential.controllers || [])],
      };
    }

    for (const credential of normalized.credentials) {
      if (credentialMap[credential.id]) {
        const current = credentialMap[credential.id];
        current.controllers = [
          ...new Set([...(current.controllers || []), ...(credential.controllers || [])]),
        ];
        current.label = credential.label || current.label || "";
        current.meta = { ...(current.meta || {}), ...(credential.meta || {}) };
      } else {
        credentialMap[credential.id] = credential;
      }
    }

    existing.credentials = Object.values(credentialMap);
    const controllersFromCredentials = existing.credentials.flatMap(
      (credential) => credential.controllers || [],
    );
    existing.controllers = [
      ...new Set([...(normalized.controllers || []), ...controllersFromCredentials]),
    ];

    this.userDb.users[normalized.id] = existing;
    return existing;
  }

  /**
   * Find user ID by credential
   */
  findUserIdByCredential(type, value) {
    const targetType = type.toLowerCase();
    const targetValue = value.toString();
    for (const [userId, user] of Object.entries(this.userDb.users)) {
      for (const credential of user.credentials || []) {
        if (
          credential.type === targetType &&
          credential.value.toString() === targetValue
        ) {
          return userId;
        }
      }
    }
    return null;
  }

  /**
   * Find user ID by identity metadata (external ID)
   */
  findUserIdByIdentityMeta(identityMeta) {
    if (!identityMeta || typeof identityMeta !== "object") {
      return null;
    }
    const externalId = (identityMeta.externalId || "").toString();
    if (!externalId) {
      return null;
    }

    for (const [userId, user] of Object.entries(this.userDb.users)) {
      const userExternalId = (
        user?.meta?.identityMeta?.externalId ||
        user?.meta?.externalId ||
        ""
      ).toString();
      if (userExternalId && userExternalId === externalId) {
        return userId;
      }
    }

    return null;
  }

  /**
   * Register credential observation from card swipe event
   */
  async registerCredentialObservation(observation) {
    if (!observation?.cardNumber || observation.cardNumber <= 0) {
      return;
    }

    const cardValue = observation.cardNumber.toString();
    const credentialType = "card";
    let userId = this.findUserIdByCredential(credentialType, cardValue);
    const now = new Date().toISOString();

    if (!userId) {
      userId = `auto-card-${cardValue}`;
      this.upsertUser(
        {
          id: userId,
          displayName: `Auto user ${cardValue}`,
          credentials: [
            {
              type: credentialType,
              value: cardValue,
              controllers: [observation.controllerSerial],
              meta: { source: "event" },
            },
          ],
        },
        "event",
      );
    }

    const user = this.userDb.users[userId];
    if (!user) {
      return;
    }

    const credentialId = `${credentialType}:${cardValue}`;
    const credential = (user.credentials || []).find((item) => item.id === credentialId);

    if (credential) {
      credential.controllers = [
        ...new Set([...(credential.controllers || []), observation.controllerSerial]),
      ];
      credential.meta = {
        ...(credential.meta || {}),
        lastSeen: now,
        lastDoorId: observation.doorId,
        lastGranted: observation.granted,
        lastReasonCode: observation.reasonCode,
        lastReasonText: observation.reasonText,
        lastRequestCode: observation.requestCode,
        lastDirectionCode: observation.directionCode,
      };
    }

    user.controllers = [
      ...new Set([...(user.controllers || []), observation.controllerSerial]),
    ];
    user.meta = {
      ...(user.meta || {}),
      lastSeen: now,
      source: "event",
    };

    await this.persist.persistUserDb(this.userDb, "event");
  }

  // =================== IMPORT ===================

  /**
   * Normalize import dataset
   */
  normalizeImportDataset(dataset) {
    if (!dataset || typeof dataset !== "object") {
      throw new Error("Import dataset is missing");
    }

    const controllers = Array.isArray(dataset.controllers) ? dataset.controllers : [];
    const records = [];

    for (const controller of controllers) {
      const serial = parseInt(controller.serial, 10);
      if (isNaN(serial)) {
        continue;
      }

      const entries = Array.isArray(controller.entries) ? controller.entries : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const credentials = [];
        if (entry.card != null && entry.card !== "") {
          credentials.push({
            type: "card",
            value: entry.card,
            controllers: [serial],
          });
        }
        if (entry.pin != null && entry.pin !== "") {
          credentials.push({
            type: "pin",
            value: entry.pin,
            controllers: [serial],
          });
        }
        if (entry.finger != null && entry.finger !== "") {
          credentials.push({
            type: "finger",
            value: entry.finger,
            controllers: [serial],
          });
        }

        if (!credentials.length) {
          continue;
        }

        records.push({
          controllerSerial: serial,
          displayName: (entry.displayName || entry.name || "").toString(),
          credentials,
          identityMeta: {
            externalId: (entry.externalId || entry.userId || entry.id || "").toString(),
            sourceSystem: (entry.sourceSystem || dataset.source || "import").toString(),
          },
          meta: {
            source: entry.source || dataset.source || "import",
            importedAt: new Date().toISOString(),
            authority: entry.authority || "",
          },
        });
      }
    }

    return records;
  }

  /**
   * Make import user ID from record
   */
  makeImportUserId(record) {
    const preferred = (record.displayName || "").trim().toLowerCase();
    if (preferred) {
      const safe = preferred.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      if (safe) {
        return `import-${safe}`;
      }
    }
    const firstCredential = record.credentials[0];
    return `import-${firstCredential.type}-${firstCredential.value}`;
  }

  /**
   * Decide target user for import record
   */
  decideImportTargetUser(record) {
    const identityUserId = this.findUserIdByIdentityMeta(record.identityMeta);
    if (identityUserId) {
      return {
        conflict: false,
        userId: identityUserId,
        candidates: [identityUserId],
      };
    }

    const found = new Set();
    for (const credential of record.credentials) {
      const userId = this.findUserIdByCredential(credential.type, credential.value);
      if (userId) {
        found.add(userId);
      }
    }

    if (found.size > 1) {
      return {
        conflict: true,
        userId: null,
        candidates: [...found],
      };
    }

    if (found.size === 1) {
      return {
        conflict: false,
        userId: [...found][0],
        candidates: [...found],
      };
    }

    return {
      conflict: false,
      userId: this.makeImportUserId(record),
      candidates: [],
    };
  }

  /**
   * Build import preview
   */
  buildImportPreview(dataset) {
    const records = this.normalizeImportDataset(dataset);
    let usersToCreate = 0;
    let usersToUpdate = 0;
    let credentialsToMerge = 0;
    const conflicts = [];
    const reviewItems = [];

    for (const [index, record] of records.entries()) {
      const decision = this.decideImportTargetUser(record);
      reviewItems.push(this.buildImportReviewItem(index, record, decision));

      if (decision.conflict) {
        conflicts.push({
          displayName: record.displayName,
          controllerSerial: record.controllerSerial,
          candidates: decision.candidates,
        });
        continue;
      }

      if (this.userDb.users[decision.userId]) {
        usersToUpdate += 1;
      } else {
        usersToCreate += 1;
      }
      credentialsToMerge += record.credentials.length;
    }

    return {
      records: records.length,
      usersToCreate,
      usersToUpdate,
      credentialsToMerge,
      conflicts,
      reviewItems,
      pendingReviews: reviewItems.length,
      canApply: false,
    };
  }

  /**
   * Build import review item
   */
  buildImportReviewItem(index, record, decision) {
    const now = new Date().toISOString();
    return {
      id: `review-${Date.now()}-${index}`,
      createdAt: now,
      status: "pending",
      decisionType: decision.conflict
        ? "conflict"
        : this.userDb.users[decision.userId]
          ? "merge"
          : "create",
      suggestedUserId: decision.userId,
      candidates: decision.candidates || [],
      approvedAction: "",
      approvedUserId: "",
      record,
    };
  }

  /**
   * Find review item by ID
   */
  findReviewItem(reviewId) {
    return (
      (this.userDb.reviewQueue || []).find((item) => item.id === reviewId) || null
    );
  }

  /**
   * Approve review item
   */
  approveReviewItem(reviewId, action, userId) {
    const item = this.findReviewItem(reviewId);
    if (!item) {
      throw new Error(`Review item not found: ${reviewId}`);
    }
    if (item.status !== "pending") {
      throw new Error(`Review item is not pending: ${reviewId}`);
    }

    const normalizedAction = (action || "").toString().toLowerCase();
    if (normalizedAction !== "create" && normalizedAction !== "merge") {
      throw new Error('Action must be "create" or "merge"');
    }

    let resolvedUserId = "";
    if (normalizedAction === "merge") {
      resolvedUserId = (userId || item.suggestedUserId || "").toString();
      if (!resolvedUserId) {
        throw new Error("Missing userId for merge action");
      }
      if (
        item.candidates.length > 0 &&
        !item.candidates.includes(resolvedUserId)
      ) {
        throw new Error(
          `userId ${resolvedUserId} is not part of review candidates`,
        );
      }
      if (!this.userDb.users[resolvedUserId]) {
        throw new Error(`Target user does not exist: ${resolvedUserId}`);
      }
    } else {
      resolvedUserId = (
        item.suggestedUserId || this.makeImportUserId(item.record)
      ).toString();
    }

    item.status = "approved";
    item.approvedAction = normalizedAction;
    item.approvedUserId = resolvedUserId;
    item.approvedAt = new Date().toISOString();

    return item;
  }

  /**
   * Reject review item
   */
  rejectReviewItem(reviewId, reason) {
    const item = this.findReviewItem(reviewId);
    if (!item) {
      throw new Error(`Review item not found: ${reviewId}`);
    }
    if (item.status !== "pending") {
      throw new Error(`Review item is not pending: ${reviewId}`);
    }

    item.status = "rejected";
    item.rejectedAt = new Date().toISOString();
    item.rejectReason = (reason || "").toString();
    return item;
  }

  /**
   * Clear review queue
   */
  clearReviewQueue({ keepPending = true } = {}) {
    const queue = Array.isArray(this.userDb.reviewQueue)
      ? this.userDb.reviewQueue
      : [];
    const terminalStatuses = new Set(["applied", "rejected", "failed"]);
    const toRemove = queue.filter((item) =>
      terminalStatuses.has(item.status),
    );

    if (keepPending) {
      this.userDb.reviewQueue = queue.filter(
        (item) => !terminalStatuses.has(item.status),
      );
    } else {
      this.userDb.reviewQueue = [];
    }

    return {
      removedCount: toRemove.length,
      removedIds: toRemove.map((item) => item.id),
      remaining: this.userDb.reviewQueue.length,
    };
  }

  /**
   * Apply import dataset
   */
  async applyImportDataset(dataset) {
    let preview = null;
    if (
      !Array.isArray(this.userDb.reviewQueue) ||
      this.userDb.reviewQueue.length === 0
    ) {
      preview = this.buildImportPreview(dataset);
      this.userDb.reviewQueue = preview.reviewItems;
      await this.persist.persistUserDb(this.userDb, "importPreview");
    }

    const summary = this.persist.getReviewQueueSummary(this.userDb);
    if (summary.pending > 0) {
      return {
        applied: false,
        reason: "reviewPending",
        reviewSummary: summary,
        preview,
      };
    }

    const touchedUsers = new Set();
    const appliedReviewIds = [];
    const failedReviewIds = [];

    for (const reviewItem of this.userDb.reviewQueue) {
      if (reviewItem.status !== "approved") {
        continue;
      }

      try {
        const user = {
          id: reviewItem.approvedUserId,
          displayName:
            reviewItem.record.displayName || reviewItem.approvedUserId,
          controllers: [reviewItem.record.controllerSerial],
          credentials: reviewItem.record.credentials,
          meta: {
            ...reviewItem.record.meta,
            identityMeta: { ...(reviewItem.record.identityMeta || {}) },
          },
        };
        this.upsertUser(user, "import");
        touchedUsers.add(reviewItem.approvedUserId);
        reviewItem.status = "applied";
        reviewItem.appliedAt = new Date().toISOString();
        appliedReviewIds.push(reviewItem.id);
      } catch (err) {
        reviewItem.status = "failed";
        reviewItem.failedAt = new Date().toISOString();
        reviewItem.error = err.message;
        failedReviewIds.push(reviewItem.id);
      }
    }

    await this.persist.persistUserDb(this.userDb, "import");
    return {
      applied: failedReviewIds.length === 0,
      touchedUsers: [...touchedUsers],
      reviewSummary: this.persist.getReviewQueueSummary(this.userDb),
      appliedReviewIds,
      failedReviewIds,
    };
  }

  // =================== VALIDATION ===================

  /**
   * Normalize validation payload
   */
  normalizeValidationPayload(payload) {
    const configuredControllerIds = this.ctrls
      .map((controller) => parseInt(controller.serial, 10))
      .filter((item) => !isNaN(item));

    const selectedControllerIds = Array.isArray(payload?.controllerIds)
      ? payload.controllerIds
          .map((item) => parseInt(item, 10))
          .filter((item) => !isNaN(item))
      : configuredControllerIds;

    return {
      selectedControllerIds: [...new Set(selectedControllerIds)],
      configuredControllerIds,
    };
  }

  /**
   * Validate user database
   */
  validateUserDb(payload) {
    const options = this.normalizeValidationPayload(payload || {});
    const configuredControllers = new Set(
      this.ctrls
        .map((controller) => parseInt(controller.serial, 10))
        .filter((item) => !isNaN(item)),
    );
    const selectedControllers = new Set(options.selectedControllerIds);
    const configuredSelection = options.selectedControllerIds.filter(
      (controllerId) => configuredControllers.has(controllerId),
    );

    const unknownControllerReferences = [];
    const usersWithoutCredentials = [];
    const credentialsWithoutControllers = [];
    const duplicateCredentialKeys = {};
    const credentialOwner = {};
    const perController = {};

    for (const controllerId of options.selectedControllerIds) {
      perController[controllerId] = {
        users: new Set(),
        credentials: 0,
        unknownControllerReferences: 0,
      };
    }

    for (const [userId, user] of Object.entries(this.userDb.users)) {
      const credentials = Array.isArray(user.credentials) ? user.credentials : [];
      if (!credentials.length) {
        usersWithoutCredentials.push(userId);
      }

      for (const credential of credentials) {
        const key = `${credential.type}:${credential.value}`;
        const controllers = Array.isArray(credential.controllers)
          ? credential.controllers
          : [];
        const selectedCredentialControllers = controllers
          .map((controllerIdRaw) => parseInt(controllerIdRaw, 10))
          .filter(
            (controllerId) =>
              !isNaN(controllerId) && selectedControllers.has(controllerId),
          );

        if (
          !selectedCredentialControllers.length &&
          options.selectedControllerIds.length > 0
        ) {
          continue;
        }

        if (credentialOwner[key] && credentialOwner[key] !== userId) {
          if (!duplicateCredentialKeys[key]) {
            duplicateCredentialKeys[key] = [credentialOwner[key]];
          }
          if (!duplicateCredentialKeys[key].includes(userId)) {
            duplicateCredentialKeys[key].push(userId);
          }
        } else {
          credentialOwner[key] = userId;
        }

        if (!controllers.length && configuredSelection.length > 0) {
          credentialsWithoutControllers.push({
            userId,
            credentialId: credential.id,
            key,
          });
        }

        for (const controllerId of selectedCredentialControllers) {
          if (!perController[controllerId]) {
            perController[controllerId] = {
              users: new Set(),
              credentials: 0,
              unknownControllerReferences: 0,
            };
          }
          perController[controllerId].users.add(userId);
          perController[controllerId].credentials += 1;
        }

        for (const controllerIdRaw of controllers) {
          const controllerId = parseInt(controllerIdRaw, 10);
          if (isNaN(controllerId) || !selectedControllers.has(controllerId)) {
            continue;
          }
          if (isNaN(controllerId) || !configuredControllers.has(controllerId)) {
            unknownControllerReferences.push({
              userId,
              credentialId: credential.id,
              controllerId: controllerIdRaw,
            });
            if (!perController[controllerIdRaw]) {
              perController[controllerIdRaw] = {
                users: new Set(),
                credentials: 0,
                unknownControllerReferences: 0,
              };
            }
            perController[controllerIdRaw].unknownControllerReferences += 1;
          }
        }
      }
    }

    const duplicateCredentials = Object.entries(duplicateCredentialKeys).map(
      ([key, owners]) => ({
        key,
        userIds: owners,
      }),
    );

    const perControllerSummary = Object.fromEntries(
      Object.entries(perController).map(([controllerId, details]) => {
        return [
          controllerId,
          {
            userCount: details.users.size,
            credentialCount: details.credentials,
            unknownControllerReferences: details.unknownControllerReferences,
          },
        ];
      }),
    );

    return {
      generatedAt: new Date().toISOString(),
      selectedControllers: options.selectedControllerIds,
      configuredControllers: options.configuredControllerIds,
      userCount: Object.keys(this.userDb.users).length,
      duplicateCredentials,
      usersWithoutCredentials,
      credentialsWithoutControllers,
      unknownControllerReferences,
      perController: perControllerSummary,
      ok:
        duplicateCredentials.length === 0 &&
        usersWithoutCredentials.length === 0 &&
        credentialsWithoutControllers.length === 0 &&
        unknownControllerReferences.length === 0,
    };
  }

  /**
   * Build reconcile preview
   */
  async buildReconcilePreview(payload) {
    const report = this.validateUserDb(payload);
    const suggestions = {
      manualMergeRequired: report.duplicateCredentials.length,
      removeUnknownControllerRefs: report.unknownControllerReferences.length,
      assignControllers: report.credentialsWithoutControllers.length,
      addCredentials: report.usersWithoutCredentials.length,
    };

    const response = {
      ...report,
      suggestions,
    };

    await this.adapter.setStateAsync("cards.lastValidation", {
      ack: true,
      val: JSON.stringify(response),
    });

    return response;
  }

  // =================== SYNC ===================

  /**
   * Normalize sync payload
   */
  normalizeSyncPayload(payload) {
    const modeRaw = (payload?.mode || "overwrite").toString().toLowerCase();
    if (modeRaw !== "overwrite" && modeRaw !== "delta") {
      throw new Error('Sync mode must be "overwrite" or "delta"');
    }

    const selectedUserIds = Array.isArray(payload?.userIds)
      ? payload.userIds.map((item) => item.toString()).filter((item) => !!item)
      : [];

    const configuredControllers = this.ctrls
      .map((controller) => parseInt(controller.serial, 10))
      .filter((item) => !isNaN(item));

    const selectedControllerIds = Array.isArray(payload?.controllerIds)
      ? payload.controllerIds
          .map((item) => parseInt(item, 10))
          .filter((item) => !isNaN(item))
      : configuredControllers;

    const userIds = selectedUserIds.length
      ? selectedUserIds
      : Object.keys(this.userDb.users);

    return {
      mode: modeRaw,
      userIds,
      controllerIds: [...new Set(selectedControllerIds)],
    };
  }

  /**
   * Build credential hash for change detection
   */
  buildCredentialHash(credentials) {
    const keys = credentials
      .map((credential) => `${credential.type}:${credential.value}`)
      .sort();
    return keys.join("|");
  }

  /**
   * Build sync plan
   */
  buildSyncPlan(payload) {
    const normalized = this.normalizeSyncPayload(payload);
    const actions = [];
    let skippedUsers = 0;

    for (const userId of normalized.userIds) {
      const user = this.userDb.users[userId];
      if (!user) {
        skippedUsers += 1;
        continue;
      }

      for (const controllerId of normalized.controllerIds) {
        const credentials = (user.credentials || []).filter((credential) => {
          const assigned = Array.isArray(credential.controllers)
            ? credential.controllers
            : [];
          return assigned.includes(controllerId);
        });

        if (!credentials.length) {
          continue;
        }

        const credentialHash = this.buildCredentialHash(credentials);
        const lastHash =
          user?.meta?.syncMeta?.[controllerId]?.credentialHash || "";
        const unchanged =
          normalized.mode === "delta" && lastHash === credentialHash;

        actions.push({
          userId,
          controllerId,
          mode: normalized.mode,
          action: unchanged ? "skip" : "upsert",
          credentialCount: credentials.length,
          credentialHash,
        });
      }
    }

    const actionable = actions.filter(
      (entry) => entry.action !== "skip",
    ).length;
    const skipped = actions.length - actionable;

    return {
      generatedAt: new Date().toISOString(),
      mode: normalized.mode,
      selectedUsers: normalized.userIds,
      selectedControllers: normalized.controllerIds,
      skippedUsers,
      totalActions: actions.length,
      actionable,
      skipped,
      actions,
    };
  }

  /**
   * Apply sync plan
   */
  async applySyncPlan(payload) {
    const plan = this.buildSyncPlan(payload);
    const updatedUsers = new Set();
    let appliedActions = 0;
    let deletedCards = 0;

    const lCFG = this.wrapperAPI.createCFG(this.adapter.config);
    const ctx = this.wrapperAPI.createCTX(
      "syncApply",
      lCFG,
      this.devs,
      this.adapter.log.debug,
    );

    // Group actions by controller
    const actionsByController = new Map();
    for (const action of plan.actions) {
      if (!actionsByController.has(action.controllerId)) {
        actionsByController.set(action.controllerId, []);
      }
      actionsByController.get(action.controllerId).push(action);
    }

    for (const [controllerId, actions] of actionsByController) {
      const dev = this.ctrls.find(
        (c) => parseInt(c.serial, 10) === controllerId,
      );
      const modelType = dev ? parseInt(dev.modelType, 10) || 4 : 4;

      // For overwrite: delete orphan cards
      if (plan.mode === "overwrite") {
        const existingCards = await this.wrapperAPI.getControllerCards(
          ctx,
          controllerId,
        );

        const targetCardNumbers = new Set();
        for (const action of actions) {
          if (action.action === "skip") {
            continue;
          }
          const user = this.userDb.users[action.userId];
          if (!user) {
            continue;
          }
          const credentials = (user.credentials || []).filter((cred) => {
            if (cred.type !== "card") {
              return false;
            }
            const assigned = Array.isArray(cred.controllers)
              ? cred.controllers
              : [];
            return assigned.map(Number).includes(controllerId);
          });
          for (const cred of credentials) {
            const cardNr = parseInt(String(cred.value), 10);
            if (!isNaN(cardNr) && cardNr > 0) {
              targetCardNumbers.add(cardNr);
            }
          }
        }

        for (const existingCard of existingCards) {
          if (!targetCardNumbers.has(existingCard)) {
            try {
              await this.wrapperAPI.deleteCard(ctx, controllerId, existingCard);
              deletedCards += 1;
              this.adapter.log.debug(
                `syncApply: deleted orphan card ${existingCard} from controller ${controllerId}`,
              );
            } catch (err) {
              this.adapter.log.warn(
                `syncApply: failed to delete card ${existingCard} from controller ${controllerId}: ${err.message}`,
              );
            }
          }
        }
      }

      // Write credentials
      for (const action of actions) {
        if (action.action === "skip") {
          continue;
        }

        const user = this.userDb.users[action.userId];
        if (!user) {
          continue;
        }

        const credentials = (user.credentials || []).filter((cred) => {
          const assigned = Array.isArray(cred.controllers)
            ? cred.controllers
            : [];
          return assigned.map(Number).includes(controllerId);
        });

        for (const cred of credentials) {
          if (cred.type !== "card") {
            continue;
          }

          const cardNr = parseInt(String(cred.value), 10);
          if (isNaN(cardNr) || cardNr <= 0) {
            continue;
          }

          const pinCred = credentials.find((c) => c.type === "pin");
          const pin = pinCred ? pinCred.value : 0;

          try {
            await this.wrapperAPI.putCardToController(
              ctx,
              controllerId,
              cardNr,
              pin,
              modelType,
            );
            this.adapter.log.debug(
              `syncApply: wrote card ${cardNr} to controller ${controllerId} (user ${action.userId})`,
            );
          } catch (err) {
            this.adapter.log.warn(
              `syncApply: failed to write card ${cardNr} to controller ${controllerId}: ${err.message}`,
            );
          }
        }

        user.meta = { ...(user.meta || {}) };
        user.meta.syncMeta = {
          ...(user.meta.syncMeta || {}),
          [action.controllerId]: {
            mode: plan.mode,
            credentialHash: action.credentialHash,
            credentialCount: action.credentialCount,
            lastSyncAt: new Date().toISOString(),
          },
        };
        updatedUsers.add(action.userId);
        appliedActions += 1;
      }
    }

    await this.persist.persistUserDb(this.userDb, "syncApply");

    const result = {
      applied: true,
      mode: plan.mode,
      selectedUsers: plan.selectedUsers,
      selectedControllers: plan.selectedControllers,
      totalActions: plan.totalActions,
      appliedActions,
      skippedActions: plan.totalActions - appliedActions,
      deletedCards,
      updatedUsers: [...updatedUsers],
    };

    await this.adapter.setStateAsync("cards.lastSyncApply", {
      ack: true,
      val: JSON.stringify(result),
    });

    return result;
  }

  // =================== RESTORE/RESYNC ===================

  /**
   * Normalize restore/resync payload
   */
  normalizeRestoreResyncPayload(payload) {
    return {
      ...payload,
      mode: "overwrite",
    };
  }

  /**
   * Build restore resync plan
   */
  async buildRestoreResyncPlan(payload) {
    const normalized = this.normalizeRestoreResyncPayload(payload || {});
    const syncPreview = this.buildSyncPlan(normalized);
    const validation = await this.buildReconcilePreview({
      controllerIds: normalized.controllerIds,
    });

    return {
      generatedAt: new Date().toISOString(),
      mode: "overwrite",
      syncPreview,
      validation,
      canApply: syncPreview.actionable > 0,
    };
  }

  /**
   * Apply restore resync
   */
  async applyRestoreResync(payload) {
    const normalized = this.normalizeRestoreResyncPayload(payload || {});
    const preview = await this.buildRestoreResyncPlan(normalized);
    const syncResult = await this.applySyncPlan(normalized);

    const result = {
      applied: true,
      mode: "overwrite",
      preview,
      syncResult,
    };

    await this.adapter.setStateAsync("cards.lastRestoreResync", {
      ack: true,
      val: JSON.stringify(result),
    });

    return result;
  }

  // =================== BACKGROUND JOBS ===================

  /**
   * Get all jobs sorted by creation time
   */
  getJobs() {
    return Object.values(this.jobs).sort((left, right) => {
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  /**
   * Start background job with runner
   */
  startBackgroundJob(type, runner) {
    const id = `job-${Date.now()}-${++this.jobSequence}`;
    const job = {
      id,
      type,
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: "",
      finishedAt: "",
      result: null,
      error: "",
    };

    this.jobs[id] = job;
    this.persist.persistJobsState(this.getJobs()).catch((err) => {
      this.adapter.log.warn(`Could not persist jobs state: ${err.message}`);
    });

    Promise.resolve().then(async () => {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      await this.persist.persistJobsState(this.getJobs());

      try {
        const result = await runner();
        job.status = "completed";
        job.result = result;
        job.finishedAt = new Date().toISOString();
        this.adapter.log.info(`Background job completed: ${id} (${type})`);
      } catch (err) {
        job.status = "failed";
        job.error = err.message;
        job.finishedAt = new Date().toISOString();
        this.adapter.log.error(
          `Background job failed: ${id} (${type}) ${err.message}`,
        );
      }

      await this.persist.persistJobsState(this.getJobs());
    });

    return job;
  }

  /**
   * Create search config for device discovery
   */
  createSearchConfig() {
    const lBind = this.adapter.config.bind || "0.0.0.0";
    return {
      config: new (require("uhppoted")).Config(
        "search",
        lBind,
        `${lBind}:60000`,
        `${lBind}:60001`,
        2500,
        [],
        false,
      ),
    };
  }

  // =================== CARD MANAGEMENT (V2.0) ===================

  /**
   * Normalize card from upsert request
   */
  normalizeCard(rawCard) {
    if (!rawCard || typeof rawCard !== "object") {
      throw new Error("Missing card object");
    }

    const cardNumber = (rawCard.cardNumber || rawCard.id || "").toString();
    if (!cardNumber) {
      throw new Error("Missing cardNumber");
    }

    // Parse controller/door structure: { controllerId: [doorNumbers] }
    const controllerAccess = {};
    if (rawCard.controllerAccess && typeof rawCard.controllerAccess === "object") {
      for (const [ctrlId, doors] of Object.entries(rawCard.controllerAccess)) {
        const cid = parseInt(ctrlId, 10);
        if (!isNaN(cid)) {
          const doorList = Array.isArray(doors)
            ? doors.map((d) => parseInt(d, 10)).filter((d) => !isNaN(d))
            : [];
          if (doorList.length > 0) {
            controllerAccess[cid] = doorList;
          }
        }
      }
    }

    return {
      cardNumber,
      username: (rawCard.username || "").toString() || null,
      pin: (rawCard.pin || "").toString() || null,
      controllerAccess, // { controllerId: [doorNumbers] }
      status: (rawCard.status || "active").toString(),
      meta: {
        ...(rawCard.meta || {}),
        source: rawCard.meta?.source || "manual",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Upsert card into cardDb
   */
  upsertCard(rawCard, source) {
    const normalized = this.normalizeCard(rawCard);
    const existing = this.cardDb.cards[normalized.cardNumber] || {
      cardNumber: normalized.cardNumber,
      username: null,
      pin: null,
      controllerAccess: {},
      status: "active",
      meta: {},
    };

    // Merge fields
    if (normalized.username) existing.username = normalized.username;
    if (normalized.pin) existing.pin = normalized.pin;
    existing.status = normalized.status;

    // Merge controller access (union of doors per controller)
    for (const [ctrlId, doors] of Object.entries(normalized.controllerAccess)) {
      const cid = parseInt(ctrlId, 10);
      if (!isNaN(cid)) {
        const existing_doors = existing.controllerAccess[cid] || [];
        existing.controllerAccess[cid] = [...new Set([...existing_doors, ...doors])].sort((a, b) => a - b);
      }
    }

    // Update metadata
    existing.meta = {
      ...(existing.meta || {}),
      ...(normalized.meta || {}),
      source: source || existing.meta.source || "manual",
      updatedAt: new Date().toISOString(),
    };

    this.cardDb.cards[normalized.cardNumber] = existing;
    return existing;
  }

  /**
   * Push a single card to all configured controllers that have access defined.
   * @param {object} card Card object from cardDb
   * @returns {Promise<{results: array, pushed: number, failed: number}>}
   */
  async pushCardToControllers(card) {
    const lCFG = this.wrapperAPI.createCFG(this.adapter.config);
    const lCTX = this.wrapperAPI.createCTX("pushCard", lCFG, this.devs, this.adapter.log.debug);

    const cardNr = parseInt(card.cardNumber, 10);
    const pin = card.pin ? parseInt(card.pin, 10) : 0;
    const results = [];

    for (const ctrl of this.ctrls) {
      const doors = card.controllerAccess?.[ctrl.serial] ?? card.controllerAccess?.[String(ctrl.serial)];
      if (!doors || doors.length === 0) continue;

      try {
        await this.wrapperAPI.putCardToController(lCTX, ctrl.serial, cardNr, pin, ctrl.modelType);
        results.push({ ctrlId: ctrl.serial, success: true });
        this.adapter.log.info(`Pushed card ${cardNr} to controller ${ctrl.serial}`);
      } catch (err) {
        results.push({ ctrlId: ctrl.serial, success: false, error: err.message });
        this.adapter.log.warn(`Failed to push card ${cardNr} to controller ${ctrl.serial}: ${err.message}`);
      }
    }

    return {
      results,
      pushed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }

  /**
   * Initialladung: push ALL cards from cardDb to their respective controllers.
   * @returns {Promise<{cardCount: number, pushed: number, failed: number}>}
   */
  async syncAllCardsToControllers() {
    const cards = Object.values(this.cardDb.cards || {});
    let pushed = 0;
    let failed = 0;

    for (const card of cards) {
      const result = await this.pushCardToControllers(card);
      pushed += result.pushed;
      failed += result.failed;
    }

    this.adapter.log.info(`Initialladung complete: ${cards.length} cards, ${pushed} pushed, ${failed} failed`);
    return { cardCount: cards.length, pushed, failed };
  }

  /**
   * Delete a single card from all controllers where it has access.
   * @param {object} card Card object from cardDb
   * @returns {Promise<{results: array, deleted: number, failed: number}>}
   */
  async deleteCardFromControllers(card) {
    const lCFG = this.wrapperAPI.createCFG(this.adapter.config);
    const lCTX = this.wrapperAPI.createCTX("deleteCard", lCFG, this.devs, this.adapter.log.debug);

    const cardNr = parseInt(card.cardNumber, 10);
    const results = [];

    for (const ctrl of this.ctrls) {
      const doors = card.controllerAccess?.[ctrl.serial] ?? card.controllerAccess?.[String(ctrl.serial)];
      if (!doors || doors.length === 0) continue;

      try {
        await this.wrapperAPI.deleteCard(lCTX, ctrl.serial, cardNr);
        results.push({ ctrlId: ctrl.serial, success: true });
        this.adapter.log.info(`Deleted card ${cardNr} from controller ${ctrl.serial}`);
      } catch (err) {
        results.push({ ctrlId: ctrl.serial, success: false, error: err.message });
        this.adapter.log.warn(`Failed to delete card ${cardNr} from controller ${ctrl.serial}: ${err.message}`);
      }
    }

    return {
      results,
      deleted: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }

  /**
   * Read all cards from specified controllers (via UHPPOTE API)
   * @param {array} controllerIds Controller serial numbers to read (undefined = all)
   * @returns {Promise<array>} Array of cards found
   */
  async readCardsFromControllers(controllerIds) {
    const lCFG = this.wrapperAPI.createCFG(this.adapter.config);
    const lCTX = this.wrapperAPI.createCTX("readCards", lCFG, this.devs, this.adapter.log.debug);

    const cardsFromControllers = [];
    const targetControllers = controllerIds && controllerIds.length > 0 
      ? this.ctrls.filter((c) => controllerIds.includes(c.serial))
      : this.ctrls;

    for (const ctrl of targetControllers) {
      try {
        this.adapter.log.info(`Reading cards from controller ${ctrl.serial}...`);
        const cards = await this.wrapperAPI.getControllerCards(lCTX, ctrl.serial);

        if (Array.isArray(cards)) {
          for (const card of cards) {
            const cardNumber = typeof card === "number"
              ? card
              : parseInt(card?.cardNumber || card?.card || card?.number, 10);
            if (!isNaN(cardNumber)) {
              let existing = cardsFromControllers.find((c) => c.cardNumber === cardNumber);
              if (!existing) {
                existing = {
                  cardNumber,
                  controllers: [],
                };
                cardsFromControllers.push(existing);
              }
              if (!existing.controllers.includes(ctrl.serial)) {
                existing.controllers.push(ctrl.serial);
              }
            }
          }
        }
      } catch (err) {
        this.adapter.log.warn(`Failed to read cards from ${ctrl.serial}: ${err.message}`);
      }
    }

    return cardsFromControllers;
  }

  /**
   * Apply migration: import cards from controllers, perform diff handling
   * @param {array} cardsFromControllers Cards read from controllers
   * @param {string} mode "overwrite" = replace, "append" = add new
   */
  async applyMigration(cardsFromControllers, mode = "overwrite") {
    const result = {
      imported: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    };

    const cardsFromMap = new Map();
    for (const card of cardsFromControllers || []) {
      cardsFromMap.set(String(card.cardNumber), card);  // always string key for safe comparison
    }

    // Phase 1: Import/update existing cards by cardNumber match
    for (const [cardNumber, card] of cardsFromMap.entries()) {
      const migrationUsername = typeof card?.username === "string" && card.username.trim().length > 0
        ? card.username.trim()
        : null;

      if (!this.cardDb.cards[cardNumber]) {
        // New card
        this.upsertCard(
          {
            cardNumber,
            username: migrationUsername,
            controllerAccess: card.controllers.reduce((acc, cid) => {
              acc[cid] = [1, 2, 3, 4]; // Default: all doors
              return acc;
            }, {}),
          },
          "migration",
        );
        result.imported++;
      } else {
        // Existing card: merge controller access
        const existing = this.cardDb.cards[cardNumber];
        if (migrationUsername) {
          existing.username = migrationUsername;
        }
        for (const cid of card.controllers || []) {
          if (!existing.controllerAccess[cid]) {
            existing.controllerAccess[cid] = [1, 2, 3, 4];
            result.updated++;
          }
        }
        existing.meta.lastMigration = new Date().toISOString();
      }
    }

    // Phase 2: Diff handling — remove controller entries for missing cards
    for (const cardNumber of Object.keys(this.cardDb.cards)) {
      if (!cardsFromMap.has(cardNumber)) {
        const card = this.cardDb.cards[cardNumber];
        // Remove all controller entries
        card.controllerAccess = {};
        result.removed++;
      }
    }

    // Note: Cards with no controller entries remain in DB (not deleted)

    return result;
  }
}

module.exports = Application;
