extends Node3D

@export var server_base := "https://casino.retailerway.com"
@export var session_id := "godot-player"
@export var move_speed := 120.0
@export var gravity := 980.0
@export var mouse_sensitivity := 0.0025
@export var player_radius := 28.0
@export var player_height := 120.0
@export var player_eye_height := 70.0
@export var floor_probe_up := 90.0
@export var floor_probe_down := 900.0
@export var floor_snap_offset := 2.0
@export var fall_recovery_distance := 180.0
@export var enable_map_collision := true
@export var enable_machine_collision := true
@export var prefer_local_assets := true
@export var machine_screen_width := 640
@export var machine_screen_height := 360
@export var screen_size_multiplier := 1.0
@export var default_bet := 100
@export var prefer_client_render := true
@export var client_render_secret := ""
@export var enable_client_render_accelerated_osr := false

const PROFILE_PATH := "user://player.cfg"
const MACHINE_CONTROL_LAYER := 4
const MACHINE_CONTROL_RAY_DISTANCE := 260.0
const UI_TEXT := Color(0.98, 0.96, 0.88, 1.0)
const UI_MUTED := Color(0.72, 0.68, 0.82, 0.92)
const UI_PANEL := Color(0.035, 0.022, 0.060, 0.88)
const UI_PANEL_STRONG := Color(0.060, 0.032, 0.095, 0.94)
const UI_GOLD := Color(1.0, 0.710, 0.230, 1.0)
const UI_PINK := Color(0.980, 0.180, 0.470, 1.0)
const UI_CYAN := Color(0.250, 0.850, 1.0, 1.0)
const TELEPORT_COOLDOWN_MS := 1200

var config_request: HTTPRequest
var map_request: HTTPRequest
var auth_request: HTTPRequest
var cloud_start_request: HTTPRequest
var cloud_input_request: HTTPRequest
var cloud_frame_request: HTTPRequest
var player_body: CharacterBody3D
var camera: Camera3D
var world_root: Node3D
var machine_root: Node3D
var status_label: Label
var balance_label: Label
var player_label: Label
var machine_label: Label
var prompt_label: Label
var auth_result_label: Label
var auth_login_mode_button: Button
var auth_register_mode_button: Button
var auth_identifier_edit: LineEdit
var auth_username_edit: LineEdit
var auth_email_edit: LineEdit
var auth_password_edit: LineEdit
var auth_submit_button: Button
var open_game_button: Button
var config_websocket: WebSocketPeer = WebSocketPeer.new()
var config_websocket_started := false
var websocket: WebSocketPeer = WebSocketPeer.new()
var websocket_started := false
var websocket_last_state := WebSocketPeer.STATE_CLOSED
var player_id := "godot-player"
var player_name := "Godot Player"
var player_email := ""
var auth_cookie := ""
var authenticated := false
var auth_mode := "login"
var pending_auth_action := ""
var machines: Array = []
var nearby_machine_index := -1
var map_collider_count := 0
var machine_collider_count := 0
var world_colliders_ready := false
var pending_eye_position := Vector3.ZERO
var pending_look_at := Vector3.FORWARD
var has_pending_pose := false
var last_safe_body_position := Vector3.ZERO
var has_safe_body_position := false
var active_machine_index := -1
var cloud_id := ""
var cloud_token := ""
var cloud_stream_client: HTTPClient
var cloud_stream_started := false
var cloud_stream_requested := false
var cloud_stream_buffer := PackedByteArray()
var cloud_stream_frame_count := 0
var cloud_stream_status := "inactive"
var cloud_frame_error_count := 0
var pending_spin_after_stream := false
var _mobile_controls_node: CanvasLayer
var _touch_move_x := 0.0
var _touch_move_y := 0.0
var _touch_look_dx := 0.0
var _touch_look_dy := 0.0
var hot_reload_in_progress := false
var _hot_reload_target_machines := 0
var teleports: Array = []
var active_teleport_id := ""
var last_teleport_time_ms := 0
var _screen_state := "auth"
var _auth_screen_layer: CanvasLayer
var _loading_screen_layer: CanvasLayer
var _loading_progress_bar: ProgressBar
var _loading_status_label: Label
var _loading_progress := 0.0
var _expected_machine_count := 0
var _loaded_machine_count := 0
var _game_started := false
var hot_reload_file: FileAccess


func _ready() -> void:
    _load_player_profile()
    _setup_mobile_controls()

    var hot_reload_file := FileAccess.open("user://.hotreload", FileAccess.READ)
    var has_hot_reload := hot_reload_file != null
    if hot_reload_file:
        hot_reload_file.close()

    if has_hot_reload:
        _build_base_scene()
        _game_started = true
        _screen_state = "game"
        _build_game_overlay()
        _refresh_player_ui()
        _refresh_machine_ui()
        _load_remote_config()
        _connect_config_socket()
        _reconnect_balance_socket()
        _check_hot_reload_state()
        set_status("Hot reload complete")
        return

    _show_auth_screen()
    if not auth_cookie.is_empty():
        _check_auth_session()


func _process(_delta: float) -> void:
    _poll_config_socket()
    if _screen_state == "game":
        _poll_balance_socket()
        _poll_cloud_stream()


func _poll_config_socket() -> void:
    if not config_websocket_started:
        return

    config_websocket.poll()

    while config_websocket.get_available_packet_count() > 0:
        var payload := config_websocket.get_packet().get_string_from_utf8()
        var message: Variant = JSON.parse_string(payload)
        if typeof(message) == TYPE_DICTIONARY:
            if message.get("type") == "config:updated" and not hot_reload_in_progress:
                hot_reload_in_progress = true
                _hot_reload_config()

    if config_websocket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
        config_websocket_started = false


func _poll_balance_socket() -> void:
    if not websocket_started:
        return

    websocket.poll()

    while websocket.get_available_packet_count() > 0:
        var payload := websocket.get_packet().get_string_from_utf8()
        var message: Variant = JSON.parse_string(payload)
        if typeof(message) == TYPE_DICTIONARY:
            if message.has("balance"):
                balance_label.text = "Bakiye: %s" % str(message["balance"])
            if message.get("type") == "config:updated" and not hot_reload_in_progress:
                hot_reload_in_progress = true
                _hot_reload_config()

    var state := websocket.get_ready_state()
    if state != websocket_last_state:
        websocket_last_state = state
        _update_socket_status(state)

    if state == WebSocketPeer.STATE_CLOSED:
        websocket_started = false
        set_status("Bakiye baglantisi kapandi")


func _physics_process(delta: float) -> void:
    if player_body == null or _screen_state != "game":
        return

    var direction := _movement_direction()
    var velocity := player_body.velocity
    if not player_body.is_on_floor():
        velocity.y -= gravity * delta
    velocity.x = direction.x * move_speed
    velocity.z = direction.z * move_speed
    player_body.velocity = velocity
    player_body.move_and_slide()
    _keep_player_on_floor()
    _check_teleports()

    _update_interaction_prompt()


func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
        var mouse_event := event as InputEventMouseButton
        var pointer_pos: Vector2 = mouse_event.position
        if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
            pointer_pos = get_viewport().get_visible_rect().size * 0.5
        if _try_activate_machine_control(pointer_pos):
            return
        Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)

    if event is InputEventKey and event.pressed and not event.echo:
        var key_event := event as InputEventKey
        if key_event.keycode == KEY_ESCAPE:
            Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
        elif key_event.keycode == KEY_E:
            _sit_at_nearby_machine()
        elif key_event.keycode == KEY_G:
            _open_nearby_game()
        elif key_event.keycode == KEY_R and key_event.ctrl_pressed:
            _hot_restart()
        elif key_event.keycode == KEY_SPACE:
            _spin_active_machine()

    if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
        if player_body != null:
            player_body.rotate_y(-event.relative.x * mouse_sensitivity)
        if camera != null:
            camera.rotation.x = clamp(
                camera.rotation.x - event.relative.y * mouse_sensitivity,
                deg_to_rad(-75.0),
                deg_to_rad(75.0)
            )

    if _touch_look_dx != 0.0 or _touch_look_dy != 0.0:
        if player_body != null:
            player_body.rotate_y(-_touch_look_dx * mouse_sensitivity * 60.0)
        if camera != null:
            camera.rotation.x = clamp(
                camera.rotation.x - _touch_look_dy * mouse_sensitivity * 60.0,
                deg_to_rad(-75.0),
                deg_to_rad(75.0)
            )
        _touch_look_dx = 0.0
        _touch_look_dy = 0.0


func _movement_direction() -> Vector3:
    var input_vector := Vector2.ZERO
    if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
        input_vector.y -= 1.0
    if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
        input_vector.y += 1.0
    if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
        input_vector.x += 1.0
    if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
        input_vector.x -= 1.0

    if _touch_move_x != 0.0 or _touch_move_y != 0.0:
        input_vector = Vector2(_touch_move_x, _touch_move_y)

    if input_vector.length_squared() <= 0.0:
        return Vector3.ZERO

    input_vector = input_vector.normalized()
    var forward := -player_body.global_transform.basis.z
    forward.y = 0.0
    forward = forward.normalized()

    var right := player_body.global_transform.basis.x
    right.y = 0.0
    right = right.normalized()

    return (right * input_vector.x) + (forward * -input_vector.y)


func _build_base_scene() -> void:
    world_root = Node3D.new()
    world_root.name = "World"
    add_child(world_root)

    machine_root = Node3D.new()
    machine_root.name = "Machines"
    add_child(machine_root)

    player_body = CharacterBody3D.new()
    player_body.name = "PlayerBody"
    player_body.collision_layer = 2
    player_body.collision_mask = 1
    player_body.up_direction = Vector3.UP
    player_body.floor_stop_on_slope = true
    player_body.floor_max_angle = deg_to_rad(50.0)
    player_body.safe_margin = 1.0
    add_child(player_body)

    var capsule := CapsuleShape3D.new()
    capsule.radius = player_radius
    capsule.height = player_height

    var player_collision := CollisionShape3D.new()
    player_collision.name = "PlayerCollision"
    player_collision.position = Vector3(0.0, player_height * 0.5, 0.0)
    player_collision.shape = capsule
    player_body.add_child(player_collision)

    camera = Camera3D.new()
    camera.name = "Camera"
    camera.current = true
    camera.far = 10000.0
    camera.position = Vector3(0.0, player_eye_height, 0.0)
    player_body.add_child(camera)

    var env := WorldEnvironment.new()
    env.name = "WorldEnvironment"
    env.environment = Environment.new()
    env.environment.ambient_light_color = Color(0.25, 0.22, 0.20)
    env.environment.ambient_light_energy = 1.5
    add_child(env)

    var sun := DirectionalLight3D.new()
    sun.name = "Sun"
    sun.light_energy = 3.0
    sun.shadow_enabled = true
    sun.rotation_degrees = Vector3(-55.0, -30.0, 0.0)
    add_child(sun)

    var fill := DirectionalLight3D.new()
    fill.name = "FillLight"
    fill.light_energy = 0.6
    fill.rotation_degrees = Vector3(20.0, 150.0, 0.0)
    add_child(fill)


func _build_game_overlay() -> void:
    var canvas := CanvasLayer.new()
    canvas.name = "Overlay"
    canvas.layer = 1
    add_child(canvas)

    _build_screen_vignette(canvas)
    _build_hud(canvas)
    _build_prompt_panel(canvas)
    _build_crosshair(canvas)


func _build_screen_vignette(canvas: CanvasLayer) -> void:
    var vignette := ColorRect.new()
    vignette.name = "ScreenVignette"
    vignette.color = Color(0.030, 0.006, 0.055, 0.16)
    vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _set_control_full_rect(vignette)
    canvas.add_child(vignette)


