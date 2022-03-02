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

        this.ulistener = null;     // socket listener
        this.ctrls = [];       // controller of this.config validated
        this.serials = {};       // valide serials
        this.devs = [];       // uAPI devices (config)
    }

    /**
     * @param {string} ip
     */
    getBroadcastAddresses(ip) {
        if (ip == "0.0.0.0") return ip;
        const interfaces = os.networkInterfaces();
        for (const iface in interfaces) {
            for (const i in interfaces[iface]) {
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

        this.log.info("Setup controller: " + lSerialNr);
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
        const lListen = lBind + ":" + rPort.toString();
        const lBroadcast = this.getBroadcastAddresses(lBind) || "0.0.0.0";
        const lBroadcastP = `${lBroadcast}:${lPort.toString()}`;

        for (const dev of this.config.controllers) {
            if (!this.serials[dev.serial]) {
                this.serials[dev.serial] = true;
                if (dev.serial && !isNaN(dev.serial)) {
                    this.treeStructure(dev.serial);
                    this.devs.push({
                        "deviceId": dev.serial,
                        "address": dev.deviceIp,
                        "forceBroadcast": true
                    });
                    this.ctrls.push(dev);
                } else this.log.error("Invalid serial number for controller: [" + dev.serial.toString() + "]");
            } else this.log.error("Controller configured more than once: " + dev.serial.toString());
        }
        this.ctx = { config: new uapi.Config("ctx", lBind, lBroadcastP, lListen, lTimeout, [], false) };
        this.log.info(JSON.stringify(this.ctx));
        this.log.info(JSON.stringify(this.devs));
        this.ulistener = await uapi.listen(this.ctx, this.onUapiEvent.bind(this), this.onUapiError.bind(this));

        for (const dev of this.ctrls) {
            try {
                await uapi.recordSpecialEvents(this.ctx, dev.serial, true);
                await uapi.setListener(this.ctx, dev.serial, "127.0.0.1", rPort);
                //await uapi.openDoor(this.ctx, dev.serial, 2);
            } catch (err) {
                this.log.error(dev.serial + ": " + err.message);
            }
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
                            this.log.info(obj._id + " deleted");
                        } else this.log.info(obj._id + " ok");
                    }
                });
            }
        });

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
            callback();
        } catch (e) {
            callback();
        }
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
                                    "err": err
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
                            "err": { "message": _("Not a Command") }
                        };
                        this.log.error("onMessage Error (" + obj.command + "): " + uRetNoCommand.err.message.toString());
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