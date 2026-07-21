# Android mobile client for the casino cloud stream

**Date:** 2026-07-20
**Status:** Approved

## Problem

The user wants to play Sugar Rush on an Android phone. Two clients exist today:

- A Unity VR project (`~/My project`), built for Meta Quest via the XR template — not
  suited to a normal phone screen without stripping out the VR rig.
- `godot-client/` (untracked in git, Godot 4 scaffold) — a desktop-style 3D lobby with
  WASD movement, mouse look, and keyboard shortcuts (`E` sit, `G` open machine screen,
  `Space` spin). Its README already flags the gap: "Add pointer/click projection so the
  3D screen can receive direct mouse/touch input" — nothing in it is tappable on a
  touchscreen. This matches the user's report: no on-screen buttons, no working game
  flow on a phone.

The user chose a **simple mobile mode** over a touch-adapted 3D lobby: tap a game in a
list, play it fullscreen, no walking around a 3D room on a phone.

## Non-goals

- No changes to the Unity VR project.
- No *behavioral* changes to the desktop 3D lobby (`scenes/main.tscn` /
  `scripts/main.gd`). It will be refactored to call the new shared
  `scripts/cloud_stream_client.gd` for cloud-stream handling (see Components §2),
  but its controls, on-screen behavior, and features must stay identical before and
  after.
- No server-side API changes — the mobile client reuses `/cloud/start`, `/cloud/stream`,
  `/cloud/input`, `/cloud/close`, and the read-only balance WebSocket exactly as they
  exist today in `slot/server.js` and `slot/cloud-stream.js`.
- No new game selection beyond Sugar Rush for v1 (the list is a small array so adding
  `slot` later is trivial, but only Sugar Rush ships now).
- No native "big Spin button" bridge. Investigation confirmed the Sugar Rush frontend
  bundle (`sugar-rush/dist/assets/index-DM-6BKpt.js`) has no listener for the
  `unitySpin` custom event that `cloud-stream.js`'s `/cloud/input` handler dispatches —
  that bridge is dead code left over from an earlier native-Unity-slot implementation.
  Only `__chipBalance` is a real, live bridge. Tapping the game's own on-screen buttons
  (rendered inside the MJPEG frame) via coordinate-accurate touch passthrough is the
  only mechanism that actually works, and it's already proven by the existing desktop
  `/cloud/` stream viewer page.

## Architecture

Add a second scene to the existing (currently untracked) `godot-client/` Godot 4
project:

- `godot-client/scenes/mobile_main.tscn` + `godot-client/scripts/mobile_main.gd` — new,
  self-contained mobile UI. Does not touch `scenes/main.tscn` / `scripts/main.gd`.
- A new Android export preset (`godot-client/export_presets.cfg`, does not exist yet)
  overrides `application/run/main_scene` to `res://scenes/mobile_main.tscn` for the
  Android build only. The project's default main scene stays
  `res://scenes/main.tscn` (desktop 3D lobby), so `godot --path godot-client` in the
  editor/PC is unaffected.
- Server: **no changes.** The mobile client is just another consumer of the existing
  cloud-stream HTTP/WebSocket API, the same way the desktop Godot client and the plain
  web `/cloud/` viewer page already are.

Build pipeline (this machine, confirmed available):

- Godot 4.7.stable CLI at `/usr/bin/godot`.
- Android SDK + NDK at `~/android-tools/sdk` (platforms 34/36, build-tools 34/35/37,
  NDK 25.2.9519653 and 27.2.12479018, platform-tools with `adb`).
- Godot Android export templates are **not** installed yet — matching 4.7.stable
  templates (~500 MB) are reachable from GitHub releases and will be downloaded and
  installed as a one-time setup step.