func _panel_style(bg: Color, border: Color, radius: int = 22, shadow_size: int = 16, margin: float = 18.0) -> StyleBoxFlat:
    var style := StyleBoxFlat.new()
    style.bg_color = bg
    style.border_color = border
    style.set_border_width_all(1)
    style.set_corner_radius_all(radius)
    style.shadow_color = Color(0.0, 0.0, 0.0, 0.36)
    style.shadow_size = shadow_size
    style.shadow_offset = Vector2(0.0, 8.0)
    style.set_content_margin(SIDE_LEFT, margin)
    style.set_content_margin(SIDE_TOP, margin)
    style.set_content_margin(SIDE_RIGHT, margin)
    style.set_content_margin(SIDE_BOTTOM, margin)
    return style


func _button_style(bg: Color, border: Color, radius: int = 14) -> StyleBoxFlat:
    return _panel_style(bg, border, radius, 0, 12.0)


func _input_style(focused: bool) -> StyleBoxFlat:
    var border := UI_GOLD if focused else Color(1.0, 1.0, 1.0, 0.12)
    return _panel_style(Color(0.020, 0.014, 0.036, 0.88), border, 12, 0, 10.0)


func _style_label(label: Label, size: int, color: Color) -> void:
    label.add_theme_font_size_override("font_size", size)
    label.add_theme_color_override("font_color", color)


func _style_button(button: Button, accent: Color) -> void:
    button.custom_minimum_size.y = 44.0
    button.focus_mode = Control.FOCUS_NONE
    button.add_theme_font_size_override("font_size", 15)
    button.add_theme_color_override("font_color", UI_TEXT)
    button.add_theme_color_override("font_hover_color", Color.WHITE)
    button.add_theme_color_override("font_pressed_color", Color.WHITE)
    button.add_theme_color_override("font_disabled_color", Color(1.0, 1.0, 1.0, 0.34))
    button.add_theme_stylebox_override("normal", _button_style(accent.darkened(0.42), accent.darkened(0.08)))
    button.add_theme_stylebox_override("hover", _button_style(accent.darkened(0.24), accent.lightened(0.16)))
    button.add_theme_stylebox_override("pressed", _button_style(accent.darkened(0.10), Color.WHITE))
    button.add_theme_stylebox_override("disabled", _button_style(Color(0.12, 0.10, 0.16, 0.58), Color(1.0, 1.0, 1.0, 0.08)))


func _style_line_edit(edit: LineEdit) -> void:
    edit.custom_minimum_size.y = 42.0
    edit.add_theme_font_size_override("font_size", 15)
    edit.add_theme_color_override("font_color", UI_TEXT)
    edit.add_theme_color_override("font_placeholder_color", UI_MUTED)
    edit.add_theme_color_override("caret_color", UI_GOLD)
    edit.add_theme_stylebox_override("normal", _input_style(false))
    edit.add_theme_stylebox_override("focus", _input_style(true))


func _build_hud(canvas: CanvasLayer) -> void:
    var panel := PanelContainer.new()
    panel.name = "HudPanel"
    panel.anchor_left = 0.0
    panel.anchor_top = 0.0
    panel.anchor_right = 0.0
    panel.anchor_bottom = 0.0
    panel.offset_left = 18.0
    panel.offset_top = 18.0
    panel.offset_right = 590.0
    panel.offset_bottom = 250.0
    panel.add_theme_stylebox_override("panel", _panel_style(UI_PANEL_STRONG, Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.34), 24, 22, 20.0))
    canvas.add_child(panel)

    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 8)
    panel.add_child(box)

    var eyebrow := Label.new()
    eyebrow.text = "CANLI CASINO KATI"
    _style_label(eyebrow, 12, UI_GOLD)
    box.add_child(eyebrow)

    var title := Label.new()
    title.text = "Retailerway Casino"
    _style_label(title, 29, UI_TEXT)
    box.add_child(title)

    var subtitle := Label.new()
    subtitle.text = "3D slot salonu - makinaya yaklas, ekrani ac, spin at."
    subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    _style_label(subtitle, 14, UI_MUTED)
    box.add_child(subtitle)

    var stats := HBoxContainer.new()
    stats.add_theme_constant_override("separation", 18)
    box.add_child(stats)

    player_label = Label.new()
    _style_label(player_label, 15, UI_CYAN)
    stats.add_child(player_label)

    balance_label = Label.new()
    balance_label.text = "Bakiye: baglaniyor..."
    _style_label(balance_label, 15, UI_GOLD)
    stats.add_child(balance_label)

    machine_label = Label.new()
    machine_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    _style_label(machine_label, 13, UI_MUTED)
    box.add_child(machine_label)

    var status_card := PanelContainer.new()
    status_card.add_theme_stylebox_override("panel", _panel_style(Color(0.014, 0.012, 0.026, 0.78), Color(UI_CYAN.r, UI_CYAN.g, UI_CYAN.b, 0.28), 14, 0, 12.0))
    box.add_child(status_card)

    status_label = Label.new()
    status_label.text = "Godot casino istemcisi baslatiliyor..."
    status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    _style_label(status_label, 13, UI_TEXT)
    status_card.add_child(status_label)

    var help := Label.new()
    help.text = "WASD/Oklar hareket | Fare bakis | E otur | G ekran | Space/makine dugmesi spin | Ctrl+R yenile | Admin panelde kayit -> tum cihazlarda canli guncelleme"
    help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    _style_label(help, 12, Color(1.0, 1.0, 1.0, 0.56))
    box.add_child(help)

    open_game_button = Button.new()
    open_game_button.text = "Yakindaki Makineyi Ac"
    open_game_button.disabled = true
    open_game_button.pressed.connect(_open_nearby_game)
    open_game_button.custom_minimum_size.x = 260
    _style_button(open_game_button, UI_GOLD)
    box.add_child(open_game_button)


func _build_registration_panel(canvas: CanvasLayer) -> void:
    var panel := PanelContainer.new()
    panel.name = "AuthPanel"
    panel.anchor_left = 1.0
    panel.anchor_right = 1.0
    panel.offset_left = -398.0
    panel.offset_right = -18.0
    panel.offset_top = 18.0
    panel.offset_bottom = 418.0
    panel.add_theme_stylebox_override("panel", _panel_style(UI_PANEL, Color(UI_PINK.r, UI_PINK.g, UI_PINK.b, 0.30), 24, 22, 20.0))
    canvas.add_child(panel)

    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 10)
    panel.add_child(box)

    var eyebrow := Label.new()
    eyebrow.text = "OYUNCU PROFILI"
    _style_label(eyebrow, 12, UI_PINK)
    box.add_child(eyebrow)

    var title := Label.new()
    title.text = "Hesap Girisi"
    _style_label(title, 23, UI_TEXT)
    box.add_child(title)

    var modes := HBoxContainer.new()
    modes.add_theme_constant_override("separation", 8)
    box.add_child(modes)

    auth_login_mode_button = Button.new()
    auth_login_mode_button.text = "Giris"
    auth_login_mode_button.pressed.connect(func() -> void: _set_auth_mode("login"))
    _style_button(auth_login_mode_button, UI_CYAN)
    modes.add_child(auth_login_mode_button)

    auth_register_mode_button = Button.new()
    auth_register_mode_button.text = "Kayit"
    auth_register_mode_button.pressed.connect(func() -> void: _set_auth_mode("register"))
    _style_button(auth_register_mode_button, UI_PINK)
    modes.add_child(auth_register_mode_button)

    auth_identifier_edit = LineEdit.new()
    auth_identifier_edit.placeholder_text = "Email veya kullanici adi"
    auth_identifier_edit.text = player_email if not player_email.is_empty() else player_id
    _style_line_edit(auth_identifier_edit)
    box.add_child(auth_identifier_edit)

    auth_username_edit = LineEdit.new()
    auth_username_edit.placeholder_text = "Kullanici adi"
    auth_username_edit.text = player_id
    _style_line_edit(auth_username_edit)
    box.add_child(auth_username_edit)

    auth_email_edit = LineEdit.new()
    auth_email_edit.placeholder_text = "Email"
    auth_email_edit.text = player_email
    _style_line_edit(auth_email_edit)
    box.add_child(auth_email_edit)

    auth_password_edit = LineEdit.new()
    auth_password_edit.placeholder_text = "Sifre"
    auth_password_edit.secret = true
    _style_line_edit(auth_password_edit)
    box.add_child(auth_password_edit)

    auth_submit_button = Button.new()
    auth_submit_button.pressed.connect(_submit_auth)
    _style_button(auth_submit_button, UI_PINK)
    box.add_child(auth_submit_button)

    open_game_button = Button.new()
    open_game_button.text = "Yakindaki Makineyi Ac"
    open_game_button.disabled = true
    open_game_button.pressed.connect(_open_nearby_game)
    _style_button(open_game_button, UI_GOLD)
    box.add_child(open_game_button)

    auth_result_label = Label.new()
    auth_result_label.text = "Giris yap veya yeni hesap olustur."
    auth_result_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    _style_label(auth_result_label, 12, UI_MUTED)
    box.add_child(auth_result_label)
    _refresh_auth_ui()


func _build_prompt_panel(canvas: CanvasLayer) -> void:
    var panel := PanelContainer.new()
    panel.name = "PromptPanel"
    panel.anchor_left = 0.5
    panel.anchor_right = 0.5
    panel.anchor_top = 1.0
    panel.anchor_bottom = 1.0
    panel.offset_left = -380.0
    panel.offset_right = 380.0
    panel.offset_top = -106.0
    panel.offset_bottom = -24.0
    panel.add_theme_stylebox_override("panel", _panel_style(Color(0.024, 0.012, 0.045, 0.86), Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.38), 26, 20, 16.0))
    canvas.add_child(panel)

    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 4)
    panel.add_child(box)

    var caption := Label.new()
    caption.text = "ETKILESIM"
    caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _style_label(caption, 11, UI_GOLD)
    box.add_child(caption)

    prompt_label = Label.new()
    prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    prompt_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    prompt_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    prompt_label.text = "Slot makinelerine yaklas."
    _style_label(prompt_label, 18, UI_TEXT)
    box.add_child(prompt_label)


func _build_crosshair(canvas: CanvasLayer) -> void:
    var crosshair := Label.new()
    crosshair.name = "Crosshair"
    crosshair.text = "+"
    crosshair.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    crosshair.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    crosshair.anchor_left = 0.5
    crosshair.anchor_right = 0.5
    crosshair.anchor_top = 0.5
    crosshair.anchor_bottom = 0.5
    crosshair.offset_left = -8.0
    crosshair.offset_right = 8.0
    crosshair.offset_top = -8.0
    crosshair.offset_bottom = 8.0
    crosshair.add_theme_font_size_override("font_size", 24)
    crosshair.add_theme_color_override("font_color", Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.82))
    crosshair.add_theme_color_override("font_outline_color", Color(0.0, 0.0, 0.0, 0.55))
    crosshair.add_theme_constant_override("outline_size", 2)
    canvas.add_child(crosshair)


