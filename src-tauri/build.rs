use std::{env, fs, path::PathBuf};

mod credential_build;

/// Telegram application keys are read at build time from credentials.json
/// (or TG_API_ID / TG_API_HASH) and embedded scrambled, so a plain search
/// through the binary does not reveal them. A client secret can never be
/// truly hidden - this only raises the bar above "strings app.exe".
///
/// Without keys the app still builds: every user then enters their own
/// api_id / api_hash in the settings. Public release builds set
/// TGO_NO_EMBEDDED_KEYS=1 so a stray credentials.json can never leak into them.
fn main() {
    println!("cargo:rerun-if-changed=credentials.json");
    println!("cargo:rerun-if-env-changed=TG_API_ID");
    println!("cargo:rerun-if-env-changed=TG_API_HASH");
    println!("cargo:rerun-if-env-changed=TGO_NO_EMBEDDED_KEYS");

    let credentials = if env::var("TGO_NO_EMBEDDED_KEYS").as_deref() == Ok("1") {
        None
    } else {
        credential_build::read_credentials()
    };
    let (api_id, api_hash) = credentials.unwrap_or((0, String::new()));
    let key: u8 = 0x5b;
    let scrambled: Vec<String> = api_hash
        .bytes()
        .map(|byte| format!("{}", byte ^ key))
        .collect();

    let generated = format!(
        "pub const API_ID: i32 = {api_id};\n\
         const SCRAMBLED_HASH: &[u8] = &[{}];\n\
         const SCRAMBLE_KEY: u8 = {key};\n\
         pub fn api_hash() -> String {{\n\
         \x20   SCRAMBLED_HASH.iter().map(|byte| (byte ^ SCRAMBLE_KEY) as char).collect()\n\
         }}\n",
        scrambled.join(", ")
    );

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("credentials.rs");
    fs::write(out, generated).expect("write credentials.rs");

    tauri_build::build()
}
