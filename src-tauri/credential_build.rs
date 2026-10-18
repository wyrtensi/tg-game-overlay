#[cfg(not(test))]
use std::env;

#[cfg(not(test))]
pub fn read_credentials() -> Option<(i32, String)> {
    read_credentials_from(
        env::var("TG_API_ID").ok().as_deref(),
        env::var("TG_API_HASH").ok().as_deref(),
        &std::fs::read_to_string("credentials.json").unwrap_or_default(),
    )
}

pub fn read_credentials_from(
    environment_id: Option<&str>,
    environment_hash: Option<&str>,
    json: &str,
) -> Option<(i32, String)> {
    if let (Some(id), Some(hash)) = (environment_id, environment_hash) {
        if let Ok(id) = id.trim().parse::<i32>() {
            if id > 0 && !hash.trim().is_empty() {
                return Some((id, hash.trim().to_string()));
            }
        }
    }

    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let id = value.get("apiId")?.as_i64()?;
    let hash = value.get("apiHash")?.as_str()?.trim();
    (id > 0 && !hash.is_empty()).then_some((id as i32, hash.to_string()))
}

#[cfg(test)]
mod tests {
    use super::read_credentials_from;

    #[test]
    fn accepts_a_complete_environment_pair() {
        assert_eq!(
            read_credentials_from(Some("123"), Some("hash"), "{}"),
            Some((123, "hash".to_string()))
        );
    }

    #[test]
    fn rejects_an_empty_or_zero_embedded_pair() {
        assert_eq!(read_credentials_from(None, None, r#"{"apiId":0,"apiHash":""}"#), None);
    }
}
