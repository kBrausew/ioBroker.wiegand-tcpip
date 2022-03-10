# ioBroker.wiegand-tcpip
![Logo](admin/wiegand-tcpip.png)

## State, Test & Badge
[![NPM version](https://img.shields.io/npm/v/iobroker.wiegand-tcpip.svg)](https://www.npmjs.com/package/iobroker.wiegand-tcpip)
[![Downloads](https://img.shields.io/npm/dm/iobroker.wiegand-tcpip.svg)](https://www.npmjs.com/package/iobroker.wiegand-tcpip)
![Number of Installations](https://iobroker.live/badges/wiegand-tcpip-installed.svg)
<!-- ![Current version in stable repository](https://iobroker.live/badges/wiegand-tcpip-stable.svg) -->
<!-- [![Dependency Status](https://img.shields.io/david/kbrausew/iobroker.wiegand-tcpip.svg)](https://david-dm.org/kbrausew/iobroker.wiegand-tcpip) -->

<!-- [![NPM](https://nodei.co/npm/iobroker.wiegand-tcpip.png?downloads=true)](https://nodei.co/npm/iobroker.wiegand-tcpip/) -->

**Tests:** ![Test and Release](https://github.com/kbrausew/ioBroker.wiegand-tcpip/workflows/Test%20and%20Release/badge.svg)

## **wiegand-tcpip** adapter for ioBroker
Wiegand Door Access Controller Shenzhen Weigeng Industrial

## Setup the adapter
[Setup Help](docs/setup.md)

## **Dependences**
| Component | Version |
| :---: | :---: |
| **NodeJS** | **min 14.x** |
| JS-Controller | min 3.x |

## **Recognition**
My very special thanks go to **@github/uhppoted & @github/twystd** without whose help this software would not have been possible :+1:
- https://github.com/uhppoted
- https://github.com/twystd

## **Hardware**
* Wiegand to TCP/IP (https://ingenier.wordpress.com/zutrittskontrolle/  german)
* Door Access Controller Shenzhen Weigeng Industrial (http://wiegand.com.cn)
* UHPPOTE -UT0311-L01 (up to L04) (https://github.com/uhppoted)
* VBESTLIFE, Dioche, Tangxi, ... (Big marketplace :wink: )
* i-keys IK-Point SC300xNT SC90xNT? (https://www.i-keys.de)
* Secukey C1 - C4 (http://secukey.com.cn/)
* S4A ACB (http://www.s4a.com.cn/)

Not every listed hardware was tested by me. Don't hesitate to tell me about the compatibility.

## **Disclaimer**
I hereby exclude liability for any damage and consequential damage that may arise from testing or using the software.
The software is designed for pure hardware-related communication.
Safety-relevant protective mechanisms are to be implemented independently in their environment

## **Changelog**
### V0.4.3
#### Function
* no new one
#### Changes
* setTime if device is running out
* select the model in configuration
### V0.4.2 (Beta)
#### Function:
* Remote network setup
* Broadcast device communication
* Remote device communication
#### Changes
* Bug ::Found uncleared intervals:: change clearInterval to adapter.clearInterval
* special remoteDoorOpen (in other contex change net-access-mode unmotivated to broadcast)
* device lowlevel debug enabled (from UHPPOTE framework connect to ioBroker log)
* add various "silly" log messages
* add per Controller the Model (1-, 2- and 4-Doors)
### V0.4.1-beta
* Small blemishes fixed and translation completed
### V0.4.0-alpha
* First working package

## License
GPL-3.0-only

## Copyright
Copyright (c) 2022 kbrausew <kbrausew@magenta.de>