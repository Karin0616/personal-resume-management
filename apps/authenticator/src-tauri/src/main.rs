#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod key_store;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::Signer;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Serialize, Deserialize)]
struct Config {
    origin: String,
    name: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Challenge {
    id: String,
    payload: String,
    origin: String,
    purpose: String,
    expires_at: String,
    registration: Option<serde_json::Value>,
}
#[derive(Default)]
struct Pending(Mutex<Option<Challenge>>);
fn directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}
fn config(app: &tauri::AppHandle) -> Result<Config, String> {
    serde_json::from_slice(
        &fs::read(directory(app)?.join("config.json")).map_err(|_| "사이트 설정이 필요합니다.")?,
    )
    .map_err(|e| e.to_string())
}
fn origin_valid(origin: &str) -> bool {
    url::Url::parse(origin)
        .map(|u| {
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
                && u.origin().ascii_serialization() == origin
        })
        .unwrap_or(false)
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn setup(app: tauri::AppHandle, origin: String, name: String) -> Result<String, String> {
    if !origin_valid(&origin)
        || name.trim().is_empty()
        || name.len() > 100
        || name.contains(['\n', '\r'])
    {
        return Err(
            "HTTPS 사이트 주소와 기기 이름을 확인하세요. 주소 끝에 /를 붙이지 마세요.".into(),
        );
    }
    let dir = directory(&app)?;
    let key = key_store::create(&dir)?;
    fs::write(
        dir.join("config.json"),
        serde_json::to_vec(&Config { origin, name }).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(B64.encode(key.verifying_key().as_bytes()))
}
#[tauri::command]
fn status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let c = config(&app)?;
    let key = key_store::load(&directory(&app)?)?;
    Ok(
        serde_json::json!({"origin":c.origin,"name":c.name,"public_key":B64.encode(key.verifying_key().as_bytes())}),
    )
}
#[tauri::command]
fn registration(app: tauri::AppHandle) -> Result<String, String> {
    let c = config(&app)?;
    let key = key_store::load(&directory(&app)?)?;
    let public_key = B64.encode(key.verifying_key().as_bytes());
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let nonce = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(10))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let payload = format!(
        "resume-auth:v1\nregister-key\n{}\n{}\n{}\n{}\n{}",
        c.origin, public_key, c.name, nonce, expires_at
    );
    let signature = B64.encode(key.sign(payload.as_bytes()).to_bytes());
    serde_json::to_string_pretty(&serde_json::json!({"name":c.name,"public_key":public_key,"origin":c.origin,"nonce":nonce,"expires_at":expires_at,"signature":signature})).map_err(|e|e.to_string())
}
fn validate_challenge(c: &Challenge, id: &str, origin: &str) -> Result<(), String> {
    let lines: Vec<_> = c.payload.split('\n').collect();
    let expiry =
        chrono::DateTime::parse_from_rfc3339(&c.expires_at).map_err(|_| "만료 시각 오류")?;
    let seconds = expiry.timestamp() - chrono::Utc::now().timestamp();
    if c.id != id
        || c.origin != origin
        || seconds <= 0
        || seconds > 300
        || !matches!(c.purpose.as_str(), "login" | "register")
        || lines.len() != if c.purpose == "register" { 7 } else { 6 }
    {
        return Err("인증 요청 검증 실패".into());
    }
    if lines[0] != "resume-auth:v1"
        || lines[1] != c.purpose
        || lines[2] != origin
        || lines[3] != id
        || lines[5] != c.expires_at
        || lines[4].len() != 64
        || !lines[4].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("서명 대상이 요청과 일치하지 않습니다.".into());
    }
    // Server's JSON insertion order is signed as a digest; verify the exact fields in its order.
    if c.purpose == "register" {
        let r = c.registration.as_ref().ok_or("기기 등록 정보 없음")?;
        let serialized=format!("{{\"name\":{},\"public_key\":{},\"origin\":{},\"nonce\":{},\"expires_at\":{},\"signature\":{}}}",r["name"],r["public_key"],r["origin"],r["nonce"],r["expires_at"],r["signature"]);
        if format!("{:x}", Sha256::digest(serialized.as_bytes())) != lines[6] {
            return Err("등록 정보 digest 불일치".into());
        }
    }
    Ok(())
}
#[tauri::command]
async fn inspect(
    app: tauri::AppHandle,
    state: tauri::State<'_, Pending>,
    request: String,
) -> Result<Challenge, String> {
    let id = if request.starts_with("resume-auth:") {
        let u = url::Url::parse(&request).map_err(|e| e.to_string())?;
        if u.scheme() != "resume-auth"
            || u.host_str() != Some("approve")
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err("잘못된 인증 링크".into());
        }
        u.path().trim_start_matches('/').to_string()
    } else {
        request
    };
    uuid::Uuid::parse_str(&id).map_err(|_| "요청 ID 형식 오류")?;
    let conf = config(&app)?;
    let c: Challenge = client()?
        .get(format!("{}/api/v1/auth/challenges/{}", conf.origin, id))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|_| "요청을 찾을 수 없거나 만료되었습니다.")?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    validate_challenge(&c, &id, &conf.origin)?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(c.clone());
    Ok(c)
}
#[tauri::command]
async fn approve(
    app: tauri::AppHandle,
    state: tauri::State<'_, Pending>,
    id: String,
) -> Result<(), String> {
    let c = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("승인할 요청 없음")?;
    let conf = config(&app)?;
    validate_challenge(&c, &id, &conf.origin)?;
    let key = key_store::load(&directory(&app)?)?;
    let signature = B64.encode(key.sign(c.payload.as_bytes()).to_bytes());
    client()?.post(format!("{}/api/v1/auth/challenges/{}/approve",conf.origin,id)).json(&serde_json::json!({"public_key":B64.encode(key.verifying_key().as_bytes()),"signature":signature})).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|_|"승인 실패: 기기 등록 또는 요청 만료 여부를 확인하세요.")?;
    Ok(())
}
#[tauri::command]
fn reject(state: tauri::State<'_, Pending>) {
    if let Ok(mut p) = state.0.lock() {
        *p = None;
    }
}
#[tauri::command]
fn initial_links(app: tauri::AppHandle) -> Vec<String> {
    app.deep_link()
        .get_current()
        .ok()
        .flatten()
        .unwrap_or_default()
        .iter()
        .map(|u| u.to_string())
        .collect()
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(Pending::default())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let _ = handle.emit(
                    "auth-links",
                    event
                        .urls()
                        .iter()
                        .map(|u| u.to_string())
                        .collect::<Vec<_>>(),
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup,
            status,
            registration,
            inspect,
            approve,
            reject,
            initial_links
        ])
        .run(tauri::generate_context!())
        .expect("Authenticator runtime failed");
}
#[cfg(test)]
mod tests {
    #[test]
    fn allowed_origins() {
        assert!(super::origin_valid("https://resume.example"));
        assert!(!super::origin_valid("http://resume.example"));
        assert!(!super::origin_valid("https://resume.example/path"));
    }
    #[test]
    fn rfc8032_vector() {
        use ed25519_dalek::Signer;
        let seed = [
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec,
            0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03,
            0x1c, 0xae, 0x7f, 0x60,
        ];
        let key = ed25519_dalek::SigningKey::from_bytes(&seed);
        let signature = key
            .sign(b"")
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert_eq!(signature, "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
    }
}
