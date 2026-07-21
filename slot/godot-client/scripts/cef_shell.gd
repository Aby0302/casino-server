extends Control

@export var server_base := "https://casino.retailerway.com"
@export var session_id := "godot-player"
@export var client_render_secret := ""

const PROFILE_PATH := "user://player.cfg"

var status_label: Label
var retry_button: Button
var browser: Control
var player_name := "Godot Player"


func _ready() -> void:
    _load_player_profile()
    _apply_runtime_overrides()
    if DisplayServer.get_name() == "headless":
        print("Headless check: skipping CEF browser startup")
        return
    _open_remote_lobby()


func _open_remote_lobby() -> void:
    if browser != null:
        browser.queue_free()
        browser = null

    if not ClassDB.class_exists("CefTexture"):
        _show_missing_cef()
        return

    var browser_obj: Object = ClassDB.instantiate("CefTexture")
    if browser_obj == null or not browser_obj is Control:
        _show_error("CEF addon loaded, but CefTexture could not be created.")
        return

    browser = browser_obj as Control
    browser.name = "RemoteLobbyBrowser"
    browser.set_anchors_preset(Control.PRESET_FULL_RECT)
    browser.offset_left = 0.0
    browser.offset_top = 0.0
    browser.offset_right = 0.0
    browser.offset_bottom = 0.0

    browser_obj.set("enable_accelerated_osr", true)
    browser_obj.set("background_color", Color(0.02, 0.02, 0.04, 1.0))
    browser_obj.set("popup_policy", 1)
    browser_obj.set("url", _remote_lobby_url())
    if browser_obj.has_signal("ipc_message"):
        browser_obj.connect("ipc_message", Callable(self, "_on_browser_ipc_message"))

    add_child(browser)
    print("Remote CEF lobby: %s" % _redacted_lobby_url())


func _show_missing_cef() -> void:
    _show_error("Godot CEF addon is required for thin shell mode. Install dsh0416/godot-cef under res://addons/godot_cef/ and restart.")


func _show_error(message: String) -> void:
    for child in get_children():
        child.queue_free()

    var background := ColorRect.new()
    background.color = Color(0.025, 0.02, 0.045, 1.0)
    background.set_anchors_preset(Control.PRESET_FULL_RECT)
    add_child(background)

    var panel := VBoxContainer.new()
    panel.set_anchors_preset(Control.PRESET_CENTER)
    panel.custom_minimum_size = Vector2(720, 220)
    panel.offset_left = -360.0
    panel.offset_top = -110.0
    panel.offset_right = 360.0
    panel.offset_bottom = 110.0
    panel.alignment = BoxContainer.ALIGNMENT_CENTER
    panel.add_theme_constant_override("separation", 14)
    add_child(panel)

    var title := Label.new()
    title.text = "Retailerway Casino Shell"
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    title.add_theme_font_size_override("font_size", 34)
    panel.add_child(title)

    status_label = Label.new()
    status_label.text = message
    status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    status_label.add_theme_font_size_override("font_size", 18)
    panel.add_child(status_label)

    retry_button = Button.new()
    retry_button.text = "Retry"
    retry_button.pressed.connect(_open_remote_lobby)
    panel.add_child(retry_button)


func _remote_lobby_url() -> String:
    var url := "%s/client/lobby?sessionID=%s" % [
        _base_url(),
        session_id.uri_encode(),
    ]
    var secret := _client_render_secret()
    if not secret.is_empty():
        url += "&clientSecret=%s" % secret.uri_encode()
    return url


func _redacted_lobby_url() -> String:
    var url := _remote_lobby_url()
    var secret_start := url.find("&clientSecret=")
    if secret_start < 0:
        return url
    return url.substr(0, secret_start) + "&clientSecret=<redacted>"


func _base_url() -> String:
    return server_base.strip_edges().trim_suffix("/")


func _client_render_secret() -> String:
    var env_secret := OS.get_environment("CASINO_CLIENT_RENDER_SECRET").strip_edges()
    if not env_secret.is_empty():
        return env_secret
    return client_render_secret.strip_edges()


func _load_player_profile() -> void:
    var config := ConfigFile.new()
    if config.load(PROFILE_PATH) == OK:
        session_id = String(config.get_value("player", "id", session_id))
        player_name = String(config.get_value("player", "name", player_name))


func _save_player_profile() -> void:
    var config := ConfigFile.new()
    config.set_value("player", "id", session_id)
    config.set_value("player", "name", player_name)
    var err := config.save(PROFILE_PATH)
    if err != OK:
        push_warning("Could not save player profile: %s" % error_string(err))


func _apply_runtime_overrides() -> void:
    var env_base := OS.get_environment("CASINO_SERVER_BASE").strip_edges()
    if not env_base.is_empty():
        server_base = env_base

    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--server-base="):
            server_base = arg.substr("--server-base=".length()).strip_edges()
        elif arg.begins_with("--session-id="):
            session_id = _sanitize_session_id(arg.substr("--session-id=".length()))
        elif arg.begins_with("--client-render-secret="):
            client_render_secret = arg.substr("--client-render-secret=".length()).strip_edges()


func _on_browser_ipc_message(message: String) -> void:
    var parsed: Variant = JSON.parse_string(message)
    if typeof(parsed) != TYPE_DICTIONARY:
        return

    var payload: Dictionary = parsed
    if String(payload.get("type", "")) != "setPlayer":
        return

    var next_id := _sanitize_session_id(String(payload.get("id", "")))
    if next_id.is_empty():
        return

    session_id = next_id
    player_name = String(payload.get("name", next_id)).strip_edges()
    if player_name.is_empty():
        player_name = next_id
    _save_player_profile()


func _sanitize_session_id(value: String) -> String:
    var clean := ""
    for i in range(value.length()):
        var c := value.substr(i, 1)
        if (c >= "a" and c <= "z") or (c >= "A" and c <= "Z") or (c >= "0" and c <= "9") or c in ["_", ".", ":", "-"]:
            clean += c
    return clean.left(128)
