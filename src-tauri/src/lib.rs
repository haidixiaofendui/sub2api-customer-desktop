mod codex_config;

use keyring::Entry;
use reqwest::{Client, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const CREDENTIAL_SERVICE: &str = "com.sub2api.customer";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct CustomerSession {
    base_url: String,
    access_token: String,
    refresh_token: Option<String>,
    api_key: String,
    expires_in: Option<u64>,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct ActivationCredentials {
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
    account_id: String,
    existing_account_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountRequest {
    account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalAccountRequest {
    account_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadNotificationsRequest {
    account_id: String,
    notification_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchApiKeyGroupRequest {
    account_id: String,
    api_key_id: i64,
    group_id: i64,
}

#[derive(Deserialize)]
struct ActivationEnvelope {
    code: Option<i64>,
    reason: Option<String>,
    data: Option<ActivationCredentials>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivationResult {
    success: bool,
    status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i64>,
    reason: Option<String>,
    retry_after: Option<u64>,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageData {
    mode: Option<String>,
    is_valid: Option<bool>,
    plan_name: Option<String>,
    balance: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
    quota: Option<UsageQuota>,
}

#[derive(Deserialize)]
struct UsageQuota {
    limit: Option<f64>,
    used: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageSnapshot {
    quota: f64,
    used: f64,
    remaining: f64,
    unit: String,
    mode: Option<String>,
    plan_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct RawUsageDetail {
    id: Value,
    model: String,
    created_at: Option<String>,
    input_tokens: Option<f64>,
    output_tokens: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageDetail {
    id: String,
    model: String,
    created_at: Option<String>,
    input_tokens: f64,
    output_tokens: f64,
}

#[derive(Deserialize)]
struct UsageDetailsData {
    items: Vec<RawUsageDetail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct RawNotification {
    id: Value,
    title: Option<String>,
    content: Option<String>,
    created_at: Option<String>,
    read: Option<bool>,
}

#[derive(Deserialize)]
struct NotificationsData {
    items: Vec<RawNotification>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
struct CustomerGroup {
    id: i64,
    name: String,
    description: Option<String>,
    platform: String,
    rate_multiplier: f64,
}

#[derive(Deserialize)]
struct RawApiKey {
    id: i64,
    name: String,
    status: String,
    group: Option<CustomerGroup>,
}

#[derive(Deserialize)]
struct ApiKeysData {
    items: Vec<RawApiKey>,
}

#[derive(Deserialize)]
struct SwitchApiKeyGroupData {
    api_key_id: i64,
    group: CustomerGroup,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeySummary {
    id: i64,
    group: Option<CustomerGroup>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationItem {
    id: String,
    title: String,
    content: String,
    time: Option<String>,
    read: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceResult {
    success: bool,
    status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i64>,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageResult {
    #[serde(flatten)]
    service: ServiceResult,
    usage: Option<UsageSnapshot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageDetailsResult {
    #[serde(flatten)]
    service: ServiceResult,
    items: Option<Vec<UsageDetail>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationsResult {
    #[serde(flatten)]
    service: ServiceResult,
    items: Option<Vec<NotificationItem>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyResult {
    #[serde(flatten)]
    service: ServiceResult,
    api_key: Option<ApiKeySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerGroupsResult {
    #[serde(flatten)]
    service: ServiceResult,
    items: Option<Vec<CustomerGroup>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwitchApiKeyGroupResult {
    #[serde(flatten)]
    service: ServiceResult,
    api_key_id: Option<i64>,
    group: Option<CustomerGroup>,
}

impl ActivationResult {
    fn failure(
        status: u16,
        code: Option<i64>,
        reason: impl Into<String>,
        retry_after: Option<u64>,
    ) -> Self {
        Self {
            success: false,
            status,
            code,
            reason: Some(reason.into()),
            retry_after,
            expires_at: None,
        }
    }
}

impl ServiceResult {
    fn success(status: u16, code: Option<i64>) -> Self {
        Self {
            success: true,
            status,
            code,
            reason: None,
        }
    }
    fn failure(status: u16, code: Option<i64>, reason: impl Into<String>) -> Self {
        Self {
            success: false,
            status,
            code,
            reason: Some(reason.into()),
        }
    }
}

fn valid_account_id(account_id: &str) -> bool {
    !account_id.is_empty()
        && account_id.len() <= 64
        && account_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn credential_entry(account_id: &str) -> Result<Entry, String> {
    if !valid_account_id(account_id) {
        return Err("本地账号标识无效。".to_string());
    }
    Entry::new(
        CREDENTIAL_SERVICE,
        &format!("customer-session:{account_id}"),
    )
    .map_err(|_| "无法访问系统安全凭据库。".to_string())
}

fn save_customer_session(account_id: &str, session: &CustomerSession) -> Result<(), String> {
    if session.base_url.trim().is_empty()
        || session.access_token.trim().is_empty()
        || session.api_key.trim().is_empty()
    {
        return Err("激活响应缺少必要凭据。".to_string());
    }
    let value = serde_json::to_string(session).map_err(|_| "无法准备安全凭据。".to_string())?;
    credential_entry(account_id)?
        .set_password(&value)
        .map_err(|_| "无法保存到系统安全凭据库。".to_string())
}

fn customer_session(account_id: &str) -> Result<CustomerSession, String> {
    let value = credential_entry(account_id)?
        .get_password()
        .map_err(|_| "找不到该账号的安全凭据，请重新添加账号。".to_string())?;
    serde_json::from_str(&value).map_err(|_| "该账号的安全凭据已损坏，请重新添加账号。".to_string())
}

fn activation_url(base_url: &str) -> Result<Url, ()> {
    let url = Url::parse(base_url.trim()).map_err(|_| ())?;
    if url.host().is_none() || !matches!(url.scheme(), "http" | "https") {
        return Err(());
    }
    url.join("api/v1/customer/activate").map_err(|_| ())
}

fn endpoint_url(base_url: &str, path: &str) -> Result<Url, ()> {
    let url = Url::parse(base_url.trim()).map_err(|_| ())?;
    if url.host().is_none() || !matches!(url.scheme(), "http" | "https") {
        return Err(());
    }
    url.join(path).map_err(|_| ())
}

fn http_client() -> Result<Client, ()> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| ())
}

async fn send(request: reqwest::RequestBuilder) -> Result<(u16, String), ()> {
    let response = request.send().await.map_err(|_| ())?;
    let status = response.status().as_u16();
    Ok((status, response.text().await.map_err(|_| ())?))
}

fn parse_response<T: DeserializeOwned>(
    body: &str,
) -> (Option<i64>, Option<String>, Option<T>, bool) {
    let value: Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(_) => return (None, Some("INVALID_RESPONSE".to_string()), None, false),
    };
    let code = value.get("code").and_then(Value::as_i64);
    let text_code = value.get("code").and_then(Value::as_str);
    let reason = value
        .get("reason")
        .and_then(Value::as_str)
        .or(text_code)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let business_ok = code.is_none_or(|value| value == 0 || value == 200)
        && text_code.is_none_or(|value| matches!(value, "OK" | "SUCCESS"));
    let payload = value.get("data").cloned().unwrap_or(value);
    (
        code,
        reason,
        serde_json::from_value(payload).ok(),
        business_ok,
    )
}

fn failure_reason(reason: Option<String>) -> String {
    reason.unwrap_or_else(|| "REQUEST_FAILED".to_string())
}

fn usage_snapshot(data: UsageData) -> Option<UsageSnapshot> {
    if data.is_valid == Some(false) {
        return None;
    }
    let quota = data.quota.as_ref();
    let remaining = data.remaining.or_else(|| quota.and_then(|value| value.remaining))?;
    let limit = quota.and_then(|value| value.limit).or(data.balance).unwrap_or(remaining);
    let used = quota.and_then(|value| value.used).unwrap_or_else(|| (limit - remaining).max(0.0));
    let unit = data.unit.or_else(|| quota.and_then(|value| value.unit.clone())).unwrap_or_else(|| "USD".to_string());
    Some(UsageSnapshot { quota: limit, used, remaining, unit, mode: data.mode, plan_name: data.plan_name })
}

fn value_id(value: Value) -> Option<String> {
    match value {
        Value::String(id) if !id.is_empty() => Some(id),
        Value::Number(id) => Some(id.to_string()),
        _ => None,
    }
}

fn same_account(session: &CustomerSession, credentials: &ActivationCredentials) -> bool {
    session.access_token == credentials.access_token || session.api_key == credentials.api_key
}

async fn send_activation(
    client: &Client,
    url: &Url,
    request: &ActivationRequest,
) -> Result<(u16, Option<u64>, ActivationEnvelope), ()> {
    let response = client
        .post(url.clone())
        .json(&serde_json::json!({ "code": request.code, "device_id": request.device_id }))
        .send()
        .await
        .map_err(|_| ())?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let body = response
        .json::<ActivationEnvelope>()
        .await
        .unwrap_or(ActivationEnvelope {
            code: None,
            reason: None,
            data: None,
        });
    Ok((status, retry_after, body))
}

#[tauri::command]
async fn activate_customer(request: ActivationRequest) -> ActivationResult {
    if request.code.trim().is_empty()
        || request.code.trim().len() > 64
        || !(16..=256).contains(&request.device_id.trim().len())
        || !valid_account_id(&request.account_id)
        || request.existing_account_ids.len() > 100
        || !request
            .existing_account_ids
            .iter()
            .all(|id| valid_account_id(id))
    {
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
    if status != 200 || envelope.code.is_some_and(|code| code != 0) {
        return ActivationResult::failure(
            status,
            envelope.code,
            envelope
                .reason
                .unwrap_or_else(|| "ACTIVATION_FAILED".to_string()),
            retry_after,
        );
    }
    let credentials = match envelope.data {
        Some(credentials)
            if !credentials.access_token.is_empty() && !credentials.api_key.is_empty() =>
        {
            credentials
        }
        _ => return ActivationResult::failure(status, Some(0), "INVALID_RESPONSE", None),
    };
    let already_added = request.existing_account_ids.iter().any(|account_id| {
        account_id != &request.account_id
            && customer_session(account_id)
                .is_ok_and(|session| same_account(&session, &credentials))
    });
    if already_added {
        return ActivationResult::failure(409, Some(409), "ACCOUNT_ALREADY_ADDED", None);
    }
    let session = CustomerSession {
        base_url: request.base_url,
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        api_key: credentials.api_key,
        expires_in: credentials.expires_in,
        expires_at: credentials.expires_at,
    };
    let expires_at = session.expires_at.clone();
    if save_customer_session(&request.account_id, &session).is_err() {
        return ActivationResult::failure(status, Some(0), "SECURE_STORAGE_FAILED", None);
    }
    ActivationResult {
        success: true,
        status,
        code: Some(0),
        reason: None,
        retry_after: None,
        expires_at,
    }
}

#[tauri::command]
async fn get_customer_api_key(request: AccountRequest) -> ApiKeyResult {
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return ApiKeyResult {
                service: ServiceResult::failure(0, None, reason),
                api_key: None,
            }
        }
    };
    let mut url = match endpoint_url(&session.base_url, "api/v1/keys") {
        Ok(url) => url,
        Err(()) => {
            return ApiKeyResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                api_key: None,
            }
        }
    };
    url.query_pairs_mut()
        .append_pair("page", "1")
        .append_pair("page_size", "100");
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return ApiKeyResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                api_key: None,
            }
        }
    };
    let (status, body) = match send(client.get(url).bearer_auth(&session.access_token)).await {
        Ok(response) => response,
        Err(()) => {
            return ApiKeyResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                api_key: None,
            }
        }
    };
    let (code, reason, data, business_ok) = parse_response::<ApiKeysData>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return ApiKeyResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            api_key: None,
        };
    }
    let mut matches = data
        .map(|data| {
            data.items
                .into_iter()
                .filter(|key| key.name == "客户客户端" && key.status == "active")
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if matches.len() != 1 {
        return ApiKeyResult {
            service: ServiceResult::failure(status, code, "CUSTOMER_API_KEY_NOT_UNIQUE"),
            api_key: None,
        };
    }
    let key = matches.remove(0);
    ApiKeyResult {
        service: ServiceResult::success(status, code),
        api_key: Some(ApiKeySummary {
            id: key.id,
            group: key.group,
        }),
    }
}

#[tauri::command]
async fn get_customer_groups(request: AccountRequest) -> CustomerGroupsResult {
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return CustomerGroupsResult {
                service: ServiceResult::failure(0, None, reason),
                items: None,
            }
        }
    };
    let url = match endpoint_url(&session.base_url, "api/v1/customer/groups") {
        Ok(url) => url,
        Err(()) => {
            return CustomerGroupsResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                items: None,
            }
        }
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return CustomerGroupsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (status, body) = match send(client.get(url).bearer_auth(&session.access_token)).await {
        Ok(response) => response,
        Err(()) => {
            return CustomerGroupsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (code, reason, groups, business_ok) = parse_response::<Vec<CustomerGroup>>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return CustomerGroupsResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            items: None,
        };
    }
    match groups {
        Some(groups) => CustomerGroupsResult {
            service: ServiceResult::success(status, code),
            items: Some(groups),
        },
        None => CustomerGroupsResult {
            service: ServiceResult::failure(status, code, "INVALID_RESPONSE"),
            items: None,
        },
    }
}

#[tauri::command]
async fn switch_customer_api_key_group(
    request: SwitchApiKeyGroupRequest,
) -> SwitchApiKeyGroupResult {
    if request.api_key_id <= 0 || request.group_id <= 0 {
        return SwitchApiKeyGroupResult {
            service: ServiceResult::failure(400, Some(400), "INVALID_REQUEST"),
            api_key_id: None,
            group: None,
        };
    }
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return SwitchApiKeyGroupResult {
                service: ServiceResult::failure(0, None, reason),
                api_key_id: None,
                group: None,
            }
        }
    };
    let path = format!("api/v1/customer/api-keys/{}/group", request.api_key_id);
    let url = match endpoint_url(&session.base_url, &path) {
        Ok(url) => url,
        Err(()) => {
            return SwitchApiKeyGroupResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                api_key_id: None,
                group: None,
            }
        }
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return SwitchApiKeyGroupResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                api_key_id: None,
                group: None,
            }
        }
    };
    let (status, body) = match send(
        client
            .put(url)
            .bearer_auth(&session.access_token)
            .json(&serde_json::json!({ "group_id": request.group_id })),
    )
    .await
    {
        Ok(response) => response,
        Err(()) => {
            return SwitchApiKeyGroupResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                api_key_id: None,
                group: None,
            }
        }
    };
    let (code, reason, data, business_ok) = parse_response::<SwitchApiKeyGroupData>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return SwitchApiKeyGroupResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            api_key_id: None,
            group: None,
        };
    }
    match data {
        Some(data) => SwitchApiKeyGroupResult {
            service: ServiceResult::success(status, code),
            api_key_id: Some(data.api_key_id),
            group: Some(data.group),
        },
        None => SwitchApiKeyGroupResult {
            service: ServiceResult::failure(status, code, "INVALID_RESPONSE"),
            api_key_id: None,
            group: None,
        },
    }
}

#[tauri::command]
async fn get_usage(request: AccountRequest) -> UsageResult {
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return UsageResult {
                service: ServiceResult::failure(0, None, reason),
                usage: None,
            }
        }
    };
    let url = match endpoint_url(&session.base_url, "v1/usage") {
        Ok(url) => url,
        Err(()) => {
            return UsageResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                usage: None,
            }
        }
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return UsageResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                usage: None,
            }
        }
    };
    let (status, body) = match send(
        client
            .get(url)
            .bearer_auth(&session.api_key)
            .header(reqwest::header::ACCEPT, "application/json"),
    )
    .await
    {
        Ok(response) => response,
        Err(()) => {
            return UsageResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                usage: None,
            }
        }
    };
    let (code, reason, data, business_ok) = parse_response::<UsageData>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return UsageResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            usage: None,
        };
    }
    match data.and_then(usage_snapshot) {
        Some(usage) => UsageResult {
            service: ServiceResult::success(status, code),
            usage: Some(usage),
        },
        None => UsageResult {
            service: ServiceResult::failure(status, code, "INVALID_RESPONSE"),
            usage: None,
        },
    }
}

