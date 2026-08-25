use keyring::Entry;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivationRequest {
    base_url: String,
    code: String,
    device_id: String,
}

#[derive(Deserialize)]
struct ActivationEnvelope {
    code: Option<i64>,
    reason: Option<String>,
    data: Option<CustomerSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivationResult {
    success: bool,
    status: u16,
    code: Option<i64>,
    reason: Option<String>,
    retry_after: Option<u64>,
    expires_at: Option<String>,
}

impl ActivationResult {
    fn failure(status: u16, code: Option<i64>, reason: impl Into<String>, retry_after: Option<u64>) -> Self {
        Self { success: false, status, code, reason: Some(reason.into()), retry_after, expires_at: None }
    }
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|_| "无法访问系统安全凭据库。".to_string())
}

fn save_customer_session(session: &CustomerSession) -> Result<(), String> {
    if session.base_url.trim().is_empty() || session.access_token.trim().is_empty() || session.api_key.trim().is_empty() {
        return Err("激活响应缺少必要凭据。".to_string());
    }
    let value = serde_json::to_string(session).map_err(|_| "无法准备安全凭据。".to_string())?;
    credential_entry()?
        .set_password(&value)
        .map_err(|_| "无法保存到系统安全凭据库。".to_string())
}

fn activation_url(base_url: &str) -> Result<Url, ()> {
    let url = Url::parse(base_url.trim()).map_err(|_| ())?;
    if !matches!(url.scheme(), "http" | "https") || (!cfg!(debug_assertions) && url.scheme() != "https") {
        return Err(());
    }
    url.join("api/v1/customer/activate").map_err(|_| ())
}

async fn send_activation(client: &Client, url: &Url, request: &ActivationRequest) -> Result<(u16, Option<u64>, ActivationEnvelope), ()> {
    let response = client
        .post(url.clone())
        .json(&serde_json::json!({ "code": request.code, "device_id": request.device_id }))
        .send()
        .await
        .map_err(|_| ())?;
    let status = response.status().as_u16();
    let retry_after = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok()).filter(|value| *value > 0);
    let body = response.json::<ActivationEnvelope>().await.unwrap_or(ActivationEnvelope { code: None, reason: None, data: None });
    Ok((status, retry_after, body))
}

#[tauri::command]
async fn activate_customer(request: ActivationRequest) -> ActivationResult {
    if request.code.trim().is_empty() || request.code.trim().len() > 64 || !(16..=256).contains(&request.device_id.trim().len()) {
        return ActivationResult::failure(400, Some(400), "INVALID_REQUEST", None);
    }
    let url = match activation_url(&request.base_url) {
        Ok(url) => url,
        Err(()) => return ActivationResult::failure(0, None, "CONFIG_ERROR", None),
    };
    let client = match Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(client) => client,
        Err(_) => return ActivationResult::failure(0, None, "NETWORK_ERROR", None),
    };
    let mut response = match send_activation(&client, &url, &request).await {
        Ok(response) => response,
        Err(()) => return ActivationResult::failure(0, None, "NETWORK_ERROR", None),
    };
    if response.0 == 409 && response.2.reason.as_deref() == Some("REDEEM_CODE_LOCKED") {
        tokio::time::sleep(Duration::from_millis(800)).await;
        response = match send_activation(&client, &url, &request).await {
            Ok(response) => response,
            Err(()) => return ActivationResult::failure(0, None, "NETWORK_ERROR", None),
        };
    }
    let (status, retry_after, envelope) = response;
    if status != 200 || envelope.code != Some(0) {
        return ActivationResult::failure(status, envelope.code, envelope.reason.unwrap_or_else(|| "ACTIVATION_FAILED".to_string()), retry_after);
    }
    let session = match envelope.data {
        Some(session) if !session.access_token.is_empty() && !session.api_key.is_empty() => session,
        _ => return ActivationResult::failure(status, Some(0), "INVALID_RESPONSE", None),
    };
    let expires_at = session.expires_at.clone();
    if save_customer_session(&session).is_err() {
        return ActivationResult::failure(status, Some(0), "SECURE_STORAGE_FAILED", None);
    }
    ActivationResult { success: true, status, code: Some(0), reason: None, retry_after: None, expires_at }
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
        .invoke_handler(tauri::generate_handler![activate_customer, has_customer_session])
        .run(tauri::generate_context!())
        .expect("failed to start Sub2API Customer");
}
