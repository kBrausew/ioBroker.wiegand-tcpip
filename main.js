"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const os = require("node:os");
// @ts-expect-error -- ioBroker adapter-core JS/TS interop
const ipaddr = require("ipaddr.js");
const uapi = require("uhppoted");
//const { stat } = require("node:fs");

/**
 * @function fnLogger
 */

class WiegandTcpip extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
   */
  constructor(options) {
    super({
      ...options,
      name: "wiegand-tcpip",
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    // this.on("objectChange", this.onObjectChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));

    this.ulistener = null; // socket listener
    this.heartbeat = null; // interval heartbeat
    this.ctrls = []; // controller of this.config validated
    this.serials = {}; // serials
    this.devs = []; // uAPI devices (config)
    this.userDb = this.createEmptyUserDb();
    this.jobs = {};
    this.jobSequence = 0;
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    const lCFG = this.createCFG();
    await this.initUserManagement();
    this.config.settime = this.config.settime || 0;
    if (this.config.settime < 1200) {
      this.log.warn("Automatic clock setting disabled");
    }

    // there is no subsciption at startup
    //this.unsubscribeStates("*");

    /*
        moved to io-package.json section "instanceObjects"
        this.setObjectNotExists("controllers", {
            type: "folder",
            common: { name: "controllers", type: "folder" },
            native: {},
        });
        */

    let itemNr = 1;
    for (const dev of this.config.controllers) {
      if (!this.serials[dev.serial]) {
        this.serials[dev.serial] = true;
        const serialNum = parseInt(dev.serial, 10);
        if (serialNum && !isNaN(serialNum) && serialNum > 0) {
          dev.serial = serialNum; // Must be number – uhppoted.resolve() only accepts number|object, not string
          // @ts-expect-error -- ioBroker adapter-core JS/TS interop
          dev.modelType = parseInt(dev.modelType, 10) || 4;
          dev.index = itemNr;
          dev.errorCount = 1;
          dev.heartbeatCount = 1;
          ++itemNr;
          await this.treeStructure(dev.serial, dev.index, dev.modelType);
          if (dev.deviceIp && dev.exposedIP && dev.exposedPort) {
            // full rig
            dev.broadcast = false;
          } else if (dev.deviceIp || dev.exposedIP || dev.exposedPort) {
            if (!dev.deviceIp) {
              dev.deviceIp = lCFG.lBroadcast;
            }
            if (!dev.exposedIP) {
              dev.exposedIP = lCFG.lBind;
            }
            // @ts-expect-error -- ioBroker adapter-core JS/TS interop
            if (!dev.exposedPort) {
              dev.exposedPort = lCFG.rPort;
            }
            dev.broadcast = true;
            this.log.warn(
              `Incorrect controller-setup for non/broadcast: ${dev.serial}`,
            );
          } else {
            dev.deviceIp = lCFG.lBroadcast;
            dev.exposedIP = lCFG.rBroadcast;
            // @ts-expect-error -- ioBroker adapter-core JS/TS interop
            dev.exposedPort = lCFG.rPort;
            dev.broadcast = true;
          }
          //await uapi.addDevice(lCTX, dev.serial, dev.deviceIp, dev.broadcast);
          this.devs.push({
            deviceId: dev.serial,
            address: dev.deviceIp,
            forceBroadcast: dev.broadcast,
          });
          dev.run = false;
          dev.eventNr = 0;
          this.ctrls.push(dev);
        } else {
          this.log.error(
            `Invalid serial number for controller: [${dev.serial.toString()}]`,
          );
        }
      } else {
        this.log.error(
          `Controller configured more than once: ${dev.serial.toString()}`,
        );
      }
    }

    this.getDevices((err, res) => {
      if (!err && res) {
        res.forEach((obj) => {
          const spl = obj._id.split(".");
          if (spl.length == 4 && spl[2] == "controllers") {
            if (!this.serials[spl[3]]) {
              this.delObject(obj._id, { recursive: true }, (err) => {
                if (err) {
                  this.log.debug(`CleanUp device ${obj._id}: ${err.message}`);
                }
              });
              this.log.info(`Controller: ${obj._id} deleted`);
            } else {
              this.log.silly(`${obj._id} ok`);
            }
          }
        });
      }
    });

    const lCTX = this.createCTX("ctx", lCFG, this.devs, this.log.debug);
    this.log.silly(JSON.stringify(lCTX));
    this.log.silly(JSON.stringify(this.devs));
    this.ulistener = await uapi.listen(
      lCTX,
      this.onUapiEvent.bind(this),
      this.onUapiError.bind(this),
    );

    await this.assureRun();
    this.heartbeat = this.setInterval(
      this.assureRun.bind(this),
      lCFG.lHeartbeat,
    );
  }

  /**
   * Is called if a subscribed state changes
   *
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      //check Id for handled operations
      const id_part = id.split(".");
      if (
        id_part.length < 6 ||
        id_part[0] != this.name ||
        id_part[1] != this.instance.toString() ||
        id_part[2] != "controllers" ||
        id_part[5] != "remoteOpen"
      ) {
        this.log.error(`State possible not handled by this adapter: ${id}`);
        return;
      }

      if (!state.ack) {
        // The state was changed
        const lLocal = `system.adapter.${this.name}.${this.instance}`;
        const lFrom = state.from || lLocal;
        if (lFrom != lLocal) {
          const ldeviceId = parseInt(id_part[3], 10);
          const ldoorId = parseInt(id_part[4], 10);
          if (state.val == true && !isNaN(ldeviceId) && !isNaN(ldoorId)) {
            const dev = this.ctrls.find((dev) => dev.serial == ldeviceId);
            if (dev.run) {
              this.doorOpenSpec(dev.serial, ldoorId);
            } else {
              this.log.error(`Can not handle unreached device: ${ldeviceId}`);
            }
            // this.setTimeout(() => {
            //     this.setState(id, { ack: true, val: false });
            // }, 50);
          }
        } else {
          this.log.silly(
            "Ignore state change from myself: i know what i do ;-)",
          );
        }
        //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack}) (from = ${state.from})`);
      } else {
        this.log.silly(
          "State ... with ACK = TRUE should already have been dealt with",
        );
      }
    } else {
      // The state was deleted
      /* No hands, no cookies */ //this.unsubscribeStates(id);
      this.log.debug(`state ${id} deleted`);
    }
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param {() => void} callback
   */
  async onUnload(callback) {
    try {
      if (this.ulistener) {
        this.ulistener.close();
        this.ulistener = null;
        this.log.debug("CleanUp: Listener Close");
      } else {
        this.log.debug("Listener is not runing");
      }
    } catch {
      // intentionally empty - listener may already be stopped
    }

    try {
      if (this.heartbeat) {
        this.clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.log.debug("CleanUp: Clear interval");
      }
    } catch {
      // intentionally empty - interval may already be cleared
    }

    callback();
  }

  // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
  // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
  // /**
  //  * Is called if a subscribed object changes
  //  * @param {string} id
  //  * @param {ioBroker.Object | null | undefined} obj
  //  */
  // onObjectChange(id, obj) {
  //     if (obj) {
  //         // The object was changed
  //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
  //     } else {
  //         // The object was deleted
  //         this.log.info(`object ${id} deleted`);
  //     }
  // }

  // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
  /**
   * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
   * Using this method requires "common.messagebox" property to be set to true in io-package.json
   *
   * @param {ioBroker.Message} obj
   */
  async onMessage(obj) {
    if (typeof obj === "object" && obj.message) {
      // @ts-expect-error -- ioBroker adapter-core JS/TS interop
      const lBind = obj.message.bind || "0.0.0.0";
      const lConf = {
        config: new uapi.Config(
          "config",
          lBind,
          `${lBind}:60000`,
          `${lBind}:60001`,
          2500,
          [],
          false,
        ),
      };
      //const lConf = { config: new uapi.Config("config", "0.0.0.0", "192.168.178.255:60000", lBind + ":60001", 2500, [], false) };
      switch (obj.command) {
        case "userList":
          if (obj.callback) {
            this.sendTo(
              obj.from,
              obj.command,
              {
                error: false,
                users: Object.values(this.userDb.users),
              },
              obj.callback,
            );
          }
          break;
        case "userGet":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const userId = (
                obj.message.userId ||
                obj.message.id ||
                ""
              ).toString();
              const user = this.userDb.users[userId] || null;
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  user,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userUpsert":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const rawUser = obj.message.user || obj.message;
              const user = this.upsertUser(rawUser, "messagebox");
              await this.persistUserDb("userUpsert");
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  user,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userDelete":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const userId = (
                obj.message.userId ||
                obj.message.id ||
                ""
              ).toString();
              if (!userId) {
                throw new Error("Missing userId");
              }
              const existed = !!this.userDb.users[userId];
              if (existed) {
                delete this.userDb.users[userId];
                await this.persistUserDb("userDelete");
              }
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  deleted: existed,
                  userId,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userImportPreview":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const dataset = obj.message.dataset || obj.message;
              const preview = this.buildImportPreview(dataset);
              this.userDb.reviewQueue = preview.reviewItems;
              await this.persistUserDb("importPreview");
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  preview,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userImportReviewList":
          if (obj.callback) {
            try {
              const summary = this.getReviewQueueSummary();
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  summary,
                  reviews: this.userDb.reviewQueue || [],
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userImportReviewApprove":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const reviewId = (
                obj.message.reviewId ||
                obj.message.id ||
                ""
              ).toString();
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const action = (obj.message.action || "").toString();
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const userId = (obj.message.userId || "").toString();
              const review = this.approveReviewItem(reviewId, action, userId);
              await this.persistUserDb("reviewApprove");
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  review,
                  summary: this.getReviewQueueSummary(),
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userImportReviewReject":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const reviewId = (
                obj.message.reviewId ||
                obj.message.id ||
                ""
              ).toString();
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const reason = (obj.message.reason || "").toString();
              const review = this.rejectReviewItem(reviewId, reason);
              await this.persistUserDb("reviewReject");
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  review,
                  summary: this.getReviewQueueSummary(),
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userImportApply":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const dataset = obj.message.dataset || obj.message;
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const background = !!obj.message.background;
              if (background) {
                const job = this.startBackgroundJob("importApply", async () => {
                  const result = await this.applyImportDataset(dataset);
                  return result;
                });
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    accepted: true,
                    jobId: job.id,
                    job,
                  },
                  obj.callback,
                );
                break;
              }

              const result = await this.applyImportDataset(dataset);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  result,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userValidate":
          if (obj.callback) {
            try {
              const payload = obj.message || {};
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const background = !!obj.message.background;
              if (background) {
                const job = this.startBackgroundJob(
                  "validateUserDb",
                  async () => {
                    const report = await this.buildReconcilePreview(payload);
                    return report;
                  },
                );
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    accepted: true,
                    jobId: job.id,
                    job,
                  },
                  obj.callback,
                );
                break;
              }

              const report = await this.buildReconcilePreview(payload);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  report,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userReconcilePreview":
          if (obj.callback) {
            try {
              const payload = obj.message || {};
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const background = !!obj.message.background;
              if (background) {
                const job = this.startBackgroundJob(
                  "reconcilePreview",
                  async () => {
                    const report = await this.buildReconcilePreview(payload);
                    return report;
                  },
                );
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    accepted: true,
                    jobId: job.id,
                    job,
                  },
                  obj.callback,
                );
                break;
              }

              const report = await this.buildReconcilePreview(payload);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  report,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userSyncPreview":
          if (obj.callback) {
            try {
              const payload = obj.message || {};
              const preview = this.buildSyncPlan(payload);
              await this.setStateAsync("cards.lastSyncPreview", {
                ack: true,
                val: JSON.stringify(preview),
              });
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  preview,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userSyncApply":
          if (obj.callback) {
            try {
              const payload = obj.message || {};
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const background = !!obj.message.background;
              if (background) {
                const job = this.startBackgroundJob("syncApply", async () => {
                  const result = await this.applySyncPlan(payload);
                  return result;
                });
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    accepted: true,
                    jobId: job.id,
                    job,
                  },
                  obj.callback,
                );
                break;
              }

              const result = await this.applySyncPlan(payload);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  result,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userRestoreResync":
          if (obj.callback) {
            try {
              const payload = obj.message || {};
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const apply = !!obj.message.apply;
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const background = !!obj.message.background;

              if (!apply) {
                const preview = await this.buildRestoreResyncPlan(payload);
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    preview,
                  },
                  obj.callback,
                );
                break;
              }

              if (background) {
                const job = this.startBackgroundJob(
                  "restoreResyncApply",
                  async () => {
                    const result = await this.applyRestoreResync(payload);
                    return result;
                  },
                );
                this.sendTo(
                  obj.from,
                  obj.command,
                  {
                    error: false,
                    accepted: true,
                    jobId: job.id,
                    job,
                  },
                  obj.callback,
                );
                break;
              }

              const result = await this.applyRestoreResync(payload);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  result,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userJobList":
          if (obj.callback) {
            try {
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  jobs: this.getJobs(),
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "userJobGet":
          if (obj.callback) {
            try {
              // @ts-expect-error -- ioBroker adapter-core JS/TS interop
              const jobId = (
                obj.message.jobId ||
                obj.message.id ||
                ""
              ).toString();
              const job = this.jobs[jobId] || null;
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: false,
                  job,
                },
                obj.callback,
              );
            } catch (err) {
              this.sendTo(
                obj.from,
                obj.command,
                this.customErr(err.message),
                obj.callback,
              );
            }
          }
          break;
        case "search":
          if (obj.callback) {
            uapi
              .getDevices(lConf)
              .then((uRet) => {
                this.sendTo(obj.from, obj.command, uRet, obj.callback);
                this.log.debug(`Search found: ${JSON.stringify(uRet)}`);
              })
              .catch((err) => {
                const uRetErr = {
                  error: true,
                  err: { message: err.message.toString() },
                };
                this.log.error(
                  `onMessage Error (${obj.command}): ${err.message.toString()}`,
                );
                this.sendTo(obj.from, obj.command, uRetErr, obj.callback);
              });
          }
          break;
        case "setip":
          if (obj.callback) {
            this.log.silly(JSON.stringify(obj.message));
            // @ts-expect-error -- ioBroker adapter-core JS/TS interop
            uapi
              .setIP(
                lConf,
                obj.message.deviceId,
                obj.message.address,
                obj.message.netmask,
                obj.message.gateway,
              )
              .then((uRet) => {
                this.sendTo(obj.from, obj.command, uRet, obj.callback);
                this.log.info(JSON.stringify(uRet));
              })
              .catch((err) => {
                const uRetErr = {
                  error: true,
                  err: { message: err.message.toString() },
                };
                this.log.error(
                  `onMessage Error (${obj.command}): ${err.message.toString()}`,
                );
                this.sendTo(obj.from, obj.command, uRetErr, obj.callback);
              });
          }
          break;
        default:
          {
            const uRetNoCommand = {
              error: true,
              err: {
                message: `"${obj.command.toUpperCase()}" is not a valide Command`,
              },
            };
            this.log.error(
              `onMessage Error: ${uRetNoCommand.err.message.toString()}`,
            );
            this.sendTo(obj.from, obj.command, uRetNoCommand, obj.callback);
          }
          break;
      }
    }
  }

  /**
   * @param {any} evt
   */
  async onUapiEvent(evt) {
    //this.log.info("Event: " + JSON.stringify(evt));
    if (evt && evt.state && evt.state.serialNumber && evt.state.event) {
      // && evt.state.event.granted && evt.state.event.door){
      const lEvt = evt.state.event;
      const ldeviceId = evt.state.serialNumber;
      const lGranted = lEvt.granted || false;
      const ldoorId = parseInt(lEvt.door, 10) || 0;
      const lCard = parseInt(lEvt.card, 10) || 0;
      const dev = this.ctrls.find((dev) => dev.serial == ldeviceId);
      const lRoot = `controllers.${ldeviceId.toString()}.${ldoorId.toString()}`;
      let requestCode = 0;
      let requestText = "";
      let reasonCode = 0;
      let reasonText = "";
      let directionCode = 0;
      let directionText = "";

      if (!lEvt && !dev) {
        this.log.error(`Major-Problem with event receiving for: ${lRoot}`);
        return;
      }

      if (ldoorId > 0 && ldoorId <= dev.modelType) {
        this.getState(`${lRoot}.unlocked`, (_fErr, fStat) => {
          if (!fStat) {
            this.log.error(`No state found: ${lRoot}.unlocked`);
          } else {
            if (lGranted) {
              this.setState(`${lRoot}.unlocked`, { ack: true, val: lGranted });
              /*let lTimeOut = */ this.setTimeout(() => {
                this.setState(`${lRoot}.unlocked`, { ack: true, val: false });
                //this.clearTimeout(lTimeOut);
                // @ts-expect-error -- ioBroker adapter-core JS/TS interop
                //lTimeOut = null;
              }, 50);
            } else {
              this.setState(`${lRoot}.unauthorized`, { ack: true, val: lCard });
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
            this.setState(`${lRoot}.directionCode`, {
              ack: true,
              val: directionCode,
            });
            this.setState(`${lRoot}.directionText`, {
              ack: true,
              val: directionText,
            });
            this.setState(`${lRoot}.requestCode`, {
              ack: true,
              val: requestCode,
            });
            this.setState(`${lRoot}.requestText`, {
              ack: true,
              val: requestText,
            });
            this.setState(`${lRoot}.reasonCode`, {
              ack: true,
              val: reasonCode,
            });
            this.setState(`${lRoot}.reasonText`, {
              ack: true,
              val: reasonText,
            });
            this.setState(`${lRoot}.lastSwipe`, { ack: true, val: lCard });
            this.setState(`${lRoot}.lastGranted`, { ack: true, val: lGranted });
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
              this.log.warn(`Card merge update failed: ${mergeErr.message}`);
            });

            this.log.debug(
              `Controller: ${ldeviceId} Door: ${ldoorId} granted: ${
                lGranted
              } Card: ${lCard}`,
            );
          }
        });
      } else {
        const lIdStr = ldoorId || "Null";
        this.log.error(
          `Received Event has no valid Door Identifier: ${
            lIdStr
          } (Controller: ${ldeviceId.toString()})`,
        );
      }

      if (lEvt.index) {
        ++dev.eventNr; // = lEvt.index;
        if (dev.eventNr != lEvt.index) {
          this.log.error(
            `Timing problem expected: ${dev.eventNr} / receive: ${
              lEvt.index
            } Event`,
          );
        }
        this.setState(`controllers.${ldeviceId.toString()}.eventNr`, {
          ack: true,
          val: lEvt.index,
        });
      }
      this.checkTimeDiff(dev, evt);
    }
  }

  /**
   * @param {{ message: any; }} err
   */
  async onUapiError(err) {
    this.log.error(`Event receive error: ${err.message}`);
  }

  /**
   * @returns {localConfig}
   */
  createCFG() {
    const lCFG = {};
    lCFG.lBind = this.config.bind || "0.0.0.0";
    lCFG.lPort = this.config.port || 60000;
    lCFG.rPort = this.config.r_port || 60099;
    lCFG.lTimeout = this.config.timeout || 2500;
    lCFG.lHeartbeat = this.config.heartbeat || 300000;
    lCFG.lListen = `${lCFG.lBind}:${lCFG.rPort.toString()}`;
    lCFG.lBroadcast = this.getBroadcastAddresses(lCFG.lBind) || "0.0.0.0";
    lCFG.lBroadcastP = `${lCFG.lBroadcast}:${lCFG.lPort.toString()}`;
    lCFG.rBroadcast =
      this.getBroadcastAddresses(lCFG.lBind) || "255.255.255.255";
    lCFG.debugll = this.config.debugLL || false;
    // lCFG.settime = this.config.settime || 1200;

    // if (!lCFG || lCFG.settime < 2) {
    //     lCFG.settime = 0;
    // } else if (lCFG.settime < 1200) {
    //     lCFG.settime = 1200;
    // }

    return lCFG;
  }

  /**
   * @param {string} pName
   * @param {localConfig} pCFG
   * @param {any[]} pDevs
   * @param {function} cLogger
   * @returns {uapiContext}
   */
  createCTX(pName, pCFG, pDevs, cLogger) {
    // @ts-expect-error -- ioBroker adapter-core JS/TS interop
    const lCTX = {
      config: new uapi.Config(
        pName,
        pCFG.lBind,
        pCFG.lBroadcastP,
        pCFG.lListen,
        pCFG.lTimeout,
        pDevs,
        pCFG.debugll,
      ),
    };
    if (cLogger) {
      lCTX.logger = cLogger;
    }
    return lCTX;
  }

  /**
   * @param {number} deviceId
   * @param {number} doorId
   */
  doorOpenSpec(deviceId, doorId) {
    const lCTX = this.createCTX(
      "specRemOp",
      this.createCFG(),
      this.devs,
      this.log.debug,
    );
    //ctx.logger = this.log.debug;
    this.log.silly(`doorOpenSpec: ${JSON.stringify(lCTX)}`);
    uapi
      .openDoor(lCTX, deviceId, doorId)
      .then((ret) => {
        // uapi.getEventIndex(ctx, deviceId)
        //     .then(lRet => {
        //         const ctrl = this.ctrls.find(dev => dev.serial == deviceId);
        //         // //if (ctrl) ++ctrl.eventNr;
        //         // if (ctrl && lRet && lRet.index && (ctrl.eventNr + 1) == lRet.index) {
        //         //     ctrl.eventNr = lRet.index;
        //         // } else this.log.debug("??: " + ctrl.eventNr + " :: " + JSON.stringify(lRet));
        //         this.log.debug("??: " + ctrl.eventNr + " :: " + JSON.stringify(lRet));
        //     })
        //     .catch(lErr => {
        //         //das wird noch folgen haben... aber nicht hier ;-)
        //     });
        this.log.debug(
          `Request remote open: ${deviceId} Door-${doorId}: ${JSON.stringify(
            ret,
          )}`,
        );
      })
      .catch((err) => {
        this.log.error(
          `Error Remote Open Door: ${deviceId}/${doorId}: ${err.message}`,
        );
      });
  }

  async assureRun() {
    if (!this.assureRun_once) {
      this.assureRun_once = true;
      const lCTX = this.createCTX(
        "assureRun",
        this.createCFG(),
        this.devs,
        this.log.debug,
      );
      //################################################################################
      //Major Try-Catch: no change code befor...
      try {
        for (const dev of this.ctrls) {
          //this.log.silly("Heartbeat: " + dev.serial);
          try {
            let eventNr = 0;
            const lStat = await uapi.getStatus(lCTX, dev.serial);
            if (lStat) {
              if (lStat.state) {
                if (lStat.state.event) {
                  eventNr = parseInt(lStat.state.event.index, 10) || 0;
                  if (dev.run == true && dev.eventNr != eventNr) {
                    this.log.warn(
                      `May connection lost (try re-connect device): ${
                        dev.serial
                      } / ${eventNr} / ${dev.eventNr}`,
                    );
                    dev.run = false;
                  }
                  ++dev.heartbeatCount;
                }
                this.checkTimeDiff(dev, lStat);
              }
            }

            if (dev.run && dev.heartbeatCount > 10) {
              const lList = await uapi.getListener(lCTX, dev.serial);
              if (lList) {
                const lHost = lList.address || "";
                const lPort = lList.port || 0;
                if (lHost != dev.exposedIP || lPort != dev.exposedPort) {
                  this.log.warn(
                    `Extendend HeartBeat negative (try re-connect device): ${
                      dev.serial
                    }`,
                  );
                  dev.run = false;
                }
              }
              dev.heartbeatCount = 1;
            }

            if (!dev.run) {
              this.log.info(`Connect to controller: ${dev.serial}`);
              await uapi.recordSpecialEvents(lCTX, dev.serial, true);
              await uapi.setListener(
                lCTX,
                dev.serial,
                dev.exposedIP,
                dev.exposedPort,
              );

              dev.eventNr = eventNr;
              dev.heartbeatCount = 1;
              dev.run = true;
              dev.setTime = true;
            }

            if (dev.setTime) {
              this.log.info(`Reset the device clock: ${dev.serial}`);
              await uapi.setTime(
                lCTX,
                dev.serial,
                this.formatDate(Date.now(), "YYYY-MM-DD hh:mm:ss"),
              );
              dev.setTime = false;
            }

            if (dev.heartbeatCount == 1) {
              for (let i = 1; i <= dev.modelType; i++) {
                try {
                  const lContr = await uapi.getDoorControl(lCTX, dev.serial, i);
                  //this.log.debug(JSON.stringify(lContr));
                  let lDelay = 0;
                  let lContr_n = 0;
                  if (lContr && lContr.doorControlState) {
                    lDelay = lContr.doorControlState.delay || 0;
                    if (lContr.doorControlState.control) {
                      lContr_n = lContr.doorControlState.control.value || 0;
                    }
                  }
                  this.setState(
                    `controllers.${dev.serial}.${i.toString()}.delay`,
                    { ack: true, val: lDelay },
                  );
                  this.setState(
                    `controllers.${dev.serial}.${i.toString()}.control`,
                    { ack: true, val: lContr_n },
                  );
                } catch {
                  // intentionally empty
                }
              }
              this.setState(`controllers.${dev.serial}.eventNr`, {
                ack: true,
                val: eventNr,
              });
            }

            /*if(dev.eventNr > 3){
                            dev.eventNr = 1;
                            await uapi.setEventIndex(lCTX, dev.serial, dev.eventNr);
                            this.log.debug(dev.eventNr);
                        }*/
          } catch (err) {
            dev.run = false;
            this.log.error(
              `Problem with controller ${dev.serial}: ${err.message}`,
            );
          }
          try {
            const lReach = `controllers.${dev.serial}.reachable`;
            this.getState(lReach, (fErr, fStat) => {
              if (!fErr) {
                let lState = false;
                // @ts-expect-error -- ioBroker adapter-core JS/TS interop
                if (fStat) {
                  lState = fStat.val || false;
                }
                if (lState != dev.run) {
                  this.setState(lReach, { ack: true, val: dev.run });
                }
                dev.errorCount = 1;
              } else {
                if (dev.errorCount % 100 == 0) {
                  //if (fErr) {
                  this.log.error(
                    `... controller ${dev.serial}: ${fErr.message}`,
                  );
                  //} else this.log.error("Major-Problem with controller " + dev.serial);
                }
                if (dev.errorCount >= 3000) {
                  this.log.error(
                    `Major-Problem: Better restart... ${dev.serial}`,
                  );
                  this.restart();
                }

                ++dev.errorCount;
              }
            });
          } catch (err) {
            dev.run = false;
            this.log.error(
              `Post-Constructur-Problem with controller ${dev.serial}: ${
                err.message
              }`,
            );
          }
        }
      } catch (e) {
        this.log.error(`Major-problem in heartbeat: ${e.message}`);
      }
      //Major Try-Catch: no change code after...
      //################################################################################
      this.assureRun_once = false;
    } else {
      this.log.error("Heartbeat is too short for all required tasks");
    }
  }

  /**
   * @param {string} ip
   */
  getBroadcastAddresses(ip) {
    // if (ip == "0.0.0.0"){
    //     if(local){
    //         return "255.255.255.255";
    //     } else return "0.0.0.0";// ip;
    // }
    const interfaces = os.networkInterfaces();
    for (const iface in interfaces) {
      for (const i in interfaces[iface]) {
        // @ts-expect-error -- ioBroker adapter-core JS/TS interop
        const f = interfaces[iface][i];
        //this.log.info(JSON.stringify(f));
        if (f.family === "IPv4" && f.address == ip) {
          return ipaddr.IPv4.broadcastAddressFromCIDR(f.cidr).toString();
        }
      }
    }
    return null;
  }

  /**
   * @param {string | number} serialNr
   * @param {number} itemNr
   * @param {number} noOfDoors
   */
  async treeStructure(serialNr, itemNr, noOfDoors) {
    const lSerialNr = serialNr.toString();
    const lRootPath = `controllers.${lSerialNr}`;

    this.log.info(
      `Create controller ${lSerialNr} for Model ${noOfDoors}-Door Objects`,
    );
    await this.setObjectNotExists(lRootPath, {
      type: "device",
      common: { name: `Controller-${itemNr.toString()}` },
      native: {},
    });

    await this.createOneState(
      lRootPath,
      "eventNr",
      "Last Event #",
      "number",
      "value",
      true,
      false,
      0,
      undefined,
    );
    await this.createOneState(
      lRootPath,
      "reachable",
      "Device reachable",
      "boolean",
      "indicator.reachable",
      true,
      false,
      false,
      undefined,
    );

    for (let i = 1; i <= 4; i++) {
      const lDoorPath = `${lRootPath}.${i.toString()}`;
      if (i <= noOfDoors) {
        //this.log.debug("Aktiviere: "+serialNr+" / "+i);
        this.setObjectNotExists(lDoorPath, {
          type: "channel",
          common: { name: `Door-${i.toString()}` },
          native: {},
        });

        await this.createOneState(
          lDoorPath,
          "control",
          "Open Mode",
          "number",
          "value",
          true,
          false,
          0,
          {
            0: "unknown",
            1: "normally open",
            2: "normally closed",
            3: "controlled",
          },
        );
        await this.createOneState(
          lDoorPath,
          "delay",
          "Switch delay",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        //await this.createOneState(lDoorPath, "door", "State ?", "boolean", "value", true, false, false, undefined);
        //await this.createOneState(lDoorPath, "button", "State ?", "boolean", "value", true, false, false, undefined);
        await this.createOneState(
          lDoorPath,
          "directionCode",
          "Direction #",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "directionText",
          "Direction",
          "string",
          "value",
          true,
          false,
          "",
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "lastSwipe",
          "Card-/Unlock- Id",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "unauthorized",
          "Unauthorized Card-/Unlock- Id",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "lastGranted",
          "Access Grant / Denied",
          "boolean",
          "value",
          true,
          false,
          false,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "reasonCode",
          "Reason #",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "reasonText",
          "Reason",
          "string",
          "value",
          true,
          false,
          "",
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "requestCode",
          "Request #",
          "number",
          "value",
          true,
          false,
          0,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "requestText",
          "Request",
          "string",
          "value",
          true,
          false,
          "",
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "remoteOpen",
          "Open Door",
          "boolean",
          "button.open.door",
          false,
          true,
          true,
          undefined,
        );
        await this.createOneState(
          lDoorPath,
          "unlocked",
          "Door unlocked",
          "boolean",
          "value.lock",
          true,
          false,
          false,
          undefined,
        );
        await this.subscribeStatesAsync(`${lDoorPath}.remoteOpen`);
      } else {
        try {
          //this.log.debug("De-Aktiviere: "+serialNr+" / "+i);
          this.unsubscribeStates(`${lDoorPath}.remoteOpen`);
          this.delObject(lDoorPath, { recursive: true }, (err) => {
            if (err) {
              this.log.debug(
                `Deleted door not valide ${lDoorPath}: ${err.message}`,
              );
            }
          });
        } catch (error) {
          this.log.warn(
            `Error deactive device: ${serialNr} / ${i} :${error.message}`,
          );
        }
      }
    }
  }

  /**
   * @param {string} path
   * @param {string} id
   * @param {string} name
   * @param {string} type
   * @param {string} role
   * @param {boolean} read
   * @param {boolean} write
   * @param {any} val
   * @param {object} stat
   */
  async createOneState(path, id, name, type, role, read, write, val, stat) {
    const lPath = `${path}.${id}`;
    await this.setObjectNotExists(lPath, {
      type: "state",
      // @ts-expect-error -- ioBroker adapter-core JS/TS interop
      common: {
        name: name,
        type: type,
        role: role,
        def: val,
        states: stat,
        read: read,
        write: write,
      },
      native: {},
      // }, (err, obj) => {
      //     if (obj) {
      //         this.setState(lPath, { val: val, ack: true });
      //         this.log.silly(name + ": New State @ " + lPath);
      //     }
    });
  }

  /**
   * @param {{ state: { doors: {  }; buttons: { } }; }} pEvt
   */
  debugState(pEvt) {
    if (pEvt && pEvt.state) {
      if (pEvt.state.doors) {
        this.log.debug(`Doors: ${JSON.stringify(pEvt.state.doors)}`);
      }
      if (pEvt.state.buttons) {
        this.log.debug(`Buttons :${JSON.stringify(pEvt.state.buttons)}`);
      }
    }
  }

  /**
   * @param {{ setTime: boolean; serial: number; }} pDev
   * @param {{ state: { system: { date: string; time: string; }; doors: {  }; buttons: { } }; }} pEvt
   */
  checkTimeDiff(pDev, pEvt) {
    //this.debugState(pEvt);
    if (
      this.config.settime &&
      this.config.settime > 1200 &&
      pEvt.state &&
      pEvt.state.system
    ) {
      if (pEvt.state.system.date && pEvt.state.system.time) {
        const lNow = new Date();
        const lDat = new Date(
          `${pEvt.state.system.date}T${pEvt.state.system.time}`,
        );
        const lDiff = Math.abs(lDat.getMilliseconds() - lNow.getMilliseconds());
        if (lDiff > this.config.settime) {
          pDev.setTime = true;
          this.log.debug(
            `The device clock is no longer up to date: ${
              pDev.serial
            } difference ${lDiff}ms`,
          );
        }
      }
    }
  }

  createEmptyUserDb() {
    return {
      schemaVersion: 1,
      updatedAt: "",
      reviewQueue: [],
      users: {},
    };
  }

  async initUserManagement() {
    await this.setObjectNotExists("cards", {
      type: "channel",
      common: { name: "Card and user management" },
      native: {},
    });

    await this.createOneState(
      "cards",
      "db",
      "User/Credential database",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );
    await this.createOneState(
      "cards",
      "userCount",
      "Count of managed users",
      "number",
      "value",
      true,
      false,
      0,
      undefined,
    );
    await this.createOneState(
      "cards",
      "credentialCount",
      "Count of managed credentials",
      "number",
      "value",
      true,
      false,
      0,
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastUpdate",
      "Last update timestamp",
      "string",
      "value",
      true,
      false,
      "",
      undefined,
    );
    await this.createOneState(
      "cards",
      "reviewQueue",
      "Import review queue",
      "string",
      "json",
      true,
      false,
      "[]",
      undefined,
    );
    await this.createOneState(
      "cards",
      "reviewPending",
      "Pending import review items",
      "number",
      "value",
      true,
      false,
      0,
      undefined,
    );
    await this.createOneState(
      "cards",
      "jobs",
      "Background jobs",
      "string",
      "json",
      true,
      false,
      "[]",
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastJob",
      "Last background job",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastSyncPreview",
      "Last sync preview",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastSyncApply",
      "Last sync apply result",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastValidation",
      "Last validation/reconcile report",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );
    await this.createOneState(
      "cards",
      "lastRestoreResync",
      "Last restore resync result",
      "string",
      "json",
      true,
      false,
      "{}",
      undefined,
    );

    const dbState = await this.getStateAsync("cards.db");
    if (dbState && typeof dbState.val === "string" && dbState.val.trim()) {
      try {
        const parsed = JSON.parse(dbState.val);
        if (parsed && typeof parsed === "object" && parsed.users) {
          this.userDb = parsed;
        }
      } catch (err) {
        this.log.warn(`Could not parse cards.db. Resetting DB: ${err.message}`);
        this.userDb = this.createEmptyUserDb();
      }
    }

    if (!Array.isArray(this.userDb.reviewQueue)) {
      this.userDb.reviewQueue = [];
    }

    await this.persistUserDb("init");
    await this.persistJobsState();
  }

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
      ? rawCredential.controllers
          .map((it) => parseInt(it, 10))
          .filter((it) => !isNaN(it))
      : [];

    return {
      id,
      type,
      value,
      label: (rawCredential.label || "").toString(),
      controllers: [...new Set(controllers)],
      meta: {
        ...(rawCredential.meta || {}),
      },
    };
  }

  normalizeUser(rawUser) {
    if (!rawUser || typeof rawUser !== "object") {
      throw new Error("Missing user object");
    }

    const id = (rawUser.id || rawUser.userId || "").toString();
    if (!id) {
      throw new Error("Missing user id");
    }

    const credentialsRaw = Array.isArray(rawUser.credentials)
      ? rawUser.credentials
      : [];
    const credentials = credentialsRaw.map((credential) =>
      this.normalizeCredential(credential),
    );

    return {
      id,
      displayName: (rawUser.displayName || rawUser.name || id).toString(),
      controllers: Array.isArray(rawUser.controllers)
        ? rawUser.controllers
            .map((it) => parseInt(it, 10))
            .filter((it) => !isNaN(it))
        : [],
      credentials,
      meta: {
        ...(rawUser.meta || {}),
      },
    };
  }

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
          ...new Set([
            ...(current.controllers || []),
            ...(credential.controllers || []),
          ]),
        ];
        current.label = credential.label || current.label || "";
        current.meta = {
          ...(current.meta || {}),
          ...(credential.meta || {}),
        };
      } else {
        credentialMap[credential.id] = credential;
      }
    }

    existing.credentials = Object.values(credentialMap);
    const controllersFromCredentials = existing.credentials.flatMap(
      (credential) => credential.controllers || [],
    );
    existing.controllers = [
      ...new Set([
        ...(normalized.controllers || []),
        ...controllersFromCredentials,
      ]),
    ];

    this.userDb.users[normalized.id] = existing;
    return existing;
  }

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

  async registerCredentialObservation(observation) {
    if (
      !observation ||
      !observation.cardNumber ||
      observation.cardNumber <= 0
    ) {
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
              meta: {
                source: "event",
              },
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
    const credential = (user.credentials || []).find(
      (item) => item.id === credentialId,
    );

    if (credential) {
      credential.controllers = [
        ...new Set([
          ...(credential.controllers || []),
          observation.controllerSerial,
        ]),
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

    await this.persistUserDb("event");
  }

  countCredentials() {
    return Object.values(this.userDb.users).reduce((sum, user) => {
      return (
        sum + (Array.isArray(user.credentials) ? user.credentials.length : 0)
      );
    }, 0);
  }

  normalizeImportDataset(dataset) {
    if (!dataset || typeof dataset !== "object") {
      throw new Error("Import dataset is missing");
    }

    const controllers = Array.isArray(dataset.controllers)
      ? dataset.controllers
      : [];
    const records = [];
    for (const controller of controllers) {
      const serial = parseInt(controller.serial, 10);
      if (isNaN(serial)) {
        continue;
      }
      const entries = Array.isArray(controller.entries)
        ? controller.entries
        : [];
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
            externalId: (
              entry.externalId ||
              entry.userId ||
              entry.id ||
              ""
            ).toString(),
            sourceSystem: (
              entry.sourceSystem ||
              dataset.source ||
              "import"
            ).toString(),
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

  makeImportUserId(record) {
    const preferred = (record.displayName || "").trim().toLowerCase();
    if (preferred) {
      const safe = preferred
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (safe) {
        return `import-${safe}`;
      }
    }
    const firstCredential = record.credentials[0];
    return `import-${firstCredential.type}-${firstCredential.value}`;
  }

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
      const userId = this.findUserIdByCredential(
        credential.type,
        credential.value,
      );
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

  getReviewQueueSummary() {
    const queue = Array.isArray(this.userDb.reviewQueue)
      ? this.userDb.reviewQueue
      : [];
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let applied = 0;
    let failed = 0;

    for (const item of queue) {
      if (item.status === "pending") {
        pending += 1;
      } else if (item.status === "approved") {
        approved += 1;
      } else if (item.status === "rejected") {
        rejected += 1;
      } else if (item.status === "applied") {
        applied += 1;
      } else if (item.status === "failed") {
        failed += 1;
      }
    }

    return {
      total: queue.length,
      pending,
      approved,
      rejected,
      applied,
      failed,
    };
  }

  findReviewItem(reviewId) {
    return (
      (this.userDb.reviewQueue || []).find((item) => item.id === reviewId) ||
      null
    );
  }

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

  async applyImportDataset(dataset) {
    let preview = null;
    if (
      !Array.isArray(this.userDb.reviewQueue) ||
      this.userDb.reviewQueue.length === 0
    ) {
      preview = this.buildImportPreview(dataset);
      this.userDb.reviewQueue = preview.reviewItems;
      await this.persistUserDb("importPreview");
    }

    const summary = this.getReviewQueueSummary();
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
            identityMeta: {
              ...(reviewItem.record.identityMeta || {}),
            },
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

    await this.persistUserDb("import");
    return {
      applied: failedReviewIds.length === 0,
      touchedUsers: [...touchedUsers],
      reviewSummary: this.getReviewQueueSummary(),
      appliedReviewIds,
      failedReviewIds,
    };
  }

  getJobs() {
    return Object.values(this.jobs).sort((left, right) => {
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

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
    this.persistJobsState().catch((err) => {
      this.log.warn(`Could not persist jobs state: ${err.message}`);
    });

    Promise.resolve().then(async () => {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      await this.persistJobsState();

      try {
        const result = await runner();
        job.status = "completed";
        job.result = result;
        job.finishedAt = new Date().toISOString();
        this.log.info(`Background job completed: ${id} (${type})`);
      } catch (err) {
        job.status = "failed";
        job.error = err.message;
        job.finishedAt = new Date().toISOString();
        this.log.error(`Background job failed: ${id} (${type}) ${err.message}`);
      }

      await this.persistJobsState();
    });

    return job;
  }

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

    await this.setStateAsync("cards.lastValidation", {
      ack: true,
      val: JSON.stringify(response),
    });

    return response;
  }

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
      const credentials = Array.isArray(user.credentials)
        ? user.credentials
        : [];
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

  buildCredentialHash(credentials) {
    const keys = credentials
      .map((credential) => `${credential.type}:${credential.value}`)
      .sort();
    return keys.join("|");
  }

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
   * Fetch all card numbers currently stored on a controller.
   * Returns an empty array when the controller is unreachable.
   *
   * @param {object} ctx
   * @param {number} controllerId
   * @returns {Promise<number[]>}
   */
  async getControllerCards(ctx, controllerId) {
    try {
      const response = await uapi.getCards(ctx, controllerId);
      const count = Number(response?.cards ?? 0);
      if (!count) {
        return [];
      }

      const cards = [];
      for (let index = 1; index <= count; index++) {
        try {
          const card = await uapi.getCardByIndex(ctx, controllerId, index);
          const cardNr = Number(card?.card?.number ?? 0);
          if (cardNr > 0) {
            cards.push(cardNr);
          }
        } catch {
          // Skip unreadable card slot.
        }
      }

      return cards;
    } catch {
      return [];
    }
  }

  /**
   * Write a single user credential to a controller via putCard.
   *
   * @param {object} ctx
   * @param {number} controllerId
   * @param {number} cardNr
   * @param {string|number} pin
   * @param {number} modelType  Number of doors on this controller.
   */
  async putCardToController(ctx, controllerId, cardNr, pin, modelType) {
    const doors = {};
    for (let door = 1; door <= Math.min(modelType || 4, 4); door++) {
      doors[door] = true;
    }

    const validFrom = "2000-01-01";
    const validTo = "2099-12-31";
    const pinValue =
      pin != null && String(pin).length > 0
        ? parseInt(String(pin), 10) || 0
        : 0;

    await uapi.putCard(
      ctx,
      controllerId,
      cardNr,
      validFrom,
      validTo,
      doors,
      pinValue,
    );
  }

  async applySyncPlan(payload) {
    const plan = this.buildSyncPlan(payload);
    const updatedUsers = new Set();
    let appliedActions = 0;
    let deletedCards = 0;

    const ctx = this.createCTX(
      "syncApply",
      this.createCFG(),
      this.devs,
      this.log.debug,
    );

    // Group actions by controller for efficient overwrite processing.
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

      // For overwrite: read existing cards from controller and remove orphans.
      if (plan.mode === "overwrite") {
        const existingCards = await this.getControllerCards(ctx, controllerId);

        // Build the set of card numbers that should be on this controller after sync.
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

        // Delete cards on controller that are no longer in User-DB.
        for (const existingCard of existingCards) {
          if (!targetCardNumbers.has(existingCard)) {
            try {
              await uapi.deleteCard(ctx, controllerId, existingCard);
              deletedCards += 1;
              this.log.debug(
                `syncApply: deleted orphan card ${existingCard} from controller ${controllerId}`,
              );
            } catch (err) {
              this.log.warn(
                `syncApply: failed to delete card ${existingCard} from controller ${controllerId}: ${err.message}`,
              );
            }
          }
        }
      }

      // Write all non-skipped actions to the controller.
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
            await this.putCardToController(
              ctx,
              controllerId,
              cardNr,
              pin,
              modelType,
            );
            this.log.debug(
              `syncApply: wrote card ${cardNr} to controller ${controllerId} (user ${action.userId})`,
            );
          } catch (err) {
            this.log.warn(
              `syncApply: failed to write card ${cardNr} to controller ${controllerId}: ${err.message}`,
            );
          }
        }

        user.meta = {
          ...(user.meta || {}),
        };
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

    await this.persistUserDb("syncApply");

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

    await this.setStateAsync("cards.lastSyncApply", {
      ack: true,
      val: JSON.stringify(result),
    });

    return result;
  }

  normalizeRestoreResyncPayload(payload) {
    return {
      ...payload,
      mode: "overwrite",
    };
  }

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

    await this.setStateAsync("cards.lastRestoreResync", {
      ack: true,
      val: JSON.stringify(result),
    });

    return result;
  }

  async persistJobsState() {
    const jobs = this.getJobs();
    await this.setStateAsync("cards.jobs", {
      ack: true,
      val: JSON.stringify(jobs),
    });
    await this.setStateAsync("cards.lastJob", {
      ack: true,
      val: jobs.length > 0 ? JSON.stringify(jobs[0]) : "{}",
    });
  }

  async persistUserDb(source) {
    this.userDb.updatedAt = new Date().toISOString();
    this.userDb.lastSource = source || "unknown";

    await this.setStateAsync("cards.db", {
      ack: true,
      val: JSON.stringify(this.userDb),
    });
    await this.setStateAsync("cards.userCount", {
      ack: true,
      val: Object.keys(this.userDb.users).length,
    });
    await this.setStateAsync("cards.credentialCount", {
      ack: true,
      val: this.countCredentials(),
    });
    await this.setStateAsync("cards.lastUpdate", {
      ack: true,
      val: this.userDb.updatedAt,
    });
    await this.setStateAsync("cards.reviewQueue", {
      ack: true,
      val: JSON.stringify(this.userDb.reviewQueue || []),
    });
    await this.setStateAsync("cards.reviewPending", {
      ack: true,
      val: this.getReviewQueueSummary().pending,
    });
  }

  /** @param {string} msg */
  customErr(msg) {
    return { error: true, err: { message: msg } };
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options]
   */
  module.exports = (options) => new WiegandTcpip(options);
} else {
  // otherwise start the instance directly
  new WiegandTcpip();
}
