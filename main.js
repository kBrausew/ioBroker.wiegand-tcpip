"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const os = require("os");
const ipaddr = require("ipaddr.js");
const uapi = require("uhppoted");
//const { stat } = require("fs");

class WiegandTcpip extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
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

        this.ulistener = null;      // socket listener
        this.heartbeat = null;      // interval heartbeat
        //this.lheartbeat = 0;        // interval ms
        this.ctrls = [];            // controller of this.config validated
        this.serials = {};          // serials
        this.devs = [];             // uAPI devices (config)
    }

    /**
     * @param {number} deviceId
     * @param {number} doorId
     */
    doorOpenSpec(deviceId, doorId) {
        const lBind = this.config.bind || "0.0.0.0";
        const lPort = this.config.port || 60000;
        const rPort = this.config.r_port || 60099;
        const lTimeout = this.config.timeout || 2500;
        //const lheartbeat = this.config.heartbeat || 300000;
        const lListen = lBind + ":" + rPort.toString();
        //const rBroadcast = this.getBroadcastAddresses(lBind) || "255.255.255.255";
        const lBroadcast = this.getBroadcastAddresses(lBind) || "0.0.0.0";
        const lBroadcastP = `${lBroadcast}:${lPort.toString()}`;
        const debugll = this.config.debugLL || false;

        const ctx = { config: new uapi.Config("doorOpenSpec", lBind, lBroadcastP, lListen, lTimeout, this.devs, debugll) };
        ctx.logger = this.log.debug;
        this.log.silly("doorOpenSpec: " + JSON.stringify(ctx));
        uapi.openDoor(ctx, deviceId, doorId)
            .then(ret => {
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
                this.log.debug("Request remote open: " + deviceId + " Door-" + doorId + ": " + JSON.stringify(ret));
            })
            .catch(err => {
                this.log.error("Error Remote Open Door: " + deviceId + "/" + doorId + ": " + err.message);
            });
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        const lBind = this.config.bind || "0.0.0.0";
        const lPort = this.config.port || 60000;
        const rPort = this.config.r_port || 60099;
        const lTimeout = this.config.timeout || 2500;
        const lheartbeat = this.config.heartbeat || 300000;
        const lListen = lBind + ":" + rPort.toString();
        const rBroadcast = this.getBroadcastAddresses(lBind) || "255.255.255.255";
        const lBroadcast = this.getBroadcastAddresses(lBind) || "0.0.0.0";
        const lBroadcastP = `${lBroadcast}:${lPort.toString()}`;
        const debugll = this.config.debugLL || false;

        this.unsubscribeStates("*");

        this.setObjectNotExists("controllers", {
            type: "folder",
            common: { name: "controllers", type: "folder" },
            native: {},
        });

        let itemNr = 1;
        for (const dev of this.config.controllers) {
            if (!this.serials[dev.serial]) {
                this.serials[dev.serial] = true;
                if (dev.serial && !isNaN(dev.serial)) {
                    // @ts-ignore
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
                        if (!dev.deviceIp) dev.deviceIp = lBroadcast;
                        if (!dev.exposedIP) dev.exposedIP = lBind;
                        // @ts-ignore
                        if (!dev.exposedPort) dev.exposedPort = rPort;
                        dev.broadcast = true;
                        this.log.warn("Incorrect controller-setup for non/broadcast: " + dev.serial);
                    } else {
                        dev.deviceIp = lBroadcast;
                        dev.exposedIP = rBroadcast;
                        // @ts-ignore
                        dev.exposedPort = rPort;
                        dev.broadcast = true;
                    }
                    await uapi.addDevice(this.ctx, dev.serial, dev.deviceIp, dev.broadcast);
                    this.devs.push({
                        "deviceId": dev.serial,
                        "address": dev.deviceIp,
                        "forceBroadcast": dev.broadcast
                    });
                    dev.run = false;
                    dev.eventNr = 0;
                    this.ctrls.push(dev);
                }
                // @ts-ignore
                else this.log.error("Invalid serial number for controller: [" + dev.serial.toString() + "]");
            }
            // @ts-ignore
            else this.log.error("Controller configured more than once: " + dev.serial.toString());
        }

        this.getDevices((err, res) => {
            if (!err && res) {
                res.forEach((obj) => {
                    const spl = obj._id.split(".");
                    if (spl.length == 4 && spl[2] == "controllers") {
                        if (!this.serials[spl[3]]) {
                            // eslint-disable-next-line no-unused-vars
                            this.delObject(obj._id, { recursive: true }, (_err) => {
                                //this.log.error("Device not valide: " + JSON.stringify(err) + " > " + obj._id);
                            });
                            this.log.info("Controller: " + obj._id + " deleted");
                        } else this.log.silly(obj._id + " ok");
                    }
                });
            }
        });

        this.ctx = { config: new uapi.Config("ctx", lBind, lBroadcastP, lListen, lTimeout, this.devs, debugll) };
        this.ctx.logger = this.log.debug;
        this.log.silly(JSON.stringify(this.ctx));
        this.log.silly(JSON.stringify(this.devs));
        this.ulistener = await uapi.listen(this.ctx, this.onUapiEvent.bind(this), this.onUapiError.bind(this));

        await this.assureRun();
        this.heartbeat = this.setInterval(this.assureRun.bind(this), lheartbeat);
    }

    async assureRun() {
        if (!this.assureRun_once) {
            this.assureRun_once = true;
            //################################################################################
            //Major Try-Catch: no change code befor...
            try {
                for (const dev of this.ctrls) {
                    //this.log.silly("Heartbeat: " + dev.serial);
                    try {
                        let eventNr = 0;
                        const lStat = await uapi.getStatus(this.ctx, dev.serial);
                        if (lStat) {
                            if (lStat.state) {
                                if (lStat.state.event) {
                                    eventNr = parseInt(lStat.state.event.index, 10) || 0;
                                    if (dev.run == true && dev.eventNr != eventNr) {
                                        this.log.warn("May connection lost (better restart): " + dev.serial + " / " + eventNr + " / " + dev.eventNr);
                                        dev.run = false;
                                    }
                                    ++dev.heartbeatCount;
                                }
                            }
                        }

                        if (dev.run && dev.heartbeatCount > 10) {
                            //this.log.debug("Extendend HeartBeat: " + dev.heartbeatCount);
                            const lList = await uapi.getListener(this.ctx, dev.serial);
                            if (lList) {
                                const lHost = lList.address || "";
                                const lPort = lList.port || 0;
                                if (lHost != dev.exposedIP || lPort != dev.exposedPort) {
                                    this.log.warn("Extendend HeartBeat negative (better restart): " + dev.serial);
                                    dev.run = false;
                                }
                            }
                            dev.heartbeatCount = 1;
                        }

                        if (!dev.run) {
                            this.log.info("Connect to controller: " + dev.serial);
                            await uapi.setTime(this.ctx, dev.serial, this.formatDate(Date.now(), "YYYY-MM-DD hh:mm:ss"));
                            await uapi.recordSpecialEvents(this.ctx, dev.serial, true);
                            await uapi.setListener(this.ctx, dev.serial, dev.exposedIP, dev.exposedPort);

                            dev.eventNr = eventNr;
                            dev.heartbeatCount = 1;
                            dev.run = true;
                        }

                        if (dev.heartbeatCount == 1) {
                            for (let i = 1; i <= dev.modelType; i++) {
                                try {
                                    const lContr = await uapi.getDoorControl(this.ctx, dev.serial, i);
                                    //this.log.debug(JSON.stringify(lContr));
                                    let lDelay = 0;
                                    let lContr_n = 0;
                                    if (lContr && lContr.doorControlState) {
                                        lDelay = lContr.doorControlState.delay || 0;
                                        if (lContr.doorControlState.control) lContr_n = lContr.doorControlState.control.value || 0;
                                    }
                                    this.setState("controllers." + dev.serial + "." + i.toString() + ".delay", { ack: true, val: lDelay });
                                    this.setState("controllers." + dev.serial + "." + i.toString() + ".control", { ack: true, val: lContr_n });
                                }
                                // eslint-disable-next-line no-empty
                                catch (fError) { }
                            }

                        }

                        /*if(dev.eventNr > 3){
                            dev.eventNr = 1;
                            await uapi.setEventIndex(this.ctx, dev.serial, dev.eventNr);
                            this.log.debug(dev.eventNr);
                        }*/

                    } catch (err) {
                        dev.run = false;
                        this.log.error("Problem with controller " + dev.serial + ": " + err.message);
                    }
                    try {
                        const lReach = "controllers." + dev.serial + ".reachable";
                        this.getState(lReach, (fErr, fStat) => {
                            if (!fErr) {
                                let lState = false;
                                // @ts-ignore
                                if (fStat) lState = fStat.val || false;
                                if (lState != dev.run) {
                                    this.setState(lReach, { ack: true, val: dev.run });
                                }
                                dev.errorCount = 1;
                            } else {
                                if ((dev.errorCount % 100) == 0) {
                                    //if (fErr) {
                                    this.log.error("... controller " + dev.serial + ": " + fErr.message);
                                    //} else this.log.error("Major-Problem with controller " + dev.serial);
                                }
                                if (dev.errorCount >= 3000) {
                                    this.log.error("Major-Problem: Better restart... " + dev.serial);
                                    this.restart();
                                }

                                ++dev.errorCount;
                            }
                        });
                    } catch (err) {
                        dev.run = false;
                        this.log.error("Post-Constructur-Problem with controller " + dev.serial + ": " + err.message);
                    }
                }
            } catch (e) {
                this.log.error("Major-problem in heartbeat: " + e.message);
            }
            //Major Try-Catch: no change code after...
            //################################################################################
            this.assureRun_once = false;
        } else this.log.error("Heartbeat is too short for all required tasks");
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
                // @ts-ignore
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
        const lRootPath = "controllers." + lSerialNr;

        this.log.info("Create controller objects: " + lSerialNr);
        await this.setObjectNotExists(lRootPath, {
            type: "device",
            common: { name: "Controller-" + itemNr.toString(), },
            native: {},
        });

        await this.createOneState(lRootPath, "eventNr", "number", "value", true, false, 0, undefined);
        await this.createOneState(lRootPath, "reachable", "boolean", "indicator.reachable", true, false, false, undefined);

        for (let i = 1; i <= 4; i++) {
            const lDoorPath = lRootPath + "." + i.toString();
            if (i <= noOfDoors) {
                this.log.debug("Aktiviere: "+serialNr+" / "+i);
                this.setObjectNotExists(lDoorPath, {
                    type: "channel",
                    common: { name: "Door-" + i.toString(), },
                    native: {},
                });

                await this.createOneState(lDoorPath, "control", "number", "value", true, false, 0,
                    { "0": "unknown", "1": "normally open", "2": "normally closed", "3": "controlled" });
                await this.createOneState(lDoorPath, "delay", "number", "value", true, false, 0, undefined);
                await this.createOneState(lDoorPath, "lastSwipe", "number", "value", true, false, 0, undefined);
                await this.createOneState(lDoorPath, "lastGranted", "boolean", "value", true, false, false, undefined);
                await this.createOneState(lDoorPath, "reasonCode", "number", "value", true, false, 0, undefined);
                await this.createOneState(lDoorPath, "reasonText", "string", "value", true, false, "", undefined);
                await this.createOneState(lDoorPath, "requestCode", "number", "value", true, false, 0, undefined);
                await this.createOneState(lDoorPath, "requestText", "string", "value", true, false, "", undefined);
                await this.createOneState(lDoorPath, "remoteOpen", "boolean", "button.lock", false, true, true, undefined);
                await this.createOneState(lDoorPath, "unlocked", "boolean", "value.lock", true, false, false, undefined);
                await this.subscribeStatesAsync(lDoorPath + ".remoteOpen");
            } else {
                try {
                    this.log.debug("De-Aktiviere: "+serialNr+" / "+i);
                    this.unsubscribeStates(lDoorPath + ".remoteOpen");
                    // eslint-disable-next-line no-unused-vars
                    this.delObject(lDoorPath, { recursive: true }, (_err) => {
                        //this.log.error("Device not valide: " + JSON.stringify(err) + " > " + lRootPath);
                    });
                }
                // eslint-disable-next-line no-empty
                catch (error) {
                    this.log.debug("Fehler: "+serialNr+" / "+i);
                }
            }
        }
    }

    /**
     * @param {string} path
     * @param {string} name
     * @param {string} type
     * @param {string} role
     * @param {boolean} read
     * @param {boolean} write
     * @param {any} val
     * @param {object} stat
     */
    async createOneState(path, name, type, role, read, write, val, stat) {
        const lPath = path + "." + name;
        await this.setObjectNotExists(lPath, {
            type: "state",
            // @ts-ignore
            common: { name: name, type: type, role: role, def: val, states: stat, read: read, write: write },
            native: {}
            // }, (err, obj) => {
            //     if (obj) {
            //         this.setState(lPath, { val: val, ack: true });
            //         this.log.silly(name + ": New State @ " + lPath);
            //     }
        });
    }

    /**
     * @param {any} evt
     */
    async onUapiEvent(evt) {
        //this.log.info("Event: " + JSON.stringify(evt));
        if (evt && evt.state && evt.state.serialNumber && evt.state.event) {// && evt.state.event.granted && evt.state.event.door){
            const lEvt = evt.state.event;
            const ldeviceId = evt.state.serialNumber;
            const lGranted = lEvt.granted || false;
            const ldoorId = parseInt(lEvt.door, 10) || 0;
            const lCard = parseInt(lEvt.card, 10) || 0;
            const dev = this.ctrls.find(dev => dev.serial == ldeviceId);
            const lRoot = "controllers." + ldeviceId.toString() + "." + ldoorId.toString();
            let requestCode = 0;
            let requestText = "";
            let reasonCode = 0;
            let reasonText = "";

            if (!lEvt && !dev) {
                this.log.error("Major-Problem with event receiving for: " + lRoot);
                return;
            }

            if (lGranted) {
                this.getState(lRoot + ".unlocked", (_fErr, fStat) => {
                    if (!fStat) {
                        this.log.error("No state found: " + lRoot + ".unlocked");
                    } else {
                        this.setState(lRoot + ".unlocked", { ack: true, val: lGranted });
                        this.setTimeout(() => {
                            this.setState(lRoot + ".unlocked", { ack: true, val: false });
                        }, 50);
                    }
                });
            }

            if (lEvt.type) {
                requestCode = lEvt.type.code || 0;
                requestText = lEvt.type.event || "";
            }
            if (lEvt.reason) {
                reasonCode = lEvt.reason.code || 0;
                reasonText = lEvt.reason.reason || "";
            }
            this.setState(lRoot + ".requestCode", { ack: true, val: requestCode });
            this.setState(lRoot + ".requestText", { ack: true, val: requestText });
            this.setState(lRoot + ".reasonCode", { ack: true, val: reasonCode });
            this.setState(lRoot + ".reasonText", { ack: true, val: reasonText });
            this.setState(lRoot + ".lastSwipe", { ack: true, val: lCard });
            this.setState(lRoot + ".lastGranted", { ack: true, val: lGranted });

            //this.setState(lRoot + ".remoteOpen", { ack: true, val: true });

            if (dev && lEvt.index) {
                ++dev.eventNr;// = lEvt.index;
                if (dev.eventNr != lEvt.index) {
                    this.log.error("Timing problem expected: " + dev.eventNr + " / receive: " + lEvt.index + " Event");
                }
                this.setState("controllers." + ldeviceId.toString() + ".eventNr", { ack: true, val: lEvt.index });
            }
            this.log.debug("Controller: " + ldeviceId + " Door: " + ldoorId + " granted: " + lGranted + " Card: " + lCard);
        }
    }

    /**
     * @param {{ message: any; }} err
     */
    async onUapiError(err) {
        this.log.error("Event receive error: " + err.message);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            if (this.ulistener) {
                this.ulistener.close();
                this.ulistener = null;
                this.log.debug("CleanUp: Listener Close");
            } else this.log.debug("Listener is not runing");
            // eslint-disable-next-line no-empty
        } catch (e) { }

        try {
            if (this.heartbeat) {
                this.clearInterval(this.heartbeat);
                this.heartbeat = null;
                this.log.debug("CleanUp: Clear interval");
            }
            // eslint-disable-next-line no-empty
        } catch (e) { }

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

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            //check Id for handled operations
            const id_part = id.split(".");
            if (id_part.length < 6 || id_part[0] != this.name || id_part[1] != this.instance.toString() || id_part[2] != "controllers"
                || id_part[5] != "remoteOpen") {

                this.log.error("State possible not handled by this adapter: " + id);
                return;
            }

            // The state was changed
            const lLocal = "system.adapter." + this.name + "." + this.instance;
            const lFrom = state.from || lLocal;
            if (lFrom != lLocal) {
                const ldeviceId = parseInt(id_part[3], 10);
                const ldoorId = parseInt(id_part[4], 10);
                if (state.val == true && !isNaN(ldeviceId) && !isNaN(ldoorId)) {
                    const dev = this.ctrls.find(dev => dev.serial == ldeviceId);
                    if (dev.run) {
                        this.doorOpenSpec(dev.serial, ldoorId);
                    } else this.log.error("Can not handle unreached device: " + ldeviceId);
                    // this.setTimeout(() => {
                    //     this.setState(id, { ack: true, val: false });
                    // }, 50);
                }
            } else this.log.silly("Ignore state change from myself: i know what i do ;-)");
            //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack}) (from = ${state.from})`);
        } else {
            // The state was deleted
            this.unsubscribeStates(id);
            this.log.debug(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     * @param {ioBroker.Message} obj
     */
    async onMessage(obj) {
        if (typeof obj === "object" && obj.message) {
            // @ts-ignore
            const lBind = obj.message.bind || "0.0.0.0";
            const lConf = { config: new uapi.Config("config", lBind, lBind + ":60000", lBind + ":60001", 2500, [], false) };
            switch (obj.command) {
                case "search":
                    if (obj.callback) {
                        uapi.getDevices(lConf)
                            .then(uRet => {
                                this.sendTo(obj.from, obj.command, uRet, obj.callback);
                            })
                            .catch(err => {
                                const uRetErr = {
                                    "error": true,
                                    "err": { "message": err.message.toString() }
                                };
                                this.log.error("onMessage Error (" + obj.command + "): " + err.message.toString());
                                this.sendTo(obj.from, obj.command, uRetErr, obj.callback);
                            });
                    }
                    break;
                case "setip":
                    if (obj.callback) {
                        this.log.silly(JSON.stringify(obj.message));
                        // @ts-ignore
                        uapi.setIP(lConf, obj.message.deviceId, obj.message.address, obj.message.netmask, obj.message.gateway)
                            .then(uRet => {
                                this.sendTo(obj.from, obj.command, uRet, obj.callback);
                            })
                            .catch(err => {
                                const uRetErr = {
                                    "error": true,
                                    "err": { "message": err.message.toString() }
                                };
                                this.log.error("onMessage Error (" + obj.command + "): " + err.message.toString());
                                this.sendTo(obj.from, obj.command, uRetErr, obj.callback);
                            });
                    }
                    break;
                default:
                    {
                        const uRetNoCommand = {
                            "error": true,
                            "err": { "message": "\"" + obj.command.toUpperCase() + "\" is not a valide Command" }
                        };
                        this.log.error("onMessage Error: " + uRetNoCommand.err.message.toString());
                        this.sendTo(obj.from, obj.command, uRetNoCommand, obj.callback);
                    }
                    break;
            }
        }
    }

}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new WiegandTcpip(options);
} else {
    // otherwise start the instance directly
    new WiegandTcpip();
}