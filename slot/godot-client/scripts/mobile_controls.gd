extends Control

signal movement_vector(x: float, y: float)
signal look_delta(dx: float, dy: float)
signal action_sit()
signal action_screen()
signal action_spin()
signal action_reload()

@export var joystick_radius := 80.0
@export var joystick_deadzone := 12.0
@export var look_sensitivity := 0.15

const UI_TEXT := Color(0.98, 0.96, 0.88, 0.92)
const UI_PANEL := Color(0.035, 0.018, 0.060, 0.38)
const UI_GOLD := Color(1.0, 0.710, 0.230, 0.90)
const UI_PINK := Color(0.980, 0.180, 0.470, 0.86)
const UI_CYAN := Color(0.250, 0.850, 1.0, 0.82)
const UI_GREEN := Color(0.340, 0.950, 0.520, 0.82)

var _joystick_touch_id := -1
var _joystick_center := Vector2(120.0, 0.0)
var _joystick_base_pos := Vector2.ZERO
var _joystick_knob_pos := Vector2.ZERO
var _joystick_active := false

var _look_touch_id := -1
var _look_last_pos := Vector2.ZERO
var _look_active := false

var _screen_size := Vector2.ZERO


func _ready() -> void:
    mouse_filter = MOUSE_FILTER_IGNORE
    _refresh_layout()


func _notification(what: int) -> void:
    if what == NOTIFICATION_RESIZED:
        _refresh_layout()


func _refresh_layout() -> void:
    _screen_size = get_viewport().get_visible_rect().size
    _joystick_center = Vector2(joystick_radius + 28.0, _screen_size.y - joystick_radius - 118.0)
    _joystick_base_pos = _joystick_center
    if not _joystick_active:
        _joystick_knob_pos = _joystick_base_pos
    queue_redraw()


func _input(event: InputEvent) -> void:
    if event is InputEventScreenTouch:
        _handle_touch(event)
    elif event is InputEventScreenDrag:
        _handle_drag(event)


func _handle_touch(event: InputEventScreenTouch) -> void:
    var pos := event.position
    var in_joystick := pos.distance_to(_joystick_center) < joystick_radius * 1.5

    if event.pressed:
        if in_joystick and _joystick_touch_id < 0:
            _joystick_touch_id = event.index
            _joystick_active = true
            _joystick_base_pos = _joystick_center
            _update_joystick(pos)
            return

        var btn_area := _button_area()
        for action in btn_area:
            var rect: Rect2 = btn_area[action]
            if rect.has_point(pos):
                _handle_button(action)
                return

        if pos.x > _screen_size.x * 0.5 and _look_touch_id < 0:
            _look_touch_id = event.index
            _look_active = true
            _look_last_pos = pos
            queue_redraw()
            return
    else:
        if event.index == _joystick_touch_id:
            _joystick_touch_id = -1
            _joystick_active = false
            movement_vector.emit(0.0, 0.0)
            queue_redraw()
        if event.index == _look_touch_id:
            _look_touch_id = -1
            _look_active = false
            queue_redraw()


func _handle_drag(event: InputEventScreenDrag) -> void:
    if event.index == _joystick_touch_id and _joystick_active:
        _update_joystick(event.position)

    if event.index == _look_touch_id and _look_active:
        var delta := event.position - _look_last_pos
        _look_last_pos = event.position
        look_delta.emit(delta.x * look_sensitivity, delta.y * look_sensitivity)


func _update_joystick(touch_pos: Vector2) -> void:
    var offset := touch_pos - _joystick_base_pos
    var dist := offset.length()
    if dist < joystick_deadzone:
        _joystick_knob_pos = _joystick_base_pos
        movement_vector.emit(0.0, 0.0)
    else:
        var clamped: Vector2 = offset.normalized() * min(dist, joystick_radius)
        _joystick_knob_pos = _joystick_base_pos + clamped
        var norm: Vector2 = clamped / joystick_radius
        movement_vector.emit(norm.x, norm.y)
    queue_redraw()


