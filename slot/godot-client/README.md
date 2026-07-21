# Casino Godot Client

Godot 4 thin-shell client for the casino. The default scene is now a full-screen
Godot CEF browser that loads the remote lobby from the Node server, so lobby UI,
game launch flow, and most new features can ship server-side without rebuilding
the native Godot package.

The old native 3D lobby remains available at `scenes/main.tscn` for development
and fallback experiments, but `project.godot` starts `scenes/cef_shell.tscn`.

## Run

1. Install Godot 4.x.
2. Open `godot-client/project.godot` in Godot.
3. Press Play.

The default shell loads:

- `https://casino.retailerway.com/client/lobby`
- `https://casino.retailerway.com/client/session`
- `https://casino.retailerway.com/casino-config.json`
- `wss://casino.retailerway.com/?game=balance&sessionID=godot-player`
- `https://casino.retailerway.com/client/start` inside the lobby game iframe
- `https://casino.retailerway.com/client-game/sugar-rush/*` after token-gated launch

## Current Features

- Starts a full-screen `CefTexture` browser instead of native 3D lobby logic.
- Uses a token-gated `/client/lobby` shell session cookie.
- Loads remote lobby UI from `client-lobby.html` and `client-lobby.js` on the server.
- Reads live `casino-config.json` to render the machine list.
- Connects to the balance WebSocket and hot-reloads config updates.
- Launches Sugar Rush in an iframe through `/client/start` without exposing game assets in the Godot bundle.
- Persists player changes back to `user://player.cfg` through CEF IPC.

## CEF Shell

The default shell requires the `dsh0416/godot-cef` `CefTexture` addon installed
under `godot-client/addons/godot_cef/`. The addon binaries are large, so that
directory is ignored by git and should be installed locally or by the packaging
pipeline instead of committed.

Godot CEF currently ships desktop binaries only (Linux, macOS, Windows). Android
or iOS store builds need a mobile-native WebView shell instead of this CEF addon.
Those shells live under `../mobile-shell/android` and `../mobile-shell/ios`.

When CEF is present, the client opens:

```text
https://casino.retailerway.com/client/lobby?sessionID=<player>
```

If the server has `CLIENT_RENDER_SECRET` set, pass the matching client launch
secret without hardcoding it in source:

```bash
CASINO_CLIENT_RENDER_SECRET=<secret> godot --path godot-client
```

or:

```bash
godot --path godot-client -- --client-render-secret=<secret>
```

The first lobby request uses the secret to mint an HttpOnly shell cookie. After
that, the web lobby launches games with `/client/start` using the shell cookie,
so the secret does not need to be embedded in iframe URLs.

Without the addon, the default shell shows an installation error. To run the old
native lobby manually, open `scenes/main.tscn` in the editor.

## Controls

- Mouse/touch: interact with the remote lobby and games.
- `Esc`: close the active game iframe in the remote lobby.
- Legacy native 3D controls still apply only when running `scenes/main.tscn`.

## Test Hook

For a headless script parse/smoke check:

```bash
godot --headless --path godot-client --check-only --quit
```

## Next Work

- Move CEF addon installation into release packaging once Linux builds are stable.
- Add a mobile-native WebView shell if targeting Android/iOS stores; Godot CEF is desktop-only today.
- Keep native shell capabilities generic so future features ship through the remote lobby.
