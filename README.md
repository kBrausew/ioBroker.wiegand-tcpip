![Logo](admin/wiegand-tcpip.png)
# ioBroker.wiegand-tcpip

[![NPM version](https://img.shields.io/npm/v/iobroker.wiegand-tcpip.svg)](https://www.npmjs.com/package/iobroker.wiegand-tcpip)
[![Downloads](https://img.shields.io/npm/dm/iobroker.wiegand-tcpip.svg)](https://www.npmjs.com/package/iobroker.wiegand-tcpip)
![Number of Installations](https://iobroker.live/badges/wiegand-tcpip-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/wiegand-tcpip-stable.svg)
<!-- [![Dependency Status](https://img.shields.io/david/kbrausew/iobroker.wiegand-tcpip.svg)](https://david-dm.org/kbrausew/iobroker.wiegand-tcpip) -->

[![NPM](https://nodei.co/npm/iobroker.wiegand-tcpip.png?downloads=true)](https://nodei.co/npm/iobroker.wiegand-tcpip/)

**Tests:** ![Test and Release](https://github.com/kbrausew/ioBroker.wiegand-tcpip/workflows/Test%20and%20Release/badge.svg)

## wiegand-tcpip adapter for ioBroker
 
wiegand Door Access Controller Shenzhen Weigeng Industrial

## Developer manual
This section is intended for the developer. It can be deleted later

### Getting started

You are almost done, only a few steps left:
1. Create a new repository on GitHub with the name `ioBroker.wiegand-tcpip`
1. Initialize the current folder as a new git repository:  
    ```bash
    git init -b main
    git add .
    git commit -m "Initial commit"
    ```
1. Link your local repository with the one on GitHub:  
    ```bash
    git remote add origin https://github.com/kbrausew/ioBroker.wiegand-tcpip
    ```

1. Push all files to the GitHub repo:  
    ```bash
    git push origin main
    ```

1. Head over to [main.js](main.js) and start programming!

### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `test:js` | Executes the tests you defined in `*.test.js` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test:unit` | Tests the adapter startup with unit tests (fast, but might require module mocks to work). |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on your code (without compiling anything). |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `release` | Creates a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage) for more details. |

### Writing tests
When done right, testing code is invaluable, because it gives you the 
confidence to change your code while knowing exactly if and when 
something breaks. A good read on the topic of test-driven development 
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92. 
Although writing tests before the code might seem strange at first, but it has very 
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form 
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation 
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually with dev-server
Since you set up `dev-server`, you can use it to run, test and debug your adapter.

You may start `dev-server` by calling from your dev directory:
```bash
dev-server watch
```

The ioBroker.admin interface will then be available at http://localhost:9999/

Please refer to the [`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (kbrausew) initial release

## License
GPL-3.0

## Copyright
Copyright (c) 2022 kbrausew <kbrausew@magenta.de>