func _button_area() -> Dictionary:
    var w := _screen_size.x
    var h := _screen_size.y
    var bw := 84.0
    var bh := 84.0
    var gap := 16.0
    var margin := 20.0
    var bottom := h - margin - bh
    return {
        "sit": Rect2(w - margin - bw * 3.0 - gap * 2.0, bottom, bw, bh),
        "screen": Rect2(w - margin - bw * 2.0 - gap, bottom, bw, bh),
        "spin": Rect2(w - margin - bw, bottom, bw, bh),
        "reload": Rect2(w - margin - bw, bottom - bh - gap, bw, bh),
    }


func _handle_button(action: String) -> void:
    match action:
        "sit": action_sit.emit()
        "screen": action_screen.emit()
        "spin": action_spin.emit()
        "reload": action_reload.emit()


func _draw() -> void:
    var bottom_band := Rect2(0.0, _screen_size.y - 220.0, _screen_size.x, 220.0)
    draw_rect(bottom_band, UI_PANEL, true)

    draw_circle(_joystick_base_pos + Vector2(0.0, 8.0), joystick_radius + 12.0, Color(0.0, 0.0, 0.0, 0.24))
    draw_circle(_joystick_base_pos, joystick_radius + 10.0, Color(0.090, 0.040, 0.120, 0.38))
    draw_arc(_joystick_base_pos, joystick_radius + 8.0, 0.0, TAU, 96, Color(UI_CYAN.r, UI_CYAN.g, UI_CYAN.b, 0.42), 3.0, true)
    draw_circle(_joystick_base_pos, joystick_radius * 0.62, Color(1.0, 1.0, 1.0, 0.06))

    var knob_color := Color(UI_CYAN.r, UI_CYAN.g, UI_CYAN.b, 0.62) if _joystick_active else Color(1.0, 1.0, 1.0, 0.18)
    draw_circle(_joystick_knob_pos, joystick_radius * 0.38, knob_color)
    draw_arc(_joystick_knob_pos, joystick_radius * 0.38, 0.0, TAU, 64, Color(1.0, 1.0, 1.0, 0.42), 2.0, true)

    var btn_area := _button_area()
    _draw_action_button(btn_area["sit"], Color(UI_CYAN.r, UI_CYAN.g, UI_CYAN.b, 0.38), UI_CYAN, "OTUR")
    _draw_action_button(btn_area["screen"], Color(UI_GOLD.r, UI_GOLD.g, UI_GOLD.b, 0.36), UI_GOLD, "EKRAN")
    _draw_action_button(btn_area["spin"], Color(UI_PINK.r, UI_PINK.g, UI_PINK.b, 0.54), UI_PINK, "SPIN")
    _draw_action_button(btn_area["reload"], Color(UI_GREEN.r, UI_GREEN.g, UI_GREEN.b, 0.34), UI_GREEN, "YENI")

    var font := ThemeDB.fallback_font
    if font:
        draw_string(font, _joystick_base_pos + Vector2(-34.0, joystick_radius + 34.0), "HAREKET", HORIZONTAL_ALIGNMENT_CENTER, -1, 12, UI_TEXT)
        var look_text := "BAKIS ALANI" if not _look_active else "BAKIS"
        draw_string(font, Vector2(_screen_size.x * 0.58, _screen_size.y - 184.0), look_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1.0, 1.0, 1.0, 0.44))


func _draw_action_button(rect: Rect2, fill: Color, border: Color, label: String) -> void:
    var center := rect.get_center()
    var radius: float = min(rect.size.x, rect.size.y) * 0.5
    draw_circle(center + Vector2(0.0, 6.0), radius, Color(0.0, 0.0, 0.0, 0.28))
    draw_circle(center, radius, fill)
    draw_arc(center, radius - 2.0, 0.0, TAU, 72, border, 3.0, true)
    draw_arc(center, radius - 10.0, -PI * 0.15, PI * 1.15, 48, Color(1.0, 1.0, 1.0, 0.22), 2.0, true)

    var font := ThemeDB.fallback_font
    if font:
        var font_size := 13
        var text_size: Vector2 = font.get_string_size(label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size)
        var label_pos := Vector2(center.x - text_size.x * 0.5, center.y + text_size.y * 0.35)
        draw_string(font, label_pos, label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, Color.WHITE)
