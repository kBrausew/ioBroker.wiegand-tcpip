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
//const { translateText } = require("./lib/tools");

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
        this.lheartbeat = 0;        // interval ms
        this.ctrls = [];            // controller of this.config validated
        this.serials = {};          // serials
        this.devs = [];             // uAPI devices (config)
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.setObjectNotExists("controllers", {
            type: "folder",
            common: { name: "controllers", type: "folder" },
            native: {},
        });

        const lBind = this.config.bind || "0.0.0.0";
        const lPort = this.config.port || 60000;
        const rPort = this.config.r_port || 60099;
        const lTimeout = this.config.timeout || 2500;
        this.lheartbeat = this.config.heartbeat || 60000;
        const lListen = lBind + ":" + rPort.toString();
        const lBroadcast = this.getBroadcastAddresses(lBind) || "0.0.0.0";
        const lBroadcastP = `${lBroadcast}:${lPort.toString()}`;

        for (const dev of this.config.controllers) {
            if (!this.serials[dev.serial]) {
                this.serials[dev.serial] = true;
                if (dev.serial && !isNaN(dev.serial)) {
                    this.treeStructure(dev.serial);
                    if (dev.deviceIp && dev.exposedIP && dev.exposedPort) {
                        // full rig
                        dev.broadcast = false;
                    } else if (dev.deviceIp || dev.exposedIP || dev.exposedPort) {
                        if (!dev.deviceIp) dev.deviceIp = lBroadcast;
                        if (!dev.exposedIP) dev.exposedIP = lBroadcast;
                        if (!dev.exposedPort) dev.exposedPort = rPort;
                        dev.broadcast = true;
                        this.log.warn("Incorrect controller-setup for non/broadcast: " + dev.serial);
                    } else {
                        dev.deviceIp = lBroadcast;
                        dev.exposedIP = lBroadcast;
                        dev.exposedPort = rPort;
                        dev.broadcast = true;
                    }
                    this.devs.push({
                        "deviceId": dev.serial,
                        "address": dev.deviceIp,
                        "forceBroadcast": dev.broadcast
                    });
                    dev.run = false;
                    dev.eventNr = 0;
                    this.ctrls.push(dev);
                } else this.log.error("Invalid serial number for controller: [" + dev.serial.toString() + "]");
            } else this.log.error("Controller configured more than once: " + dev.serial.toString());
        }

        this.getDevices((err, res) => {
            if (!err && res) {
                res.forEach((obj) => {
                    const spl = obj._id.split(".");
                    if (spl.length == 4 && spl[2] == "controllers") {
                        if (!this.serials[spl[3]]) {
                            this.delObject(obj._id, { recursive: true }, (err) => {
                                this.log.error("Device not valide: " + JSON.stringify(err) + " > " + obj._id);
                            });
                            this.log.info("Controller: "+ obj._id + " deleted");
                        } else this.log.silly(obj._id + " ok");
                    }
                });
            }
        });

        this.ctx = { config: new uapi.Config("ctx", lBind, lBroadcastP, lListen, lTimeout, this.devs, false) };
        //this.log.silly(JSON.stringify(this.ctx));
        //this.log.silly(JSON.stringify(this.devs));
        this.ulistener = await uapi.listen(this.ctx, this.onUapiEvent.bind(this), this.onUapiError.bind(this));

        await this.assureRun();
        this.heartbeat = this.setInterval(this.assureRun.bind(this), 10000);// this.lheartbeat);
    }

    async assureRun() {
        if (!this.assureRun_once) {
            this.assureRun_once = true;
            //################################################################################
            //Major Try-Catch: no change code befor...
            try {
                for (const dev of this.ctrls) {
                    try {
                        const lStat = await uapi.getStatus(this.ctx, dev.serial);
                        let eventNr = 0;
                        if (lStat) {
                            if (lStat.state) {
                                if (lStat.state.event) {
                                    eventNr = parseInt(lStat.state.event.index, 10) || 0;
                                    if (dev.run != false && dev.eventNr != eventNr) {
                                        this.log.warn("May connection lost (better restart): " + dev.serial);
                                        dev.run = false;
                                    }
                                }
                            }
                        }
                        //this.log.info(JSON.stringify(lStat));

                        if (!dev.run) {
                            this.log.info("Connect to controller: " + dev.serial);
                            await uapi.setTime(this.ctx, dev.serial, this.formatDate(Date.now(), "YYYY-MM-DD hh:mm:ss"));
                            await uapi.recordSpecialEvents(this.ctx, dev.serial, true);
                            await uapi.setListener(this.ctx, dev.serial, dev.exposedIP, dev.exposedPort);
                            dev.eventNr = eventNr;

                            dev.run = true;
                        }
                    } catch (err) {
                        dev.run = false;
                        this.log.error("Problem with controller " + dev.serial + ": " + err.message);
                    }
                }
            } catch (e) {
                this.log.error("Major problem in heartbeat: " + e.message);
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
        if (ip == "0.0.0.0") return ip;
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
     */
    treeStructure(serialNr) {
        const lSerialNr = serialNr.toString();
        const lId = "controllers." + lSerialNr;

        this.log.info("Create controller objects: " + lSerialNr);
        this.setObjectNotExists(lId, {
            type: "device",
            common: { name: lSerialNr, },
            native: {},
        });

        for (let i = 1; i <= 4; i++) {
            const cId = lId + "." + i.toString();
            this.setObjectNotExists(cId, {
                type: "channel",
                common: { name: i.toString(), },
                native: {},
            });

            const ulState = cId + ".unlock";
            this.setObjectNotExists(ulState, {
                type: "state",
                common: { name: "unlock", type: "boolean", role: "switch", read: true, write: false },
                native: {},
            }, (err, obj) => {
                if (obj) this.setState(ulState, { val: false, ack: true });
            });
        }
    }

    /**
     * @param {any} event
     */
    onUapiEvent(event) {
        this.log.info("Event: " + JSON.stringify(event));
    }

    /**
     * @param {{ message: any; }} err
     */
    onUapiError(err) {
        this.log.error("Event receive error: " + err.message);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (this.ulistener) {
                this.ulistener.close();
                this.ulistener = null;
                this.log.debug("Listener Close");
            } else this.log.debug("Listener is not runing");
            // eslint-disable-next-line no-empty
        } catch (e) { }

        try {
            if (this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = null;
                this.log.debug("Clear interval");
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
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     * @param {ioBroker.Message} obj
     */
    onMessage(obj) {
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