func _show_auth_screen() -> void:
    _screen_state = "auth"
    _auth_screen_layer = CanvasLayer.new()
    _auth_screen_layer.name = "AuthScreen"
    _auth_screen_layer.layer = 10
    add_child(_auth_screen_layer)

    var bg := ColorRect.new()
    bg.name = "AuthBg"
    bg.color = Color(0.01, 0.005, 0.03, 1.0)
    _set_control_full_rect(bg)
    _auth_screen_layer.add_child(bg)

    var center := MarginContainer.new()
    center.anchor_left = 0.5
    center.anchor_top = 0.5
    center.anchor_right = 0.5
    center.anchor_bottom = 0.5
    center.offset_left = -230.0
    center.offset_top = -290.0
    center.offset_right = 230.0
    center.offset_bottom = 290.0
    _auth_screen_layer.add_child(center)

    var card := PanelContainer.new()
    card.name = "AuthCard"
    card.add_theme_stylebox_override("panel", _panel_style(
        Color(0.030, 0.018, 0.055, 0.94),
        Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.28),
        28, 24, 28.0
    ))
    center.add_child(card)

    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 10)
    card.add_child(box)

    var logo_title := Label.new()
    logo_title.text = "RETAILERWAY"
    logo_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _style_label(logo_title, 36, UI_GOLD)
    box.add_child(logo_title)

    var logo_sub := Label.new()
    logo_sub.text = "CASINO"
    logo_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _style_label(logo_sub, 22, UI_TEXT)
    box.add_child(logo_sub)

    var divider := HSeparator.new()
    divider.modulate = Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.2)
    box.add_child(divider)

    var mode_label := Label.new()
    mode_label.text = "Hesap Girisi"
    mode_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _style_label(mode_label, 13, UI_MUTED)
    box.add_child(mode_label)

    var modes := HBoxContainer.new()
    modes.add_theme_constant_override("separation", 10)
    modes.alignment = 1
    box.add_child(modes)

    auth_login_mode_button = Button.new()
    auth_login_mode_button.text = "GIRIS"
    auth_login_mode_button.custom_minimum_size.x = 140
    auth_login_mode_button.pressed.connect(func() -> void: _set_auth_mode("login"))
    _style_button(auth_login_mode_button, UI_GOLD)
    modes.add_child(auth_login_mode_button)

    auth_register_mode_button = Button.new()
    auth_register_mode_button.text = "KAYIT"
    auth_register_mode_button.custom_minimum_size.x = 140
    auth_register_mode_button.pressed.connect(func() -> void: _set_auth_mode("register"))
    _style_button(auth_register_mode_button, UI_PINK)
    modes.add_child(auth_register_mode_button)

    auth_identifier_edit = LineEdit.new()
    auth_identifier_edit.placeholder_text = "Email veya kullanici adi"
    _style_line_edit(auth_identifier_edit)
    box.add_child(auth_identifier_edit)

    auth_username_edit = LineEdit.new()
    auth_username_edit.placeholder_text = "Kullanici adi"
    _style_line_edit(auth_username_edit)
    box.add_child(auth_username_edit)

    auth_email_edit = LineEdit.new()
    auth_email_edit.placeholder_text = "Email"
    _style_line_edit(auth_email_edit)
    box.add_child(auth_email_edit)

    auth_password_edit = LineEdit.new()
    auth_password_edit.placeholder_text = "Sifre"
    auth_password_edit.secret = true
    _style_line_edit(auth_password_edit)
    box.add_child(auth_password_edit)

    auth_submit_button = Button.new()
    auth_submit_button.text = "Giris Yap"
    auth_submit_button.custom_minimum_size.x = 200
    auth_submit_button.pressed.connect(_submit_auth)
    _style_button(auth_submit_button, UI_GOLD)
    box.add_child(auth_submit_button)

    auth_result_label = Label.new()
    auth_result_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    auth_result_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    auth_result_label.text = "Giris yap veya yeni hesap olustur."
    _style_label(auth_result_label, 12, UI_MUTED)
    box.add_child(auth_result_label)

    if not player_email.is_empty():
        auth_identifier_edit.text = player_email
        auth_email_edit.text = player_email
    if player_id != "godot-player":
        auth_identifier_edit.text = player_id
        auth_username_edit.text = player_id

    auth_password_edit.text_submitted.connect(func(_t: String) -> void: _submit_auth())
    _refresh_auth_ui()


func _hide_auth_screen() -> void:
    if _auth_screen_layer != null and not _auth_screen_layer.is_queued_for_deletion():
        _auth_screen_layer.queue_free()
        _auth_screen_layer = null


func _show_loading_screen() -> void:
    _loading_screen_layer = CanvasLayer.new()
    _loading_screen_layer.name = "LoadingScreen"
    _loading_screen_layer.layer = 9
    add_child(_loading_screen_layer)

    var bg := ColorRect.new()
    bg.name = "LoadingBg"
    bg.color = Color(0.01, 0.005, 0.03, 1.0)
    _set_control_full_rect(bg)
    _loading_screen_layer.add_child(bg)

    var center := MarginContainer.new()
    center.anchor_left = 0.5
    center.anchor_top = 0.5
    center.anchor_right = 0.5
    center.anchor_bottom = 0.5
    center.offset_left = -220.0
    center.offset_top = -100.0
    center.offset_right = 220.0
    center.offset_bottom = 100.0
    _loading_screen_layer.add_child(center)

    var vbox := VBoxContainer.new()
    vbox.add_theme_constant_override("separation", 16)
    vbox.alignment = 1
    center.add_child(vbox)

    var title := Label.new()
    title.text = "RETAILERWAY CASINO"
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _style_label(title, 28, UI_GOLD)
    vbox.add_child(title)

    _loading_status_label = Label.new()
    _loading_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _loading_status_label.text = "Yukleniyor..."
    _style_label(_loading_status_label, 15, UI_TEXT)
    vbox.add_child(_loading_status_label)

    _loading_progress_bar = ProgressBar.new()
    _loading_progress_bar.custom_minimum_size = Vector2(400, 8)
    _loading_progress_bar.max_value = 100.0
    _loading_progress_bar.value = 0.0
    _loading_progress_bar.show_percentage = false

    var ps := StyleBoxFlat.new()
    ps.bg_color = Color(0.12, 0.08, 0.18, 0.6)
    ps.set_corner_radius_all(6)

    var fs := StyleBoxFlat.new()
    fs.bg_color = UI_GOLD
    fs.set_corner_radius_all(6)

    _loading_progress_bar.add_theme_stylebox_override("background", ps)
    _loading_progress_bar.add_theme_stylebox_override("fill", fs)
    vbox.add_child(_loading_progress_bar)


func _hide_loading_screen() -> void:
    if _loading_screen_layer != null and not _loading_screen_layer.is_queued_for_deletion():
        _loading_screen_layer.queue_free()
        _loading_screen_layer = null


func _update_loading_progress(p: float, status: String) -> void:
    _loading_progress = p
    if _loading_progress_bar != null:
        _loading_progress_bar.value = p
    set_status(status)


func _on_auth_success() -> void:
    if _screen_state != "auth":
        return
    _screen_state = "loading"
    _hide_auth_screen()
    _show_loading_screen()
    _start_game_load()


func _start_game_load() -> void:
    _update_loading_progress(0, "Oyun baslatiliyor...")
    _build_base_scene()
    _update_loading_progress(10, "Config yukleniyor...")
    _load_remote_config()
    _connect_config_socket()


func _complete_game_load() -> void:
    if _game_started:
        return
    _game_started = true
    _update_loading_progress(95, "Oyun dunyasi kuruluyor...")
    _screen_state = "game"
    _hide_loading_screen()
    _build_game_overlay()
    _refresh_player_ui()
    _refresh_machine_ui()
    _reconnect_balance_socket()
    _update_loading_progress(100, "Hazir!")


func _setup_mobile_controls() -> void:
    if not _is_mobile():
        return
    var scene: PackedScene = load("res://scenes/mobile_controls.tscn")
    if scene == null:
        return
    var instance = scene.instantiate()
    if not instance is Control:
        return
    var controls: Control = instance
    _mobile_controls_node = CanvasLayer.new()
    _mobile_controls_node.add_child(controls)
    add_child(_mobile_controls_node)
    controls.movement_vector.connect(_on_mobile_move)
    controls.look_delta.connect(_on_mobile_look)
    controls.action_sit.connect(_sit_at_nearby_machine)
    controls.action_screen.connect(_open_nearby_game)
    controls.action_spin.connect(_spin_active_machine)
    controls.action_reload.connect(_hot_restart)
    print("Mobile controls activated")


func _is_mobile() -> bool:
    return OS.get_name() in ["Android", "iOS"]


func _on_mobile_move(x: float, y: float) -> void:
    _touch_move_x = x
    _touch_move_y = y


func _on_mobile_look(dx: float, dy: float) -> void:
    _touch_look_dx = dx
    _touch_look_dy = dy


func _load_remote_config() -> void:
    config_request = HTTPRequest.new()
    config_request.name = "ConfigRequest"
    add_child(config_request)
    config_request.request_completed.connect(_on_config_response)

    var url := "%s/casino-config.json?v=%s" % [_base_url(), Time.get_ticks_msec()]
    set_status("Loading config: %s" % url)

    var err := config_request.request(url)
    if err != OK:
        set_status("Config request failed to start: %s" % error_string(err))


func _hot_reload_config() -> void:
    if player_body != null:
        var eye := _current_eye_position()
        var look_dir := -player_body.global_transform.basis.z
        pending_eye_position = eye
        pending_look_at = eye + look_dir * 100.0
        has_pending_pose = true
    _screen_state = "loading"
    _show_loading_screen()
    _update_loading_progress(0, "Config guncelleniyor...")
    _clear_machines()
    _clear_teleports()
    map_collider_count = 0
    world_colliders_ready = false
    if config_request != null:
        config_request.queue_free()
        config_request = null
    if map_request != null:
        map_request.queue_free()
        map_request = null
    _update_loading_progress(10, "Config indiriliyor...")
    _load_remote_config()


func _clear_machines() -> void:
    active_machine_index = -1
    nearby_machine_index = -1
    cloud_id = ""
    cloud_token = ""
    cloud_stream_status = "inactive"
    cloud_stream_started = false
    cloud_stream_requested = false
    _stop_cloud_stream()
    machine_collider_count = 0
    for entry in machines:
        var node_val: Variant = entry.get("node")
        if node_val is Node:
            (node_val as Node).queue_free()
    machines.clear()
    _refresh_machine_ui()


