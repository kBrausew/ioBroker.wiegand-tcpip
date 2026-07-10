# Manual NPM Publishing Guide

> **Note:** The automated GitHub Actions deploy job is disabled. Use this guide for manual npm publishing.

## Prerequisites

- Node.js 22.x or later installed
- npm account with publish permissions
- All tests passing locally: `npm run test:regression`

## Steps for Manual Publishing

### 1. Ensure all tests pass

```bash
npm run test:regression
npm run lint
npm run check
```

### 2. Verify version in package.json and io-package.json

Both files must have the same version number (e.g., `1.0.1`):

```bash
grep '"version"' package.json io-package.json
```

### 3. Login to npm

```bash
npm login
```

You'll be prompted for:
- Username
- Password
- Email
- OTP (One-Time Password) if 2FA is enabled

### 4. Publish to npm

```bash
npm publish --access public
```

### 5. Verify publication

Check that the version is available on npm:

```bash
npm view iobroker.wiegand-tcpip@<version>
```

Or visit: https://www.npmjs.com/package/iobroker.wiegand-tcpip

## Troubleshooting

### Version already exists error
```
npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/iobroker.wiegand-tcpip - You cannot publish over the previously published version "1.0.1".
```

**Solution:** Bump version in `package.json` and `io-package.json` to a new version number and try again.

### Authentication failed
```
npm ERR! 401 Unauthorized - Login first with `npm adduser`
```

**Solution:** Run `npm logout` and then `npm login` again.

### Publishing blocked by 2FA
You may need to pass an OTP token:

```bash
npm publish --access public --otp <6-digit-code>
```

## ioBroker.repositories Update

After successful npm publishing:

1. The adapter-check in [ioBroker.repositories PR #6285](https://github.com/ioBroker/ioBroker.repositories/pull/6285) will automatically pass
2. GitHub Actions will detect the npm publication
3. The PR can be merged once adapter-check is ✅

## Notes

- This adapter uses GitHub OIDC Trusted Publishing in the automated workflow (when enabled)
- Manual publishing requires npm account credentials
- Always test locally before publishing: `npm run test:regression`
