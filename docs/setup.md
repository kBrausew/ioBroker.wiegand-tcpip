# `Setup`
- [Initial start-up](#initial-start-up) Fist time access to the Device
- [Setup the adapter](#door-access-controllers-settings) Setup the ioBroker Adapter
  - [TCP/IP Network Settings](#tcpip-network-settings) Setup the adapter network

## Initial start-up
When you connect the device for the first time, it may be useful to enter the network data.

These steps are optional and only required for using the device in another, remote network, outside the local network at the ioBroker instance
* To do this...
  - Connect the device to the same network in which ioBroker is also located. No Docker, VPN or other subnet [^1]
  - Install and start the adapter with default settings.
  - Switch to the "Device Remote Setup" tab
  - Run the device scan
    There are two possible error messages that result in no devices being found[^3], [^4]
  - If you have more than one device active, select the one you want in the "Device Id" dropdown box.
  - Put the desired address data in the appropriate input fields[^2]

## Door Access Controllers Settings
### TCP/IP Network Settings
#### Network interface
From the list, select the network host adapter to which you have connected your device.[^2]
- Special addresses
  - `0.0.0.0` All available interfaces (Default)
  - `127.0.0.1` Only local host network (for the [simulator](https://github.com/uhppoted/uhppote-simulator))
  - All others can be used if you know what you want. e.g. VPN, Docker etc...
#### Sender-Port
Default is 60000. Without error message from the network there is no need the change that.
#### Receiver-Port
Default is 60001. Without error message from the network there is no need the change that.
I redefined port 60099 for the adapter. If something doesn't work, change this back to the default.
#### Connection Timeout in milli seconds
Timeout for any communication over the network.
Do not change without consultation.
Values below 1000 and above 10000 can work for the time being,
 but always lead to errors in real operation
  

[^1]: If you are unable to connect the device to the same local network as the ioBroker instance,
  you must set the IP addresses in another alternative way
[^2]: The device only allows IPv4 addresses
[^3]: ![Error message: No Device found](images/no-devices-found.png)
[^4]: ![Error message: Adapter not started](images/adapter-not-run.png)