func _on_config_response(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
    if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
        set_status("Config request failed: result=%s code=%s" % [result, response_code])
        return

    var parsed_config: Variant = JSON.parse_string(body.get_string_from_utf8())
    if typeof(parsed_config) != TYPE_DICTIONARY:
        set_status("Config JSON is invalid")
        return

    var config: Dictionary = parsed_config
    if hot_reload_in_progress:
        var machines_value: Variant = config.get("machines", [])
        _hot_reload_target_machines = machines_value.size() if typeof(machines_value) == TYPE_ARRAY else 0
    _apply_spawn(config)
    _apply_teleports(config)
    _update_loading_progress(25, "Config yuklendi, harita yukleniyor...")
    _download_map(String(config.get("map", "")), config)


func _apply_spawn(config: Dictionary) -> void:
    var spawn_value: Variant = config.get("spawn", {})
    var spawn: Dictionary = spawn_value if typeof(spawn_value) == TYPE_DICTIONARY else {}
    var position: Vector3 = _to_vector3(spawn.get("position", []), Vector3.ZERO)
    var look_at: Vector3 = _to_vector3(spawn.get("lookAt", []), position + Vector3.FORWARD)

    _set_player_pose(position, look_at)
    set_status("Spawned player at %s, looking at %s" % [str(position), str(look_at)])


func _set_player_pose(position: Vector3, look_at: Vector3) -> void:
    pending_eye_position = position
    pending_look_at = look_at
    has_pending_pose = true

    var body_position := position - Vector3(0.0, player_eye_height, 0.0)
    if world_colliders_ready:
        var unsnapped_body_position := body_position
        body_position = _snap_body_position_to_floor(position, body_position)
        if not body_position.is_equal_approx(unsnapped_body_position):
            print("Player floor snap: configEye=%s body=%s snappedBody=%s" % [str(position), str(unsnapped_body_position), str(body_position)])
        else:
            print("Player floor snap unchanged: configEye=%s body=%s" % [str(position), str(body_position)])

    player_body.global_position = body_position
    player_body.velocity = Vector3.ZERO
    _remember_safe_position(body_position)

    var eye_position := _current_eye_position()
    var delta := look_at - eye_position
    var flat_delta := Vector3(delta.x, 0.0, delta.z)
    if flat_delta.length_squared() > 0.001:
        var flat_direction := flat_delta.normalized()
        player_body.rotation.y = atan2(-flat_direction.x, -flat_direction.z)

    camera.rotation = Vector3.ZERO
    var horizontal_distance := Vector2(delta.x, delta.z).length()
    if horizontal_distance > 0.001:
        camera.rotation.x = clamp(atan2(delta.y, horizontal_distance), deg_to_rad(-75.0), deg_to_rad(75.0))


func _current_eye_position() -> Vector3:
    return player_body.global_position + Vector3(0.0, player_eye_height, 0.0)


func _clear_teleports() -> void:
    teleports.clear()
    active_teleport_id = ""
    last_teleport_time_ms = 0


func _apply_teleports(config: Dictionary) -> void:
    _clear_teleports()
    var teleports_value: Variant = config.get("teleports", [])
    if typeof(teleports_value) != TYPE_ARRAY:
        return

    var teleport_list: Array = teleports_value
    for idx in range(teleport_list.size()):
        var entry_value: Variant = teleport_list[idx]
        if typeof(entry_value) != TYPE_DICTIONARY:
            continue

        var entry: Dictionary = entry_value
        var center := _to_vector3(entry.get("position", []), Vector3.ZERO)
        var target_position := _to_vector3(entry.get("targetPosition", []), center)
        var target_look_at := _to_vector3(entry.get("targetLookAt", []), target_position + Vector3.FORWARD * 100.0)
        teleports.append({
            "id": String(entry.get("id", "teleport_%d" % idx)),
            "enabled": bool(entry.get("enabled", true)),
            "position": center,
            "size": _positive_vector3(_to_vector3(entry.get("size", []), Vector3(120.0, 160.0, 120.0)), Vector3(120.0, 160.0, 120.0)),
            "target_position": target_position,
            "target_look_at": target_look_at,
        })

    if not teleports.is_empty():
        print("Loaded %s teleport zones" % teleports.size())


func _positive_vector3(value: Vector3, fallback: Vector3) -> Vector3:
    return Vector3(
        max(1.0, absf(value.x)) if value.x != 0.0 else fallback.x,
        max(1.0, absf(value.y)) if value.y != 0.0 else fallback.y,
        max(1.0, absf(value.z)) if value.z != 0.0 else fallback.z
    )


func _check_teleports() -> void:
    if teleports.is_empty() or player_body == null:
        return

    var eye_position := _current_eye_position()
    var matched: Dictionary = {}
    for teleport_value in teleports:
        var teleport: Dictionary = teleport_value
        if not bool(teleport.get("enabled", true)):
            continue
        var teleport_position: Vector3 = teleport.get("position", Vector3.ZERO)
        var teleport_size: Vector3 = teleport.get("size", Vector3.ONE)
        if _point_inside_box(eye_position, teleport_position, teleport_size):
            matched = teleport
            break

    if matched.is_empty():
        active_teleport_id = ""
        return

    var teleport_id := String(matched.get("id", "teleport"))
    if active_teleport_id == teleport_id:
        return

    var now := Time.get_ticks_msec()
    if now - last_teleport_time_ms < TELEPORT_COOLDOWN_MS:
        active_teleport_id = teleport_id
        return

    active_teleport_id = teleport_id
    last_teleport_time_ms = now
    var target_position: Vector3 = matched.get("target_position", eye_position)
    var target_look_at: Vector3 = matched.get("target_look_at", eye_position + Vector3.FORWARD * 100.0)
    _set_player_pose(target_position, target_look_at)
    set_status("Teleport: %s" % teleport_id)


func _point_inside_box(point: Vector3, center: Vector3, size: Vector3) -> bool:
    var half := size * 0.5
    return absf(point.x - center.x) <= half.x and absf(point.y - center.y) <= half.y and absf(point.z - center.z) <= half.z


func _snap_body_position_to_floor(reference_eye_position: Vector3, fallback_body_position: Vector3) -> Vector3:
    var floor_hit := _find_floor_hit(reference_eye_position)
    if floor_hit.is_empty():
        return fallback_body_position

    var hit_position: Vector3 = floor_hit["position"]
    return Vector3(fallback_body_position.x, hit_position.y + floor_snap_offset, fallback_body_position.z)


func _find_floor_hit(reference_eye_position: Vector3) -> Dictionary:
    if not world_colliders_ready:
        return {}

    var space_state := get_world_3d().direct_space_state
    var offsets: Array[Vector3] = [
        Vector3.ZERO,
        Vector3(player_radius * 0.7, 0.0, 0.0),
        Vector3(-player_radius * 0.7, 0.0, 0.0),
        Vector3(0.0, 0.0, player_radius * 0.7),
        Vector3(0.0, 0.0, -player_radius * 0.7),
    ]

    for offset in offsets:
        var from: Vector3 = reference_eye_position + offset + Vector3(0.0, floor_probe_up, 0.0)
        var to: Vector3 = reference_eye_position + offset - Vector3(0.0, floor_probe_down, 0.0)
        var query := PhysicsRayQueryParameters3D.create(from, to, 1)
        query.exclude = [player_body.get_rid()]
        var hit := space_state.intersect_ray(query)
        if not hit.is_empty() and hit.has("normal"):
            var normal: Vector3 = hit["normal"]
            if normal.y > 0.25:
                return hit

    return {}


func _keep_player_on_floor() -> void:
    if not world_colliders_ready:
        return

    var eye_position := _current_eye_position()
    var floor_hit := _find_floor_hit(eye_position)
    if not floor_hit.is_empty():
        var hit_position: Vector3 = floor_hit["position"]
        var snapped_y := hit_position.y + floor_snap_offset
        var delta_y := snapped_y - player_body.global_position.y
        var small_step_down := player_height * 0.3
        if delta_y >= 0.0 or abs(delta_y) <= small_step_down:
            player_body.global_position.y = snapped_y
            if delta_y > fall_recovery_distance:
                set_status("Player snapped back onto the lobby floor")
            _remember_safe_position(player_body.global_position)
        return

    if has_safe_body_position and player_body.global_position.y < last_safe_body_position.y - fall_recovery_distance:
        player_body.global_position = last_safe_body_position
        player_body.velocity = Vector3.ZERO
        set_status("Player recovered to last safe floor position")


func _snap_current_player_to_floor() -> void:
    if not world_colliders_ready:
        return

    var snapped_position := _snap_body_position_to_floor(_current_eye_position(), player_body.global_position)
    if not snapped_position.is_equal_approx(player_body.global_position):
        player_body.global_position = snapped_position
        _remember_safe_position(player_body.global_position)


func _remember_safe_position(position: Vector3) -> void:
    last_safe_body_position = position
    has_safe_body_position = true


func _download_map(map_name: String, config: Dictionary) -> void:
    if map_name.is_empty():
        _clear_map()
        set_status("Loaded config without map")
        _download_machines(config.get("machines", []))
        return

    var local_asset_path := _local_asset_path("maps", map_name)
    if prefer_local_assets and not local_asset_path.is_empty():
        set_status("Loading local map: %s" % local_asset_path)
        _load_map_from_path(config, local_asset_path)
        return

    map_request = HTTPRequest.new()
    map_request.name = "MapRequest"
    add_child(map_request)

    var local_path := _cache_path(map_name)
    map_request.download_file = local_path
    map_request.request_completed.connect(_on_map_downloaded.bind(config, local_path))

    var url := "%s/maps/%s?v=%s" % [_base_url(), map_name.uri_encode(), Time.get_ticks_msec()]
    set_status("Downloading map: %s" % url)

    var err := map_request.request(url)
    if err != OK:
        set_status("Map request failed to start: %s" % error_string(err))


func _on_map_downloaded(result: int, response_code: int, _headers: PackedStringArray, _body: PackedByteArray, config: Dictionary, local_path: String) -> void:
    if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
        set_status("Map download failed: result=%s code=%s" % [result, response_code])
        return

    _load_map_from_path(config, local_path)


func _load_map_from_path(config: Dictionary, local_path: String) -> void:
    _clear_map()

    var map_node: Node = null
    if local_path.ends_with(".tscn"):
        var scene := load(local_path)
        if scene != null:
            map_node = scene.instantiate()
        else:
            set_status("Map scene failed to load: %s" % local_path)
            return
    else:
        map_node = _load_gltf(local_path)
        if map_node == null:
            set_status("Map GLB failed to load: %s" % local_path)
            return

    _apply_map_transform(map_node, config)
    _apply_model_parts(map_node, config.get("mapParts", {}))
    map_node.name = "CasinoLobby"
    world_root.add_child(map_node)

    if enable_map_collision:
        map_collider_count = _add_static_colliders(map_node)
    world_colliders_ready = map_collider_count > 0

    var spawn_marker := map_node.get_node_or_null("PlayerSpawn") as Marker3D
    if spawn_marker != null:
        var spawn_pos := spawn_marker.global_position
        var look_dir := -spawn_marker.global_transform.basis.z
        pending_eye_position = spawn_pos
        pending_look_at = spawn_pos + look_dir * 100.0
        has_pending_pose = true
        print("Using PlayerSpawn marker at %s, looking %s" % [str(spawn_pos), str(look_dir)])

    if world_colliders_ready and has_pending_pose:
        _set_player_pose(pending_eye_position, pending_look_at)

    _update_loading_progress(45, "Harita yuklendi, makineler yukleniyor...")
    set_status("Loaded map: %s (%s colliders)" % [local_path, map_collider_count])
    _download_machines(config.get("machines", []))


func _clear_map() -> void:
    if world_root != null:
        var existing := world_root.get_node_or_null("CasinoLobby")
        if existing != null and not existing.is_queued_for_deletion():
            existing.queue_free()
    map_collider_count = 0
    world_colliders_ready = false


func _apply_map_transform(map_node: Node, config: Dictionary) -> void:
    if not map_node is Node3D:
        return

    var transform_value: Variant = config.get("mapTransform", {})
    var map_transform: Dictionary = transform_value if typeof(transform_value) == TYPE_DICTIONARY else {}
    var node_3d := map_node as Node3D
    node_3d.position = _to_vector3(map_transform.get("position", []), Vector3.ZERO)
    node_3d.rotation_degrees = _to_vector3(map_transform.get("rotation", []), Vector3.ZERO)
    node_3d.scale = _to_vector3(map_transform.get("scale", []), Vector3.ONE)


func _download_machines(machines_value: Variant) -> void:
    if typeof(machines_value) != TYPE_ARRAY:
        set_status("Loaded map. No machines in config.")
        if hot_reload_in_progress:
            _complete_config_hot_reload()
        elif _screen_state == "loading":
            _complete_game_load()
        return

    var machine_list: Array = machines_value
    _expected_machine_count = machine_list.size()
    _loaded_machine_count = 0
    if machine_list.is_empty():
        set_status("Loaded map. No machines in config.")
        if hot_reload_in_progress:
            _complete_config_hot_reload()
        elif _screen_state == "loading":
            _complete_game_load()
        return

    for machine_value in machine_list:
        if typeof(machine_value) != TYPE_DICTIONARY:
            continue
        var machine: Dictionary = machine_value
        var model_name: String = String(machine.get("model", ""))
        if model_name.is_empty():
            continue

        var local_asset_path := _local_asset_path("models", model_name)
        if prefer_local_assets and not local_asset_path.is_empty():
            _load_machine_from_path(machine, local_asset_path)
            continue

        var request := HTTPRequest.new()
        request.name = "MachineRequest_%s" % String(machine.get("id", "machine"))
        add_child(request)

        var local_path := _cache_path(model_name)
        request.download_file = local_path
        request.request_completed.connect(_on_machine_downloaded.bind(machine, request, local_path))

        var url := "%s/models/%s?v=%s" % [_base_url(), model_name.uri_encode(), Time.get_ticks_msec()]
        var err := request.request(url)
        if err != OK:
            set_status("Machine request failed: %s" % error_string(err))


func _on_machine_downloaded(result: int, response_code: int, _headers: PackedStringArray, _body: PackedByteArray, machine: Dictionary, request: HTTPRequest, local_path: String) -> void:
    request.queue_free()

    if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
        set_status("Machine download failed: %s code=%s" % [String(machine.get("id", "machine")), response_code])
        return

    _load_machine_from_path(machine, local_path)


func _load_machine_from_path(machine: Dictionary, local_path: String) -> void:
    var machine_node := _load_gltf(local_path)
    if machine_node == null:
        set_status("Machine GLB failed to load: %s" % local_path)
        return

    machine_node.name = String(machine.get("id", "machine"))
    machine_node.position = _to_vector3(machine.get("position", []), Vector3.ZERO)
    machine_node.rotation_degrees = _to_vector3(machine.get("rotation", []), Vector3.ZERO)
    machine_node.scale = _to_vector3(machine.get("scale", []), Vector3.ONE)
    _apply_model_parts(machine_node, machine.get("modelParts", {}))
    machine_root.add_child(machine_node)

    var added_machine_colliders := 0
    if enable_machine_collision:
        added_machine_colliders = _add_static_colliders(machine_node)
        machine_collider_count += added_machine_colliders

    var machine_index := machines.size()
    var screen := _create_machine_screen(machine_node, machine)
    _create_machine_controls(machine_node, machine, machine_index)

    machines.append({
        "id": machine_node.name,
        "game": String(machine.get("game", "slot")),
        "node": machine_node,
        "config": machine,
        "interaction_radius": float(machine.get("interactionRadius", 80.0)),
        "screen_mesh_instance": screen.get("mesh_instance"),
        "screen_material": screen.get("screen_material"),
        "stream_image": screen.get("stream_image"),
        "stream_texture": screen.get("stream_texture"),
    })
    _refresh_machine_ui()
    set_status("Loaded machine: %s (%s colliders)" % [machine_node.name, added_machine_colliders])

    if _screen_state == "loading":
        _loaded_machine_count += 1
        var p := 45.0 + (float(_loaded_machine_count) / float(max(1, _expected_machine_count))) * 40.0
        _update_loading_progress(p, "Makine yukleniyor: %s/%s" % [_loaded_machine_count, _expected_machine_count])
        if _loaded_machine_count >= _expected_machine_count:
            if hot_reload_in_progress:
                _complete_config_hot_reload()
            else:
                _complete_game_load()
    elif hot_reload_in_progress and _hot_reload_target_machines > 0 and machines.size() >= _hot_reload_target_machines:
        _complete_config_hot_reload()

    if OS.get_environment("CASINO_AUTOSTART_STREAM") == "1" and active_machine_index < 0:
        call_deferred("_start_machine_game", machines.size() - 1)


func _load_gltf(path: String) -> Node:
    var document := GLTFDocument.new()
    var state := GLTFState.new()
    var file_path := path
    if path.begins_with("user://") or path.begins_with("res://"):
        file_path = ProjectSettings.globalize_path(path)
    var err := document.append_from_file(file_path, state)
    if err != OK:
        push_error("GLB load failed for %s: %s" % [path, error_string(err)])
        return null
    return document.generate_scene(state)


func _complete_config_hot_reload() -> void:
    if not hot_reload_in_progress:
        return
    hot_reload_in_progress = false
    _hot_reload_target_machines = 0
    _screen_state = "game"
    _hide_loading_screen()
    if has_pending_pose and world_colliders_ready:
        _set_player_pose(pending_eye_position, pending_look_at)
    set_status("Config guncellendi")


func _apply_model_parts(root: Node, parts_value: Variant) -> void:
    if typeof(parts_value) != TYPE_DICTIONARY:
        return

    _apply_model_parts_recursive(root, parts_value as Dictionary, {"mesh_index": 0})


func _model_part_value(parts: Dictionary, node_name: String, mesh_index: int) -> Variant:
    var indexed_prefix := "%03d__" % mesh_index
    var exact_indexed_key := "%s%s" % [indexed_prefix, node_name]
    if parts.has(exact_indexed_key):
        return parts.get(exact_indexed_key)

    for raw_key in parts.keys():
        var key := String(raw_key)
        if key.begins_with(indexed_prefix):
            return parts.get(raw_key)

    return parts.get(node_name)


func _apply_model_parts_recursive(node: Node, parts: Dictionary, state: Dictionary) -> void:
    if node is Node3D:
        var part_value: Variant = parts.get(node.name)
        if node is MeshInstance3D:
            var mesh_index := int(state.get("mesh_index", 0))
            state["mesh_index"] = mesh_index + 1
            part_value = _model_part_value(parts, node.name, mesh_index)
        if typeof(part_value) == TYPE_DICTIONARY:
            var part: Dictionary = part_value
            var node_3d := node as Node3D
            if part.has("position"):
                node_3d.position = _to_vector3(part.get("position", []), node_3d.position)
            if part.has("rotation"):
                node_3d.rotation_degrees = _to_vector3(part.get("rotation", []), node_3d.rotation_degrees)
            if part.has("scale"):
                node_3d.scale = _to_vector3(part.get("scale", []), node_3d.scale)
            if bool(part.get("deleted", false)):
                node_3d.visible = false
            elif part.has("hidden"):
                node_3d.visible = not bool(part.get("hidden"))
            elif part.has("visible"):
                node_3d.visible = bool(part.get("visible"))

    for child in node.get_children():
        _apply_model_parts_recursive(child, parts, state)


func _add_static_colliders(root: Node) -> int:
    if root is Node3D and not (root as Node3D).visible:
        return 0

    var added := 0
    if root is MeshInstance3D:
        var mesh_instance := root as MeshInstance3D
        var mesh := mesh_instance.mesh
        if mesh != null:
            var shape := mesh.create_trimesh_shape()
            if shape != null:
                if shape is ConcavePolygonShape3D:
                    (shape as ConcavePolygonShape3D).backface_collision = true
                var body := StaticBody3D.new()
                body.name = "%s_StaticBody" % mesh_instance.name
                body.collision_layer = 1
                body.collision_mask = 0

                var collision := CollisionShape3D.new()
                collision.name = "CollisionShape3D"
                collision.shape = shape
                body.add_child(collision)
                mesh_instance.add_child(body)
                added += 1

    for child in root.get_children():
        added += _add_static_colliders(child)

    return added


func _create_machine_screen(machine_node: Node3D, machine: Dictionary) -> Dictionary:
    var screen_value: Variant = machine.get("screen", {})
    var screen_config: Dictionary = screen_value if typeof(screen_value) == TYPE_DICTIONARY else {}
    var size := _to_vector3(screen_config.get("size", []), Vector3(360.0, 260.0, 0.0))

    var size_mult := 1.5
    var desired_w: float = max(1.0, size.x) * size_mult
    var desired_h: float = max(1.0, size.y) * size_mult

    var quad := QuadMesh.new()
    quad.size = Vector2(desired_w, desired_h)

    var material := StandardMaterial3D.new()
    material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    material.cull_mode = BaseMaterial3D.CULL_DISABLED
    material.albedo_color = Color(0.15, 0.05, 0.25, 1.0)

    var screen_mesh := MeshInstance3D.new()
    screen_mesh.name = "%s_InWorldScreen" % machine_node.name
    screen_mesh.mesh = quad
    screen_mesh.material_override = material
    var screen_pos := _to_vector3(screen_config.get("position", []), Vector3(0.0, 80.0, -255.0))
    screen_mesh.position = screen_pos
    screen_mesh.rotation_degrees = _to_vector3(screen_config.get("rotation", []), Vector3.ZERO)
    machine_node.add_child(screen_mesh)

    print("Screen '%s' local_pos=%s rot=%s size=%s global_pos=%s" % [
        screen_mesh.name, screen_mesh.position, screen_mesh.rotation_degrees,
        Vector2(desired_w, desired_h), screen_mesh.global_position
    ])

    return {
        "mesh_instance": screen_mesh,
        "screen_material": material,
        "stream_image": Image.new(),
        "stream_texture": null,
    }


func _create_machine_controls(machine_node: Node3D, machine: Dictionary, machine_index: int) -> void:
    _create_machine_control(machine_node, machine, machine_index, "spinButton")
    _create_machine_control(machine_node, machine, machine_index, "lever")


func _create_machine_control(machine_node: Node3D, machine: Dictionary, machine_index: int, control_key: String) -> void:
    var control_value: Variant = machine.get(control_key, {})
    if typeof(control_value) != TYPE_DICTIONARY:
        return

    var control_config: Dictionary = control_value
    var area := Area3D.new()
    area.name = "%s_%sHitbox" % [machine_node.name, control_key]
    area.position = _to_vector3(control_config.get("position", []), Vector3.ZERO)
    area.rotation_degrees = _to_vector3(control_config.get("rotation", []), Vector3.ZERO)
    area.collision_layer = MACHINE_CONTROL_LAYER
    area.collision_mask = 0
    area.monitoring = false
    area.monitorable = true
    area.input_ray_pickable = true
    area.set_meta("machine_index", machine_index)
    area.set_meta("control_key", control_key)

    var shape := CollisionShape3D.new()
    shape.name = "CollisionShape3D"
    var sphere := SphereShape3D.new()
    var r := float(control_config.get("radius", 0.0))
    if r <= 0.0:
        var sz := _to_vector3(control_config.get("size", []), Vector3.ZERO)
        r = max(sz.x, max(sz.y, sz.z)) * 0.5
    if r <= 0.0: r = 22.0
    sphere.radius = max(8.0, r)
    shape.shape = sphere
    area.add_child(shape)
    machine_node.add_child(area)


func _try_activate_machine_control(screen_position: Vector2) -> bool:
    if camera == null or get_world_3d() == null:
        return false

    var ray_origin := camera.project_ray_origin(screen_position)
    var ray_end := ray_origin + camera.project_ray_normal(screen_position) * MACHINE_CONTROL_RAY_DISTANCE
    var query := PhysicsRayQueryParameters3D.create(ray_origin, ray_end, MACHINE_CONTROL_LAYER)
    query.collide_with_areas = true
    query.collide_with_bodies = false
    query.hit_from_inside = true

    var hit := get_world_3d().direct_space_state.intersect_ray(query)
    if hit.is_empty():
        return false

    var collider_value: Variant = hit.get("collider")
    if not collider_value is Area3D:
        return false

    var area := collider_value as Area3D
    if not area.has_meta("machine_index"):
        return false

    _activate_machine_control(int(area.get_meta("machine_index")), String(area.get_meta("control_key", "spinButton")))
    return true


func _activate_machine_control(machine_index: int, control_key: String) -> void:
    if machine_index < 0 or machine_index >= machines.size():
        return

    nearby_machine_index = machine_index
    var machine_id := String(machines[machine_index].get("id", "slot"))
    if active_machine_index != machine_index:
        _start_machine_game(machine_index, true)
        set_status("%s %s tiklandi; stream baslatilip spin atilacak" % [machine_id, control_key])
        return

    if _active_machine_uses_client_render():
        pending_spin_after_stream = false
        _spin_active_machine()
        return

    if cloud_id.is_empty() or cloud_token.is_empty():
        pending_spin_after_stream = true
        if not cloud_stream_started and cloud_stream_status == "inactive":
            _start_machine_game(machine_index, true)
        else:
            set_status("%s %s tiklandi; spin siraya alindi" % [machine_id, control_key])
        return

    pending_spin_after_stream = false
    _spin_active_machine()


func _set_control_full_rect(control: Control) -> void:
    control.anchor_left = 0.0
    control.anchor_top = 0.0
    control.anchor_right = 1.0
    control.anchor_bottom = 1.0
    control.offset_left = 0.0
    control.offset_top = 0.0
    control.offset_right = 0.0
    control.offset_bottom = 0.0


func _update_interaction_prompt() -> void:
    if prompt_label == null:
        return
    var nearest_index := -1
    var nearest_distance := INF
    var player_xz := Vector2(player_body.global_position.x, player_body.global_position.z)

    for i in range(machines.size()):
        var entry: Dictionary = machines[i]
        var node_value: Variant = entry.get("node")
        if not node_value is Node3D:
            continue
        var machine_node := node_value as Node3D
        var machine_xz := Vector2(machine_node.global_position.x, machine_node.global_position.z)
        var distance := player_xz.distance_to(machine_xz)
        var radius := float(entry.get("interaction_radius", 80.0))
        if distance <= radius and distance < nearest_distance:
            nearest_distance = distance
            nearest_index = i

    nearby_machine_index = nearest_index
    _refresh_machine_ui()

    if open_game_button != null:
        open_game_button.disabled = true
    if nearby_machine_index < 0:
        prompt_label.text = "Slot makinelerine yaklas."
        return

    var nearby: Dictionary = machines[nearby_machine_index]
    if not authenticated:
        prompt_label.text = "%s hazir. Oynamak icin once giris yap." % String(nearby.get("id", "slot"))
        return

    prompt_label.text = "E: %s koltuguna otur | G: ekrani ac | Space veya makine dugmesi: spin" % String(nearby.get("id", "slot"))
    if open_game_button != null:
        open_game_button.disabled = false


func _sit_at_nearby_machine() -> void:
    if nearby_machine_index < 0:
        set_status("Yakinda slot makinesi yok")
        return

    var entry: Dictionary = machines[nearby_machine_index]
    var config_value: Variant = entry.get("config", {})
    var machine_config: Dictionary = config_value if typeof(config_value) == TYPE_DICTIONARY else {}
    var node_value: Variant = entry.get("node")
    if not node_value is Node3D:
        return

    var machine_node := node_value as Node3D
    var seat_value: Variant = machine_config.get("seat", {})
    var seat_config: Dictionary = seat_value if typeof(seat_value) == TYPE_DICTIONARY else {}
    var seat_position := _to_vector3(seat_config.get("position", []), machine_node.global_position + Vector3(0.0, 0.0, 120.0))
    _set_player_pose(seat_position, machine_node.global_position)
    set_status("%s koltuguna oturuldu" % String(entry.get("id", "slot")))


func _open_nearby_game() -> void:
    if not authenticated:
        set_status("Oyun acmak icin once giris yap")
        if auth_result_label != null:
            auth_result_label.text = "Oyun acmak icin email/kullanici adi ile giris yap."
        return
    if nearby_machine_index < 0:
        set_status("Yakinda acilacak oyun yok")
        return

    _start_machine_game(nearby_machine_index)


func _start_machine_game(machine_index: int, spin_when_ready: bool = false) -> void:
    if machine_index < 0 or machine_index >= machines.size():
        return
    if not authenticated:
        pending_spin_after_stream = false
        set_status("Oyun baslatmak icin once giris yap")
        if auth_result_label != null:
            auth_result_label.text = "Oyun baslatmak icin hesabina giris yap."
        return

    if machine_index == active_machine_index and _active_machine_uses_client_render():
        if spin_when_ready:
            pending_spin_after_stream = false
            _spin_active_machine()
        else:
            set_status("Client renderer zaten aktif")
        return

    if machine_index == active_machine_index and cloud_id.is_empty() and cloud_token.is_empty() and cloud_stream_status != "inactive":
        pending_spin_after_stream = pending_spin_after_stream or spin_when_ready
        set_status("Stream zaten basliyor; spin siraya alindi" if pending_spin_after_stream else "Stream zaten basliyor")
        return

    var previous_machine_index := active_machine_index
    if previous_machine_index >= 0 and previous_machine_index < machines.size() and previous_machine_index != machine_index:
        _clear_machine_client_render(machines[previous_machine_index])

    active_machine_index = machine_index
    pending_spin_after_stream = spin_when_ready
    var entry: Dictionary = machines[machine_index]
    var game := String(entry.get("game", "slot"))
    _set_machine_screen_status(entry, "%s bu ekranda baslatiliyor..." % game)
    set_status("Makine ekrani baslatiliyor: %s" % game)

    _stop_cloud_stream()
    cloud_id = ""
    cloud_token = ""
    cloud_stream_frame_count = 0
    cloud_stream_status = "starting"

    var mat_val: Variant = entry.get("screen_material")
    if mat_val is BaseMaterial3D:
        (mat_val as BaseMaterial3D).albedo_color = Color(0.12, 0.04, 0.20, 0.5)
        (mat_val as BaseMaterial3D).albedo_texture = null

    _clear_machine_client_render(entry)
    if prefer_client_render and _start_client_render(entry, game):
        return
    if prefer_client_render:
        _set_machine_screen_status(entry, "CEF addon yok; cloud stream fallback")
        set_status("CEF addon yok; cloud stream fallback")

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
        pending_spin_after_stream = false
        cloud_stream_status = "inactive"
        _set_machine_screen_status(entry, "Cloud stream failed to start: %s" % error_string(err))
        set_status("Cloud stream request failed: %s" % error_string(err))


func _start_client_render(entry: Dictionary, game: String) -> bool:
    if not ClassDB.class_exists("CefTexture2D"):
        return false

    var texture_obj: Object = ClassDB.instantiate("CefTexture2D")
    if texture_obj == null:
        return false
    if not texture_obj is Texture2D:
        push_warning("CefTexture2D addon class is not a Texture2D")
        return false

    texture_obj.set("texture_size", Vector2i(machine_screen_width, machine_screen_height))
    texture_obj.set("enable_accelerated_osr", _client_render_accelerated_osr())
    texture_obj.set("background_color", Color(0, 0, 0, 1))
    texture_obj.set("popup_policy", 0)
    texture_obj.set("preload_script", _client_render_preload_script())

    var launch_url := _client_render_start_url(game)
    texture_obj.set("url", launch_url)

    var mat_val: Variant = entry.get("screen_material")
    if mat_val is BaseMaterial3D:
        (mat_val as BaseMaterial3D).albedo_color = Color.WHITE
        (mat_val as BaseMaterial3D).albedo_texture = texture_obj as Texture2D

    entry["client_render_active"] = true
    entry["client_render_texture"] = texture_obj
    entry["client_render_url"] = launch_url

    cloud_id = ""
    cloud_token = ""
    cloud_stream_status = "client-render"
    _set_machine_screen_status(entry, "Client-side CEF renderer active")
    set_status("Client-side CEF renderer active: %s" % game)

    if pending_spin_after_stream:
        pending_spin_after_stream = false
        _send_client_render_spin(default_bet)

    return true


func _client_render_start_url(game: String) -> String:
    var url := "%s/client/start?game=%s&sessionID=%s" % [
        _base_url(),
        game.uri_encode(),
        session_id.uri_encode(),
    ]
    var secret := _client_render_secret()
    if not secret.is_empty():
        url += "&clientSecret=%s" % secret.uri_encode()
    return url


func _client_render_secret() -> String:
    var env_secret := OS.get_environment("CASINO_CLIENT_RENDER_SECRET").strip_edges()
    if not env_secret.is_empty():
        return env_secret

    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--client-render-secret="):
            return arg.substr("--client-render-secret=".length()).strip_edges()

    return client_render_secret.strip_edges()


func _client_render_accelerated_osr() -> bool:
    var enabled := _parse_bool(OS.get_environment("CASINO_CEF_ACCELERATED"), enable_client_render_accelerated_osr)
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--cef-accelerated="):
            enabled = _parse_bool(arg.substr("--cef-accelerated=".length()), enabled)
    return enabled


func _parse_bool(value: String, fallback: bool) -> bool:
    var clean := value.strip_edges().to_lower()
    if clean in ["1", "true", "yes", "on"]:
        return true
    if clean in ["0", "false", "no", "off"]:
        return false
    return fallback


func _client_render_preload_script() -> String:
    return """
(function () {
  if (window.__casinoGodotBridgeInstalled) return;
  window.__casinoGodotBridgeInstalled = true;
  window.__casinoGodotPendingSpinBet = 0;

  function triggerSpin(bet) {
    var nextBet = Number(bet) || 100;
    var scene = window.__sugarBlastGameScene;
    if (!scene) {
      window.__casinoGodotPendingSpinBet = nextBet;
      startGameFromBridge();
      return false;
    }
    dismissIntro(scene);
    if (scene._spinLock) {
      window.__casinoGodotPendingSpinBet = nextBet;
      return false;
    }
    var spinHit = scene.spinControls && scene.spinControls.spinHit;
    if (spinHit && typeof spinHit.emit === 'function') {
      spinHit.emit('pointerdown');
      return true;
    }
    window.dispatchEvent(new CustomEvent('unitySpin', { detail: { bet: nextBet } }));
    return true;
  }

  function dismissIntro(scene) {
    if (scene && scene.introSplash && typeof scene.introSplash.hide === 'function') {
      scene.introSplash.hide();
      return true;
    }
    return false;
  }

  function startGameFromBridge() {
    if (typeof window.__sugarBlastStartGame !== 'function') return false;
    try {
      window.__sugarBlastStartGame();
      return true;
    } catch (_) {
      return false;
    }
  }

  function kickStart() {
    var scene = window.__sugarBlastGameScene;
    if (scene) {
      dismissIntro(scene);
      if (window.__casinoGodotPendingSpinBet) {
        var pending = window.__casinoGodotPendingSpinBet;
        window.__casinoGodotPendingSpinBet = 0;
        triggerSpin(pending);
      }
      return true;
    }

    if (startGameFromBridge()) return false;

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      var canvas = document.querySelector('canvas');
      if (canvas && typeof PointerEvent !== 'undefined') {
        var rect = canvas.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height * 0.72;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
      }
    } catch (_) {}
    return false;
  }

  window.__casinoGodotSpin = triggerSpin;
  window.onIpcMessage = function (message) {
    try {
      var payload = JSON.parse(message);
      if (payload && payload.type === 'unitySpin') triggerSpin(payload.bet);
    } catch (_) {}
  };
  if (window.ipcMessage && typeof window.ipcMessage.addListener === 'function') {
    window.ipcMessage.addListener(window.onIpcMessage);
  }

  var tries = 0;
  var timer = window.setInterval(function () {
    tries += 1;
    if (kickStart() || tries >= 24) window.clearInterval(timer);
  }, 500);
})();
"""


func _active_machine_uses_client_render() -> bool:
    if active_machine_index < 0 or active_machine_index >= machines.size():
        return false
    return bool(machines[active_machine_index].get("client_render_active", false))


func _active_client_render_texture() -> Object:
    if active_machine_index < 0 or active_machine_index >= machines.size():
        return null
    var texture_val: Variant = machines[active_machine_index].get("client_render_texture")
    if texture_val is Object:
        return texture_val as Object
    return null


func _clear_machine_client_render(entry: Dictionary) -> void:
    if not bool(entry.get("client_render_active", false)):
        return

    var texture_val: Variant = entry.get("client_render_texture")
    var mat_val: Variant = entry.get("screen_material")
    if mat_val is BaseMaterial3D and texture_val is Texture2D:
        var material := mat_val as BaseMaterial3D
        if material.albedo_texture == texture_val:
            material.albedo_texture = null

    entry["client_render_active"] = false
    entry["client_render_texture"] = null
    entry["client_render_url"] = ""


func _send_client_render_spin(bet: int) -> bool:
    var texture := _active_client_render_texture()
    if texture == null:
        return false

    var sent := false
    var payload := JSON.stringify({ "type": "unitySpin", "bet": bet })
    if texture.has_method("send_ipc_message"):
        texture.call("send_ipc_message", payload)
        sent = true
    if texture.has_method("eval"):
        texture.call("eval", "if (window.__casinoGodotSpin) window.__casinoGodotSpin(%s);" % bet)
        sent = true
    return sent


func _on_cloud_start_response(result: int, response_code: int, headers: PackedStringArray, _body: PackedByteArray) -> void:
    if active_machine_index < 0 or active_machine_index >= machines.size():
        return

    var entry: Dictionary = machines[active_machine_index]
    if response_code != 302 and response_code != 301:
        pending_spin_after_stream = false
        cloud_stream_status = "inactive"
        _set_machine_screen_status(entry, "Cloud start failed: result=%s code=%s" % [result, response_code])
        set_status("Cloud start failed: result=%s code=%s" % [result, response_code])
        return

    var location := _header_value(headers, "location")
    var params := _query_params(location)
    cloud_id = String(params.get("id", ""))
    cloud_token = String(params.get("token", ""))

    if cloud_id.is_empty() or cloud_token.is_empty():
        pending_spin_after_stream = false
        cloud_stream_status = "inactive"
        _set_machine_screen_status(entry, "Cloud token missing")
        set_status("Cloud token missing")
        return

    _set_machine_screen_status(entry, "Connecting video stream...")
    _start_cloud_stream()


func _start_cloud_stream() -> void:
    cloud_stream_started = true
    cloud_stream_requested = false
    cloud_stream_buffer.clear()
    cloud_stream_status = "connecting"
    cloud_frame_error_count = 0
    _set_active_screen_status("Waiting for first frame...")
    _request_cloud_frame()


func _request_cloud_frame() -> void:
    if not cloud_stream_started or cloud_id.is_empty() or cloud_token.is_empty():
        return
    if cloud_stream_requested:
        return

    if cloud_frame_request != null:
        cloud_frame_request.queue_free()

    cloud_frame_request = HTTPRequest.new()
    cloud_frame_request.name = "CloudFrameRequest"
    cloud_frame_request.timeout = 20.0
    add_child(cloud_frame_request)
    cloud_frame_request.request_completed.connect(_on_cloud_frame_response.bind(cloud_frame_request))

    var url := "%s/cloud/frame?id=%s&token=%s&width=%s&height=%s&t=%s" % [
        _base_url(),
        cloud_id.uri_encode(),
        cloud_token.uri_encode(),
        machine_screen_width,
        machine_screen_height,
        Time.get_ticks_msec(),
    ]
    var err := cloud_frame_request.request(url)
    if err != OK:
        cloud_frame_request.queue_free()
        cloud_frame_request = null
        pending_spin_after_stream = false
        cloud_stream_status = "inactive"
        _set_active_screen_status("Cloud frame request failed: %s" % error_string(err))
        set_status("Cloud frame request failed: %s" % error_string(err))
        return

    cloud_stream_requested = true
    cloud_stream_status = "streaming"


func _on_cloud_frame_response(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray, request: HTTPRequest) -> void:
    if request != null:
        request.queue_free()
    if request == cloud_frame_request:
        cloud_frame_request = null
    cloud_stream_requested = false

    if not cloud_stream_started:
        return

    if result == HTTPRequest.RESULT_SUCCESS and response_code == 200 and body.size() > 0:
        cloud_frame_error_count = 0
        _show_cloud_frame(body)
        _schedule_cloud_frame(0.2)
        return

    cloud_frame_error_count += 1
    var message := "Cloud frame failed: result=%s code=%s bytes=%s" % [result, response_code, body.size()]
    _set_active_screen_status(message)
    set_status(message)

    if response_code == 403 or response_code == 404 or cloud_frame_error_count >= 3:
        pending_spin_after_stream = false
        cloud_stream_status = "inactive"
        _stop_cloud_stream()
        return

    _schedule_cloud_frame(1.0)


func _schedule_cloud_frame(delay: float) -> void:
    if not cloud_stream_started:
        return
    var tree := get_tree()
    if tree == null:
        return
    var timer := tree.create_timer(delay)
    timer.timeout.connect(func ():
        if cloud_stream_started and not cloud_stream_requested:
            _request_cloud_frame()
    )


func _poll_cloud_stream() -> void:
    if not cloud_stream_started or cloud_stream_client == null:
        return

    cloud_stream_client.poll()
    var status := cloud_stream_client.get_status()

    if status == HTTPClient.STATUS_CONNECTED and not cloud_stream_requested:
        var path := "/cloud/stream?id=%s&token=%s&width=%s&height=%s" % [
            cloud_id.uri_encode(),
            cloud_token.uri_encode(),
            machine_screen_width,
            machine_screen_height,
        ]
        var err := cloud_stream_client.request(HTTPClient.METHOD_GET, path, PackedStringArray())
        if err != OK:
            _set_active_screen_status("Cloud stream request failed: %s" % error_string(err))
            _stop_cloud_stream()
            return
        cloud_stream_requested = true
        cloud_stream_status = "streaming"
        _set_active_screen_status("Waiting for first frame...")
        return

    if status == HTTPClient.STATUS_BODY:
        var chunk := cloud_stream_client.read_response_body_chunk()
        if chunk.size() > 0:
            cloud_stream_buffer.append_array(chunk)
            _extract_cloud_frames()
        return

    if status == HTTPClient.STATUS_DISCONNECTED and cloud_stream_requested:
        _set_active_screen_status("Cloud stream disconnected")
        _stop_cloud_stream()


func _extract_cloud_frames() -> void:
    var header_separator := PackedByteArray([13, 10, 13, 10])
    while true:
        var header_end := _find_bytes(cloud_stream_buffer, header_separator, 0)
        if header_end < 0:
            if cloud_stream_buffer.size() > 1024 * 1024:
                cloud_stream_buffer = cloud_stream_buffer.slice(max(0, cloud_stream_buffer.size() - 4096))
            return

        var header_text := cloud_stream_buffer.slice(0, header_end).get_string_from_ascii()
        var content_length := _content_length_from_header(header_text)
        var frame_start := header_end + header_separator.size()
        if content_length <= 0:
            cloud_stream_buffer = cloud_stream_buffer.slice(frame_start)
            continue

        var frame_end := frame_start + content_length
        if cloud_stream_buffer.size() < frame_end:
            return

        var frame := cloud_stream_buffer.slice(frame_start, frame_end)
        var next_start := frame_end
        if cloud_stream_buffer.size() >= next_start + 2 and cloud_stream_buffer[next_start] == 13 and cloud_stream_buffer[next_start + 1] == 10:
            next_start += 2
        cloud_stream_buffer = cloud_stream_buffer.slice(next_start)
        _show_cloud_frame(frame)


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
    var texture: ImageTexture
    if tex_val is ImageTexture:
        texture = tex_val as ImageTexture
        if image.get_width() == texture.get_width() and image.get_height() == texture.get_height():
            texture.update(image)
        else:
            texture = ImageTexture.create_from_image(image)
            entry["stream_texture"] = texture
    else:
        texture = ImageTexture.create_from_image(image)
        entry["stream_texture"] = texture

    var mat_val: Variant = entry.get("screen_material")
    if mat_val is BaseMaterial3D:
        (mat_val as BaseMaterial3D).albedo_color = Color.WHITE
        (mat_val as BaseMaterial3D).albedo_texture = texture

    cloud_stream_frame_count += 1

    if cloud_stream_frame_count == 1 or cloud_stream_frame_count % 30 == 0:
        print("Cloud stream frame displayed: %s (%sx%s JPEG)" % [cloud_stream_frame_count, image.get_width(), image.get_height()])
        set_status("Sugar Rush yayinda | kare: %s | Space: spin" % cloud_stream_frame_count)

    if pending_spin_after_stream and cloud_stream_frame_count == 1:
        pending_spin_after_stream = false
        _spin_active_machine()


func _spin_active_machine() -> void:
    if not authenticated:
        set_status("Spin icin once giris yap")
        if auth_result_label != null:
            auth_result_label.text = "Spin atmak icin hesabina giris yap."
        return

    if active_machine_index < 0:
        if nearby_machine_index >= 0:
            _start_machine_game(nearby_machine_index, true)
        else:
            set_status("Spin icin once makineye yaklas")
        return

    if _active_machine_uses_client_render():
        pending_spin_after_stream = false
        if _send_client_render_spin(default_bet):
            _set_active_screen_status("Spin sent to client renderer | bet: %s" % default_bet)
        else:
            set_status("Client renderer input unavailable")
        return

    if cloud_id.is_empty() or cloud_token.is_empty():
        pending_spin_after_stream = true
        if not cloud_stream_started and cloud_stream_status == "inactive":
            _start_machine_game(active_machine_index, true)
        else:
            set_status("Stream hazir degil; spin siraya alindi")
        return

    _send_cloud_input({ "type": "unitySpin", "bet": default_bet })
    _set_active_screen_status("Spin sent | bet: %s" % default_bet)


func _send_cloud_input(payload: Dictionary) -> void:
    if cloud_id.is_empty() or cloud_token.is_empty():
        return


    if cloud_input_request != null:
        cloud_input_request.queue_free()

    payload["id"] = cloud_id
    payload["token"] = cloud_token
    payload["width"] = machine_screen_width
    payload["height"] = machine_screen_height

    cloud_input_request = HTTPRequest.new()
    cloud_input_request.name = "CloudInputRequest"
    add_child(cloud_input_request)
    var headers := PackedStringArray(["Content-Type: application/json"])
    var err := cloud_input_request.request("%s/cloud/input" % _base_url(), headers, HTTPClient.METHOD_POST, JSON.stringify(payload))
    if err != OK:
        set_status("Cloud input failed: %s" % error_string(err))


func _stop_cloud_stream() -> void:
    if cloud_stream_client != null:
        cloud_stream_client.close()
    cloud_stream_client = null
    if cloud_frame_request != null:
        cloud_frame_request.queue_free()
    cloud_frame_request = null
    cloud_stream_started = false
    cloud_stream_requested = false
    cloud_frame_error_count = 0
    cloud_stream_buffer.clear()


func _set_active_screen_status(text: String) -> void:
    if active_machine_index < 0 or active_machine_index >= machines.size():
        return
    _set_machine_screen_status(machines[active_machine_index], text)


func _set_machine_screen_status(_entry: Dictionary, _text: String) -> void:
    pass


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
    var base := _base_url()
    var scheme := "https"
    var rest := base
    var scheme_sep := base.find("://")
    if scheme_sep >= 0:
        scheme = base.substr(0, scheme_sep)
        rest = base.substr(scheme_sep + 3)

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


func _set_auth_mode(mode: String) -> void:
    auth_mode = "register" if mode == "register" else "login"
    _refresh_auth_ui()


func _refresh_auth_ui() -> void:
    if auth_identifier_edit != null:
        auth_identifier_edit.visible = auth_mode == "login"
    if auth_username_edit != null:
        auth_username_edit.visible = auth_mode == "register"
    if auth_email_edit != null:
        auth_email_edit.visible = auth_mode == "register"
    if auth_password_edit != null:
        auth_password_edit.placeholder_text = "Sifre"
    if auth_submit_button != null:
        auth_submit_button.text = "Giris Yap" if auth_mode == "login" else "Kayit Ol"
    if auth_login_mode_button != null:
        auth_login_mode_button.modulate = Color.WHITE if auth_mode == "login" else Color(0.72, 0.72, 0.78, 1.0)
    if auth_register_mode_button != null:
        auth_register_mode_button.modulate = Color.WHITE if auth_mode == "register" else Color(0.72, 0.72, 0.78, 1.0)
    if open_game_button != null:
        open_game_button.disabled = not authenticated or nearby_machine_index < 0


func _set_auth_busy(busy: bool) -> void:
    if auth_submit_button != null:
        auth_submit_button.disabled = busy
    if auth_login_mode_button != null:
        auth_login_mode_button.disabled = busy
    if auth_register_mode_button != null:
        auth_register_mode_button.disabled = busy


func _submit_auth() -> void:
    if auth_mode == "register":
        _register_account()
    else:
        _login_account()


func _login_account() -> void:
    var identifier := auth_identifier_edit.text.strip_edges()
    var password := auth_password_edit.text
    if identifier.is_empty() or password.is_empty():
        auth_result_label.text = "Email/kullanici adi ve sifre gerekli."
        return

    var body := JSON.stringify({ "identifier": identifier, "password": password })
    _start_auth_request("login", HTTPClient.METHOD_POST, "/api/login", body)


func _register_account() -> void:
    var username := auth_username_edit.text.strip_edges()
    var email := auth_email_edit.text.strip_edges()
    var password := auth_password_edit.text
    if username.length() < 3:
        auth_result_label.text = "Kullanici adi en az 3 karakter olmali."
        return
    if email.find("@") < 1 or email.find(".") < 3:
        auth_result_label.text = "Gecerli bir email gir."
        return
    if password.length() < 6:
        auth_result_label.text = "Sifre en az 6 karakter olmali."
        return

    var body := JSON.stringify({ "username": username, "email": email, "password": password })
    _start_auth_request("register", HTTPClient.METHOD_POST, "/api/register", body)


func _check_auth_session() -> void:
    _start_auth_request("session", HTTPClient.METHOD_GET, "/api/session", "")


func _start_auth_request(action: String, method: int, path: String, body: String) -> void:
    pending_auth_action = action
    _set_auth_busy(true)
    if auth_result_label != null:
        auth_result_label.text = "Oturum kontrol ediliyor..." if action == "session" else "Sunucuya baglaniyor..."

    if auth_request != null:
        auth_request.queue_free()

    auth_request = HTTPRequest.new()
    auth_request.name = "AuthRequest"
    add_child(auth_request)
    auth_request.request_completed.connect(_on_auth_response)

    var err := auth_request.request("%s%s" % [_base_url(), path], _auth_headers(not body.is_empty()), method, body)
    if err != OK:
        _set_auth_busy(false)
        if auth_result_label != null:
            auth_result_label.text = "Auth istegi baslatilamadi: %s" % error_string(err)


func _on_auth_response(result: int, response_code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
    _set_auth_busy(false)
    _store_auth_cookie(headers)

    var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
    var response: Dictionary = parsed if typeof(parsed) == TYPE_DICTIONARY else {}

    if result != HTTPRequest.RESULT_SUCCESS:
        if pending_auth_action == "session":
            _clear_authenticated("Giris yap veya yeni hesap olustur.")
        elif auth_result_label != null:
            auth_result_label.text = "Baglanti basarisiz: result=%s" % result
        return

    if response_code != 200:
        var message := String(response.get("error", response.get("message", "Auth basarisiz")))
        if pending_auth_action == "session":
            _clear_authenticated("Oturum suresi doldu. Tekrar giris yap.")
        elif auth_result_label != null:
            auth_result_label.text = message
        return

    if pending_auth_action == "session" and not bool(response.get("authenticated", false)):
        _clear_authenticated("Giris yap veya yeni hesap olustur.")
        return

    if pending_auth_action != "session" and not bool(response.get("ok", false)):
        if auth_result_label != null:
            auth_result_label.text = String(response.get("error", "Auth basarisiz"))
        return

    var player_value: Variant = response.get("player", {})
    if not player_value is Dictionary:
        if auth_result_label != null:
            auth_result_label.text = "Oyuncu bilgisi eksik."
        return

    _apply_authenticated_player(player_value as Dictionary)


func _apply_authenticated_player(player: Dictionary) -> void:
    player_id = String(player.get("id", player_id))
    player_name = String(player.get("username", player.get("name", player_id)))
    player_email = String(player.get("email", player_email))
    session_id = player_id
    authenticated = true
    if auth_password_edit != null:
        auth_password_edit.text = ""
    _save_player_profile()
    _refresh_player_ui()
    _refresh_auth_ui()
    if _screen_state != "auth":
        _reconnect_balance_socket()
    if auth_result_label != null:
        auth_result_label.text = "Hazir: %s" % player_id
    if _screen_state == "auth":
        _on_auth_success()


func _clear_authenticated(message: String) -> void:
    authenticated = false
    auth_cookie = ""
    if websocket_started:
        websocket.close()
    websocket_started = false
    if balance_label != null:
        balance_label.text = "Bakiye: giris bekleniyor"
    _save_player_profile()
    _refresh_player_ui()
    _refresh_auth_ui()
    if auth_result_label != null:
        auth_result_label.text = message


func _auth_headers(json_body: bool = false) -> PackedStringArray:
    var headers := PackedStringArray()
    if json_body:
        headers.append("Content-Type: application/json")
    if not auth_cookie.is_empty():
        headers.append("Cookie: %s" % auth_cookie)
    return headers


func _store_auth_cookie(headers: PackedStringArray) -> void:
    for header in headers:
        var raw := String(header)
        if not raw.to_lower().begins_with("set-cookie:"):
            continue
        var value := raw.substr(raw.find(":") + 1).strip_edges()
        var cookie_pair := value.split(";", false)[0].strip_edges()
        if cookie_pair.begins_with("casinoAuth="):
            auth_cookie = cookie_pair
            return


func _load_player_profile() -> void:
    var config := ConfigFile.new()
    if config.load(PROFILE_PATH) == OK:
        player_id = String(config.get_value("player", "id", player_id))
        player_name = String(config.get_value("player", "name", player_name))
        player_email = String(config.get_value("player", "email", player_email))
        auth_cookie = String(config.get_value("player", "auth_cookie", auth_cookie))
    session_id = player_id


func _save_player_profile() -> void:
    var config := ConfigFile.new()
    config.set_value("player", "id", player_id)
    config.set_value("player", "name", player_name)
    config.set_value("player", "email", player_email)
    config.set_value("player", "auth_cookie", auth_cookie)
    var err := config.save(PROFILE_PATH)
    if err != OK:
        push_warning("Could not save player profile: %s" % error_string(err))


func _refresh_player_ui() -> void:
    if player_label != null:
        player_label.text = "%s | ID: %s" % [player_name, player_id] if authenticated else "Giris bekleniyor"
    if auth_identifier_edit != null and not authenticated:
        auth_identifier_edit.text = player_email if not player_email.is_empty() else player_id
    if auth_username_edit != null and not authenticated:
        auth_username_edit.text = player_id
    if auth_email_edit != null and not authenticated:
        auth_email_edit.text = player_email


func _refresh_machine_ui() -> void:
    if machine_label == null:
        return

    var nearby_text := "none"
    if nearby_machine_index >= 0 and nearby_machine_index < machines.size():
        nearby_text = String(machines[nearby_machine_index].get("id", "slot"))

    machine_label.text = "Makineler: %s | Yakinda: %s | Carpisma: harita %s, makine %s" % [machines.size(), nearby_text, map_collider_count, machine_collider_count]
    if open_game_button != null:
        open_game_button.disabled = not authenticated or nearby_machine_index < 0


func _connect_config_socket() -> void:
    config_websocket = WebSocketPeer.new()
    var socket_url := _base_url().replace("https://", "wss://").replace("http://", "ws://")
    socket_url += "/?game=admin"

    var err := config_websocket.connect_to_url(socket_url)
    if err != OK:
        push_warning("Config socket failed: %s" % error_string(err))
        return

    config_websocket_started = true


func _connect_balance_socket() -> void:
    websocket = WebSocketPeer.new()
    var socket_url := _base_url().replace("https://", "wss://").replace("http://", "ws://")
    socket_url += "/?game=balance&sessionID=%s" % session_id.uri_encode()
    if not auth_cookie.is_empty():
        websocket.set("handshake_headers", PackedStringArray(["Cookie: %s" % auth_cookie]))

    var err := websocket.connect_to_url(socket_url)
    if err != OK:
        if balance_label != null:
            balance_label.text = "Bakiye: baglanti hatasi (%s)" % error_string(err)
        return

    websocket_started = true
    websocket_last_state = websocket.get_ready_state()
    if balance_label != null:
        balance_label.text = "Bakiye: baglaniyor..."


func _reconnect_balance_socket() -> void:
    if websocket_started:
        websocket.close()
    websocket_started = false
    _connect_balance_socket()


func _update_socket_status(state: WebSocketPeer.State) -> void:
    if balance_label == null:
        return
    match state:
        WebSocketPeer.STATE_CONNECTING:
            balance_label.text = "Bakiye: baglaniyor..."
        WebSocketPeer.STATE_OPEN:
            balance_label.text = "Bakiye: baglandi"
            print("Balance socket connected")
        WebSocketPeer.STATE_CLOSING:
            balance_label.text = "Bakiye: kapaniyor..."
        WebSocketPeer.STATE_CLOSED:
            balance_label.text = "Bakiye: kapandi"


func _to_vector3(value: Variant, fallback: Vector3) -> Vector3:
    if typeof(value) != TYPE_ARRAY or value.size() < 3:
        return fallback
    return Vector3(float(value[0]), float(value[1]), float(value[2]))


func _cache_path(file_name: String) -> String:
    var safe_name := file_name.replace("/", "_").replace("\\", "_")
    return "user://%s" % safe_name


func _local_asset_path(kind: String, file_name: String) -> String:
    var safe_name := file_name.replace("\\", "/").trim_prefix("/")
    if safe_name.contains("../"):
        return ""
    var candidate := ProjectSettings.globalize_path("res://../%s/%s" % [kind, safe_name])
    return candidate if FileAccess.file_exists(candidate) else ""


func _hot_restart() -> void:
    if hot_reload_in_progress:
        return
    hot_reload_in_progress = true
    var state := {
        "session_id": session_id,
        "px": player_body.global_position.x,
        "py": player_body.global_position.y,
        "pz": player_body.global_position.z,
        "ry": player_body.rotation.y,
        "cx": camera.rotation.x,
    }
    var file := FileAccess.open("user://.hotreload", FileAccess.WRITE)
    if file:
        file.store_var(state)
        file.close()
    set_status("Hot reloading scripts...")
    var http := HTTPRequest.new()
    http.name = "HotReloadRequest"
    add_child(http)
    http.request_completed.connect(_on_hotreload_response)
    http.request("%s/dev-script/main.gd" % _base_url())


func _on_hotreload_response(res: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
    if res != HTTPRequest.RESULT_SUCCESS or code != 200:
        set_status("Hot reload HTTP failed: %s %s" % [res, code])
        hot_reload_in_progress = false
        return
    var source := body.get_string_from_utf8()
    var new_script := GDScript.new()
    new_script.source_code = source
    var err := new_script.reload()
    if err != OK:
        set_status("Script compile error: %s" % error_string(err))
        hot_reload_in_progress = false
        return
    set_script(new_script)
    if is_inside_tree():
        call_deferred("_ready")


func _check_hot_reload_state() -> bool:
    var file := FileAccess.open("user://.hotreload", FileAccess.READ)
    if not file:
        return false
    var state: Dictionary = file.get_var()
    file.close()
    DirAccess.remove_absolute("user://.hotreload")
    var sid: String = state.get("session_id", "")
    if not sid.is_empty():
        session_id = sid
    var px: float = state.get("px", 0.0)
    var py: float = state.get("py", 0.0)
    var pz: float = state.get("pz", 0.0)
    var ry: float = state.get("ry", 0.0)
    var cx: float = state.get("cx", 0.0)
    if player_body != null:
        player_body.global_position = Vector3(px, py, pz)
        player_body.rotation.y = ry
    if camera != null:
        camera.rotation.x = cx
    set_status("Hot reload complete")
    return true


func _base_url() -> String:
    return server_base.trim_suffix("/")


func set_status(text: String) -> void:
    if status_label != null:
        status_label.text = text
    if _loading_status_label != null:
        _loading_status_label.text = text
    print(text)
