mod config;
mod i18n;
mod input;
mod phrase_wheel;
mod runtime_cache;
mod send_policy;
mod states;
#[cfg(test)]
mod send_policy_test;
#[cfg(test)]
#[path = "../credential_build.rs"]
mod credential_build;
#[cfg(windows)]
mod win32;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};

use config::{
    normalize_profile_exe, ChatRef, Config, DirectionSettings, PhraseWheelSettings, Profile,
    ProfileMode, RelaySettings, Zone, TRANSPORT_RELAY, TRANSPORT_TELEGRAM,
};
use runtime_cache::{direction_cache_key, runtime_cache_path, RuntimeCacheV1};

/// Telegram application keys, embedded scrambled by build.rs.
mod credentials {
    include!(concat!(env!("OUT_DIR"), "/credentials.rs"));
}
use serde::Serialize;
use states::{Effect, Event, Kind, State};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const OVERLAY: &str = "overlay";
const MAIN: &str = "main";
const TELEGRAM_WORKER: &str = "telegram";
const RELAY_WORKER: &str = "relay";

static APP: OnceLock<AppHandle> = OnceLock::new();
static DIRECTION_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static PHRASE_WHEEL_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub struct AppState {
    config: Mutex<Config>,
    hotkey_sync: Mutex<()>,
    state: Mutex<State>,
    game_foreground: Mutex<bool>,
    single_key_open_pending: AtomicBool,
    /// Hotkeys that could not be registered, published as one warning line.
    shortcut_errors: Mutex<ShortcutErrors>,
    config_path: PathBuf,
    runtime_cache: Mutex<RuntimeCacheV1>,
    runtime_cache_path: PathBuf,
    markup: Mutex<bool>,
    /// Paused from the tray: the overlay stays out of the way entirely.
    paused: Mutex<bool>,
    /// True once the Telegram worker reports a live connection.
    connected: Mutex<bool>,
    /// Latest worker status, retained so a freshly opened settings window cannot miss it.
    telegram_status: Mutex<serde_json::Value>,
    /// True after the Telegram window has installed its event listeners.
    telegram_worker_ready: Mutex<bool>,
    /// Retains an overlay history request until the Telegram window is ready.
    pending_history_request: Mutex<bool>,
    phrase_wheel: Mutex<phrase_wheel::WheelLifecycle>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    kind: Kind,
    game_exe: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ZonesPayload {
    inactive: Zone,
    active: Zone,
    ttl_ms: u64,
    opacity: f64,
    font_scale: f64,
    text_color: String,
    author_color: String,
    shadow: f64,
    fade_ms: u64,
    sticker_animation_seconds: u64,
    message_layout: String,
    show_author: bool,
    show_message_time: bool,
    incoming_bubble_color: String,
    outgoing_bubble_color: String,
    direction_display_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagePayload {
    id: String,
    author: String,
    text: String,
    at: u64,
    outgoing: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhraseWheelPayload {
    active: bool,
    phrases: Vec<String>,
    selected_index: Option<usize>,
    origin_x: Option<i32>,
    origin_y: Option<i32>,
    cancel_radius_px: Option<u32>,
}

/// Opt-in tracing to %TEMP%\tg-game-overlay.log (set TGO_LOG=1): the dev
/// server swallows stdout on Windows.
fn log(line: &str) {
    use std::io::Write;
    if std::env::var("TGO_LOG").is_err() {
        return;
    }
    let path = std::env::temp_dir().join("tg-game-overlay.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{} {}", now_ms(), line);
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn is_single_key_shortcut(hotkey: &str) -> bool {
    !hotkey.contains('+')
}

/// Settings store and show the Windows key as "Win", while global-hotkey only
/// understands "Super", so the name is swapped right before parsing.
fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    hotkey
        .split('+')
        .map(|part| {
            if part.trim().eq_ignore_ascii_case("win") {
                "Super"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("+")
        .parse::<Shortcut>()
        .map_err(|error| error.to_string())
}

fn should_register_chat_shortcut(
    hotkey: &str,
    kind: Kind,
    markup: bool,
    paused: bool,
    game_foreground: bool,
) -> bool {
    !is_single_key_shortcut(hotkey)
        || (kind == Kind::Inactive && game_foreground && !markup && !paused)
}

fn chat_shortcut_error_after_attempt(
    previous: Option<&str>,
    hotkey: &str,
    attempt: Option<Result<(), String>>,
) -> Option<String> {
    match attempt {
        None => previous.map(str::to_owned),
        Some(Ok(())) => None,
        Some(Err(error)) => Some(format!(
            "Не удалось включить клавишу {hotkey}: {error}. Выберите другое сочетание в настройках."
        )),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShortcutSlot {
    Chat,
    Markup,
    PhraseWheel,
}

/// One registration error per hotkey, so that a success for one of them never
/// clears a failure reported for another.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ShortcutErrors {
    chat: Option<String>,
    markup: Option<String>,
    phrase_wheel: Option<String>,
}

impl ShortcutErrors {
    fn slot_mut(&mut self, slot: ShortcutSlot) -> &mut Option<String> {
        match slot {
            ShortcutSlot::Chat => &mut self.chat,
            ShortcutSlot::Markup => &mut self.markup,
            ShortcutSlot::PhraseWheel => &mut self.phrase_wheel,
        }
    }

    /// The pages show a single line; the chat key matters most.
    fn published(&self) -> Option<String> {
        self.chat
            .clone()
            .or_else(|| self.markup.clone())
            .or_else(|| self.phrase_wheel.clone())
    }
}

fn published_shortcut_error(app: &AppHandle) -> Option<String> {
    app.state::<AppState>().shortcut_errors.lock().unwrap().published()
}

fn set_shortcut_error(app: &AppHandle, slot: ShortcutSlot, error: Option<String>) {
    let app_state = app.state::<AppState>();
    let mut errors = app_state.shortcut_errors.lock().unwrap();
    let before = errors.published();
    *errors.slot_mut(slot) = error;
    let after = errors.published();
    drop(errors);
    if before != after {
        let _ = app.emit("overlay:chat_shortcut_error", after);
    }
}

fn sync_single_key_chat_shortcut(app: &AppHandle) {
    let app_state = app.state::<AppState>();
    let _sync_guard = app_state.hotkey_sync.lock().unwrap();
    let config = app_state.config.lock().unwrap().clone();
    let hotkey = config.hotkey.as_str();
    if !is_single_key_shortcut(hotkey) {
        return;
    }

    let kind = app_state.state.lock().unwrap().kind;
    let markup = *app_state.markup.lock().unwrap();
    let paused = *app_state.paused.lock().unwrap();
    let game_foreground = *app_state.game_foreground.lock().unwrap();
    let should_register =
        should_register_chat_shortcut(hotkey, kind, markup, paused, game_foreground);
    let Ok(shortcut) = parse_hotkey(hotkey) else {
        return;
    };
    let manager = app.global_shortcut();

    if should_register {
        let attempt = if manager.is_registered(shortcut.clone()) {
            Ok(())
        } else {
            manager.register(shortcut).map_err(|error| error.to_string())
        };
        if let Err(error) = &attempt {
            log(&format!("failed to register chat key {hotkey}: {error}"));
        }
        let previous = app_state.shortcut_errors.lock().unwrap().chat.clone();
        let error = chat_shortcut_error_after_attempt(previous.as_deref(), hotkey, Some(attempt));
        set_shortcut_error(app, ShortcutSlot::Chat, error);
    } else if manager.is_registered(shortcut.clone()) {
        match manager.unregister(shortcut) {
            Ok(()) => set_shortcut_error(app, ShortcutSlot::Chat, None),
            Err(error) => {
                log(&format!("failed to unregister chat key {hotkey}: {error}"));
                set_shortcut_error(app, ShortcutSlot::Chat, Some(format!(
                    "Не удалось освободить клавишу {hotkey}: {error}. Перезапустите приложение."
                )));
            }
        }
    }
}

fn schedule_single_key_chat_shortcut_sync(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || sync_single_key_chat_shortcut(&app));
}

/// Only the overlay itself keeps the current state. Every other window of the
/// app (settings, dialogs, the tray menu) is not the game: it hides the overlay
/// like a foreign application and can never match a profile, whatever the exe.
fn foreground_event(
    hwnd: isize,
    exe: Option<String>,
    is_own: bool,
    overlay_hwnd: Option<isize>,
) -> Event {
    Event::Foreground {
        exe: if is_own { None } else { exe },
        hwnd,
        is_overlay: overlay_hwnd == Some(hwnd),
    }
}

fn overlay_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY)
}

fn overlay_hwnd(app: &AppHandle) -> Option<isize> {
    #[cfg(windows)]
    {
        overlay_window(app)
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

fn push_config(app: &AppHandle, config: &Config) {
    let _ = app.emit("config:changed", config);
    push_zones(app, config);
}

fn push_zones(app: &AppHandle, config: &Config) {
    let state = app.state::<AppState>();
    let exe = state.state.lock().unwrap().game_exe.clone();
    let profile = exe.as_deref().and_then(|exe| config.profile(exe));
    let (inactive, active) = match profile {
        Some(profile) => (profile.inactive, profile.active),
        None => {
            let fallback = Profile::new(String::new(), String::new());
            (fallback.inactive, fallback.active)
        }
    };

    let _ = app.emit(
        "overlay:zones",
        ZonesPayload {
            inactive,
            active,
            ttl_ms: config.ttl_ms,
            opacity: config.opacity,
            font_scale: config.font_scale,
            text_color: config.text_color.clone(),
            author_color: config.author_color.clone(),
            shadow: config.shadow,
            fade_ms: config.fade_ms,
            sticker_animation_seconds: config.sticker_animation_seconds,
            message_layout: config.message_layout.clone(),
            show_author: config.show_author,
            show_message_time: config.show_message_time,
            incoming_bubble_color: config.incoming_bubble_color.clone(),
            outgoing_bubble_color: config.outgoing_bubble_color.clone(),
            direction_display_ms: config.direction_signals.display_ms,
        },
    );
}

fn emit_history_request(app: &AppHandle) {
    let _ = app.emit("tg:history_request", serde_json::json!({}));
}

fn request_telegram_history(app: &AppHandle) {
    let state = app.state::<AppState>();
    let worker_ready = state.telegram_worker_ready.lock().unwrap();
    if *worker_ready {
        drop(worker_ready);
        emit_history_request(app);
    } else {
        *state.pending_history_request.lock().unwrap() = true;
    }
}

/// Places the overlay over the whole game window; zones are laid out inside it.
fn align_overlay(app: &AppHandle, game_hwnd: Option<isize>) {
    #[cfg(windows)]
    {
        let (Some(window), Some(hwnd)) = (overlay_window(app), game_hwnd) else {
            return;
        };
        let Some(rect) = win32::window_rect(hwnd) else {
            return;
        };
        if rect.width <= 0 || rect.height <= 0 {
            return;
        }

        let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
        let _ = window.set_size(PhysicalSize::new(rect.width as u32, rect.height as u32));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, game_hwnd);
    }
}

fn set_click_through(app: &AppHandle, on: bool) {
    if let Some(window) = overlay_window(app) {
        let _ = window.set_ignore_cursor_events(on);
    }

    #[cfg(windows)]
    if let Some(hwnd) = overlay_hwnd(app) {
        // The overlay must not take focus away from the game while it is passive.
        win32::set_no_activate(hwnd, on);
        log(&format!("click_through={on} hwnd={hwnd:#x}"));
    }
}

fn apply_effect(app: &AppHandle, effect: Effect, state: &State) {
    let Some(window) = overlay_window(app) else {
        return;
    };

    match effect {
        Effect::Show => {
            align_overlay(app, state.game_hwnd);
            // Markup started from the settings window survives switching to the game.
            set_click_through(app, !*app.state::<AppState>().markup.lock().unwrap());
            let _ = window.show();
        }
        Effect::Hide | Effect::Disable => {
            let _ = window.hide();
        }
        Effect::Activate => {
            align_overlay(app, state.game_hwnd);
            set_click_through(app, false);
            let _ = window.show();
            let _ = window.set_focus();
        }
        Effect::Deactivate => {
            #[cfg(windows)]
            if let Some(hwnd) = state.game_hwnd {
                win32::focus_window(hwnd);
            }
            set_click_through(app, !*app.state::<AppState>().markup.lock().unwrap());
        }
    }
}

fn dispatch(app: &AppHandle, event: Event) {
    let app_state = app.state::<AppState>();
    if *app_state.paused.lock().unwrap() {
        return;
    }
    let config = app_state.config.lock().unwrap().clone();
    let previous = app_state.state.lock().unwrap().clone();

    let lookup = |exe: Option<&str>| -> Option<ProfileMode> {
        exe.and_then(|exe| config.profile(exe))
            .map(|profile| profile.mode)
    };
    let result = states::transition(&previous, &event, &lookup);
    let next = result.state.clone();

    *app_state.state.lock().unwrap() = next.clone();
    match &event {
        Event::Foreground { is_overlay, .. } => {
            *app_state.game_foreground.lock().unwrap() =
                !*is_overlay && next.kind == Kind::Inactive;
        }
        Event::Hotkey if previous.kind == Kind::Inactive && next.kind == Kind::Active => {
            *app_state.game_foreground.lock().unwrap() = false;
        }
        Event::Hotkey if previous.kind == Kind::Active && next.kind == Kind::Inactive => {
            *app_state.game_foreground.lock().unwrap() = true;
        }
        Event::Dismiss if next.kind == Kind::Inactive => {
            *app_state.game_foreground.lock().unwrap() = true;
        }
        _ => {}
    }
    if previous.kind == Kind::Inactive && next.kind != Kind::Inactive {
        cancel_phrase_wheel(app);
    }
    // Keyed on the event, not on a Hide effect: markup started from the settings
    // window begins in Hidden, and Hidden to Hidden produces no effect at all.
    if matches!(event, Event::Foreground { is_overlay: false, .. })
        && matches!(next.kind, Kind::Hidden | Kind::Off)
    {
        stop_markup(app);
    }

    for effect in result.effects {
        log(&format!(
            "effect {effect:?} for {:?} exe={:?}",
            next.kind, next.game_exe
        ));
        apply_effect(app, effect, &next);
    }
    sync_single_key_chat_shortcut(app);

    if previous.kind != next.kind || previous.game_exe != next.game_exe {
        let _ = app.emit(
            "overlay:state",
            StatePayload {
                kind: next.kind,
                game_exe: next.game_exe.clone(),
            },
        );
        push_zones(app, &config);
    }
}

fn save_config(app: &AppHandle, config: Config) -> Result<Config, String> {
    let app_state = app.state::<AppState>();
    config.save(&app_state.config_path)?;
    *app_state.config.lock().unwrap() = config.clone();
    push_config(app, &config);
    Ok(config)
}

#[tauri::command]
fn sync_overlay(app: AppHandle) {
    log("sync_overlay requested by the page");
    let state = app.state::<AppState>().state.lock().unwrap().clone();
    let config = app.state::<AppState>().config.lock().unwrap().clone();
    let _ = app.emit(
        "overlay:state",
        StatePayload {
            kind: state.kind,
            game_exe: state.game_exe.clone(),
        },
    );
    push_zones(&app, &config);
    let _ = app.emit("overlay:chat_shortcut_error", published_shortcut_error(&app));
    request_telegram_history(&app);
}

#[tauri::command]
fn tg_worker_ready(app: AppHandle) {
    let state = app.state::<AppState>();
    let mut worker_ready = state.telegram_worker_ready.lock().unwrap();
    *worker_ready = true;
    let pending = std::mem::take(&mut *state.pending_history_request.lock().unwrap());
    drop(worker_ready);
    if pending {
        emit_history_request(&app);
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    app.state::<AppState>().config.lock().unwrap().clone()
}

#[tauri::command]
fn get_chat_shortcut_error(app: AppHandle) -> Option<String> {
    published_shortcut_error(&app)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedSettings {
    ttl_ms: u64,
    opacity: f64,
    font_scale: f64,
    text_color: Option<String>,
    author_color: Option<String>,
    shadow: Option<f64>,
    fade_ms: Option<u64>,
    sticker_animation_seconds: Option<u64>,
    message_layout: Option<String>,
    show_author: Option<bool>,
    show_message_time: Option<bool>,
    incoming_bubble_color: Option<String>,
    outgoing_bubble_color: Option<String>,
}

fn is_hex_color(value: &str) -> bool {
    let body = value.strip_prefix('#').unwrap_or("");
    matches!(body.len(), 3 | 6) && body.chars().all(|c| c.is_ascii_hexdigit())
}

#[tauri::command]
fn set_feed_settings(
    app: AppHandle,
    window: WebviewWindow,
    settings: FeedSettings,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let mut config = get_config(app.clone());
    config.ttl_ms = settings.ttl_ms.clamp(3_000, 60_000);
    config.opacity = settings.opacity.clamp(0.0, 1.0);
    config.font_scale = settings.font_scale.clamp(0.6, 2.0);
    if let Some(color) = settings.text_color.filter(|value| is_hex_color(value)) {
        config.text_color = color;
    }
    if let Some(color) = settings.author_color.filter(|value| is_hex_color(value)) {
        config.author_color = color;
    }
    if let Some(shadow) = settings.shadow {
        config.shadow = shadow.clamp(0.0, 1.0);
    }
    if let Some(fade) = settings.fade_ms {
        config.fade_ms = fade.clamp(0, 5_000);
    }
    if let Some(seconds) = settings.sticker_animation_seconds {
        config.sticker_animation_seconds = seconds.min(60);
    }
    if let Some(layout) = settings
        .message_layout
        .filter(|value| matches!(value.as_str(), "compact" | "dialogue"))
    {
        config.message_layout = layout;
    }
    if let Some(show_author) = settings.show_author {
        config.show_author = show_author;
    }
    if let Some(show_message_time) = settings.show_message_time {
        config.show_message_time = show_message_time;
    }
    if let Some(color) = settings
        .incoming_bubble_color
        .filter(|value| is_hex_color(value))
    {
        config.incoming_bubble_color = color;
    }
    if let Some(color) = settings
        .outgoing_bubble_color
        .filter(|value| is_hex_color(value))
    {
        config.outgoing_bubble_color = color;
    }
    save_config(&app, config)
}

#[tauri::command]
fn set_language(app: AppHandle, window: WebviewWindow, language: String) -> Result<Config, String> {
    require_main_window(&window)?;
    if !matches!(language.as_str(), "auto" | "en" | "ru" | "zh") {
        return Err(format!("Неизвестный язык: {language}"));
    }
    let mut config = get_config(app.clone());
    config.language = language;
    let config = save_config(&app, config)?;
    refresh_tray_text(&app);
    Ok(config)
}

/// Name of the HKCU Run value, after the product.
const AUTOSTART_VALUE: &str = "tg-game-overlay";

/// Points the Run value at the running executable, so a moved install heals
/// itself on the next start, or removes the value.
fn apply_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let command = if enabled {
            let exe = std::env::current_exe()
                .map_err(|error| format!("Не удалось настроить автозапуск: {error}"))?;
            Some(format!("\"{}\"", exe.display()))
        } else {
            None
        };
        win32::set_run_at_login(AUTOSTART_VALUE, command.as_deref())
            .map_err(|error| format!("Не удалось настроить автозапуск: {error}"))
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
fn set_flags(
    app: AppHandle,
    window: WebviewWindow,
    autostart: bool,
    demo_feed: bool,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let mut config = get_config(app.clone());
    let previous_autostart = config.autostart;
    apply_autostart(autostart)?;
    config.autostart = autostart;
    config.demo_feed = demo_feed;
    save_config(&app, config).inspect_err(|_| {
        if let Err(error) = apply_autostart(previous_autostart) {
            log(&format!("failed to roll back autostart: {error}"));
        }
    })
}

#[tauri::command]
fn set_hotkey(
    app: AppHandle,
    window: WebviewWindow,
    hotkey: String,
    markup: Option<bool>,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let shortcut = parse_hotkey(&hotkey)
        .map_err(|_| format!("Не удалось разобрать сочетание: {hotkey}"))?;

    let mut config = get_config(app.clone());
    let is_markup_shortcut = markup.unwrap_or(false);
    if is_markup_shortcut && is_single_key_shortcut(&hotkey) {
        return Err("Для режима разметки нужна комбинация с Ctrl, Alt, Shift или Win".into());
    }

    let previous = if is_markup_shortcut {
        config.markup_hotkey.clone()
    } else {
        config.hotkey.clone()
    };

    if parse_hotkey(&previous).ok().as_ref() == Some(&shortcut) {
        return Ok(config);
    }
    let other = if is_markup_shortcut {
        &config.hotkey
    } else {
        &config.markup_hotkey
    };
    if parse_hotkey(other).ok().as_ref() == Some(&shortcut)
        || parse_hotkey(&config.phrase_wheel.hotkey).ok().as_ref() == Some(&shortcut)
    {
        return Err("Это сочетание уже используется другой функцией приложения".into());
    }

    let app_state = app.state::<AppState>();
    let kind = app_state.state.lock().unwrap().kind;
    let runtime_markup = *app_state.markup.lock().unwrap();
    let paused = *app_state.paused.lock().unwrap();
    let game_foreground = *app_state.game_foreground.lock().unwrap();
    let _hotkey_sync_guard = app_state.hotkey_sync.lock().unwrap();
    let register_new = is_markup_shortcut
        || should_register_chat_shortcut(&hotkey, kind, runtime_markup, paused, game_foreground);
    let unregister_old = is_markup_shortcut
        || should_register_chat_shortcut(&previous, kind, runtime_markup, paused, game_foreground);
    let mut registered_new = false;
    let manager = app.global_shortcut();

    for step in replacement_steps(&previous, &hotkey) {
        match step {
            "register:new" if register_new && !manager.is_registered(shortcut.clone()) => {
                manager
                    .register(shortcut.clone())
                    .map_err(|error| format!("Сочетание занято другой программой: {error}"))?;
                registered_new = true;
            }
            "unregister:old" => {
                if unregister_old {
                    if let Ok(old) = parse_hotkey(&previous) {
                        if manager.is_registered(old.clone()) {
                            if let Err(error) = manager.unregister(old) {
                                if registered_new {
                                    let _ = manager.unregister(shortcut.clone());
                                }
                                return Err(format!(
                                    "Не удалось заменить прежнее сочетание: {error}"
                                ));
                            }
                        }
                    }
                }
            }
            "save:new" if is_markup_shortcut => config.markup_hotkey = hotkey.clone(),
            "save:new" => config.hotkey = hotkey.clone(),
            _ => {}
        }
    }

    let config = save_config(&app, config)?;
    let slot = if is_markup_shortcut {
        ShortcutSlot::Markup
    } else {
        ShortcutSlot::Chat
    };
    set_shortcut_error(&app, slot, None);
    schedule_single_key_chat_shortcut_sync(&app);
    Ok(config)
}

#[tauri::command]
fn set_markup_hotkey(
    app: AppHandle,
    window: WebviewWindow,
    hotkey: String,
) -> Result<Config, String> {
    set_hotkey(app, window, hotkey, Some(true))
}

fn publish_direction(app: &AppHandle, direction: input::Direction) {
    let request_id = format!(
        "direction-{}-{}",
        now_ms(),
        DIRECTION_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let at = now_ms();

    let _ = app.emit(
        "overlay:direction_pending",
        serde_json::json!({
            "requestId": request_id,
            "direction": direction,
            "at": at,
        }),
    );

    if !*app.state::<AppState>().connected.lock().unwrap() {
        let _ = app.emit(
            "overlay:send_result",
            serde_json::json!({
                "requestId": request_id,
                "kind": "direction",
                "ok": false,
                "error": disconnected_text(app),
            }),
        );
        return;
    }

    let _ = app.emit(
        "tg:direction",
        serde_json::json!({
            "requestId": request_id,
            "direction": direction,
            "at": at,
        }),
    );
}

#[cfg(windows)]
fn observe_direction_keys(app: AppHandle) {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    std::thread::spawn(move || {
        let mut tracker = input::KeyEdgeTracker::default();
        let mut escape_was_down = false;
        loop {
            let app_state = app.state::<AppState>();
            let settings = app_state.config.lock().unwrap().direction_signals.clone();
            let kind = app_state.state.lock().unwrap().kind;
            let markup = *app_state.markup.lock().unwrap();
            let paused = *app_state.paused.lock().unwrap();
            let game_foreground = *app_state.game_foreground.lock().unwrap();
            let keys = [
                settings.up_key.as_str(),
                settings.down_key.as_str(),
                settings.left_key.as_str(),
                settings.right_key.as_str(),
            ];
            let pressed = keys.map(|key| {
                input::virtual_key(key)
                    .map(|virtual_key| unsafe { GetAsyncKeyState(virtual_key) < 0 })
                    .unwrap_or(false)
            });
            let edges = tracker.update(&pressed);

            let escape_is_down = input::virtual_key("Escape")
                .map(|virtual_key| unsafe { GetAsyncKeyState(virtual_key) < 0 })
                .unwrap_or(false);
            if escape_is_down && !escape_was_down {
                cancel_phrase_wheel(&app);
            }
            escape_was_down = escape_is_down;

            if settings.enabled
                && input::DirectionInputGate::enabled(kind, markup, paused, game_foreground)
            {
                for direction in edges {
                    publish_direction(&app, direction);
                }
            }

            std::thread::sleep(Duration::from_millis(20));
        }
    });
}

fn phrase_wheel_settings_if_available(app: &AppHandle) -> Option<PhraseWheelSettings> {
    let app_state = app.state::<AppState>();
    let settings = app_state.config.lock().unwrap().phrase_wheel.clone();
    let kind = app_state.state.lock().unwrap().kind;
    let markup = *app_state.markup.lock().unwrap();
    let paused = *app_state.paused.lock().unwrap();
    (settings.enabled && kind == Kind::Inactive && !markup && !paused).then_some(settings)
}

fn emit_phrase_wheel(
    app: &AppHandle,
    active: bool,
    phrases: Vec<String>,
    selected_index: Option<usize>,
    origin: Option<(i32, i32)>,
    cancel_radius_px: Option<u32>,
) {
    let _ = app.emit(
        "overlay:phrase_wheel",
        PhraseWheelPayload {
            active,
            phrases,
            selected_index,
            origin_x: origin.map(|(x, _)| x),
            origin_y: origin.map(|(_, y)| y),
            cancel_radius_px,
        },
    );
}

fn phrase_wheel_origin(app: &AppHandle) -> Option<(i32, i32)> {
    #[cfg(windows)]
    {
        overlay_hwnd(app).and_then(win32::cursor_position_in_window)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

fn open_phrase_wheel(app: &AppHandle) {
    let Some(settings) = phrase_wheel_settings_if_available(app) else {
        return;
    };
    let app_state = app.state::<AppState>();
    let mut wheel = app_state.phrase_wheel.lock().unwrap();
    if wheel.is_open() {
        return;
    }
    let origin = phrase_wheel_origin(app);
    wheel.open_at(origin);
    drop(wheel);
    emit_phrase_wheel(
        app,
        true,
        settings.phrases,
        None,
        origin,
        Some(settings.dead_zone_px),
    );
}

fn update_phrase_wheel(app: &AppHandle, delta_x: i32, delta_y: i32) {
    let Some(settings) = phrase_wheel_settings_if_available(app) else {
        cancel_phrase_wheel(app);
        return;
    };
    let app_state = app.state::<AppState>();
    let mut wheel = app_state.phrase_wheel.lock().unwrap();
    let changed = wheel.update_mouse(
        delta_x,
        delta_y,
        settings.phrases.len(),
        settings.dead_zone_px,
    );
    let origin = wheel.origin();
    drop(wheel);
    if let Some(selected_index) = changed {
        emit_phrase_wheel(
            app,
            true,
            settings.phrases,
            selected_index,
            origin,
            Some(settings.dead_zone_px),
        );
    }
}

fn cancel_phrase_wheel(app: &AppHandle) {
    let app_state = app.state::<AppState>();
    let mut wheel = app_state.phrase_wheel.lock().unwrap();
    if !wheel.cancel() {
        return;
    }
    drop(wheel);
    emit_phrase_wheel(app, false, Vec::new(), None, None, None);
}

fn release_phrase_wheel(app: &AppHandle) {
    let selection = app
        .state::<AppState>()
        .phrase_wheel
        .lock()
        .unwrap()
        .release();
    let Some(selected_index) = selection else {
        return;
    };
    emit_phrase_wheel(app, false, Vec::new(), None, None, None);
    let Some(selected_index) = selected_index else {
        return;
    };
    let phrase = app
        .state::<AppState>()
        .config
        .lock()
        .unwrap()
        .phrase_wheel
        .phrases
        .get(selected_index)
        .cloned();
    if let Some(phrase) = phrase {
        let request_id = format!(
            "phrase-wheel-{}-{}",
            now_ms(),
            PHRASE_WHEEL_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        if !*app.state::<AppState>().connected.lock().unwrap() {
            let _ = app.emit("overlay:send_result", serde_json::json!({
                "requestId": request_id, "kind": "phrase", "ok": false, "error": disconnected_text(&app)
            }));
            return;
        }
        let _ = app.emit("tg:phrase", serde_json::json!({
            "requestId": request_id, "phrase": phrase, "at": now_ms()
        }));
    }
}

#[tauri::command]
fn set_direction_settings(
    app: AppHandle,
    window: WebviewWindow,
    settings: DirectionSettings,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let mut config = get_config(app.clone());
    config.direction_signals = normalize_direction_settings(settings)?;
    save_config(&app, config)
}

#[tauri::command]
fn set_phrase_wheel_settings(
    app: AppHandle,
    window: WebviewWindow,
    settings: PhraseWheelSettings,
) -> Result<Config, String> {
    require_main_window(&window)?;
    cancel_phrase_wheel(&app);
    let mut config = get_config(app.clone());
    let settings = normalize_phrase_wheel_settings(settings)?;
    let shortcut = parse_hotkey(&settings.hotkey)
        .map_err(|_| format!("Не удалось разобрать сочетание: {}", settings.hotkey))?;
    for reserved in [&config.hotkey, &config.markup_hotkey] {
        if parse_hotkey(reserved).ok().as_ref() == Some(&shortcut) {
            return Err("Это сочетание уже используется другой функцией приложения".into());
        }
    }

    let previous = config.phrase_wheel.clone();
    let same_shortcut = parse_hotkey(&previous.hotkey).ok().as_ref() == Some(&shortcut);
    for step in phrase_wheel_shortcut_steps(previous.enabled, settings.enabled, same_shortcut) {
        match *step {
            "register:new" => app
                .global_shortcut()
                .register(shortcut.clone())
                .map_err(|error| format!("Сочетание занято другой программой: {error}"))?,
            "unregister:old" => {
                if let Ok(old) = parse_hotkey(&previous.hotkey) {
                    if let Err(error) = app.global_shortcut().unregister(old) {
                        if settings.enabled && !same_shortcut {
                            let _ = app.global_shortcut().unregister(shortcut.clone());
                        }
                        return Err(format!("Не удалось заменить прежнее сочетание: {error}"));
                    }
                }
            }
            _ => {}
        }
    }
    // The same hotkey kept after it failed to register at startup is retried
    // here instead of being reported as fine.
    if settings.enabled && !app.global_shortcut().is_registered(shortcut.clone()) {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|error| format!("Сочетание занято другой программой: {error}"))?;
    }
    config.phrase_wheel = settings;
    let config = save_config(&app, config)?;
    set_shortcut_error(&app, ShortcutSlot::PhraseWheel, None);
    Ok(config)
}

#[tauri::command]
fn get_direction_message_id(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    chat_key: String,
) -> Result<Option<i32>, String> {
    require_telegram_worker(&window)?;
    let cache_key = direction_cache_key(&account_id, &chat_key);
    Ok(app
        .state::<AppState>()
        .runtime_cache
        .lock()
        .unwrap()
        .get(&cache_key))
}

#[tauri::command]
fn set_direction_message_id(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    chat_key: String,
    message_id: i32,
) -> Result<(), String> {
    require_telegram_worker(&window)?;
    let cache_key = direction_cache_key(&account_id, &chat_key);
    let app_state = app.state::<AppState>();
    let snapshot = {
        let mut cache = app_state.runtime_cache.lock().unwrap();
        cache.set(cache_key, message_id);
        cache.clone()
    };
    snapshot.save(&app_state.runtime_cache_path)
}

#[tauri::command]
fn get_phrase_message_id(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    chat_key: String,
) -> Result<Option<i32>, String> {
    require_telegram_worker(&window)?;
    let cache_key = format!("phrase|{}", direction_cache_key(&account_id, &chat_key));
    Ok(app.state::<AppState>().runtime_cache.lock().unwrap().get(&cache_key))
}

#[tauri::command]
fn set_phrase_message_id(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    chat_key: String,
    message_id: i32,
) -> Result<(), String> {
    require_telegram_worker(&window)?;
    let cache_key = format!("phrase|{}", direction_cache_key(&account_id, &chat_key));
    let app_state = app.state::<AppState>();
    let snapshot = {
        let mut cache = app_state.runtime_cache.lock().unwrap();
        cache.set(cache_key, message_id);
        cache.clone()
    };
    snapshot.save(&app_state.runtime_cache_path)
}

fn normalize_direction_settings(
    mut settings: DirectionSettings,
) -> Result<DirectionSettings, String> {
    settings.up_key = settings.up_key.trim().to_string();
    settings.down_key = settings.down_key.trim().to_string();
    settings.left_key = settings.left_key.trim().to_string();
    settings.right_key = settings.right_key.trim().to_string();
    settings.display_ms = settings.display_ms.clamp(500, 10_000);
    let keys = [
        &settings.up_key,
        &settings.down_key,
        &settings.left_key,
        &settings.right_key,
    ];
    if keys.iter().any(|key| key.is_empty()) {
        return Err("Назначьте клавишу для каждого направления".into());
    }
    let unique = keys
        .iter()
        .map(|key| key.to_lowercase())
        .collect::<std::collections::HashSet<_>>();
    if unique.len() != keys.len() {
        return Err("Клавиша направления повторяется".into());
    }
    Ok(settings)
}

fn normalize_phrase_wheel_settings(
    mut settings: PhraseWheelSettings,
) -> Result<PhraseWheelSettings, String> {
    settings.hotkey = settings.hotkey.trim().to_string();
    let has_modifier = settings.hotkey.split('+').any(|part| {
        matches!(
            part.trim().to_ascii_lowercase().as_str(),
            "ctrl" | "alt" | "shift" | "win" | "super"
        )
    });
    if !has_modifier || settings.hotkey.split('+').count() < 2 {
        return Err("Нужен хотя бы один модификатор: Ctrl, Alt, Shift или Win".into());
    }
    settings.dead_zone_px = settings.dead_zone_px.clamp(16, 160);
    if !(2..=8).contains(&settings.phrases.len()) {
        return Err("Добавьте от 2 до 8 фраз".into());
    }
    for phrase in &mut settings.phrases {
        *phrase = phrase.trim().to_string();
        if phrase.is_empty() {
            return Err("Фраза не должна быть пустой".into());
        }
        if phrase.chars().count() > 160 {
            return Err("Фраза должна содержать не больше 160 символов".into());
        }
    }
    Ok(settings)
}

fn replacement_steps(_previous: &str, _next: &str) -> [&'static str; 3] {
    ["register:new", "unregister:old", "save:new"]
}

fn phrase_wheel_shortcut_steps(
    was_enabled: bool,
    will_enable: bool,
    same_shortcut: bool,
) -> &'static [&'static str] {
    match (was_enabled, will_enable, same_shortcut) {
        (false, true, _) => &["register:new"],
        (true, false, _) => &["unregister:old"],
        (true, true, false) => &["register:new", "unregister:old"],
        _ => &[],
    }
}

#[cfg(test)]
mod markup_tests {
    use super::markup_unavailable;
    use crate::states::Kind;

    #[test]
    fn needs_a_game_in_front() {
        assert_eq!(
            markup_unavailable(Kind::Off, None, None).as_deref(),
            Some("Сначала откройте игру")
        );
        assert_eq!(markup_unavailable(Kind::Inactive, Some("dota2.exe"), None), None);
    }

    #[test]
    fn needs_the_requested_game_in_front() {
        let expected = format!("Сначала откройте {}", "Dota 2");
        assert_eq!(
            markup_unavailable(Kind::Off, None, Some(("dota2.exe", "Dota 2"))),
            Some(expected.clone())
        );
        assert_eq!(
            markup_unavailable(Kind::Inactive, Some("cs2.exe"), Some(("dota2.exe", "Dota 2"))),
            Some(expected)
        );
    }

    #[test]
    fn allows_the_game_right_behind_the_settings_window() {
        assert_eq!(
            markup_unavailable(Kind::Hidden, Some("dota2.exe"), Some(("Dota2.exe", "Dota 2"))),
            None
        );
    }
}

#[cfg(test)]
mod foreground_tests {
    use super::foreground_event;
    use crate::states::Event;

    fn unpack(event: Event) -> (Option<String>, bool) {
        match event {
            Event::Foreground { exe, is_overlay, .. } => (exe, is_overlay),
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn recognizes_the_overlay_root_owner() {
        let event = foreground_event(0x42, Some("tg-game-overlay.exe".into()), true, Some(0x42));
        assert!(unpack(event).1);
    }

    #[test]
    fn treats_the_settings_window_as_a_foreign_application() {
        let event = foreground_event(0x43, Some("tg-game-overlay.exe".into()), true, Some(0x42));
        assert_eq!(unpack(event), (None, false));
    }

    #[test]
    fn keeps_the_exe_of_other_applications() {
        let event = foreground_event(0x44, Some("dota2.exe".into()), false, Some(0x42));
        assert_eq!(unpack(event), (Some("dota2.exe".into()), false));
    }
}

#[cfg(test)]
mod shortcut_tests {
    use super::{chat_shortcut_error_after_attempt, normalize_phrase_wheel_settings, parse_hotkey, phrase_wheel_shortcut_steps, replacement_steps, ShortcutErrors, ShortcutSlot};
    use crate::config::PhraseWheelSettings;

    #[test]
    fn parses_the_win_modifier_shown_by_the_settings_page() {
        let win = parse_hotkey("Ctrl+Win+T").unwrap();
        assert_eq!(Ok(win), parse_hotkey("Ctrl+Super+T"));
        assert_eq!(parse_hotkey("win+Shift+K"), parse_hotkey("Super+Shift+K"));
        assert!(parse_hotkey("Ctrl+Shift+M").is_ok());
        assert!(parse_hotkey("Win").is_err());
    }

    #[test]
    fn registers_the_new_shortcut_before_releasing_the_old_one() {
        assert_eq!(
            replacement_steps("Ctrl+T", "Ctrl+Y"),
            ["register:new", "unregister:old", "save:new"]
        );
    }

    #[test]
    fn failed_chat_key_registration_is_reported_and_a_success_clears_it() {
        let error = chat_shortcut_error_after_attempt(
            None,
            "T",
            Some(Err("уже используется".to_string())),
        )
        .unwrap();
        assert!(error.contains('T'));
        assert!(error.contains("уже используется"));

        assert_eq!(
            chat_shortcut_error_after_attempt(Some(&error), "T", Some(Ok(()))),
            None
        );
        assert_eq!(chat_shortcut_error_after_attempt(Some(&error), "T", None), Some(error));
    }

    #[test]
    fn a_chat_key_success_keeps_a_markup_failure_visible() {
        let mut errors = ShortcutErrors::default();
        *errors.slot_mut(ShortcutSlot::Markup) = Some("markup".into());
        *errors.slot_mut(ShortcutSlot::Chat) = Some("chat".into());
        assert_eq!(errors.published().as_deref(), Some("chat"));

        *errors.slot_mut(ShortcutSlot::Chat) = None;
        assert_eq!(errors.published().as_deref(), Some("markup"));

        *errors.slot_mut(ShortcutSlot::Markup) = None;
        *errors.slot_mut(ShortcutSlot::PhraseWheel) = Some("wheel".into());
        assert_eq!(errors.published().as_deref(), Some("wheel"));
    }

    #[test]
    fn phrase_wheel_replaces_the_active_shortcut_without_a_gap() {
        assert_eq!(
            phrase_wheel_shortcut_steps(true, true, false),
            ["register:new", "unregister:old"]
        );
        assert_eq!(
            phrase_wheel_shortcut_steps(false, true, false),
            ["register:new"]
        );
        assert_eq!(
            phrase_wheel_shortcut_steps(true, false, true),
            ["unregister:old"]
        );
    }

    #[test]
    fn rejects_invalid_phrase_wheel_content_before_persisting() {
        let invalid = PhraseWheelSettings {
            enabled: true,
            hotkey: "Ctrl+Space".into(),
            dead_zone_px: 42,
            phrases: vec![" ".into(), "Назад".into()],
        };

        assert_eq!(
            normalize_phrase_wheel_settings(invalid).unwrap_err(),
            "Фраза не должна быть пустой"
        );
    }
}

#[tauri::command]
fn upsert_profile(app: AppHandle, window: WebviewWindow, profile: Profile) -> Result<Config, String> {
    require_main_window(&window)?;
    let mut config = get_config(app.clone());
    let exe = profile.exe.to_lowercase();
    match config
        .profiles
        .iter_mut()
        .find(|item| item.exe.to_lowercase() == exe)
    {
        Some(existing) => *existing = profile,
        None => config.profiles.push(profile),
    }
    save_config(&app, config)
}

#[tauri::command]
fn remove_profile(app: AppHandle, window: WebviewWindow, exe: String) -> Result<Config, String> {
    require_main_window(&window)?;
    let mut config = get_config(app.clone());
    let exe = exe.to_lowercase();
    config
        .profiles
        .retain(|profile| profile.exe.to_lowercase() != exe);
    save_config(&app, config)
}

#[tauri::command]
fn add_current_app(app: AppHandle, window: WebviewWindow) -> Result<Config, String> {
    require_main_window(&window)?;
    #[cfg(windows)]
    {
        let info = win32::foreground_info();
        let exe = info
            .exe
            .ok_or("Не удалось определить активное приложение")?;
        if exe == "tg-game-overlay.exe" {
            return Err("Это окно самого приложения, переключитесь на игру".into());
        }

        let mut config = get_config(app.clone());
        if config.profile(&exe).is_none() {
            let title = exe.trim_end_matches(".exe").to_string();
            config.profiles.push(Profile::new(exe, title));
        }

        save_config(&app, config)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Поддерживается только Windows".into())
    }
}

#[tauri::command]
fn add_profile_by_exe(app: AppHandle, window: WebviewWindow, value: String) -> Result<Config, String> {
    require_main_window(&window)?;
    let exe = normalize_profile_exe(&value)?;
    let mut config = get_config(app.clone());
    if config.profile(&exe).is_none() {
        let title = exe.trim_end_matches(".exe").to_string();
        config.profiles.push(Profile::new(exe, title));
    }
    save_config(&app, config)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileCandidatePayload {
    exe: String,
    title: String,
}

#[tauri::command]
fn list_profile_candidates(
    window: WebviewWindow,
) -> Result<Vec<ProfileCandidatePayload>, String> {
    // The list names every visible window, so only the settings window gets it.
    require_main_window(&window)?;
    #[cfg(windows)]
    {
        Ok(win32::profile_candidates()
            .into_iter()
            .map(|candidate| ProfileCandidatePayload {
                exe: candidate.exe,
                title: candidate.title,
            })
            .collect())
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn save_zones(app: AppHandle, exe: String, inactive: Zone, active: Zone) -> Result<Config, String> {
    let mut config = get_config(app.clone());
    let key = exe.to_lowercase();
    if let Some(profile) = config
        .profiles
        .iter_mut()
        .find(|item| item.exe.to_lowercase() == key)
    {
        profile.inactive = inactive;
        profile.active = active;
    }
    let config = save_config(&app, config)?;
    toggle_markup(app, false, None)?;
    Ok(config)
}

#[tauri::command]
fn send_message(app: AppHandle, text: String, request_id: String) {
    if text.trim().is_empty() {
        return;
    }

    match send_policy::text_send_action(*app.state::<AppState>().connected.lock().unwrap()) {
        send_policy::TextSendAction::Forward => {
            let _ = app.emit(
                "tg:send",
                serde_json::json!({ "requestId": request_id, "text": text }),
            );
        }
        send_policy::TextSendAction::ReportDisconnected => {
            let _ = app.emit(
                "overlay:send_result",
                serde_json::json!({
                    "requestId": request_id,
                    "kind": "text",
                    "ok": false,
                    "error": if active_worker(&app) == RELAY_WORKER { "Свой сервер не подключён" } else { "Telegram не подключён или чат не выбран" },
                }),
            );
        }
    }
}

/// The worker asks for the keys instead of holding them in page code.
fn secrets_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn active_worker(app: &AppHandle) -> &'static str {
    if app.state::<AppState>().config.lock().unwrap().transport == TRANSPORT_RELAY {
        RELAY_WORKER
    } else {
        TELEGRAM_WORKER
    }
}

/// Both transport workers run all the time; only the selected one may speak
/// for the chat. Calls from the other one are dropped here as a safety net.
fn from_inactive_worker(app: &AppHandle, window: &WebviewWindow) -> bool {
    let label = window.label();
    (label == TELEGRAM_WORKER || label == RELAY_WORKER) && label != active_worker(app)
}

fn disconnected_text(app: &AppHandle) -> &'static str {
    if active_worker(app) == RELAY_WORKER {
        "Свой сервер не подключён"
    } else {
        "Telegram не подключён"
    }
}

/// The Telegram session and API keys are the account: only the worker that
/// owns the MTProto client may read or replace them, never a page that renders
/// chat content.
fn require_telegram_worker(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == TELEGRAM_WORKER {
        Ok(())
    } else {
        Err("Telegram secrets are only available to the Telegram worker".into())
    }
}

/// Settings, secrets and the list of running windows belong to the settings
/// window: the overlay and the workers render chat content from other people
/// and must not be able to change or read them.
fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN {
        Ok(())
    } else {
        Err("This command is only available to the settings window".into())
    }
}

const RELAY_ACCESS_KEY: &str = "relay_access_key";
const RELAY_PASSWORD: &str = "relay_password";

/// Only the relay worker may read the relay secrets.
#[tauri::command]
fn relay_credentials(app: AppHandle, window: WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != RELAY_WORKER {
        return Err("relay secrets are only available to the relay worker".into());
    }
    let dir = secrets_dir(&app);
    Ok(serde_json::json!({
        "accessKey": secrets::load(&dir, RELAY_ACCESS_KEY),
        "password": secrets::load(&dir, RELAY_PASSWORD),
    }))
}

#[tauri::command]
fn relay_secret_state(app: AppHandle) -> serde_json::Value {
    let dir = secrets_dir(&app);
    serde_json::json!({
        "hasAccessKey": secrets::load(&dir, RELAY_ACCESS_KEY).is_some_and(|value| !value.is_empty()),
        "hasPassword": secrets::load(&dir, RELAY_PASSWORD).is_some_and(|value| !value.is_empty()),
    })
}

fn update_relay_secret(dir: &PathBuf, name: &str, value: Option<String>) -> Result<(), String> {
    match value {
        None => Ok(()),
        Some(value) if value.is_empty() => {
            secrets::clear(dir, name);
            Ok(())
        }
        Some(value) => secrets::save(dir, name, &value),
    }
}

/// `None` keeps a stored secret, an empty string forgets it.
#[tauri::command]
fn set_relay_settings(
    app: AppHandle,
    window: WebviewWindow,
    settings: RelaySettings,
    access_key: Option<String>,
    password: Option<String>,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let settings = RelaySettings {
        url: settings.url.trim().to_string(),
        room: settings.room.trim().to_string(),
        display_name: settings.display_name.trim().to_string(),
    };
    if settings.url.chars().count() > 300 || settings.room.chars().count() > 120 {
        return Err("Слишком длинный адрес сервера или название комнаты".into());
    }
    if settings.display_name.chars().count() > 64 {
        return Err("Имя длиннее 64 символов".into());
    }
    if access_key.as_deref().is_some_and(|key| !key.is_empty() && key.chars().count() < 16) {
        return Err("Ключ доступа короче 16 символов".into());
    }
    let dir = secrets_dir(&app);
    update_relay_secret(&dir, RELAY_ACCESS_KEY, access_key)?;
    update_relay_secret(&dir, RELAY_PASSWORD, password)?;

    let mut config = get_config(app.clone());
    config.relay = settings;
    let config = save_config(&app, config)?;
    let _ = app.emit("relay:settings_changed", serde_json::json!({}));
    Ok(config)
}

#[tauri::command]
fn set_transport(app: AppHandle, window: WebviewWindow, transport: String) -> Result<Config, String> {
    require_main_window(&window)?;
    if transport != TRANSPORT_TELEGRAM && transport != TRANSPORT_RELAY {
        return Err(format!("Неизвестный способ связи: {transport}"));
    }
    let app_state = app.state::<AppState>();
    // The switch lands in memory first: from_inactive_worker drops the old
    // worker from here on, so nothing it sends can slip in after the reset.
    let (config, previous_transport) = {
        let mut current = app_state.config.lock().unwrap();
        if current.transport == transport {
            return Ok(current.clone());
        }
        let previous = std::mem::replace(&mut current.transport, transport);
        (current.clone(), previous)
    };
    let offline = serde_json::json!({ "state": "offline" });
    let previous_connected = std::mem::replace(&mut *app_state.connected.lock().unwrap(), false);
    let previous_status =
        std::mem::replace(&mut *app_state.telegram_status.lock().unwrap(), offline.clone());
    let _ = app.emit("overlay:reset", serde_json::json!({}));
    let _ = app.emit("tg:status", offline);

    if let Err(error) = config.save(&app_state.config_path) {
        // The workers never saw config:changed: hand the chat back to the old one.
        app_state.config.lock().unwrap().transport = previous_transport;
        *app_state.connected.lock().unwrap() = previous_connected;
        *app_state.telegram_status.lock().unwrap() = previous_status.clone();
        let _ = app.emit("tg:status", previous_status);
        request_telegram_history(&app);
        return Err(error);
    }
    // config:changed is what the workers react to.
    push_config(&app, &config);
    Ok(config)
}

/// False in public builds: users bring their own api_id / api_hash.
#[tauri::command]
fn tg_builtin_keys_available() -> bool {
    credentials::API_ID > 0 && !credentials::api_hash().is_empty()
}

#[tauri::command]
fn tg_api_keys(app: AppHandle, window: WebviewWindow) -> Result<serde_json::Value, String> {
    require_telegram_worker(&window)?;
    let config = get_config(app.clone());
    let path = app.state::<AppState>().config_path.clone();
    let dir = path.parent().map(PathBuf::from).unwrap_or_default();

    let api_id = config.api_id.unwrap_or(credentials::API_ID);
    let api_hash = secrets::load(&dir, "api_hash").unwrap_or_else(credentials::api_hash);

    Ok(serde_json::json!({ "apiId": api_id, "apiHash": api_hash }))
}

fn emit_api_keys_changed(app: &AppHandle, api_id: i32, api_hash: String) {
    let _ = app.emit(
        "tg:api_keys_changed",
        serde_json::json!({ "apiId": api_id, "apiHash": api_hash }),
    );
}

#[tauri::command]
fn tg_save_api_keys(
    app: AppHandle,
    window: WebviewWindow,
    api_id: i32,
    api_hash: String,
) -> Result<Config, String> {
    require_main_window(&window)?;
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::save(&dir, "api_hash", &api_hash)?;

    let mut config = get_config(app.clone());
    config.api_id = Some(api_id);
    let config = save_config(&app, config)?;
    emit_api_keys_changed(&app, api_id, api_hash);
    Ok(config)
}

#[tauri::command]
fn tg_clear_api_keys(app: AppHandle, window: WebviewWindow) -> Result<Config, String> {
    require_main_window(&window)?;
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::clear(&dir, "api_hash");

    let mut config = get_config(app.clone());
    config.api_id = None;
    let config = save_config(&app, config)?;
    emit_api_keys_changed(&app, credentials::API_ID, credentials::api_hash());
    Ok(config)
}

/// The session string is the account: it never travels through the config file.
#[tauri::command]
fn tg_save_session(app: AppHandle, window: WebviewWindow, session: String) -> Result<(), String> {
    require_telegram_worker(&window)?;
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::save(&dir, "session", &session)
}

#[tauri::command]
fn tg_session(app: AppHandle, window: WebviewWindow) -> Option<String> {
    if require_telegram_worker(&window).is_err() {
        return None;
    }
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::load(&dir, "session")
}

#[tauri::command]
fn tg_clear_session(app: AppHandle, window: WebviewWindow) {
    if require_telegram_worker(&window).is_err() {
        return;
    }
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::clear(&dir, "session");
}

#[tauri::command]
fn tg_logout(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_main_window(&window)?;
    let dir = app
        .state::<AppState>()
        .config_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    secrets::clear(&dir, "session");
    *app.state::<AppState>().connected.lock().unwrap() = false;
    let _ = app.emit("tg:login", serde_json::json!({ "step": "logout" }));
    Ok(())
}

/// Login steps typed by the user in the settings window: phone, code, password.
#[tauri::command]
fn tg_login_step(
    app: AppHandle,
    window: WebviewWindow,
    step: String,
    value: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let _ = app.emit(
        "tg:login",
        serde_json::json!({ "step": step, "value": value }),
    );
    Ok(())
}

#[tauri::command]
fn tg_reconnect_now(app: AppHandle) {
    let _ = app.emit("tg:reconnect_now", serde_json::json!({}));
}

#[tauri::command]
fn tg_status(app: AppHandle, window: WebviewWindow, status: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let connected = status
        .get("state")
        .and_then(|state| state.as_str())
        .map(|state| state == "connected")
        .unwrap_or(false);
    *app.state::<AppState>().connected.lock().unwrap() = connected;
    *app.state::<AppState>().telegram_status.lock().unwrap() = status.clone();

    let _ = app.emit("tg:status", status);
}

#[tauri::command]
fn tg_current_status(app: AppHandle) -> serde_json::Value {
    app.state::<AppState>()
        .telegram_status
        .lock()
        .unwrap()
        .clone()
}

#[tauri::command]
fn tg_request_dialogs(app: AppHandle, query: Option<String>) {
    let _ = app.emit("tg:dialogs_request", serde_json::json!({ "query": query }));
}

#[tauri::command]
fn tg_dialogs(
    app: AppHandle,
    window: WebviewWindow,
    dialogs: serde_json::Value,
    error: Option<String>,
    query: Option<String>,
) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit(
        "tg:dialogs",
        serde_json::json!({ "dialogs": dialogs, "error": error, "query": query }),
    );
}

/// A real Telegram message on its way to the overlay.
#[tauri::command]
fn push_message(app: AppHandle, window: WebviewWindow, message: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("overlay:message", message);
}

#[tauri::command]
fn reset_overlay_feed(app: AppHandle, window: WebviewWindow) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("overlay:reset", serde_json::json!({}));
}

/// A pasted image on its way to Telegram.
#[tauri::command]
fn send_file(app: AppHandle, request_id: String, data_url: String, caption: Option<String>) {
    if !*app.state::<AppState>().connected.lock().unwrap() {
        let _ = app.emit(
            "overlay:send_result",
            serde_json::json!({
                "requestId": request_id,
                "kind": "file",
                "ok": false,
                "error": disconnected_text(&app)
            }),
        );
        return;
    }

    let _ = app.emit(
        "tg:send_file",
        serde_json::json!({ "requestId": request_id, "dataUrl": data_url, "caption": caption }),
    );
}

#[tauri::command]
fn tg_request_stickers(app: AppHandle, refresh: Option<bool>) {
    let _ = app.emit(
        "tg:stickers_request",
        serde_json::json!({ "refresh": refresh.unwrap_or(false) }),
    );
}

#[tauri::command]
fn tg_stickers(app: AppHandle, window: WebviewWindow, payload: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("tg:stickers", payload);
}

#[tauri::command]
fn tg_send_result(app: AppHandle, window: WebviewWindow, result: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("overlay:send_result", result);
}

#[tauri::command]
fn tg_direction(app: AppHandle, window: WebviewWindow, payload: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("overlay:direction", payload);
}

#[tauri::command]
fn tg_phrase(app: AppHandle, window: WebviewWindow, payload: serde_json::Value) {
    if from_inactive_worker(&app, &window) {
        return;
    }
    let _ = app.emit("overlay:phrase", payload);
}

#[tauri::command]
fn set_chat(app: AppHandle, window: WebviewWindow, chat: Option<ChatRef>) -> Result<Config, String> {
    require_main_window(&window)?;
    if let Some(selected) = &chat {
        if !matches!(selected.kind.as_str(), "user" | "chat" | "channel")
            || selected.id.trim().is_empty()
        {
            return Err("Telegram вернул некорректный чат".to_string());
        }
        if matches!(selected.kind.as_str(), "user" | "channel")
            && selected
                .access_hash
                .as_deref()
                .is_none_or(str::is_empty)
        {
            return Err("Telegram не дал данные доступа к чату. Откройте его в Telegram и обновите список".to_string());
        }
    }
    let mut config = get_config(app.clone());
    config.chat = chat;
    save_config(&app, config)
}

#[tauri::command]
fn send_sticker(app: AppHandle, request_id: String, file_id: String) {
    if !*app.state::<AppState>().connected.lock().unwrap() {
        let _ = app.emit(
            "overlay:send_result",
            serde_json::json!({
                "requestId": request_id,
                "kind": "sticker",
                "ok": false,
                "error": disconnected_text(&app)
            }),
        );
        return;
    }
    let _ = app.emit(
        "tg:send_sticker",
        serde_json::json!({ "requestId": request_id, "fileId": file_id }),
    );
}

#[tauri::command]
fn dismiss(app: AppHandle) {
    std::thread::spawn(move || dispatch(&app, Event::Dismiss));
}

/// Markup draws on the game window that is in front (or right behind the
/// settings window), so it needs one, and it has to be the requested game.
fn markup_unavailable(
    kind: Kind,
    game_exe: Option<&str>,
    requested: Option<(&str, &str)>,
) -> Option<String> {
    match requested {
        Some((exe, title)) if !game_exe.is_some_and(|game| game.eq_ignore_ascii_case(exe)) => {
            Some(format!("Сначала откройте {title}"))
        }
        _ if kind == Kind::Off => Some("Сначала откройте игру".into()),
        _ => None,
    }
}

/// Leaves markup mode without handing focus anywhere: the game went away or
/// the overlay was paused, so focus has already moved on.
fn stop_markup(app: &AppHandle) {
    let was_on = std::mem::replace(&mut *app.state::<AppState>().markup.lock().unwrap(), false);
    if !was_on {
        return;
    }
    set_click_through(app, true);
    let _ = app.emit("overlay:markup", serde_json::json!({ "active": false }));
}

#[tauri::command]
fn toggle_markup(app: AppHandle, on: bool, exe: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>().state.lock().unwrap().clone();
    if on {
        let config = get_config(app.clone());
        let requested = exe.as_deref().map(|exe| {
            let title = config.profile(exe).map_or(exe, |profile| profile.title.as_str());
            (exe, title)
        });
        if let Some(error) = markup_unavailable(state.kind, state.game_exe.as_deref(), requested) {
            return Err(error);
        }
    }

    *app.state::<AppState>().markup.lock().unwrap() = on;
    if on {
        cancel_phrase_wheel(&app);
    }
    *app.state::<AppState>().game_foreground.lock().unwrap() = !on && state.kind == Kind::Inactive;
    schedule_single_key_chat_shortcut_sync(&app);

    if on {
        align_overlay(&app, state.game_hwnd);
        set_click_through(&app, false);
        if let Some(window) = overlay_window(&app) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        set_click_through(&app, true);
        #[cfg(windows)]
        if let Some(hwnd) = state.game_hwnd {
            win32::focus_window(hwnd);
        }
    }

    let _ = app.emit("overlay:markup", serde_json::json!({ "active": on }));
    Ok(())
}

#[tauri::command]
fn open_main_window(app: AppHandle) {
    *app.state::<AppState>().game_foreground.lock().unwrap() = false;
    schedule_single_key_chat_shortcut_sync(&app);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn demo_feed(app: AppHandle) {
    let mut index = 0usize;

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));

        let state = app.state::<AppState>();
        if !state.config.lock().unwrap().demo_feed || *state.connected.lock().unwrap() {
            continue;
        }
        if state.state.lock().unwrap().kind == Kind::Off {
            continue;
        }

        let lines = i18n::demo_lines(current_locale(&app));
        let (author, text) = lines[index % lines.len()];
        index += 1;
        log(&format!("demo message from {author}"));
        let _ = app.emit(
            "overlay:message",
            MessagePayload {
                id: format!("demo-{}", now_ms()),
                author: author.into(),
                text: text.into(),
                at: now_ms(),
                outgoing: false,
            },
        );
    });
}

/// Keeps the overlay glued to the game window when it is moved or resized.
fn track_game_window(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));

        let state = app.state::<AppState>().state.lock().unwrap().clone();
        if matches!(state.kind, Kind::Inactive | Kind::Active) {
            align_overlay(&app, state.game_hwnd);
        }
    });
}

/// Pausing hides the overlay until the user switches it back on.
fn set_paused(app: &AppHandle, paused: bool) {
    *app.state::<AppState>().paused.lock().unwrap() = paused;

    // The tray icon is the only place this state is visible from.
    refresh_tray_text(app);
    let _ = app.emit("overlay:paused", serde_json::json!({ "paused": paused }));

    if paused {
        cancel_phrase_wheel(app);
        if let Some(window) = overlay_window(app) {
            let _ = window.hide();
        }
        *app.state::<AppState>().state.lock().unwrap() = State::default();
        *app.state::<AppState>().game_foreground.lock().unwrap() = false;
        stop_markup(app);
        schedule_single_key_chat_shortcut_sync(app);
        let _ = app.emit(
            "overlay:state",
            StatePayload {
                kind: Kind::Off,
                game_exe: None,
            },
        );
        return;
    }

    // Pick the overlay back up wherever the user is right now.
    #[cfg(windows)]
    {
        let info = win32::foreground_info();
        let event = foreground_event(info.hwnd, info.exe, info.is_own, overlay_hwnd(app));
        let app = app.clone();
        std::thread::spawn(move || dispatch(&app, event));
    }
}

fn current_locale(app: &AppHandle) -> i18n::Locale {
    i18n::resolve(&app.state::<AppState>().config.lock().unwrap().language)
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let text = i18n::tray(current_locale(app));
    let paused = *app.state::<AppState>().paused.lock().unwrap();
    let open = MenuItem::with_id(app, "open", text.settings, true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", text.pause, true, paused, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &pause, &quit])
}

fn refresh_tray_text(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("tray") else {
        return;
    };
    if let Ok(menu) = tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    let text = i18n::tray(current_locale(app));
    let paused = *app.state::<AppState>().paused.lock().unwrap();
    let _ = tray.set_tooltip(Some(if paused { text.tooltip_paused } else { text.tooltip }));
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("tray")
        .tooltip(i18n::tray(current_locale(app)).tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // Left click opens the settings, right click opens the menu.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_main_window(tray.app_handle().clone());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main_window(app.clone()),
            "pause" => {
                let paused = *app.state::<AppState>().paused.lock().unwrap();
                set_paused(app, !paused);
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let config = app.state::<AppState>().config.lock().unwrap().clone();
                    let pressed = shortcut.to_string();
                    let chat_hotkey = parse_hotkey(&config.hotkey)
                        .ok()
                        .map(|value| value.to_string());
                    let markup_hotkey = parse_hotkey(&config.markup_hotkey)
                        .ok()
                        .map(|value| value.to_string());
                    let phrase_wheel_hotkey = parse_hotkey(&config.phrase_wheel.hotkey)
                        .ok()
                        .map(|value| value.to_string());

                    if is_single_key_shortcut(&config.hotkey)
                        && chat_hotkey.as_deref() == Some(pressed.as_str())
                    {
                        if event.state() == ShortcutState::Pressed {
                            let state = app.state::<AppState>();
                            let can_open = state.state.lock().unwrap().kind == Kind::Inactive
                                && *state.game_foreground.lock().unwrap()
                                && !*state.markup.lock().unwrap()
                                && !*state.paused.lock().unwrap();
                            if can_open
                                && state
                                    .single_key_open_pending
                                    .compare_exchange(
                                        false,
                                        true,
                                        Ordering::AcqRel,
                                        Ordering::Acquire,
                                    )
                                    .is_ok()
                            {
                                let app = app.clone();
                                std::thread::spawn(move || {
                                    dispatch(&app, Event::Hotkey);
                                    app.state::<AppState>()
                                        .single_key_open_pending
                                        .store(false, Ordering::Release);
                                });
                            }
                        }
                        return;
                    }

                    if config.phrase_wheel.enabled
                        && phrase_wheel_hotkey.as_deref() == Some(pressed.as_str())
                    {
                        if event.state() == ShortcutState::Pressed {
                            open_phrase_wheel(app);
                        } else {
                            release_phrase_wheel(app);
                        }
                        return;
                    }

                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    if markup_hotkey.as_deref() == Some(pressed.as_str()) {
                        let markup = *app.state::<AppState>().markup.lock().unwrap();
                        let app = app.clone();
                        std::thread::spawn(move || {
                            if let Err(error) = toggle_markup(app, !markup, None) {
                                log(&format!("markup hotkey ignored: {error}"));
                            }
                        });
                        return;
                    }

                    dispatch(app, Event::Hotkey);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_chat_shortcut_error,
            sync_overlay,
            tg_worker_ready,
            set_feed_settings,
            set_flags,
            set_language,
            set_hotkey,
            set_markup_hotkey,
            set_direction_settings,
            set_phrase_wheel_settings,
            upsert_profile,
            remove_profile,
            add_current_app,
            add_profile_by_exe,
            list_profile_candidates,
            save_zones,
            send_message,
            send_sticker,
            send_file,
            relay_credentials,
            relay_secret_state,
            set_relay_settings,
            set_transport,
            tg_builtin_keys_available,
            tg_api_keys,
            tg_save_api_keys,
            tg_clear_api_keys,
            tg_save_session,
            tg_session,
            tg_clear_session,
            tg_logout,
            tg_login_step,
            tg_reconnect_now,
            tg_status,
            tg_current_status,
            tg_request_dialogs,
            tg_dialogs,
            tg_request_stickers,
            tg_stickers,
            tg_send_result,
            tg_direction,
            tg_phrase,
            get_direction_message_id,
            set_direction_message_id,
            get_phrase_message_id,
            set_phrase_message_id,
            push_message,
            reset_overlay_feed,
            set_chat,
            dismiss,
            toggle_markup,
            open_main_window
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = APP.set(handle.clone());

            let config_path = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("config.json");
            let first_run = !config_path.exists();
            let runtime_cache_path = runtime_cache_path(&config_path);
            let runtime_cache = RuntimeCacheV1::load(&runtime_cache_path);
            let mut config = match Config::load(&config_path) {
                Ok(config) => config,
                Err(error) => {
                    // Keep the broken file around: losing the game profiles
                    // silently is worse than starting with defaults once.
                    log(&format!(
                        "config unreadable, starting with defaults: {error}"
                    ));
                    let _ =
                        std::fs::rename(&config_path, config_path.with_extension("broken.json"));
                    Config::default()
                }
            };
            if first_run {
                // A fresh install greets the user with phrases in their language.
                config.phrase_wheel.phrases = i18n::default_phrases(i18n::resolve(&config.language));
            }

            app.manage(AppState {
                config: Mutex::new(config.clone()),
                hotkey_sync: Mutex::new(()),
                state: Mutex::new(State::default()),
                game_foreground: Mutex::new(false),
                single_key_open_pending: AtomicBool::new(false),
                shortcut_errors: Mutex::new(ShortcutErrors::default()),
                config_path,
                runtime_cache: Mutex::new(runtime_cache),
                runtime_cache_path,
                markup: Mutex::new(false),
                paused: Mutex::new(false),
                connected: Mutex::new(false),
                telegram_status: Mutex::new(serde_json::json!({ "state": "offline" })),
                telegram_worker_ready: Mutex::new(false),
                pending_history_request: Mutex::new(false),
                phrase_wheel: Mutex::new(phrase_wheel::WheelLifecycle::default()),
            });

            // A single-key chat hotkey is registered only while a game is in
            // front; sync_single_key_chat_shortcut reports its own failures.
            let mut hotkeys = vec![(ShortcutSlot::Markup, config.markup_hotkey.clone())];
            if !is_single_key_shortcut(&config.hotkey) {
                hotkeys.push((ShortcutSlot::Chat, config.hotkey.clone()));
            }
            if config.phrase_wheel.enabled {
                hotkeys.push((ShortcutSlot::PhraseWheel, config.phrase_wheel.hotkey.clone()));
            }
            for (slot, hotkey) in hotkeys {
                let attempt = parse_hotkey(&hotkey).and_then(|shortcut| {
                    app.global_shortcut()
                        .register(shortcut)
                        .map_err(|error| error.to_string())
                });
                if let Err(error) = &attempt {
                    log(&format!("failed to register {slot:?} hotkey {hotkey}: {error}"));
                    let error = chat_shortcut_error_after_attempt(None, &hotkey, Some(attempt));
                    set_shortcut_error(&handle, slot, error);
                }
            }

            if let Err(error) = apply_autostart(config.autostart) {
                log(&error);
            }

            setup_tray(&handle)?;

            // State must exist before a WebView can invoke an IPC command.
            for window_config in &app.config().app.windows {
                WebviewWindowBuilder::from_config(&handle, window_config)?.build()?;
            }

            // The app lives in the tray: showing a window on every start would
            // pull focus away from whatever is running, a game included.
            if first_run {
                open_main_window(handle.clone());
            }

            // Keep the overlay out of alt-tab and make sure it never takes focus
            // before the first state change applies the same flags.
            #[cfg(windows)]
            if let Some(hwnd) = overlay_hwnd(&handle) {
                win32::set_no_activate(hwnd, true);
                win32::set_tool_window(hwnd, true);
            }
            demo_feed(handle.clone());
            track_game_window(handle.clone());

            #[cfg(windows)]
            observe_direction_keys(handle.clone());

            #[cfg(windows)]
            {
                let raw_input_handle = handle.clone();
                win32::watch_raw_mouse(move |delta_x, delta_y| {
                    update_phrase_wheel(&raw_input_handle, delta_x, delta_y);
                });
            }

            #[cfg(windows)]
            {
                let overlay_handle = overlay_hwnd(&handle);
                let watcher = handle.clone();
                win32::watch_foreground(move |info| {
                    log(&format!(
                        "foreground exe={:?} hwnd={:#x} own={}",
                        info.exe, info.hwnd, info.is_own
                    ));
                    let event =
                        foreground_event(info.hwnd, info.exe, info.is_own, overlay_handle);
                    dispatch(&watcher, event);
                });

                let info = win32::foreground_info();
                let event = foreground_event(info.hwnd, info.exe, info.is_own, overlay_handle);
                let handle = handle.clone();
                std::thread::spawn(move || dispatch(&handle, event));
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Closing the settings window only hides it: the overlay keeps running.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
mod secrets;
