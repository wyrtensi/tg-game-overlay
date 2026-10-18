//! Text the backend shows on its own: the tray menu and tooltip, the demo
//! feed and the default phrase wheel. Everything else is translated by the
//! web pages (src/i18n), which also translate error strings returned here.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    Ru,
    Zh,
}

/// "en" / "ru" / "zh" pick a language; anything else follows Windows.
pub fn resolve(setting: &str) -> Locale {
    match setting {
        "en" => Locale::En,
        "ru" => Locale::Ru,
        "zh" => Locale::Zh,
        _ => system_locale(),
    }
}

#[cfg(windows)]
fn system_locale() -> Locale {
    // SAFETY: plain query of the user's display language, no arguments.
    let lang_id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    from_primary_language(lang_id & 0x3ff)
}

#[cfg(not(windows))]
fn system_locale() -> Locale {
    Locale::En
}

/// Maps a Windows primary language id (LANGID & 0x3ff) the same way the web
/// pages map BCP 47 tags in detectLocale.
fn from_primary_language(primary: u16) -> Locale {
    match primary {
        0x04 => Locale::Zh,
        0x19 | 0x23 | 0x3f => Locale::Ru, // Russian, Belarusian, Kazakh
        _ => Locale::En,
    }
}

pub struct TrayText {
    pub settings: &'static str,
    pub pause: &'static str,
    pub quit: &'static str,
    pub tooltip: &'static str,
    pub tooltip_paused: &'static str,
}

pub fn tray(locale: Locale) -> TrayText {
    match locale {
        Locale::Ru => TrayText {
            settings: "Настройки",
            pause: "Пауза",
            quit: "Выход",
            tooltip: "Telegram overlay",
            tooltip_paused: "Telegram overlay - пауза",
        },
        Locale::En => TrayText {
            settings: "Settings",
            pause: "Pause",
            quit: "Quit",
            tooltip: "Telegram overlay",
            tooltip_paused: "Telegram overlay - paused",
        },
        Locale::Zh => TrayText {
            settings: "设置",
            pause: "暂停",
            quit: "退出",
            tooltip: "Telegram overlay",
            tooltip_paused: "Telegram overlay - 已暂停",
        },
    }
}

pub fn demo_lines(locale: Locale) -> [(&'static str, &'static str); 5] {
    match locale {
        Locale::Ru => [
            ("Стас", "зайдёшь на катку?"),
            ("Стас", "смотри что нашёл в патче"),
            ("Аня", "не забудь про созвон в 19:00"),
            ("Стас", "го в 21, я освобожусь"),
            ("Аня", "сюда же прилетит картинка"),
        ],
        Locale::En => [
            ("Alex", "up for a match?"),
            ("Alex", "look what I found in the patch notes"),
            ("Sam", "don't forget the call at 7 pm"),
            ("Alex", "let's go at 9, I'll be free"),
            ("Sam", "pictures show up here too"),
        ],
        Locale::Zh => [
            ("小明", "来一局吗？"),
            ("小明", "看看我在更新说明里发现了什么"),
            ("小红", "别忘了晚上 7 点的语音"),
            ("小明", "9 点开吧，我那时有空"),
            ("小红", "图片也会显示在这里"),
        ],
    }
}

pub fn default_phrases(locale: Locale) -> Vec<String> {
    let phrases: [&str; 4] = match locale {
        Locale::Ru => ["Вперёд", "Назад", "Нужна помощь", "Подожди"],
        Locale::En => ["Go", "Fall back", "Need help", "Wait"],
        Locale::Zh => ["前进", "撤退", "需要支援", "等一下"],
    };
    phrases.iter().map(|phrase| phrase.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::{default_phrases, from_primary_language, resolve, Locale};

    #[test]
    fn explicit_settings_win_over_the_system() {
        assert_eq!(resolve("en"), Locale::En);
        assert_eq!(resolve("ru"), Locale::Ru);
        assert_eq!(resolve("zh"), Locale::Zh);
    }

    #[test]
    fn maps_windows_primary_languages() {
        assert_eq!(from_primary_language(0x04), Locale::Zh);
        assert_eq!(from_primary_language(0x19), Locale::Ru);
        assert_eq!(from_primary_language(0x09), Locale::En);
        assert_eq!(from_primary_language(0x07), Locale::En);
    }

    #[test]
    fn default_phrases_match_the_phrase_wheel_defaults() {
        assert_eq!(
            default_phrases(Locale::Ru),
            crate::config::PhraseWheelSettings::default().phrases
        );
        assert_eq!(default_phrases(Locale::Zh).len(), 4);
    }
}
