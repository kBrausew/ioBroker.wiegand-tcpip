"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils     = require("@iobroker/adapter-core");
const os        = require("os");
const ipaddr    = require("ipaddr.js");
const uapi      = require("uhppoted");

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
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.ulistener = null;
        this.ctrls     = new Array();
    }

    /**
     * @param {string} ip
     */
    getBroadcastAddresses(ip) {
        const interfaces = os.networkInterfaces();
        for (const iface in interfaces) {
            for (const i in interfaces[iface]) {
                const f = interfaces[iface][i];
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
    async createWiegand(serialNr){
        const lSerialNr = serialNr.toString();
        const lId       = "controllers." + lSerialNr;
        await this.setObjectNotExistsAsync( lId, {
            type: "device",
            common: { name: lSerialNr, },
            native: {},
        });

        await this.setObjectNotExistsAsync( lId + ".button", {
            type: "channel",
            common: { name: "button", },
            native: {},
        });

        await this.setObjectNotExistsAsync( lId + ".button.doorOpen1", {
            type: "state",
            common: { name: "doorOpen1", type: "boolean", role: "switch", read: true, write: false },
            native: {},
        });

    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        await this.setObjectNotExistsAsync("controllers", {
            type: "folder",
            common: { name: "controllers", type: "folder" },
            native: {},
        });

        const lBind         = this.config.iface     || "0.0.0.0";
        const lPort         = this.config.port      || 60000;
        const rPort         = this.config.r_port    || 60099;
        const lTimeout      = this.config.timeout   || 2500;
        const lListen       = lBind + ":" + lPort.toString();
        const lBroadcast    = this.getBroadcastAddresses(lBind) || lBind;
        const lBroadcastP   = lBroadcast + ":" + rPort.toString();


        this.ctx = {config: new uapi.Config("ctx", lBind, lBroadcastP, lListen, lTimeout, [], false)};
        this.log.info(JSON.stringify(this.ctx));
        //this.ulistener = uapi.listen();

        await this.createWiegand(12345);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if(this.ulistener) {
                this.ulistener.close();
                this.ulistener = null;
                this.log.debug("Listener Close");
            }
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
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    //     if (typeof obj === "object" && obj.message) {
    //         if (obj.command === "send") {
    //             // e.g. send email or pushover or whatever
    //             this.log.info("send command");

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    //         }
    //     }
    // }

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