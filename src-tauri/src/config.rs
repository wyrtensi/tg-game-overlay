use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileMode {
    Show,
    Hidden,
    Blocked,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Zone {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Zone {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { x, y, width, height }
    }
}

/// The single chat the overlay mirrors: a person, a group or a channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRef {
    /// "user", "chat" (basic group) or "channel" (supergroup or channel).
    pub kind: String,
    pub id: String,
    pub access_hash: Option<String>,
    pub title: String,
    pub username: Option<String>,
    #[serde(default)]
    pub is_bot: bool,
    /// Forum topic, when the chat is a forum supergroup.
    pub topic_id: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub exe: String,
    pub title: String,
    pub mode: ProfileMode,
    pub inactive: Zone,
    pub active: Zone,
}

impl Profile {
    pub fn new(exe: String, title: String) -> Self {
        let inactive = Zone::new(0.02, 0.6, 0.3, 0.35);
        Self {
            exe,
            title,
            mode: ProfileMode::Show,
            inactive,
            active: Zone::new(inactive.x, 0.25, inactive.width, 0.7),
        }
    }
}

fn default_text_color() -> String {
    "#f2f2f2".to_string()
}

fn default_author_color() -> String {
    "#7fb2ff".to_string()
}

fn default_shadow() -> f64 {
    0.85
}

fn default_fade_ms() -> u64 {
    1_200
}

fn default_sticker_animation_seconds() -> u64 {
    10
}

fn default_message_layout() -> String {
    "compact".to_string()
}

fn default_show_author() -> bool {
    true
}

fn default_show_message_time() -> bool {
    true
}

fn default_incoming_bubble_color() -> String {
    "#1c222c".to_string()
}

fn default_outgoing_bubble_color() -> String {
    "#1e5d92".to_string()
}

fn default_direction_signals() -> DirectionSettings {
    DirectionSettings::default()
}

fn default_phrase_wheel() -> PhraseWheelSettings {
    PhraseWheelSettings::default()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectionSettings {
    pub enabled: bool,
    pub up_key: String,
    pub down_key: String,
    pub left_key: String,
    pub right_key: String,
    pub display_ms: u64,
}

impl Default for DirectionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            up_key: "ArrowUp".to_string(),
            down_key: "ArrowDown".to_string(),
            left_key: "ArrowLeft".to_string(),
            right_key: "ArrowRight".to_string(),
            display_ms: 2_500,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseWheelSettings {
    pub enabled: bool,
    pub hotkey: String,
    pub dead_zone_px: u32,
    pub phrases: Vec<String>,
}

impl Default for PhraseWheelSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            hotkey: "Ctrl+Space".to_string(),
            dead_zone_px: 42,
            phrases: vec![
                "Вперёд".to_string(),
                "Назад".to_string(),
                "Нужна помощь".to_string(),
                "Подожди".to_string(),
            ],
        }
    }
}

/// The self-hosted relay server (server/PROTOCOL.md). The access key and the
/// room password are secrets and live in DPAPI storage, never in this file.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySettings {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub display_name: String,
}

pub const TRANSPORT_TELEGRAM: &str = "telegram";
pub const TRANSPORT_RELAY: &str = "relay";

fn default_transport() -> String {
    TRANSPORT_TELEGRAM.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub hotkey: String,
    pub markup_hotkey: String,
    pub ttl_ms: u64,
    /// Backdrop opacity behind a chat line, 0..1.
    pub opacity: f64,
    pub font_scale: f64,
    #[serde(default = "default_text_color")]
    pub text_color: String,
    #[serde(default = "default_author_color")]
    pub author_color: String,
    /// Text shadow strength, 0..1: readability over bright scenes.
    #[serde(default = "default_shadow")]
    pub shadow: f64,
    /// How long the fade-out takes at the end of a line's life.
    #[serde(default = "default_fade_ms")]
    pub fade_ms: u64,
    /// Animated sticker playback duration in seconds; zero keeps a still frame.
    #[serde(default = "default_sticker_animation_seconds")]
    pub sticker_animation_seconds: u64,
    #[serde(default = "default_message_layout")]
    pub message_layout: String,
    #[serde(default = "default_show_author")]
    pub show_author: bool,
    #[serde(default = "default_show_message_time")]
    pub show_message_time: bool,
    #[serde(default = "default_incoming_bubble_color")]
    pub incoming_bubble_color: String,
    #[serde(default = "default_outgoing_bubble_color")]
    pub outgoing_bubble_color: String,
    /// Telegram application id: only set when the user brings their own.
    #[serde(default)]
    pub api_id: Option<i32>,
    #[serde(default)]
    pub chat: Option<ChatRef>,
    /// Which worker carries the chat: "telegram" or "relay".
    #[serde(default = "default_transport")]
    pub transport: String,
    #[serde(default)]
    pub relay: RelaySettings,
    #[serde(default = "default_direction_signals")]
    pub direction_signals: DirectionSettings,
    #[serde(default = "default_phrase_wheel")]
    pub phrase_wheel: PhraseWheelSettings,
    pub autostart: bool,
    pub demo_feed: bool,
    pub profiles: Vec<Profile>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "T".to_string(),
            markup_hotkey: "Ctrl+Shift+M".to_string(),
            ttl_ms: 10_000,
            opacity: 0.45,
            font_scale: 1.0,
            text_color: default_text_color(),
            author_color: default_author_color(),
            shadow: default_shadow(),
            fade_ms: default_fade_ms(),
            sticker_animation_seconds: default_sticker_animation_seconds(),
            message_layout: default_message_layout(),
            show_author: default_show_author(),
            show_message_time: default_show_message_time(),
            incoming_bubble_color: default_incoming_bubble_color(),
            outgoing_bubble_color: default_outgoing_bubble_color(),
            api_id: None,
            chat: None,
            transport: default_transport(),
            relay: RelaySettings::default(),
            direction_signals: default_direction_signals(),
            phrase_wheel: default_phrase_wheel(),
            autostart: false,
            demo_feed: false,
            profiles: Vec::new(),
        }
    }
}

