# Mobile Native WebView Shells

These are thin native shells for app-store platforms. They load the same remote
casino lobby as the desktop Godot CEF shell:

```text
https://casino.retailerway.com/client/lobby?sessionID=<persisted-player>
```

The lobby, game list, UI, and game iframe all ship from the server, so most
future features can be released without a new Android/iOS store binary.

## Security Model

- Do not hardcode `CLIENT_RENDER_SECRET` in source.
- Pass it at build time through environment variables or build settings.
- Any secret included in a mobile binary can be extracted by a motivated user.
  Treat it as a launch gate, not as a strong anti-tamper boundary.
- Server-side wallet/game authorization remains the real enforcement point.

## Android

Path: `mobile-shell/android`

Stack:

- Kotlin
- Native Android `WebView`
- SharedPreferences-backed persistent `android-<id>` session
- JS bridge: `window.CasinoShell.setPlayer(id, name)`

Build with Android Studio, or with a local Gradle installation:

```bash
cd slot/mobile-shell/android
CASINO_SERVER_BASE=https://casino.retailerway.com \
CLIENT_RENDER_SECRET=<secret> \
gradle :app:assembleRelease
```

For emulator/local server testing, use `http://10.0.2.2:<port>` as
`CASINO_SERVER_BASE`. Cleartext is allowed only for `localhost`, `127.0.0.1`,
and `10.0.2.2`; production must use HTTPS.

## iOS

Path: `mobile-shell/ios/RetailerwayCasino.xcodeproj`

Stack:

- SwiftUI
- `WKWebView`
- UserDefaults-backed persistent `ios-<id>` session
- JS bridge: `window.webkit.messageHandlers.casinoShell.postMessage(...)`

Open the Xcode project, set your signing team, then set these build settings for
the app target:

- `CASINO_SERVER_BASE`: `https://casino.retailerway.com`
- `CLIENT_RENDER_SECRET`: your launch secret, if the server requires one

CLI example:

```bash
xcodebuild \
  -project slot/mobile-shell/ios/RetailerwayCasino.xcodeproj \
  -scheme RetailerwayCasino \
  -configuration Release \
  CASINO_SERVER_BASE=https://casino.retailerway.com \
  CLIENT_RENDER_SECRET=<secret>
```

iOS production builds should use HTTPS. If you need local HTTP testing, add a
temporary App Transport Security exception locally and do not ship it.

## Remote Update Boundary

Server-only updates usually do not need a store update:

- Lobby UI changes in `client-lobby.html` / `client-lobby.js`
- New machines or games exposed through `casino-config.json`
- Game frontend changes served through `/client-game/*`
- Wallet/RGS backend changes that preserve the browser protocol

Store updates are still required for native shell changes:

- New native permissions
- WebView engine policy/workaround code
- Push notifications, deep links, biometric login, native payments
- Bundle ID, icon, signing, or store metadata changes
