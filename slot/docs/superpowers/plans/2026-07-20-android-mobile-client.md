# Android Mobile Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a debug Android APK that lets the user play Sugar Rush on their phone: tap a game in a simple list, play it fullscreen via the existing cloud-stream, tap real on-screen game buttons (Play/Spin/bet), and see a live balance.

**Architecture:** Add a lightweight Godot mobile scene (`mobile_main.tscn`/`mobile_main.gd`) to the existing `godot-client/` project. It reuses the same `/cloud/start`, `/cloud/stream`, `/cloud/input`, `/cloud/close` HTTP API the desktop 3D lobby already talks to. The MJPEG-decode/session logic that currently lives inline in `scripts/main.gd` is extracted into a shared `scripts/cloud_stream_client.gd` node, used by both scenes. An Android-only project-setting override switches the exported app's main scene to the mobile one; the desktop/editor experience is untouched. The final task actually runs Godot's Android export on this machine (SDK/NDK/export templates already present or installed here) to produce the APK file.

**Tech Stack:** Godot 4.7 (GDScript), the existing Node.js `slot/server.js` + `slot/cloud-stream.js` (unmodified), local Android SDK/NDK at `~/android-tools/sdk`.

## Global Constraints

- No behavioral changes to the desktop 3D lobby (`scenes/main.tscn` / `scripts/main.gd`) — only a structural refactor to use the new shared script; controls, on-screen text, and features must be identical before/after.
- No server-side (`slot/server.js`, `slot/cloud-stream.js`) changes.
- `godot-client/export_presets.cfg` and anything under `godot-client/export/` stay gitignored (already the case per `.gitignore`) — never `git add` them.
- Mobile client uses its own persisted, randomly generated `sessionID` (prefixed `mobile-`), never the desktop client's default `godot-player`.
- Only Sugar Rush ships in the v1 game list.

---

### Task 1: Commit the existing godot-client scaffold as a clean baseline

**Files:**
- Modify (stage as-is, already on disk): `.gitignore`
- Add (stage as-is, already on disk): `godot-client/` (all existing files)

**Interfaces:** None — this is a git-only task, no code changes.

- [ ] **Step 1: Confirm what's currently untracked/modified**

Run: `cd /home/aby/Desktop/casino/slot && git status --short .gitignore godot-client`

Expected: `M .gitignore` and `??` lines for every file under `godot-client/` (the directory has never been committed).

- [ ] **Step 2: Headless sanity check that the project loads before committing**

Run: `godot --headless --path /home/aby/Desktop/casino/slot/godot-client --quit-after 3`

Expected: prints startup lines (e.g. `Loading player.cfg` or `Spawned player at ...` if a prior config file is used) and exits with code 0 — no `SCRIPT ERROR` or `Parse Error` lines. This proves the current scaffold is not broken before we start modifying it.

- [ ] **Step 3: Stage and commit**

```bash
cd /home/aby/Desktop/casino/slot
git add .gitignore godot-client
git status --short
```