impl Config {
    pub fn profile(&self, exe: &str) -> Option<&Profile> {
        let exe = exe.to_lowercase();
        self.profiles.iter().find(|profile| profile.exe.to_lowercase() == exe)
    }

    pub fn load(path: &PathBuf) -> Result<Self, String> {
        let Ok(raw) = fs::read_to_string(path) else {
            return Ok(Self::default());
        };

        serde_json::from_str(&raw).map_err(|error| format!("{path:?}: {error}"))
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Не удалось создать папку настроек {parent:?}: {error}"))?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|error| format!("Не удалось подготовить настройки: {error}"))?;
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, raw)
            .map_err(|error| format!("Не удалось записать временный файл настроек {temporary:?}: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("Не удалось применить настройки {path:?}: {error}"))
    }
}

pub fn normalize_profile_exe(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_matches('"');
    let executable = trimmed
        .rsplit(['\\', '/'])
        .next()
        .map(str::trim)
        .unwrap_or_default();

    if executable.is_empty() || !executable.to_ascii_lowercase().ends_with(".exe") {
        return Err("Укажите имя файла с расширением .exe".into());
    }

    Ok(executable.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::{normalize_profile_exe, Config};
    use std::fs;

    #[test]
    fn loading_preserves_an_existing_chat_hotkey() {
        let path = std::env::temp_dir().join(format!(
            "tg-overlay-hotkey-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut config = Config::default();
        config.hotkey = "Ctrl+T".to_string();
        config.save(&path).unwrap();

        let loaded = Config::load(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(loaded.hotkey, "Ctrl+T");
    }

    #[test]
    fn old_config_defaults_sticker_animation_to_ten_seconds() {
        let config: Config = serde_json::from_str(
            r#"{"hotkey":"Ctrl+T","markupHotkey":"Ctrl+M","ttlMs":10000,"opacity":0.45,"fontScale":1,"autostart":false,"demoFeed":true,"profiles":[]}"#,
        )
        .unwrap();

        assert_eq!(config.sticker_animation_seconds, 10);
    }

    #[test]
    fn fresh_config_does_not_show_demo_messages() {
        assert!(!Config::default().demo_feed);
    }

    #[test]
    fn old_config_defaults_dialogue_appearance() {
        let config: Config = serde_json::from_str(
            r#"{"hotkey":"Ctrl+T","markupHotkey":"Ctrl+M","ttlMs":10000,"opacity":0.45,"fontScale":1,"autostart":false,"demoFeed":true,"profiles":[]}"#,
        )
        .unwrap();

        assert_eq!(config.message_layout, "compact");
        assert!(config.show_author);
        assert_eq!(config.incoming_bubble_color, "#1c222c");
        assert_eq!(config.outgoing_bubble_color, "#1e5d92");
    }

    #[test]
    fn old_config_defaults_direction_signals() {
        let config: Config = serde_json::from_str(
            r#"{"hotkey":"Ctrl+T","markupHotkey":"Ctrl+M","ttlMs":10000,"opacity":0.45,"fontScale":1,"autostart":false,"demoFeed":true,"profiles":[]}"#,
        )
        .unwrap();

        assert!(!config.direction_signals.enabled);
        assert_eq!(config.direction_signals.up_key, "ArrowUp");
    }

    #[test]
    fn old_config_defaults_phrase_wheel() {
        let config: Config = serde_json::from_str(
            r#"{"hotkey":"Ctrl+T","markupHotkey":"Ctrl+M","ttlMs":10000,"opacity":0.45,"fontScale":1,"autostart":false,"demoFeed":true,"profiles":[]}"#,
        )
        .unwrap();

        assert!(!config.phrase_wheel.enabled);
        assert_eq!(config.phrase_wheel.hotkey, "Ctrl+Space");
    }

    #[test]
    fn old_config_defaults_to_the_telegram_transport() {
        let config: Config = serde_json::from_str(
            r#"{"hotkey":"Ctrl+T","markupHotkey":"Ctrl+M","ttlMs":10000,"opacity":0.45,"fontScale":1,"autostart":false,"demoFeed":true,"profiles":[]}"#,
        )
        .unwrap();

        assert_eq!(config.transport, "telegram");
        assert_eq!(config.relay, super::RelaySettings::default());
    }

    #[test]
    fn normalizes_a_quoted_executable_path() {
        assert_eq!(
            normalize_profile_exe(r#"  "C:\Games\My Game\Launcher.EXE"  "#),
            Ok("launcher.exe".to_string())
        );
    }

    #[test]
    fn rejects_a_non_executable_profile_value() {
        assert!(normalize_profile_exe(r#"C:\\Games\\My Game"#).is_err());
    }

    #[test]
    fn reports_an_error_when_the_config_path_is_not_a_file() {
        let path = std::env::temp_dir().join(format!("tg-overlay-config-save-{}", std::process::id()));
        fs::create_dir_all(&path).unwrap();

        assert!(Config::default().save(&path).is_err());
    }
}