#[tauri::command]
async fn get_usage_details(request: AccountRequest) -> UsageDetailsResult {
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return UsageDetailsResult {
                service: ServiceResult::failure(0, None, reason),
                items: None,
            }
        }
    };
    let url = match endpoint_url(&session.base_url, "api/usage/details") {
        Ok(url) => url,
        Err(()) => {
            return UsageDetailsResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                items: None,
            }
        }
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return UsageDetailsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (status, body) = match send(
        client
            .post(url)
            .bearer_auth(&session.access_token)
            .json(&serde_json::json!({ "before_id": 0 })),
    )
    .await
    {
        Ok(response) => response,
        Err(()) => {
            return UsageDetailsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (code, reason, data, business_ok) = parse_response::<UsageDetailsData>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return UsageDetailsResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            items: None,
        };
    }
    match data {
        Some(data) => UsageDetailsResult {
            service: ServiceResult::success(status, code),
            items: Some(
                data.items
                    .into_iter()
                    .filter_map(|item| {
                        value_id(item.id).map(|id| UsageDetail {
                            id,
                            model: item.model,
                            created_at: item.created_at,
                            input_tokens: item.input_tokens.unwrap_or(0.0),
                            output_tokens: item.output_tokens.unwrap_or(0.0),
                        })
                    })
                    .collect(),
            ),
        },
        None => UsageDetailsResult {
            service: ServiceResult::failure(status, code, "INVALID_RESPONSE"),
            items: None,
        },
    }
}

