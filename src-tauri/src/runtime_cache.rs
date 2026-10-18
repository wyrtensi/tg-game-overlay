use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCacheV1 {
    #[serde(default)]
    direction_message_ids_by_chat: HashMap<String, i32>,
}

pub fn direction_cache_key(account_id: &str, chat_key: &str) -> String {
    format!("{account_id}|{chat_key}")
}

pub fn runtime_cache_path(config_path: &Path) -> PathBuf {
    config_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("telegram-runtime-cache-v1.json")
}

impl RuntimeCacheV1 {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn get(&self, key: &str) -> Option<i32> {
        self.direction_message_ids_by_chat.get(key).copied()
    }

    pub fn set(&mut self, key: String, message_id: i32) {
        self.direction_message_ids_by_chat.insert(key, message_id);
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = path.with_extension("tmp");
        let serialized = serde_json::to_string_pretty(self).map_err(|error| error.to_string())?;
        fs::write(&temporary, serialized).map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            error.to_string()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{direction_cache_key, runtime_cache_path, RuntimeCacheV1};

    fn test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "tg-game-overlay-runtime-cache-{name}-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn keeps_direction_message_ids_isolated_by_account_and_chat() {
        let key_a = direction_cache_key("10", "channel:7:2");
        let key_b = direction_cache_key("11", "channel:7:2");
        let key_c = direction_cache_key("10", "channel:7:3");
        assert_ne!(key_a, key_b);
        assert_ne!(key_a, key_c);
    }

    #[test]
    fn saves_and_loads_a_direction_message_id() {
        let path = test_path("round-trip");
        let key = direction_cache_key("10", "channel:7:2");
        let mut cache = RuntimeCacheV1::default();
        cache.set(key.clone(), 42);
        cache.save(&path).unwrap();

        assert_eq!(RuntimeCacheV1::load(&path).get(&key), Some(42));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn discards_a_corrupt_cache_without_touching_the_file() {
        let path = test_path("corrupt");
        std::fs::write(&path, "not json").unwrap();

        assert_eq!(RuntimeCacheV1::load(&path).get("missing"), None);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn stores_runtime_state_next_to_but_separate_from_user_config() {
        let config = std::path::Path::new("C:/overlay/config.json");
        assert_eq!(
            runtime_cache_path(config),
            std::path::PathBuf::from("C:/overlay/telegram-runtime-cache-v1.json")
        );
    }
}