Expected: `godot-client/.godot/`, `godot-client/export/`, and `godot-client/export_presets.cfg` do NOT appear in the staged list (they're covered by the `.gitignore` lines already present) — everything else under `godot-client/` does.

```bash
git commit -m "$(cat <<'EOF'
Add Godot desktop lobby client scaffold

Baseline commit of the existing godot-client/ work (3D lobby, cloud
stream on machine screens, balance socket, player registration) before
adding a mobile-specific scene on top of it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U6oSYunGK1tHn5shbcZ83C
EOF
)"
```

Expected: commit succeeds, `git log --oneline -1` shows the new commit.

---

### Task 2: Fix the stale Android SDK path in Godot's editor settings

**Files:**
- Modify: `~/.config/godot/editor_settings-4.7.tres` (outside the repo — not a git-tracked file, no commit for this task)

**Interfaces:** None.

**Context:** Godot's global editor settings already point `export/android/android_sdk_path` at `/home/aby/Android/Sdk`, which does not exist. The real SDK lives at `/home/aby/android-tools/sdk` (confirmed: `platforms/android-34`, `platforms/android-36`, `build-tools/{34.0.0,35.0.1,37.0.0}`, `ndk/{25.2.9519653,27.2.12479018}`, `platform-tools/adb` all present there). `java_sdk_path` (`/usr/lib/jvm/java-21-openjdk`) and `export/android/debug_keystore` (`/home/aby/.local/share/godot/keystores/debug.keystore`, already exists) are already correct and don't need changes.

- [ ] **Step 1: Confirm the bad path and the fix target**

```bash
grep -n "android_sdk_path" ~/.config/godot/editor_settings-4.7.tres
ls /home/aby/android-tools/sdk/platforms
```

Expected: first command prints `export/android/android_sdk_path = "/home/aby/Android/Sdk"`; second prints `android-34` and `android-36`.

- [ ] **Step 2: Patch the path**

Use the Edit tool on `~/.config/godot/editor_settings-4.7.tres`:

old_string: `export/android/android_sdk_path = "/home/aby/Android/Sdk"`
new_string: `export/android/android_sdk_path = "/home/aby/android-tools/sdk"`

- [ ] **Step 3: Verify**

Run: `grep -n "android_sdk_path" ~/.config/godot/editor_settings-4.7.tres`

Expected: `export/android/android_sdk_path = "/home/aby/android-tools/sdk"`

---

### Task 3: Install Godot 4.7 Android export templates

**Files:** none in the repo — installs into `~/.local/share/godot/export_templates/4.7.stable/` (outside the repo, no commit).

**Interfaces:** None.

- [ ] **Step 1: Confirm templates are currently missing**

Run: `ls ~/.local/share/godot/export_templates/`

Expected: empty (no `4.7.stable` directory yet).

- [ ] **Step 2: Download the template archive into the scratchpad**

```bash
mkdir -p /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/godot-templates
curl -L --fail -o /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/godot-templates/templates.tpz \
  "https://github.com/godotengine/godot/releases/download/4.7-stable/Godot_v4.7-stable_export_templates.tpz"
ls -la /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/godot-templates/templates.tpz
```

Expected: a file of roughly 400-600 MB (this was confirmed reachable via a HEAD request during design: it 302-redirects to a signed `release-assets.githubusercontent.com` URL, which `curl -L` follows automatically).

- [ ] **Step 3: Extract and install into Godot's template directory**

```bash
cd /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/godot-templates
unzip -q templates.tpz
cat templates/version.txt
mkdir -p ~/.local/share/godot/export_templates/4.7.stable
cp -r templates/* ~/.local/share/godot/export_templates/4.7.stable/
```

Expected: `templates/version.txt` prints `4.7.stable` (or `4.7.stable.official.<hash>` — either way, confirms this is the right version); the copy succeeds.

- [ ] **Step 4: Verify the Android templates specifically are present**

```bash
ls ~/.local/share/godot/export_templates/4.7.stable/ | grep -i android
```

Expected: lines including `android_debug.apk`, `android_release.apk`, `android_source.zip`.

- [ ] **Step 5: Clean up the scratch download**

```bash
rm -rf /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/godot-templates
```

---

### Task 4: Create the shared `CloudStreamClient` node with a headless self-test

**Files:**
- Create: `godot-client/scripts/cloud_stream_client.gd`
- Create: `godot-client/scripts/tests/test_cloud_stream_client.gd`

**Interfaces:**
- Produces (used by Task 5 and Task 6): a `class_name CloudStreamClient extends Node` with:
  - `var base_url: String`, `var cloud_id: String`, `var cloud_token: String`, `var width: int`, `var height: int`
  - `signal session_started()`
  - `signal frame_received(image: Image)`
  - `signal status_changed(message: String)`
  - `signal stream_closed()`
  - `func start_session(p_base_url: String, game: String, session_id: String, p_width: int, p_height: int) -> void`
  - `func send_click(x: float, y: float) -> void`
  - `func send_input(payload: Dictionary) -> void`
  - `func close_session() -> void`
  - `func is_active() -> bool`

- [ ] **Step 1: Write the failing test**

Create `godot-client/scripts/tests/test_cloud_stream_client.gd`:

```gdscript
extends SceneTree

func _init() -> void:
	var client := CloudStreamClient.new()
	var failures := 0

	var headers := PackedStringArray([
		"Content-Type: text/html",
		"Location: http://x/y?id=abc&token=def",
	])
	var location := client._header_value(headers, "location")
	if location != "http://x/y?id=abc&token=def":
		push_error("header_value failed: %s" % location)
		failures += 1

	var params := client._query_params("http://x/y?id=abc&token=def")
	if String(params.get("id", "")) != "abc" or String(params.get("token", "")) != "def":
		push_error("query_params failed: %s" % str(params))
		failures += 1

	var header_text := "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: 1234\r\n"
	if client._content_length_from_header(header_text) != 1234:
		push_error("content_length_from_header failed")
		failures += 1

	var buffer := PackedByteArray([1, 2, 3, 13, 10, 13, 10, 9])
	var separator := PackedByteArray([13, 10, 13, 10])
	if client._find_bytes(buffer, separator, 0) != 3:
		push_error("find_bytes failed")
		failures += 1

	client.base_url = "https://casino.retailerway.com"
	var parsed := client._parse_base_url()
	if String(parsed.get("host", "")) != "casino.retailerway.com" \
			or int(parsed.get("port", 0)) != 443 \
			or String(parsed.get("scheme", "")) != "https":
		push_error("parse_base_url failed: %s" % str(parsed))
		failures += 1

	client.free()

	if failures == 0:
		print("ALL TESTS PASSED")
		quit(0)
	else:
		print("%s TEST(S) FAILED" % failures)
		quit(1)
```

- [ ] **Step 2: Run it to confirm it fails (class doesn't exist yet)**

Run: `godot --headless --path /home/aby/Desktop/casino/slot/godot-client --script res://scripts/tests/test_cloud_stream_client.gd`

Expected: a parse/identifier error mentioning `CloudStreamClient` is not declared, non-zero exit code.

- [ ] **Step 3: Implement `CloudStreamClient`**

Create `godot-client/scripts/cloud_stream_client.gd`:

```gdscript
class_name CloudStreamClient
extends Node

signal session_started()
signal frame_received(image: Image)
signal status_changed(message: String)
signal stream_closed()

var base_url: String = ""
var cloud_id: String = ""
var cloud_token: String = ""
var width: int = 1280
var height: int = 720

var _start_request: HTTPRequest
var _input_request: HTTPRequest
var _close_request: HTTPRequest
var _stream_client: HTTPClient
var _stream_started := false
var _stream_requested := false
var _stream_buffer := PackedByteArray()


func _process(_delta: float) -> void:
	_poll_stream()


func start_session(p_base_url: String, game: String, session_id: String, p_width: int, p_height: int) -> void:
	base_url = p_base_url
	width = p_width
	height = p_height
	status_changed.emit("Starting %s..." % game)

	if _start_request != null:
		_start_request.queue_free()
	_start_request = HTTPRequest.new()
	_start_request.max_redirects = 0
	add_child(_start_request)
	_start_request.request_completed.connect(_on_start_response)

	var url := "%s/cloud/start?game=%s&sessionID=%s&width=%s&height=%s" % [
		base_url, game.uri_encode(), session_id.uri_encode(), width, height,
	]
	var err := _start_request.request(url)
	if err != OK:
		status_changed.emit("Start request failed: %s" % error_string(err))


func send_click(x: float, y: float) -> void:
	send_input({ "type": "click", "x": x, "y": y })


func send_input(payload: Dictionary) -> void:
	if cloud_id.is_empty() or cloud_token.is_empty():
		return

	if _input_request != null:
		_input_request.queue_free()

	payload["id"] = cloud_id
	payload["token"] = cloud_token
	payload["width"] = width
	payload["height"] = height

	_input_request = HTTPRequest.new()
	add_child(_input_request)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var err := _input_request.request(
		"%s/cloud/input" % base_url, headers, HTTPClient.METHOD_POST, JSON.stringify(payload)
	)
	if err != OK:
		status_changed.emit("Input send failed: %s" % error_string(err))


func close_session() -> void:
	if _stream_client != null:
		_stream_client.close()
	_stream_client = null
	_stream_started = false
	_stream_requested = false
	_stream_buffer.clear()

	if not cloud_id.is_empty() and not cloud_token.is_empty():
		if _close_request != null:
			_close_request.queue_free()
		_close_request = HTTPRequest.new()
		add_child(_close_request)
		var body := JSON.stringify({ "id": cloud_id, "token": cloud_token })
		var headers := PackedStringArray(["Content-Type: application/json"])
		_close_request.request("%s/cloud/close" % base_url, headers, HTTPClient.METHOD_POST, body)

	cloud_id = ""
	cloud_token = ""
	stream_closed.emit()


func is_active() -> bool:
	return _stream_started


func _on_start_response(_result: int, response_code: int, headers: PackedStringArray, _body: PackedByteArray) -> void:
	if response_code != 302 and response_code != 301:
		status_changed.emit("Cloud start failed: code=%s" % response_code)
		return

	var location := _header_value(headers, "location")
	var params := _query_params(location)
	cloud_id = String(params.get("id", ""))
	cloud_token = String(params.get("token", ""))

	if cloud_id.is_empty() or cloud_token.is_empty():
		status_changed.emit("Cloud token missing")
		return

	status_changed.emit("Connecting video stream...")
	_connect_stream()


func _connect_stream() -> void:
	var parsed := _parse_base_url()
	var host := String(parsed.get("host", ""))
	var port := int(parsed.get("port", 443))
	var scheme := String(parsed.get("scheme", "https"))
	if host.is_empty():
		status_changed.emit("Stream host parse failed")
		return

	_stream_client = HTTPClient.new()
	var tls_options: TLSOptions = TLSOptions.client() if scheme == "https" else null
	var err := _stream_client.connect_to_host(host, port, tls_options)
	if err != OK:
		status_changed.emit("Stream connect failed: %s" % error_string(err))
		return

	_stream_started = true
	_stream_requested = false
	_stream_buffer.clear()
	session_started.emit()


func _poll_stream() -> void:
	if not _stream_started or _stream_client == null:
		return

	_stream_client.poll()
	var status := _stream_client.get_status()

	if status == HTTPClient.STATUS_CONNECTED and not _stream_requested:
		var path := "/cloud/stream?id=%s&token=%s&width=%s&height=%s" % [
			cloud_id.uri_encode(), cloud_token.uri_encode(), width, height,
		]
		var err := _stream_client.request(HTTPClient.METHOD_GET, path, PackedStringArray())
		if err != OK:
			status_changed.emit("Stream request failed: %s" % error_string(err))
			close_session()
			return
		_stream_requested = true
		status_changed.emit("Waiting for first frame...")
		return

	if status == HTTPClient.STATUS_BODY:
		var chunk := _stream_client.read_response_body_chunk()
		if chunk.size() > 0:
			_stream_buffer.append_array(chunk)
			_extract_frames()
		return

	if status == HTTPClient.STATUS_DISCONNECTED and _stream_requested:
		status_changed.emit("Stream disconnected")
		close_session()


func _extract_frames() -> void:
	var header_separator := PackedByteArray([13, 10, 13, 10])
	while true:
		var header_end := _find_bytes(_stream_buffer, header_separator, 0)
		if header_end < 0:
			if _stream_buffer.size() > 1024 * 1024:
				_stream_buffer = _stream_buffer.slice(max(0, _stream_buffer.size() - 4096))
			return

		var header_text := _stream_buffer.slice(0, header_end).get_string_from_ascii()
		var content_length := _content_length_from_header(header_text)
		var frame_start := header_end + header_separator.size()
		if content_length <= 0:
			_stream_buffer = _stream_buffer.slice(frame_start)
			continue

		var frame_end := frame_start + content_length
		if _stream_buffer.size() < frame_end:
			return

		var frame := _stream_buffer.slice(frame_start, frame_end)
		var next_start := frame_end
		if _stream_buffer.size() >= next_start + 2 and _stream_buffer[next_start] == 13 and _stream_buffer[next_start + 1] == 10:
			next_start += 2
		_stream_buffer = _stream_buffer.slice(next_start)

		var image := Image.new()
		var err := image.load_jpg_from_buffer(frame)
		if err == OK:
			frame_received.emit(image)


func _header_value(headers: PackedStringArray, key: String) -> String:
	var prefix := "%s:" % key.to_lower()
	for header in headers:
		var raw := String(header)
		if raw.to_lower().begins_with(prefix):
			return raw.substr(raw.find(":") + 1).strip_edges()
	return ""


func _query_params(url: String) -> Dictionary:
	var params := {}
	var query_start := url.find("?")
	if query_start < 0:
		return params

	var query := url.substr(query_start + 1)
	for pair in query.split("&", false):
		var equals := pair.find("=")
		if equals < 0:
			params[pair.uri_decode()] = ""
		else:
			var key := pair.substr(0, equals).uri_decode()
			var value := pair.substr(equals + 1).uri_decode()
			params[key] = value
	return params


func _parse_base_url() -> Dictionary:
	var scheme := "https"
	var rest := base_url
	var scheme_sep := base_url.find("://")
	if scheme_sep >= 0:
		scheme = base_url.substr(0, scheme_sep)
		rest = base_url.substr(scheme_sep + 3)

	var slash := rest.find("/")
	if slash >= 0:
		rest = rest.substr(0, slash)

	var host := rest
	var port := 443 if scheme == "https" else 80
	var colon := rest.rfind(":")
	if colon > 0:
		host = rest.substr(0, colon)
		port = int(rest.substr(colon + 1))

	return { "scheme": scheme, "host": host, "port": port }


func _content_length_from_header(header_text: String) -> int:
	for line in header_text.split("\n", false):
		var clean := line.strip_edges()
		if clean.to_lower().begins_with("content-length:"):
			return int(clean.substr(clean.find(":") + 1).strip_edges())
	return -1


func _find_bytes(buffer: PackedByteArray, pattern: PackedByteArray, start: int) -> int:
	if pattern.is_empty() or buffer.size() < pattern.size():
		return -1

	var max_index := buffer.size() - pattern.size()
	for i in range(max(0, start), max_index + 1):
		var matched := true
		for j in range(pattern.size()):
			if buffer[i + j] != pattern[j]:
				matched = false
				break
		if matched:
			return i
	return -1
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `godot --headless --path /home/aby/Desktop/casino/slot/godot-client --script res://scripts/tests/test_cloud_stream_client.gd`

Expected: `ALL TESTS PASSED` printed, exit code 0. Verify exit code with `echo $?` immediately after.

- [ ] **Step 5: Commit**

```bash
cd /home/aby/Desktop/casino/slot
git add godot-client/scripts/cloud_stream_client.gd godot-client/scripts/tests/test_cloud_stream_client.gd
git commit -m "$(cat <<'EOF'
Add shared CloudStreamClient node for cloud-stream sessions

Extracts the MJPEG-over-HTTPClient decode logic and /cloud/start,
/cloud/input, /cloud/close handling into a standalone node so both the
desktop 3D lobby and the new mobile scene can share it instead of
duplicating it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U6oSYunGK1tHn5shbcZ83C
EOF
)"
```

---

### Task 5: Refactor `main.gd` to use `CloudStreamClient`

**Files:**
- Modify: `godot-client/scripts/main.gd`

**Interfaces:**
- Consumes: `CloudStreamClient` from Task 4 (`start_session`, `send_input`, `close_session`, `is_active`, signals `frame_received(image: Image)`, `status_changed(message: String)`, `session_started()`).
- No new interfaces produced — behavior must match the pre-refactor version exactly (same on-screen text, same controls: `E`/`G`/`Space`).

- [ ] **Step 1: Remove the now-duplicated variables**

In `godot-client/scripts/main.gd`, remove these lines (they move into `CloudStreamClient`):

```gdscript
var cloud_id := ""
var cloud_token := ""
var cloud_stream_client: HTTPClient
var cloud_stream_started := false
var cloud_stream_requested := false
var cloud_stream_buffer := PackedByteArray()
```

Keep `var cloud_stream_frame_count := 0` (still used for the on-screen "frames: N" throttle) and `var cloud_stream_status := "inactive"` can be removed too (unused after the refactor — nothing reads it).

Also remove:
```gdscript
var cloud_start_request: HTTPRequest
var cloud_input_request: HTTPRequest
```

Add in their place:
```gdscript
var stream_client: CloudStreamClient
```

- [ ] **Step 2: Wire up `stream_client` in `_ready()`**

Find:
```gdscript
func _ready() -> void:
	_load_player_profile()
	_build_base_scene()
	_build_overlay()
	_refresh_player_ui()
	_refresh_machine_ui()
	_load_remote_config()
	_connect_balance_socket()
```

Replace with:
```gdscript
func _ready() -> void:
	_load_player_profile()
	_build_base_scene()
	_build_overlay()
	_refresh_player_ui()
	_refresh_machine_ui()
	_load_remote_config()
	_connect_balance_socket()

	stream_client = CloudStreamClient.new()
	stream_client.name = "StreamClient"
	add_child(stream_client)
	stream_client.frame_received.connect(_on_stream_frame_received)
	stream_client.status_changed.connect(_on_stream_status_changed)
```

- [ ] **Step 3: Stop double-polling the stream in `_process`**

Find:
```gdscript
func _process(_delta: float) -> void:
	_poll_balance_socket()
	_poll_cloud_stream()
```

Replace with:
```gdscript
func _process(_delta: float) -> void:
	_poll_balance_socket()
```

(`CloudStreamClient` is a child `Node` and gets its own `_process` called automatically by the engine — no manual poll needed here.)

- [ ] **Step 4: Replace the cloud-start block in `_start_machine_game`**

Find:
```gdscript
	_stop_cloud_stream()
	cloud_id = ""
	cloud_token = ""
	cloud_stream_frame_count = 0
	cloud_stream_status = "starting"

	var mat_val: Variant = entry.get("screen_material")
	if mat_val is BaseMaterial3D:
		(mat_val as BaseMaterial3D).albedo_color = Color(0.12, 0.04, 0.20, 0.5)
		(mat_val as BaseMaterial3D).albedo_texture = null

	if cloud_start_request != null:
		cloud_start_request.queue_free()

	cloud_start_request = HTTPRequest.new()
	cloud_start_request.name = "CloudStartRequest"
	cloud_start_request.max_redirects = 0
	add_child(cloud_start_request)
	cloud_start_request.request_completed.connect(_on_cloud_start_response)

	var url := "%s/cloud/start?game=%s&sessionID=%s&width=%s&height=%s" % [
		_base_url(),
		game.uri_encode(),
		session_id.uri_encode(),
		machine_screen_width,
		machine_screen_height,
	]
	var err := cloud_start_request.request(url)
	if err != OK:
		_set_machine_screen_status(entry, "Cloud stream failed to start: %s" % error_string(err))
		set_status("Cloud stream request failed: %s" % error_string(err))
```

Replace with:
```gdscript
	cloud_stream_frame_count = 0

	var mat_val: Variant = entry.get("screen_material")
	if mat_val is BaseMaterial3D:
		(mat_val as BaseMaterial3D).albedo_color = Color(0.12, 0.04, 0.20, 0.5)
		(mat_val as BaseMaterial3D).albedo_texture = null

	stream_client.close_session()
	stream_client.start_session(_base_url(), game, session_id, machine_screen_width, machine_screen_height)
```

- [ ] **Step 5: Remove the functions that moved into `CloudStreamClient`**

Delete these functions entirely from `main.gd`: `_on_cloud_start_response`, `_start_cloud_stream`, `_poll_cloud_stream`, `_extract_cloud_frames`, `_send_cloud_input`, `_stop_cloud_stream`, `_header_value`, `_query_params`, `_parse_base_url`, `_content_length_from_header`, `_find_bytes`.

- [ ] **Step 6: Replace `_show_cloud_frame` with a signal handler that takes a decoded `Image`**

Find:
```gdscript
func _show_cloud_frame(frame: PackedByteArray) -> void:
	if active_machine_index < 0 or active_machine_index >= machines.size():
		return

	var entry: Dictionary = machines[active_machine_index]

	var image_val: Variant = entry.get("stream_image")
	if not image_val is Image:
		return
	var image := image_val as Image
	var err := image.load_jpg_from_buffer(frame)
	if err != OK:
		if cloud_stream_frame_count < 5:
			print("Cloud frame JPEG decode failed: %s (bytes=%s)" % [error_string(err), frame.size()])
		return

	var tex_val: Variant = entry.get("stream_texture")
```

Replace the whole function with:
```gdscript
func _on_stream_frame_received(image: Image) -> void:
	if active_machine_index < 0 or active_machine_index >= machines.size():
		return

	var entry: Dictionary = machines[active_machine_index]

	var tex_val: Variant = entry.get("stream_texture")
```

(Everything from `var tex_val: Variant = entry.get("stream_texture")` to the end of the original function stays exactly as-is — only the top of the function changes, since the image now arrives already-decoded instead of as raw JPEG bytes.)

Add right after it:
```gdscript
func _on_stream_status_changed(text: String) -> void:
	set_status(text)
```

- [ ] **Step 7: Update `_spin_active_machine`**

Find:
```gdscript
func _spin_active_machine() -> void:
	if active_machine_index < 0:
		if nearby_machine_index >= 0:
			_start_machine_game(nearby_machine_index)
		else:
			set_status("Spin icin once makineye yaklas")
		return

	if cloud_id.is_empty() or cloud_token.is_empty():
		set_status("Stream hazir degil; G ile makine ekranini baslat")
		return

	_send_cloud_input({ "type": "unitySpin", "bet": default_bet })
	_set_active_screen_status("Spin sent | bet: %s" % default_bet)
```

Replace with:
```gdscript
func _spin_active_machine() -> void:
	if active_machine_index < 0:
		if nearby_machine_index >= 0:
			_start_machine_game(nearby_machine_index)
		else:
			set_status("Spin icin once makineye yaklas")
		return

	if not stream_client.is_active():
		set_status("Stream hazir degil; G ile makine ekranini baslat")
		return

	stream_client.send_input({ "type": "unitySpin", "bet": default_bet })
	_set_active_screen_status("Spin sent | bet: %s" % default_bet)
```

- [ ] **Step 8: Confirm no dangling references remain**

```bash
grep -n "cloud_start_request\|cloud_input_request\|cloud_stream_client\b\|cloud_stream_buffer\|cloud_stream_requested\|cloud_stream_status\|_send_cloud_input\|_stop_cloud_stream\|_show_cloud_frame\b" /home/aby/Desktop/casino/slot/godot-client/scripts/main.gd
```

Expected: no output (nothing left referencing the removed names). If anything prints, fix that call site before continuing.

- [ ] **Step 9: Behavior-preserving smoke test against a live dev server**

Start a scratch server instance:
```bash
cd /home/aby/Desktop/casino/slot
PORT=3010 node server.js > /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/main-refactor-server.log 2>&1 &
echo $! > /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/main-refactor-server.pid
sleep 1
```

Run the desktop scene's existing autostart hook against it (the scene's `server_base` export defaults to production, so override it via the `--` CLI args Godot passes through as `OS.get_cmdline_user_args()`... actually simplest: temporarily point at the local server by editing nothing and instead running with the env var already supported):

```bash
CASINO_AUTOSTART_STREAM=1 timeout 30 godot --headless --path /home/aby/Desktop/casino/slot/godot-client --quit-after 200
```

Expected in stdout: the same log lines the scaffold already produced before this refactor — `"Loaded machine: ..."`, then (once the first machine's autostart kicks in) `"Cloud stream frame displayed: 1 (...)"` and `"Cloud stream frame displayed: 30 (...)"`. Since `server_base` still points at production (`https://casino.retailerway.com`, unchanged by this task), this smoke test exercises the real production `/cloud/*` endpoints — confirm frames are actually displayed, not just that requests were sent.

```bash
kill $(cat /tmp/claude-1000/-home-aby-Desktop-casino-slot/b0337f79-d165-4a9d-9fb1-f21e84337b22/scratchpad/main-refactor-server.pid) 2>/dev/null
```

(The local scratch server started above isn't actually used by this test since `server_base` defaults to production — it's fine to leave it running or kill it; kill it to avoid a stray process.)

- [ ] **Step 10: Commit**

```bash
cd /home/aby/Desktop/casino/slot
git add godot-client/scripts/main.gd
git commit -m "$(cat <<'EOF'
Refactor main.gd to use the shared CloudStreamClient

Removes the inline MJPEG/HTTPClient duplication now that
scripts/cloud_stream_client.gd exists. No behavioral change: same
controls (E/G/Space), same on-screen status text, same one-active-
machine-stream model.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U6oSYunGK1tHn5shbcZ83C
EOF
)"
```

---

### Task 6: Build the mobile scene (`mobile_main.tscn` / `mobile_main.gd`)

**Files:**
- Create: `godot-client/scenes/mobile_main.tscn`
- Create: `godot-client/scripts/mobile_main.gd`

**Interfaces:**
- Consumes: `CloudStreamClient` from Task 4 (same surface as Task 5).
- Produces: nothing consumed by later tasks except its scene path
  `res://scenes/mobile_main.tscn`, referenced by Task 7's project-setting override.

- [ ] **Step 1: Create the scene file**

Create `godot-client/scenes/mobile_main.tscn`:

```
[gd_scene load_steps=2 format=3 uid="uid://casino_godot_mobile"]

[ext_resource type="Script" path="res://scripts/mobile_main.gd" id="1_mobile"]

[node name="MobileMain" type="Control"]
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_mobile")
```

- [ ] **Step 2: Write the mobile script**

Create `godot-client/scripts/mobile_main.gd`:

```gdscript
extends Control

const PROFILE_PATH := "user://mobile_player.cfg"
const GAMES := [
	{ "id": "sugar-rush", "label": "Sugar Rush" },
]

@export var server_base := "https://casino.retailerway.com"
@export var stream_width := 720
@export var stream_height := 1280

var session_id := ""
var stream_client: CloudStreamClient
var active_game_id := ""

var list_view: VBoxContainer
var stream_view: Control
var stream_rect: TextureRect
var balance_label: Label
var status_label: Label

var websocket: WebSocketPeer = WebSocketPeer.new()
var websocket_started := false


func _ready() -> void:
	_load_or_create_session_id()

	anchor_right = 1.0
	anchor_bottom = 1.0

	stream_client = CloudStreamClient.new()
	stream_client.name = "StreamClient"
	add_child(stream_client)
	stream_client.frame_received.connect(_on_frame_received)
	stream_client.status_changed.connect(_on_status_changed)
	stream_client.session_started.connect(_on_session_started)

	_build_list_view()
	_build_stream_view()
	_show_list_view()
	_connect_balance_socket()

	if OS.get_environment("CASINO_MOBILE_AUTOSTART") == "1":
		call_deferred("_start_game", String(GAMES[0]["id"]))


func _process(_delta: float) -> void:
	_poll_balance_socket()


func _load_or_create_session_id() -> void:
	var config := ConfigFile.new()
	if config.load(PROFILE_PATH) == OK:
		session_id = String(config.get_value("player", "session_id", ""))
	if session_id.is_empty():
		session_id = "mobile-%s" % _random_hex(8)
		config.set_value("player", "session_id", session_id)
		var err := config.save(PROFILE_PATH)
		if err != OK:
			push_warning("Could not save mobile session id: %s" % error_string(err))


func _random_hex(length: int) -> String:
	var chars := "0123456789abcdef"
	var result := ""
	for i in range(length):
		result += chars[randi() % chars.length()]
	return result


func _build_list_view() -> void:
	list_view = VBoxContainer.new()
	list_view.name = "GameListView"
	list_view.anchor_right = 1.0
	list_view.anchor_bottom = 1.0
	list_view.alignment = BoxContainer.ALIGNMENT_CENTER
	list_view.add_theme_constant_override("separation", 24)
	add_child(list_view)

	var title := Label.new()
	title.text = "Retailerway Casino"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 32)
	list_view.add_child(title)

	for game in GAMES:
		var button := Button.new()
		button.text = String(game["label"])
		button.custom_minimum_size = Vector2(320, 96)
		button.add_theme_font_size_override("font_size", 24)
		button.pressed.connect(_start_game.bind(String(game["id"])))
		list_view.add_child(button)


func _build_stream_view() -> void:
	stream_view = Control.new()
	stream_view.name = "StreamView"
	stream_view.anchor_right = 1.0
	stream_view.anchor_bottom = 1.0
	add_child(stream_view)

	stream_rect = TextureRect.new()
	stream_rect.name = "StreamRect"
	stream_rect.anchor_right = 1.0
	stream_rect.anchor_bottom = 1.0
	stream_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	stream_rect.mouse_filter = Control.MOUSE_FILTER_STOP
	stream_rect.gui_input.connect(_on_stream_gui_input)
	stream_view.add_child(stream_rect)

	var back_button := Button.new()
	back_button.text = "< Lobi"
	back_button.position = Vector2(16, 16)
	back_button.custom_minimum_size = Vector2(120, 56)
	back_button.pressed.connect(_return_to_list)
	stream_view.add_child(back_button)

	balance_label = Label.new()
	balance_label.text = "Balance: connecting..."
	balance_label.position = Vector2(16, 80)
	balance_label.add_theme_font_size_override("font_size", 18)
	stream_view.add_child(balance_label)

	status_label = Label.new()
	status_label.text = ""
	status_label.anchor_left = 0.5
	status_label.anchor_right = 0.5
	status_label.anchor_top = 1.0
	status_label.anchor_bottom = 1.0
	status_label.offset_top = -64
	status_label.offset_bottom = -16
	status_label.offset_left = -240
	status_label.offset_right = 240
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stream_view.add_child(status_label)


func _show_list_view() -> void:
	list_view.visible = true
	stream_view.visible = false


func _show_stream_view() -> void:
	list_view.visible = false
	stream_view.visible = true


func _start_game(game_id: String) -> void:
	active_game_id = game_id
	_show_stream_view()
	status_label.text = "Starting %s..." % game_id
	stream_client.start_session(server_base, game_id, session_id, stream_width, stream_height)


func _return_to_list() -> void:
	stream_client.close_session()
	active_game_id = ""
	stream_rect.texture = null
	_show_list_view()


func _on_session_started() -> void:
	status_label.text = ""


func _on_status_changed(text: String) -> void:
	status_label.text = text


func _on_frame_received(image: Image) -> void:
	var texture := stream_rect.texture
	if texture is ImageTexture and (texture as ImageTexture).get_size() == image.get_size():
		(texture as ImageTexture).update(image)
	else:
		stream_rect.texture = ImageTexture.create_from_image(image)


func _on_stream_gui_input(event: InputEvent) -> void:
	if not stream_client.is_active():
		return

	if event is InputEventScreenTouch and event.pressed:
		_send_tap(event.position)
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_send_tap(event.position)


func _send_tap(local_position: Vector2) -> void:
	var texture := stream_rect.texture
	if texture == null:
		return

	var rect_size := stream_rect.size
	var natural_size := texture.get_size()
	if natural_size.x <= 0 or natural_size.y <= 0 or rect_size.x <= 0 or rect_size.y <= 0:
		return

	var scale: float = min(rect_size.x / natural_size.x, rect_size.y / natural_size.y)
	var draw_size := natural_size * scale
	var offset := (rect_size - draw_size) * 0.5

	var stream_x: float = clamp((local_position.x - offset.x) / scale, 0.0, natural_size.x)
	var stream_y: float = clamp((local_position.y - offset.y) / scale, 0.0, natural_size.y)
	stream_client.send_click(stream_x, stream_y)


func _connect_balance_socket() -> void:
	websocket = WebSocketPeer.new()
	var socket_url := server_base.replace("https://", "wss://").replace("http://", "ws://")
	socket_url += "/?game=balance&sessionID=%s" % session_id.uri_encode()

	var err := websocket.connect_to_url(socket_url)
	if err != OK:
		balance_label.text = "Balance: socket failed (%s)" % error_string(err)
		return

	websocket_started = true


func _poll_balance_socket() -> void:
	if not websocket_started:
		return

	websocket.poll()
	while websocket.get_available_packet_count() > 0:
		var payload := websocket.get_packet().get_string_from_utf8()
		var message: Variant = JSON.parse_string(payload)
		if typeof(message) == TYPE_DICTIONARY and message.has("balance"):
			balance_label.text = "Balance: %s" % str(message["balance"])

	if websocket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		websocket_started = false
```

- [ ] **Step 3: Headless smoke test against production**

```bash
CASINO_MOBILE_AUTOSTART=1 timeout 30 godot --headless --path /home/aby/Desktop/casino/slot/godot-client scenes/mobile_main.tscn --quit-after 200
```

Expected in stdout: no `SCRIPT ERROR` lines. Since there's no `print()` for received frames in this script yet, confirm success by adding a temporary `print("frame %s" % image.get_size())` at the top of `_on_frame_received` before running, seeing frame-size lines print, then removing that temporary print line before committing.

- [ ] **Step 4: Verify the session id persists across runs**

```bash
rm -f "/home/aby/.local/share/godot/app_userdata/Casino Godot Client/mobile_player.cfg"
CASINO_MOBILE_AUTOSTART=1 timeout 5 godot --headless --path /home/aby/Desktop/casino/slot/godot-client scenes/mobile_main.tscn --quit-after 30
cat "/home/aby/.local/share/godot/app_userdata/Casino Godot Client/mobile_player.cfg"
```

Expected: a `[player]` section with `session_id="mobile-<8 hex chars>"`. Run the same `godot --headless ...` command a second time and confirm the file's `session_id` value is unchanged (proves persistence works, not just generation).

- [ ] **Step 5: Commit**

```bash
cd /home/aby/Desktop/casino/slot
git add godot-client/scenes/mobile_main.tscn godot-client/scripts/mobile_main.gd
git commit -m "$(cat <<'EOF'
Add mobile game-list + fullscreen stream scene

Simple mobile mode: tap a game, play it fullscreen via the existing
cloud stream, with touch taps forwarded as scaled clicks (so the
game's own Play/Spin/bet buttons, already rendered inside the video
frame, become tappable), a back button, and a live balance label.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U6oSYunGK1tHn5shbcZ83C
EOF
)"
```

---

### Task 7: Android export preset + main-scene override

**Files:**
- Modify: `godot-client/project.godot` (tracked in git)
- Create: `godot-client/export_presets.cfg` (gitignored — never committed)

**Interfaces:** None (pure configuration).

- [ ] **Step 1: Override the main scene for Android only**

In `godot-client/project.godot`, in the `[application]` section, find:
```
run/main_scene="res://scenes/main.tscn"
```

Add immediately after it:
```
run/main_scene.android="res://scenes/mobile_main.tscn"
```

This uses Godot's built-in per-feature-tag setting override syntax (`setting.feature=value`), active only when the `android` feature tag is present — i.e. only in the exported Android build, never in the editor or a desktop export.

- [ ] **Step 2: Verify the override doesn't affect desktop**

```bash
grep -n "run/main_scene" /home/aby/Desktop/casino/slot/godot-client/project.godot
timeout 10 godot --headless --path /home/aby/Desktop/casino/slot/godot-client --quit-after 3
```

Expected: `grep` shows both lines; the headless run still prints the desktop 3D lobby's own startup lines (e.g. `"Spawned player at ..."`), proving the override doesn't leak into the default (non-Android) run.

- [ ] **Step 3: Create the export preset**

Create `godot-client/export_presets.cfg`:

```ini
[preset.0]

name="Android"
platform="Android"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="export/casino-mobile.apk"
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false
seed=0
script_export_mode=1

[preset.0.options]

custom_template/debug=""
custom_template/release=""
gradle_build/use_gradle_build=false
gradle_build/gradle_build_directory=""
gradle_build/android_source_template=""
gradle_build/compress_native_libraries=false
gradle_build/min_sdk=""
gradle_build/target_sdk=""
version/code=1
version/name="1.0"
package/unique_name="com.retailerway.casinomobile"
package/name="Casino Mobile"
package/signed=true
package/retain_data_on_uninstall=false
package/exclude_from_recents=false
package/show_in_android_tv=false
package/show_in_app_library=true
package/show_as_launcher_app=true
screen/immersive_mode=true
screen/support_small=true
screen/support_normal=true
screen/support_large=true
screen/support_xlarge=true
user_data_backup/allow=false
command_line/extra_args=""
permissions/internet=true
permissions/access_network_state=true
architectures/armeabi-v7a=false
architectures/arm64-v8a=true
architectures/x86=false
architectures/x86_64=false
keystore/debug="/home/aby/.local/share/godot/keystores/debug.keystore"
keystore/debug_user="androiddebugkey"
keystore/debug_password="android"
keystore/release=""
keystore/release_user=""
keystore/release_password=""
one_click_deploy/clear_previous_install=false
```

- [ ] **Step 4: Confirm it's ignored by git**

```bash
cd /home/aby/Desktop/casino/slot
git status --short godot-client/export_presets.cfg
```

Expected: no output (already covered by the `.gitignore` entry from Task 1 — confirms it will never be committed).

---

### Task 8: Export the debug APK and hand it off

**Files:** none modified — this task only produces a build artifact at `godot-client/export/casino-mobile.apk` (gitignored, not committed).

**Interfaces:** None.

- [ ] **Step 1: Run the export**

```bash
mkdir -p /home/aby/Desktop/casino/slot/godot-client/export
cd /home/aby/Desktop/casino/slot/godot-client
godot --headless --export-debug "Android" export/casino-mobile.apk
```

Expected: Godot prints template/keystore/SDK resolution lines and finishes without an `ERROR:` line. If it errors on a specific unrecognized or invalid key in `export_presets.cfg` (Godot names the offending key in the error text), remove or correct just that one `key=value` line in `[preset.0.options]` and re-run this exact command — Godot fills any remaining missing preset options with its own built-in platform defaults, so a smaller options block than Step 3 above is safe.

- [ ] **Step 2: Verify the APK was produced**

```bash
ls -la /home/aby/Desktop/casino/slot/godot-client/export/casino-mobile.apk
file /home/aby/Desktop/casino/slot/godot-client/export/casino-mobile.apk
```

Expected: the file exists (tens of MB); `file` reports it as a Zip/Java archive (`Android package (APK)` or `Zip archive data`).

- [ ] **Step 3: Sanity-check the APK's manifest with the local SDK tools**

```bash
~/android-tools/sdk/build-tools/35.0.1/aapt2 dump badging /home/aby/Desktop/casino/slot/godot-client/export/casino-mobile.apk | head -20
```

Expected: prints `package: name='com.retailerway.casinomobile' ...` and lists `uses-permission: name='android.permission.INTERNET'` — confirms the package name and internet permission from Task 7's preset made it into the built manifest.

- [ ] **Step 4: Hand the APK to the user**

Use the `SendUserFile` tool with `files: ["/home/aby/Desktop/casino/slot/godot-client/export/casino-mobile.apk"]`, `status: "proactive"`, and a caption explaining it's a debug build to sideload (enable "Install from unknown sources" for the file manager/browser used to open it, since it isn't Play-Store-signed).
