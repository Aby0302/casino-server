# Casino Godot Client

Godot 4 client scaffold for the casino lobby. It keeps the existing Node server,
live `casino-config.json`, GLB map/model assets, and read-only balance WebSocket.

## Run

1. Install Godot 4.x.
2. Open `godot-client/project.godot` in Godot.
3. Press Play.

The client loads:

- `https://casino.retailerway.com/casino-config.json`
- `https://casino.retailerway.com/maps/<map>.glb`
- `https://casino.retailerway.com/models/<model>.glb`
- `wss://casino.retailerway.com/?game=balance&sessionID=godot-player`
- `https://casino.retailerway.com/client/start` for the in-world Sugar Rush screen when the optional CEF addon is installed
- `https://casino.retailerway.com/cloud/stream` as the fallback Sugar Rush screen path

## Current Features

- Loads the live lobby config, map GLB, and machine GLBs.
- Uses `CharacterBody3D` movement instead of raw transform movement.
- Generates static collision bodies from imported GLB meshes.
- Treats config spawn/seat positions as camera targets, then snaps the player's
  capsule feet onto the closest lobby floor collider.
- Recovers the player to the last safe floor position if they fall below the map.
- Uses local repo assets during development, then falls back to remote assets.
- Connects to the read-only balance WebSocket.
- Displays Sugar Rush through a token-gated client-side CEF renderer when available.
- Falls back to the live Sugar Rush cloud stream when the CEF addon is not installed.
- Sends spin input to the active client renderer or cloud session without opening a browser window.
- Provides player registration and lobby interaction UI.

## Optional CEF Renderer

The 3D slot screen uses the `dsh0416/godot-cef` `CefTexture2D` addon when it is
installed under `godot-client/addons/godot_cef/`. The addon binaries are large,
so that directory is ignored by git and should be installed locally or by the
packaging pipeline instead of committed.

Godot CEF currently ships desktop binaries only (Linux, macOS, Windows). Android
exports exclude `addons/godot_cef/` and keep using the cloud stream fallback.

When CEF is present, the client opens:

```text
https://casino.retailerway.com/client/start?game=sugar-rush&sessionID=<player>
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

Without the addon, the client keeps using `/cloud/start`, `/cloud/stream`, and
`/cloud/input` automatically.

## Controls

- `WASD` or arrow keys: move
- Left click: capture mouse
- Mouse: look around
- `E`: sit at the nearby slot machine
- `G`: show Sugar Rush on the nearby machine screen
- `Space`: spin the active machine stream
- `Esc`: release mouse

## Test Hook

For a headless smoke test that auto-starts the first machine stream:

```bash
CASINO_AUTOSTART_STREAM=1 godot --headless --path godot-client
```

## Next Work

- Add pointer/click projection so the CEF 3D screen can receive direct mouse/touch input.
- Move CEF addon installation into release packaging once Linux builds are stable.
- Add OpenXR support after desktop lobby loading is stable.
