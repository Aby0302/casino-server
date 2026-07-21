# Casino Godot Client

Godot 4 native 3D casino lobby. The default scene is `scenes/main.tscn`, so the
client opens into the 3D lobby and uses the live Node server for config, assets,
balance, and remote game rendering.

An optional full-screen remote WebView/CEF shell remains available at
`scenes/cef_shell.tscn` for store-shell experiments, but it is not the default.

## Run

1. Install Godot 4.x.
2. Open `godot-client/project.godot` in Godot.
3. Press Play.

The default 3D lobby loads:

- `https://casino.retailerway.com/casino-config.json`
- `https://casino.retailerway.com/maps/<map>.glb`
- `https://casino.retailerway.com/models/<model>.glb`
- `wss://casino.retailerway.com/?game=balance&sessionID=godot-player`
- `https://casino.retailerway.com/client/start` for CEF in-world game screens when the addon is installed
- `https://casino.retailerway.com/cloud/stream` as the fallback in-world game screen path

## Current Features

- Loads the live lobby config, map GLB, and machine GLBs.
- Uses `CharacterBody3D` movement instead of raw transform movement.
- Generates static collision bodies from imported GLB meshes.
- Treats config spawn/seat positions as camera targets, then snaps the player's capsule feet onto the closest lobby floor collider.
- Connects to the read-only balance WebSocket and hot-reloads config updates.
- Displays Sugar Rush on the 3D slot machine screen through CEF when available.
- Falls back to the live Sugar Rush cloud stream when CEF is not installed.
- Sends spin input to the active client renderer or cloud session without opening a browser window.

## CEF Rendering

The 3D slot screen can use the `dsh0416/godot-cef` addon when it is installed
under `godot-client/addons/godot_cef/`. The addon binaries are large, so that
directory is ignored by git and should be installed locally or by the packaging
pipeline instead of committed.

Linux builds force CEF to use `ozone-platform=x11` in `project.godot`. Godot can
still run on Wayland, but CEF's Vulkan accelerated off-screen renderer is not
compatible with Chromium's Wayland ozone backend on this stack.

CEF rendering defaults to software OSR because NVIDIA/Vulkan DMA-BUF accelerated
OSR can load the page in CEF while drawing a blank Godot texture on some drivers.
This applies to both the 3D slot screen and the optional full-screen CEF shell.
To retry accelerated OSR for debugging, run with `CASINO_CEF_ACCELERATED=1` or
`-- --cef-accelerated=1`.

Godot CEF currently ships desktop binaries only (Linux, macOS, Windows). Android
or iOS store builds need a mobile-native WebView shell instead of this CEF addon.
Those shells live under `../mobile-shell/android` and `../mobile-shell/ios`.

When CEF is present in the default 3D lobby, the in-world slot screen opens:

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

The full-screen remote shell uses `/client/lobby` first to mint an HttpOnly shell
cookie. That mode is available by opening `scenes/cef_shell.tscn` manually.

Without the addon, the default 3D lobby keeps using `/cloud/start`,
`/cloud/stream`, and `/cloud/input` automatically.

## Controls

- `WASD` or arrow keys: move
- Left click: capture mouse
- Mouse: look around
- `E`: sit at the nearby slot machine
- `G`: show Sugar Rush on the nearby machine screen
- `Space`: spin the active machine stream
- `Esc`: release mouse

## Test Hook

For a headless script parse/smoke check:

```bash
godot --headless --path godot-client --check-only --quit
```

## Next Work

- Move CEF addon installation into release packaging once Linux builds are stable.
- Keep the optional remote shell and mobile-native shells available for store-update-minimized builds.
- Add pointer/click projection so the 3D screen can receive direct mouse/touch input.