#[tauri::command]
async fn get_notifications(request: AccountRequest) -> NotificationsResult {
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => {
            return NotificationsResult {
                service: ServiceResult::failure(0, None, reason),
                items: None,
            }
        }
    };
    let url = match endpoint_url(&session.base_url, "api/notifications") {
        Ok(url) => url,
        Err(()) => {
            return NotificationsResult {
                service: ServiceResult::failure(0, None, "CONFIG_ERROR"),
                items: None,
            }
        }
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => {
            return NotificationsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (status, body) = match send(client.get(url).bearer_auth(&session.access_token)).await {
        Ok(response) => response,
        Err(()) => {
            return NotificationsResult {
                service: ServiceResult::failure(0, None, "NETWORK_ERROR"),
                items: None,
            }
        }
    };
    let (code, reason, data, business_ok) = parse_response::<NotificationsData>(&body);
    if !(200..300).contains(&status) || !business_ok {
        return NotificationsResult {
            service: ServiceResult::failure(status, code, failure_reason(reason)),
            items: None,
        };
    }
    match data {
        Some(data) => NotificationsResult {
            service: ServiceResult::success(status, code),
            items: Some(
                data.items
                    .into_iter()
                    .filter_map(|item| {
                        value_id(item.id).map(|id| NotificationItem {
                            id,
                            title: item.title.unwrap_or_else(|| "通知".to_string()),
                            content: item.content.unwrap_or_default(),
                            time: item.created_at,
                            read: item.read.unwrap_or(false),
                        })
                    })
                    .collect(),
            ),
        },
        None => NotificationsResult {
            service: ServiceResult::failure(status, code, "INVALID_RESPONSE"),
            items: None,
        },
    }
}

#[tauri::command]
async fn mark_notifications_read(request: ReadNotificationsRequest) -> ServiceResult {
    if request.notification_ids.is_empty() || request.notification_ids.len() > 100 {
        return ServiceResult::failure(400, Some(400), "INVALID_REQUEST");
    }
    let session = match customer_session(&request.account_id) {
        Ok(session) => session,
        Err(reason) => return ServiceResult::failure(0, None, reason),
    };
    let url = match endpoint_url(&session.base_url, "api/notifications/read") {
        Ok(url) => url,
        Err(()) => return ServiceResult::failure(0, None, "CONFIG_ERROR"),
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(()) => return ServiceResult::failure(0, None, "NETWORK_ERROR"),
    };
    let notification_ids: Vec<Value> = request
        .notification_ids
        .into_iter()
        .map(|id| {
            id.parse::<u64>()
                .map(|id| Value::Number(id.into()))
                .unwrap_or(Value::String(id))
        })
        .collect();
    let (status, body) = match send(
        client
            .post(url)
            .bearer_auth(&session.access_token)
            .json(&serde_json::json!({ "notification_ids": notification_ids })),
    )
    .await
    {
        Ok(response) => response,
        Err(()) => return ServiceResult::failure(0, None, "NETWORK_ERROR"),
    };
    let (code, reason, _, business_ok) = parse_response::<Value>(&body);
    if (200..300).contains(&status) && business_ok {
        ServiceResult::success(status, code)
    } else {
        ServiceResult::failure(status, code, failure_reason(reason))
    }
}

#[tauri::command]
fn apply_codex_config(
    app: tauri::AppHandle,
    request: AccountRequest,
) -> Result<codex_config::CodexConfigStatus, String> {
    let session = customer_session(&request.account_id)?;
    codex_config::apply(
        &app,
        &request.account_id,
        &session.base_url,
        &session.api_key,
    )
}

#[tauri::command]
fn restore_official_codex_config(
    app: tauri::AppHandle,
) -> Result<codex_config::CodexConfigStatus, String> {
    codex_config::restore(&app)
}

#[tauri::command]
fn diagnose_codex_config(
    app: tauri::AppHandle,
    request: OptionalAccountRequest,
) -> Result<codex_config::CodexConfigStatus, String> {
    let account_id = request
        .account_id
        .or(codex_config::configured_account(&app)?);
    let session = account_id.as_deref().map(customer_session).transpose()?;
    codex_config::diagnose(
        &app,
        session.as_ref().map(|value| value.base_url.as_str()),
        session.as_ref().map(|value| value.api_key.as_str()),
    )
}

#[tauri::command]
fn delete_customer_session(app: tauri::AppHandle, request: AccountRequest) -> Result<(), String> {
    if codex_config::configured_account(&app)?.as_deref() == Some(request.account_id.as_str()) {
        codex_config::restore(&app)?;
    }
    let entry = credential_entry(&request.account_id)?;
    if entry.get_password().is_err() {
        return Ok(());
    }
    entry
        .delete_credential()
        .map_err(|_| "无法删除系统安全凭据。".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        activation_url, endpoint_url, parse_response, same_account, usage_snapshot, ActivationCredentials,
        ActivationEnvelope, ApiKeysData, CustomerGroup, CustomerSession, SwitchApiKeyGroupData,
        UsageData, UsageDetailsData,
    };
    use serde_json::Value;

    #[test]
    fn parses_activation_credentials() {
        let response = r#"{"code":0,"data":{"access_token":"access","refresh_token":"refresh","api_key":"key","expires_in":86400,"expires_at":"2026-09-24T10:00:00+08:00"}}"#;
        let envelope: ActivationEnvelope = serde_json::from_str(response).unwrap();
        let session = envelope.data.unwrap();
        assert_eq!(session.access_token, "access");
        assert_eq!(session.api_key, "key");
    }

    #[test]
    fn parses_wallet_usage_response() {
        let response = r#"{"mode":"unrestricted","isValid":true,"planName":"钱包余额","balance":20,"remaining":20,"unit":"USD"}"#;
        let (code, _, data, ok) = parse_response::<UsageData>(response);
        let usage = usage_snapshot(data.unwrap()).unwrap();
        assert_eq!(code, None);
        assert_eq!(usage.remaining, 20.0);
        assert_eq!(usage.used, 0.0);
        assert_eq!(usage.unit, "USD");
        assert!(ok);
    }

    #[test]
    fn parses_api_key_quota_usage_response() {
        let response = r#"{"mode":"quota_limited","isValid":true,"remaining":8.5,"unit":"USD","quota":{"limit":10,"used":1.5,"remaining":8.5,"unit":"USD"}}"#;
        let (_, _, data, ok) = parse_response::<UsageData>(response);
        let usage = usage_snapshot(data.unwrap()).unwrap();
        assert_eq!(usage.quota, 10.0);
        assert_eq!(usage.used, 1.5);
        assert_eq!(usage.remaining, 8.5);
        assert!(ok);
    }

    #[test]
    fn parses_usage_authentication_error() {
        let response = r#"{"error":{"type":"authentication_error","message":"Invalid API key"}}"#;
        let (_, reason, _, _) = parse_response::<UsageData>(response);
        assert_eq!(reason.as_deref(), Some("Invalid API key"));
    }

    #[test]
    fn parses_numeric_usage_detail_id() {
        let response = r#"{"code":0,"data":{"items":[{"id":123,"model":"gpt-5.5","input_tokens":100,"output_tokens":20}]}}"#;
        let (_, _, data, ok) = parse_response::<UsageDetailsData>(response);
        assert_eq!(data.unwrap().items[0].id.as_i64(), Some(123));
        assert!(ok);
    }

    #[test]
    fn preserves_string_error_code() {
        let response = r#"{"code":"INVALID_TOKEN","message":"Invalid token"}"#;
        let (_, reason, _, ok) = parse_response::<Value>(response);
        assert_eq!(reason.as_deref(), Some("INVALID_TOKEN"));
        assert!(!ok);
    }

    #[test]
    fn parses_customer_api_key_with_no_group() {
        let response = r#"{"code":0,"data":{"items":[{"id":12,"name":"客户客户端","status":"active","group":null}]}}"#;
        let (_, _, data, ok) = parse_response::<ApiKeysData>(response);
        let key = &data.unwrap().items[0];
        assert_eq!(key.id, 12);
        assert!(key.group.is_none());
        assert!(ok);
    }

    #[test]
    fn parses_customer_groups_array() {
        let response = r#"{"code":0,"data":[{"id":6,"name":"OpenAI","description":"OpenAI 模型分组","platform":"openai","rate_multiplier":1}]}"#;
        let (_, _, groups, ok) = parse_response::<Vec<CustomerGroup>>(response);
        let group = &groups.unwrap()[0];
        assert_eq!(group.id, 6);
        assert_eq!(group.platform, "openai");
        assert!(ok);
    }

    #[test]
    fn parses_switched_group() {
        let response = r#"{"code":0,"data":{"api_key_id":12,"group":{"id":6,"name":"OpenAI","description":"OpenAI 模型分组","platform":"openai","rate_multiplier":1}}}"#;
        let (_, _, data, ok) = parse_response::<SwitchApiKeyGroupData>(response);
        let data = data.unwrap();
        assert_eq!(data.api_key_id, 12);
        assert_eq!(data.group.id, 6);
        assert!(ok);
    }

    #[test]
    fn builds_api_key_list_query() {
        let mut url = endpoint_url("http://localhost:8080", "api/v1/keys").unwrap();
        url.query_pairs_mut()
            .append_pair("page", "1")
            .append_pair("page_size", "100");
        assert_eq!(
            url.as_str(),
            "http://localhost:8080/api/v1/keys?page=1&page_size=100"
        );
    }

    #[test]
    fn accepts_http_service_urls() {
        assert_eq!(
            activation_url("http://8.136.139.105:8080")
                .unwrap()
                .as_str(),
            "http://8.136.139.105:8080/api/v1/customer/activate"
        );
        assert_eq!(
            endpoint_url("http://8.136.139.105:8080", "v1/usage")
                .unwrap()
                .as_str(),
            "http://8.136.139.105:8080/v1/usage"
        );
    }

    #[test]
    fn detects_an_already_saved_account() {
        let session = CustomerSession {
            base_url: "http://localhost".to_string(),
            access_token: "old-token".to_string(),
            refresh_token: None,
            api_key: "same-key".to_string(),
            expires_in: None,
            expires_at: None,
        };
        let credentials = ActivationCredentials {
            access_token: "new-token".to_string(),
            refresh_token: None,
            api_key: "same-key".to_string(),
            expires_in: None,
            expires_at: None,
        };
        assert!(same_account(&session, &credentials));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            activate_customer,
            get_customer_api_key,
            get_customer_groups,
            switch_customer_api_key_group,
            get_usage,
            get_usage_details,
            get_notifications,
            mark_notifications_read,
            apply_codex_config,
            restore_official_codex_config,
            diagnose_codex_config,
            delete_customer_session
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Sub2API Customer");
}
