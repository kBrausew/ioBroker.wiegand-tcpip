/**
 * UHPPOTE API Wrapper
 * Encapsulates all UHPPOTE API communication and device management
 */

const uapi = require("uhppoted");
const os = require("os");
const ipaddr = require("ipaddr.js");

class WrapperAPI {
  /**
   * @param {any} logger ioBroker logger instance
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Create local configuration from adapter config
   * @param {object} config Adapter config object
   * @returns {object} Local config
   */
  createCFG(config) {
    const lCFG = {};
    lCFG.lBind = config.bind || "0.0.0.0";
    lCFG.lPort = config.port || 60000;
    lCFG.rPort = config.r_port || 60099;
    lCFG.lTimeout = config.timeout || 2500;
    lCFG.lHeartbeat = config.heartbeat || 300000;
    lCFG.lListen = `${lCFG.lBind}:${lCFG.rPort.toString()}`;
    lCFG.lBroadcast = this.getBroadcastAddresses(lCFG.lBind) || "0.0.0.0";
    lCFG.lBroadcastP = `${lCFG.lBroadcast}:${lCFG.lPort.toString()}`;
    lCFG.rBroadcast = this.getBroadcastAddresses(lCFG.lBind) || "255.255.255.255";
    lCFG.debugll = config.debugLL || false;
    return lCFG;
  }

  /**
   * Create UHPPOTE API context
   * @param {string} pName Context name
   * @param {object} pCFG Local config
   * @param {array} pDevs Device list
   * @param {function} cLogger Logger function
   * @returns {object} UHPPOTE context
   */
  createCTX(pName, pCFG, pDevs, cLogger) {
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
   * Get broadcast address for given IP
   * @param {string} ip IP address
   * @returns {string|null} Broadcast address or null
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
   * Fetch all card numbers currently stored on a controller
   * @param {object} ctx UHPPOTE context
   * @param {number} controllerId Controller serial number
   * @returns {Promise<number[]>} Array of card numbers
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
          // Skip unreadable card slot
        }
      }

      return cards;
    } catch {
      return [];
    }
  }

  /**
   * Write a single card credential to a controller
   * @param {object} ctx UHPPOTE context
   * @param {number} controllerId Controller serial
   * @param {number} cardNr Card number
   * @param {string|number} pin PIN (optional)
   * @param {number} modelType Number of doors
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

  /**
   * Open door via UHPPOTE API
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {number} doorId Door number
   */
  async openDoor(ctx, deviceId, doorId) {
    return await uapi.openDoor(ctx, deviceId, doorId);
  }

  /**
   * Get device status
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   */
  async getStatus(ctx, deviceId) {
    return await uapi.getStatus(ctx, deviceId);
  }

  /**
   * Get event listener status
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   */
  async getListener(ctx, deviceId) {
    return await uapi.getListener(ctx, deviceId);
  }

  /**
   * Set event listener
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {string} address IP address
   * @param {number} port Port number
   */
  async setListener(ctx, deviceId, address, port) {
    return await uapi.setListener(ctx, deviceId, address, port);
  }

  /**
   * Enable/disable special event recording
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {boolean} enabled Enable flag
   */
  async recordSpecialEvents(ctx, deviceId, enabled) {
    return await uapi.recordSpecialEvents(ctx, deviceId, enabled);
  }

  /**
   * Set device time
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {string} dateTimeStr DateTime string "YYYY-MM-DD hh:mm:ss"
   */
  async setTime(ctx, deviceId, dateTimeStr) {
    return await uapi.setTime(ctx, deviceId, dateTimeStr);
  }

  /**
   * Get door control status
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {number} doorId Door number
   */
  async getDoorControl(ctx, deviceId, doorId) {
    return await uapi.getDoorControl(ctx, deviceId, doorId);
  }

  /**
   * Delete card from controller
   * @param {object} ctx UHPPOTE context
   * @param {number} deviceId Device serial
   * @param {number} cardNr Card number
   */
  async deleteCard(ctx, deviceId, cardNr) {
    return await uapi.deleteCard(ctx, deviceId, cardNr);
  }

  /**   * Discover devices on network
   * @param {object} config Device discovery config
   * @returns {Promise<array>} Array of discovered devices
   */
  async getDevices(config) {
    return await uapi.getDevices(config);
  }

  /**
   * Set IP address on device
   * @param {object} config Device discovery config
   * @param {number} deviceId Device serial
   * @param {string} address IP address
   * @param {string} netmask Netmask
   * @param {string} gateway Gateway
   * @returns {Promise<object>} Response object
   */
  async setIP(config, deviceId, address, netmask, gateway) {
    return await uapi.setIP(config, deviceId, address, netmask, gateway);
  }

  /**   * Listen to device events
   * @param {object} ctx UHPPOTE context
   * @param {function} onEvent Event handler
   * @param {function} onError Error handler
   */
  async listen(ctx, onEvent, onError) {
    return await uapi.listen(ctx, onEvent, onError);
  }
}

module.exports = WrapperAPI;
