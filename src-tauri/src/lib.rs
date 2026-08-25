use keyring::Entry;
use serde::{Deserialize, Serialize};

const CREDENTIAL_SERVICE: &str = "com.sub2api.customer";
const CREDENTIAL_ACCOUNT: &str = "customer-session";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerSession {
    base_url: String,
    access_token: String,
    refresh_token: Option<String>,
    api_key: String,
    expires_in: Option<u64>,
    expires_at: Option<String>,
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|_| "无法访问系统安全凭据库。".to_string())
}

#[tauri::command]
fn save_customer_session(session: CustomerSession) -> Result<(), String> {
    if session.base_url.trim().is_empty() || session.access_token.trim().is_empty() || session.api_key.trim().is_empty() {
        return Err("激活响应缺少必要凭据。".to_string());
    }
    let value = serde_json::to_string(&session).map_err(|_| "无法准备安全凭据。".to_string())?;
    credential_entry()?
        .set_password(&value)
        .map_err(|_| "无法保存到系统安全凭据库。".to_string())
}

#[tauri::command]
fn has_customer_session() -> Result<bool, String> {
    let value = match credential_entry()?.get_password() {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    Ok(serde_json::from_str::<CustomerSession>(&value).is_ok())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_customer_session, has_customer_session])
        .run(tauri::generate_context!())
        .expect("failed to start Sub2API Customer");
}
