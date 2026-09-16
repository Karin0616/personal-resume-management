use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use std::{fs, path::Path};
use zeroize::Zeroizing;

#[cfg(windows)]
fn protect(input: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let source = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let ok = if decrypt {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("Windows 키 보호에 실패했습니다. 같은 Windows 사용자로 실행하세요.".into());
        }
        let buffer = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let result = buffer.to_vec();
        use zeroize::Zeroize;
        buffer.zeroize();
        LocalFree(output.pbData as _);
        Ok(result)
    }
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("MVP는 Windows에서만 키 저장을 지원합니다.".into())
}

pub fn load(dir: &Path) -> Result<SigningKey, String> {
    let bytes = fs::read(dir.join("device-key.dpapi")).map_err(|_| "먼저 기기 키를 생성하세요.")?;
    let raw = Zeroizing::new(protect(&bytes, true)?);
    let seed: &[u8; 32] = raw.as_slice().try_into().map_err(|_| "키 파일 형식 오류")?;
    Ok(SigningKey::from_bytes(seed))
}
pub fn create(dir: &Path) -> Result<SigningKey, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if dir.join("device-key.dpapi").exists() {
        return load(dir);
    }
    let key = SigningKey::generate(&mut OsRng);
    let raw = Zeroizing::new(key.to_bytes());
    let encrypted = protect(raw.as_ref(), false)?;
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("device-key.dpapi"))
        .map_err(|e| e.to_string())?;
    file.write_all(&encrypted).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(key)
}
#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_roundtrip() {
        let secret = [42u8; 32];
        let encrypted = super::protect(&secret, false).unwrap();
        assert_ne!(encrypted, secret);
        assert_eq!(super::protect(&encrypted, true).unwrap(), secret);
    }
}
