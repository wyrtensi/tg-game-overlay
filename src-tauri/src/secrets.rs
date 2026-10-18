//! Secrets on disk are protected with DPAPI, so the Telegram session string is
//! readable only by this Windows user on this machine.

use std::path::PathBuf;

#[cfg(windows)]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

fn secret_path(dir: &PathBuf, name: &str) -> PathBuf {
    dir.join("secrets").join(format!("{name}.bin"))
}

#[cfg(windows)]
fn protect(data: &[u8], encrypt: bool) -> Option<Vec<u8>> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    let ok = unsafe {
        if encrypt {
            CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
        } else {
            CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
        }
    };
    ok.ok()?;

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            output.pbData as *mut _,
        ));
    }

    Some(bytes)
}

#[cfg(not(windows))]
fn protect(data: &[u8], _encrypt: bool) -> Option<Vec<u8>> {
    Some(data.to_vec())
}

pub fn save(dir: &PathBuf, name: &str, value: &str) -> Result<(), String> {
    let path = secret_path(dir, name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let protected = protect(value.as_bytes(), true).ok_or("не удалось зашифровать значение")?;
    std::fs::write(&path, protected).map_err(|error| error.to_string())
}

pub fn load(dir: &PathBuf, name: &str) -> Option<String> {
    let raw = std::fs::read(secret_path(dir, name)).ok()?;
    let plain = protect(&raw, false)?;

    String::from_utf8(plain).ok()
}

pub fn clear(dir: &PathBuf, name: &str) {
    let _ = std::fs::remove_file(secret_path(dir, name));
}