- Output: a signed debug APK (Godot's built-in debug keystore, generating one via
  `keytool` if `~/.android/debug.keystore` doesn't exist) delivered to the user as a
  file (install via `adb install` or by copying the APK to the phone).

## Components (`mobile_main.gd`)

1. **Game list screen** — fullscreen `Control`, one large touch `Button` per playable
   game, driven by a small local array (`[{id: "sugar-rush", label: "Sugar Rush"}]`
   today). Tapping a button starts a cloud session for that game.

2. **Stream view screen** — a `TextureRect` filling the screen. Frame delivery reuses
   the MJPEG-over-`HTTPClient` decode approach already implemented in
   `scripts/main.gd` (`_start_cloud_stream` / `_poll_cloud_stream` /
   `_extract_cloud_frames` / `_show_cloud_frame`), adapted to update the `TextureRect`'s
   texture instead of a 3D screen material. Given the amount of shared logic, this
   parsing code is factored out of `main.gd` into a small shared script
   (`scripts/cloud_stream_client.gd`) that both `main.gd` and `mobile_main.gd` use,
   rather than duplicated.

3. **Touch-to-click passthrough** — `_gui_input` on the stream `TextureRect` captures
   tap position, scales it into stream pixel coordinates using the same
   letterbox-aware math as the existing web viewer's `streamPoint()` (`cloud-stream.js`
   `streamViewerHtml`), and POSTs `{type: "click", x, y}` to `/cloud/input`. This is
   what makes the buttons already drawn inside the game (Play, Spin, bet +/-, menu)
   actually tappable — they exist today; only the transport to reach them was missing
   from the 3D Godot client.

4. **"◀ Lobi" back button** — native overlay `Button`, top-left, visible only during a
   stream. Stops the cloud session (`POST /cloud/close`) and returns to the game list.

5. **Balance label** — reuses the existing read-only balance WebSocket subscription
   pattern from `main.gd` (`_connect_balance_socket`, `_poll_balance_socket`) so the
   player sees live wallet balance without any server change.

6. **Session/player id** — on first launch, generate a random per-install id (e.g.
   `mobile-<8 hex chars>`) and persist it to `user://player.cfg` (same `ConfigFile`
   pattern `main.gd` already uses for `godot-player`). Deliberately **not** reusing the
   desktop client's default `godot-player` id, so a phone and a desktop Godot client
   don't collide on the same wallet. No registration screen for v1 (matches "basit
   mod" — anonymous per-install session, same as the desktop client's unregistered
   default state).

## Data flow

Tap a game button → `GET /cloud/start?game=sugar-rush&sessionID=<persisted-id>` →
server responds 302 with `id`/`token` (existing flow, unchanged) → Godot opens an
`HTTPClient` MJPEG stream from `/cloud/stream?id=...&token=...` and renders frames into
the `TextureRect` (~8 fps, `FRAME_INTERVAL_MS=120`, same as desktop) → taps on the image
are scaled and POSTed to `/cloud/input`, which Playwright replays as real mouse clicks
inside the headless page running the actual game → the balance WebSocket pushes wallet
updates back to the HUD in real time, same as the desktop client.

## Error handling

- Stream connect/HTTP failures surface as text in the same status label used for normal
  progress messages ("Starting...", "Connecting video stream..."), so the failure is
  visible in place. v1 does not add an automatic reconnect loop — the existing "◀ Lobi"
  back button already lets the player back out and re-tap the game to retry, so no
  separate retry control is needed.
- Leaving the stream screen (back button, or app backgrounded) calls `/cloud/close` to
  free the Playwright session immediately. The server's existing 15-minute idle sweep
  (`closeIdleSessions` in `cloud-stream.js`) is the backstop if that call is missed
  (app killed, network dropped).

## Testing / verification

- Extend the existing headless smoke test hook
  (`CASINO_AUTOSTART_STREAM=1 godot --headless --path godot-client`) to also exercise
  `mobile_main.gd`'s cloud-session start + first-frame-received path against a local
  dev server instance, so a broken build is caught without needing a phone.
- Manual verification: install the built debug APK on the user's phone and play a real
  round of Sugar Rush end-to-end (tap game → see stream → tap Play → tap Spin → see
  balance update → tap back).

## Deliverable

A debug APK file, built on this machine using the local Android SDK/NDK, handed to the
user (e.g. via file transfer) for sideloading onto their phone.
