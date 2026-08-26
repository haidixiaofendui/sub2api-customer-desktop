use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use toml_edit::{value, DocumentMut, Item, Table};

const PROVIDER_ID: &str = "sub2api";
const DEFAULT_MODEL: &str = "gpt-5.5";
const BACKUP_VERSION: u8 = 1;

static CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigStatus {
    pub healthy: bool,
    pub configured: bool,
    pub current_account_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub relay_url: Option<String>,
    pub backup_available: bool,
    pub repaired_sessions: usize,
    pub restart_required: bool,
    pub issues: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u8,
    codex_home: String,
    auth_existed: bool,
    config_existed: bool,
    auth_sha256: Option<String>,
    config_sha256: Option<String>,
    official_provider: Option<String>,
    thread_providers: Vec<ThreadProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThreadProvider {
    id: String,
    provider: Option<String>,
}

#[derive(Debug)]
struct CodexPaths {
    home: PathBuf,
    auth: PathBuf,
    config: PathBuf,
    state_db: PathBuf,
    backup_dir: PathBuf,
    manifest: PathBuf,
    active_state: PathBuf,
}

#[derive(Debug)]
struct FileState {
    existed: bool,
    bytes: Vec<u8>,
}

pub fn relay_url(service_url: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(service_url.trim())
        .map_err(|_| "CODEX_RELAY_URL_INVALID: 服务地址无法派生模型地址。".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("CODEX_RELAY_URL_INVALID: 模型地址必须使用 HTTP 或 HTTPS。".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    let relay_path = if path.ends_with("/v1") || path == "/v1" {
        path
    } else if path.is_empty() {
        "/v1".to_string()
    } else {
        format!("{path}/v1")
    };
    url.set_path(&relay_path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

pub fn apply(
    app: &AppHandle,
    account_id: &str,
    service_url: &str,
    api_key: &str,
) -> Result<CodexConfigStatus, String> {
    let _guard = config_lock()?;
    if api_key.trim().is_empty() {
        return Err("CODEX_CREDENTIAL_MISSING: 账号 API Key 为空。".into());
    }
    let relay = relay_url(service_url)?;
    let paths = paths(app)?;
    preflight(&paths)?;
    ensure_baseline(&paths)?;

    let old_auth = capture_file(&paths.auth)?;
    let old_config = capture_file(&paths.config)?;
    let old_threads = read_thread_providers(&paths.state_db)?;
    let new_auth = build_auth(&old_auth.bytes, old_auth.existed, api_key)?;
    let new_config = build_config(&old_config.bytes, old_config.existed, &relay)?;

    let result = (|| {
        atomic_write(&paths.auth, &new_auth)?;
        atomic_write(&paths.config, &new_config)?;
        let repaired = set_all_thread_providers(&paths.state_db, PROVIDER_ID)?;
        let mut status = diagnose_paths(&paths, Some(api_key), Some(&relay))?;
        status.repaired_sessions = repaired;
        if !status.healthy {
            return Err(format!(
                "CODEX_CONFIG_INVALID: {}",
                status.issues.join("；")
            ));
        }
        atomic_write(&paths.active_state, account_id.as_bytes())?;
        status.current_account_id = Some(account_id.to_string());
        status.restart_required = true;
        Ok(status)
    })();

    if let Err(error) = result {
        let rollback = restore_file(&paths.auth, &old_auth)
            .and_then(|_| restore_file(&paths.config, &old_config))
            .and_then(|_| restore_thread_providers(&paths.state_db, &old_threads, None));
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "CODEX_ROLLBACK_FAILED: {error}；回滚失败：{rollback_error}"
            )),
        };
    }
    result
}

pub fn restore(app: &AppHandle) -> Result<CodexConfigStatus, String> {
    let _guard = config_lock()?;
    let paths = paths(app)?;
    let manifest = load_valid_manifest(&paths)?
        .ok_or_else(|| "CODEX_BACKUP_NOT_FOUND: 没有可用的官方配置基线。".to_string())?;
    let old_auth = capture_file(&paths.auth)?;
    let old_config = capture_file(&paths.config)?;
    let old_threads = read_thread_providers(&paths.state_db)?;

    let result = (|| {
        restore_baseline_file(
            &paths.auth,
            &paths.backup_dir.join("auth.json"),
            manifest.auth_existed,
        )?;
        restore_baseline_file(
            &paths.config,
            &paths.backup_dir.join("config.toml"),
            manifest.config_existed,
        )?;
        let official = manifest.official_provider.as_deref().unwrap_or("OpenAI");
        restore_thread_providers(&paths.state_db, &manifest.thread_providers, Some(official))?;
        let status = diagnose_official(&paths, &manifest)?;
        if !status.healthy {
            return Err(format!(
                "CODEX_CONFIG_INVALID: {}",
                status.issues.join("；")
            ));
        }
        remove_if_exists(&paths.active_state)?;
        Ok(CodexConfigStatus {
            restart_required: true,
            ..status
        })
    })();

    if let Err(error) = result {
        let rollback = restore_file(&paths.auth, &old_auth)
            .and_then(|_| restore_file(&paths.config, &old_config))
            .and_then(|_| restore_thread_providers(&paths.state_db, &old_threads, None));
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "CODEX_ROLLBACK_FAILED: {error}；回滚失败：{rollback_error}"
            )),
        };
    }
    result
}

pub fn diagnose(
    app: &AppHandle,
    service_url: Option<&str>,
    api_key: Option<&str>,
) -> Result<CodexConfigStatus, String> {
    let _guard = config_lock()?;
    let paths = paths(app)?;
    let relay = service_url.map(relay_url).transpose()?;
    diagnose_paths(&paths, api_key, relay.as_deref())
}

pub fn configured_account(app: &AppHandle) -> Result<Option<String>, String> {
    let paths = paths(app)?;
    if !paths.active_state.exists() {
        return Ok(None);
    }
    let value = fs::read_to_string(paths.active_state)
        .map_err(|_| "CODEX_STATE_READ_FAILED: 无法读取 Codex 配置状态。".to_string())?;
    let value = value.trim();
    Ok((!value.is_empty()).then(|| value.to_string()))
}

fn config_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CONFIG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "CODEX_OPERATION_LOCKED: Codex 配置操作锁不可用。".to_string())
}

fn paths(app: &AppHandle) -> Result<CodexPaths, String> {
    let home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|path| path.join(".codex"))
        })
        .or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(".codex"))
        })
        .ok_or_else(|| "CODEX_HOME_UNAVAILABLE: 无法确定 Codex 配置目录。".to_string())?;
    if home.as_os_str().is_empty() || home.is_relative() {
        return Err("CODEX_HOME_UNAVAILABLE: Codex 配置目录必须是绝对路径。".into());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "CODEX_HOME_UNAVAILABLE: 无法确定应用数据目录。".to_string())?;
    let backup_dir = app_data.join("codex-official-backup");
    Ok(CodexPaths {
        auth: home.join("auth.json"),
        config: home.join("config.toml"),
        state_db: home.join("state_5.sqlite"),
        home,
        manifest: backup_dir.join("manifest.json"),
        active_state: app_data.join("codex-active-account"),
        backup_dir,
    })
}

fn preflight(paths: &CodexPaths) -> Result<(), String> {
    fs::create_dir_all(&paths.home)
        .map_err(|_| "CODEX_PERMISSION_DENIED: 无法创建 Codex 配置目录。".to_string())?;
    let probe = paths.home.join(format!(
        ".sub2api-write-probe-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::write(&probe, b"probe")
        .and_then(|_| fs::remove_file(&probe))
        .map_err(|_| "CODEX_PERMISSION_DENIED: Codex 配置目录不可写。".to_string())?;
    if paths.auth.exists() {
        let bytes = fs::read(&paths.auth)
            .map_err(|_| "CODEX_AUTH_INVALID: 无法读取 auth.json。".to_string())?;
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| "CODEX_AUTH_INVALID: auth.json 不是有效 JSON。".to_string())?;
    }
    if paths.config.exists() {
        let text = fs::read_to_string(&paths.config)
            .map_err(|_| "CODEX_CONFIG_INVALID: 无法读取 config.toml。".to_string())?;
        text.parse::<DocumentMut>()
            .map_err(|_| "CODEX_CONFIG_INVALID: config.toml 不是有效 TOML。".to_string())?;
    }
    read_thread_providers(&paths.state_db)?;
    if paths.manifest.exists() {
        load_valid_manifest(paths)?;
    }
    Ok(())
}

fn ensure_baseline(paths: &CodexPaths) -> Result<(), String> {
    if load_valid_manifest(paths)?.is_some() {
        return Ok(());
    }
    fs::create_dir_all(&paths.backup_dir)
        .map_err(|_| "CODEX_BACKUP_INVALID: 无法创建官方配置备份目录。".to_string())?;
    let auth = capture_file(&paths.auth)?;
    let config = capture_file(&paths.config)?;
    if auth.existed {
        atomic_write(&paths.backup_dir.join("auth.json"), &auth.bytes)?;
    }
    if config.existed {
        atomic_write(&paths.backup_dir.join("config.toml"), &config.bytes)?;
    }
    let manifest = BackupManifest {
        version: BACKUP_VERSION,
        codex_home: paths.home.to_string_lossy().into_owned(),
        auth_existed: auth.existed,
        config_existed: config.existed,
        auth_sha256: auth.existed.then(|| sha256(&auth.bytes)),
        config_sha256: config.existed.then(|| sha256(&config.bytes)),
        official_provider: selected_provider(&config.bytes, config.existed)?,
        thread_providers: read_thread_providers(&paths.state_db)?,
    };
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| "CODEX_BACKUP_INVALID: 无法生成官方配置备份清单。".to_string())?;
    atomic_write(&paths.manifest, &bytes)?;
    load_valid_manifest(paths)?
        .ok_or_else(|| "CODEX_BACKUP_INVALID: 官方配置备份创建后校验失败。".to_string())?;
    Ok(())
}

fn load_valid_manifest(paths: &CodexPaths) -> Result<Option<BackupManifest>, String> {
    if !paths.manifest.exists() {
        return Ok(None);
    }
    let manifest: BackupManifest = serde_json::from_slice(
        &fs::read(&paths.manifest)
            .map_err(|_| "CODEX_BACKUP_INVALID: 无法读取官方配置备份清单。".to_string())?,
    )
    .map_err(|_| "CODEX_BACKUP_INVALID: 官方配置备份清单已损坏。".to_string())?;
    if manifest.version != BACKUP_VERSION || PathBuf::from(&manifest.codex_home) != paths.home {
        return Err("CODEX_BACKUP_INVALID: 官方配置备份与当前 Codex 目录不匹配。".into());
    }
    verify_backup_file(
        &paths.backup_dir.join("auth.json"),
        manifest.auth_existed,
        manifest.auth_sha256.as_deref(),
    )?;
    verify_backup_file(
        &paths.backup_dir.join("config.toml"),
        manifest.config_existed,
        manifest.config_sha256.as_deref(),
    )?;
    Ok(Some(manifest))
}

fn verify_backup_file(path: &Path, existed: bool, hash: Option<&str>) -> Result<(), String> {
    if !existed {
        return Ok(());
    }
    let bytes =
        fs::read(path).map_err(|_| "CODEX_BACKUP_INVALID: 官方配置备份文件缺失。".to_string())?;
    if hash != Some(sha256(&bytes).as_str()) {
        return Err("CODEX_BACKUP_INVALID: 官方配置备份摘要不匹配。".into());
    }
    Ok(())
}

fn build_auth(source: &[u8], existed: bool, api_key: &str) -> Result<Vec<u8>, String> {
    let mut object = if existed {
        serde_json::from_slice::<Value>(source)
            .map_err(|_| "CODEX_AUTH_INVALID: auth.json 不是有效 JSON。".to_string())?
            .as_object()
            .cloned()
            .ok_or_else(|| "CODEX_AUTH_INVALID: auth.json 顶层必须是对象。".to_string())?
    } else {
        Map::new()
    };
    object.insert("OPENAI_API_KEY".into(), Value::String(api_key.into()));
    for key in [
        "OPENAI_BASE_URL",
        "experimental_bearer_token",
        "tokens",
        "access_token",
        "refresh_token",
    ] {
        object.remove(key);
    }
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(object))
        .map_err(|_| "CODEX_AUTH_INVALID: 无法生成 auth.json。".to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn build_config(source: &[u8], existed: bool, relay: &str) -> Result<Vec<u8>, String> {
    let text = if existed {
        std::str::from_utf8(source)
            .map_err(|_| "CODEX_CONFIG_INVALID: config.toml 不是 UTF-8。".to_string())?
    } else {
        ""
    };
    let mut document = text
        .parse::<DocumentMut>()
        .map_err(|_| "CODEX_CONFIG_INVALID: config.toml 不是有效 TOML。".to_string())?;
    document["model_provider"] = value(PROVIDER_ID);
    document["model"] = value(DEFAULT_MODEL);
    if document
        .get("model_providers")
        .and_then(Item::as_table)
        .is_none()
    {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or_else(|| "CODEX_CONFIG_INVALID: model_providers 必须是 TOML 表。".to_string())?;
    let mut provider = Table::new();
    provider["name"] = value(PROVIDER_ID);
    provider["base_url"] = value(relay);
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);
    providers[PROVIDER_ID] = Item::Table(provider);
    let output = document.to_string();
    output
        .parse::<DocumentMut>()
        .map_err(|_| "CODEX_CONFIG_INVALID: 生成的 config.toml 无法校验。".to_string())?;
    Ok(output.into_bytes())
}

fn diagnose_paths(
    paths: &CodexPaths,
    api_key: Option<&str>,
    relay: Option<&str>,
) -> Result<CodexConfigStatus, String> {
    let mut issues = Vec::new();
    let mut warnings = Vec::new();
    let auth = fs::read(&paths.auth)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let config = fs::read_to_string(&paths.config)
        .ok()
        .and_then(|text| text.parse::<DocumentMut>().ok());
    let provider = config
        .as_ref()
        .and_then(|doc| doc.get("model_provider"))
        .and_then(Item::as_str)
        .map(str::to_string);
    let model = config
        .as_ref()
        .and_then(|doc| doc.get("model"))
        .and_then(Item::as_str)
        .map(str::to_string);
    let configured = provider.as_deref() == Some(PROVIDER_ID);
    let actual_relay = config
        .as_ref()
        .and_then(|doc| provider_field(doc, "base_url"))
        .map(str::to_string);
    if let Some(expected_key) = api_key {
        let key_matches = auth
            .as_ref()
            .and_then(|value| value.get("OPENAI_API_KEY"))
            .and_then(Value::as_str)
            == Some(expected_key);
        if !key_matches {
            issues.push("Codex API Key 与当前账号不一致。".into());
        }
    }
    if configured {
        if model.as_deref() != Some(DEFAULT_MODEL) {
            issues.push("Codex 默认模型不正确。".into());
        }
        if relay.is_some() && actual_relay.as_deref() != relay {
            issues.push("Codex 模型转发地址不正确。".into());
        }
        if config
            .as_ref()
            .and_then(|doc| provider_field(doc, "wire_api"))
            != Some("responses")
        {
            issues.push("Codex Provider wire_api 不正确。".into());
        }
        let requires_auth = config
            .as_ref()
            .and_then(|doc| provider_item(doc, "requires_openai_auth"))
            .and_then(Item::as_bool);
        if requires_auth != Some(true) {
            issues.push("Codex Provider 认证设置不正确。".into());
        }
    }
    if auth.as_ref().is_some_and(|value| {
        [
            "tokens",
            "access_token",
            "refresh_token",
            "experimental_bearer_token",
        ]
        .iter()
        .any(|key| value.get(key).is_some())
    }) && configured
    {
        warnings.push("API Key 模式仍包含 OAuth 材料。".into());
    }
    let active = configured_account_from_paths(paths)?;
    let backup_available = load_valid_manifest(paths)?.is_some();
    Ok(CodexConfigStatus {
        healthy: issues.is_empty() && (!configured || config.is_some() && auth.is_some()),
        configured,
        current_account_id: active,
        provider,
        model,
        relay_url: actual_relay,
        backup_available,
        repaired_sessions: 0,
        restart_required: false,
        issues,
        warnings,
    })
}

fn diagnose_official(
    paths: &CodexPaths,
    manifest: &BackupManifest,
) -> Result<CodexConfigStatus, String> {
    let mut issues = Vec::new();
    verify_restored_file(
        &paths.auth,
        manifest.auth_existed,
        manifest.auth_sha256.as_deref(),
        &mut issues,
    );
    verify_restored_file(
        &paths.config,
        manifest.config_existed,
        manifest.config_sha256.as_deref(),
        &mut issues,
    );
    Ok(CodexConfigStatus {
        healthy: issues.is_empty(),
        configured: false,
        current_account_id: None,
        provider: manifest.official_provider.clone(),
        model: None,
        relay_url: None,
        backup_available: true,
        repaired_sessions: manifest.thread_providers.len(),
        restart_required: false,
        issues,
        warnings: Vec::new(),
    })
}

fn provider_item<'a>(document: &'a DocumentMut, key: &str) -> Option<&'a Item> {
    document
        .get("model_providers")?
        .as_table()?
        .get(PROVIDER_ID)?
        .as_table()?
        .get(key)
}

fn provider_field<'a>(document: &'a DocumentMut, key: &str) -> Option<&'a str> {
    provider_item(document, key)?.as_str()
}

fn selected_provider(bytes: &[u8], existed: bool) -> Result<Option<String>, String> {
    if !existed {
        return Ok(None);
    }
    let document = std::str::from_utf8(bytes)
        .map_err(|_| "CODEX_CONFIG_INVALID: config.toml 不是 UTF-8。".to_string())?
        .parse::<DocumentMut>()
        .map_err(|_| "CODEX_CONFIG_INVALID: config.toml 不是有效 TOML。".to_string())?;
    Ok(document
        .get("model_provider")
        .and_then(Item::as_str)
        .map(str::to_string))
}

fn read_thread_providers(path: &Path) -> Result<Vec<ThreadProvider>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let connection = Connection::open(path)
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法打开 state_5.sqlite。".to_string())?;
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='threads')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法检查 threads 表。".to_string())?;
    if !exists {
        return Err("CODEX_STATE_DB_INVALID: state_5.sqlite 缺少 threads 表。".into());
    }
    let has_column = connection
        .prepare("PRAGMA table_info(threads)")
        .and_then(|mut statement| {
            let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
            for column in columns {
                if column? == "model_provider" {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法检查 model_provider 列。".to_string())?;
    if !has_column {
        return Err("CODEX_STATE_DB_INVALID: threads 表缺少 model_provider 列。".into());
    }
    let mut statement = connection
        .prepare("SELECT id, model_provider FROM threads")
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法读取历史任务。".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ThreadProvider {
                id: row.get(0)?,
                provider: row.get(1)?,
            })
        })
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法读取历史任务。".to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "CODEX_STATE_DB_INVALID: 历史任务数据无法解析。".to_string())
}

fn set_all_thread_providers(path: &Path, provider: &str) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut connection = Connection::open(path)
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法打开 state_5.sqlite。".to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "CODEX_STATE_DB_BUSY: Codex 历史任务数据库正在使用。".to_string())?;
    let changed = transaction
        .execute(
            "UPDATE threads SET model_provider=?1 WHERE COALESCE(model_provider, '') <> ?1",
            [provider],
        )
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法更新历史任务 Provider。".to_string())?;
    transaction
        .commit()
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法提交历史任务更新。".to_string())?;
    Ok(changed)
}

fn restore_thread_providers(
    path: &Path,
    snapshot: &[ThreadProvider],
    fallback: Option<&str>,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let current = read_thread_providers(path)?;
    let baseline: HashMap<&str, &Option<String>> = snapshot
        .iter()
        .map(|item| (item.id.as_str(), &item.provider))
        .collect();
    let mut connection = Connection::open(path)
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法打开 state_5.sqlite。".to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "CODEX_STATE_DB_BUSY: Codex 历史任务数据库正在使用。".to_string())?;
    for item in current {
        let provider = baseline
            .get(item.id.as_str())
            .map(|value| (*value).clone())
            .unwrap_or_else(|| fallback.map(str::to_string).or(item.provider));
        transaction
            .execute(
                "UPDATE threads SET model_provider=?1 WHERE id=?2",
                params![provider, item.id],
            )
            .map_err(|_| "CODEX_STATE_DB_INVALID: 无法恢复历史任务 Provider。".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "CODEX_STATE_DB_INVALID: 无法提交历史任务恢复。".to_string())
}

fn capture_file(path: &Path) -> Result<FileState, String> {
    if !path.exists() {
        return Ok(FileState {
            existed: false,
            bytes: Vec::new(),
        });
    }
    Ok(FileState {
        existed: true,
        bytes: fs::read(path)
            .map_err(|_| "CODEX_PERMISSION_DENIED: 无法读取 Codex 配置文件。".to_string())?,
    })
}

fn restore_file(path: &Path, state: &FileState) -> Result<(), String> {
    if state.existed {
        atomic_write(path, &state.bytes)
    } else {
        remove_if_exists(path)
    }
}

fn restore_baseline_file(path: &Path, backup: &Path, existed: bool) -> Result<(), String> {
    if existed {
        let bytes = fs::read(backup)
            .map_err(|_| "CODEX_BACKUP_INVALID: 官方配置备份文件缺失。".to_string())?;
        atomic_write(path, &bytes)
    } else {
        remove_if_exists(path)
    }
}

fn verify_restored_file(
    path: &Path,
    existed: bool,
    expected_hash: Option<&str>,
    issues: &mut Vec<String>,
) {
    if existed {
        match fs::read(path) {
            Ok(bytes) if expected_hash == Some(sha256(&bytes).as_str()) => {}
            _ => issues.push(format!(
                "{} 未恢复到官方基线。",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    } else if path.exists() {
        issues.push(format!(
            "{} 在官方基线中原本不存在。",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
}

fn configured_account_from_paths(paths: &CodexPaths) -> Result<Option<String>, String> {
    if !paths.active_state.exists() {
        return Ok(None);
    }
    let value = fs::read_to_string(&paths.active_state)
        .map_err(|_| "CODEX_STATE_READ_FAILED: 无法读取 Codex 配置状态。".to_string())?;
    Ok((!value.trim().is_empty()).then(|| value.trim().to_string()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "CODEX_WRITE_FAILED: 目标文件没有父目录。".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "CODEX_PERMISSION_DENIED: 无法创建目标目录。".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temporary = parent.join(format!(".{name}.{nonce}.tmp"));
    let previous = parent.join(format!(".{name}.{nonce}.previous"));
    let write_result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|_| "CODEX_WRITE_FAILED: 无法创建临时配置文件。".to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "CODEX_WRITE_FAILED: 无法写入临时配置文件。".to_string())?;
        if fs::read(&temporary).ok().as_deref() != Some(bytes) {
            return Err("CODEX_WRITE_FAILED: 临时配置文件写后校验失败。".into());
        }
        if path.exists() {
            fs::rename(path, &previous)
                .map_err(|_| "CODEX_WRITE_FAILED: 无法准备替换现有配置。".to_string())?;
        }
        if let Err(error) = fs::rename(&temporary, path) {
            if previous.exists() {
                let _ = fs::rename(&previous, path);
            }
            return Err(format!("CODEX_WRITE_FAILED: 无法替换配置文件：{error}"));
        }
        remove_if_exists(&previous)?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    write_result
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("CODEX_PERMISSION_DENIED: 无法移除配置文件。".into()),
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::{
        build_auth, build_config, ensure_baseline, load_valid_manifest, read_thread_providers,
        relay_url, restore_baseline_file, restore_thread_providers, set_all_thread_providers,
        CodexPaths,
    };
    use rusqlite::Connection;
    use std::fs;

    fn test_paths(root: &std::path::Path) -> CodexPaths {
        let home = root.join(".codex");
        let backup_dir = root.join("app").join("codex-official-backup");
        fs::create_dir_all(&home).unwrap();
        CodexPaths {
            auth: home.join("auth.json"),
            config: home.join("config.toml"),
            state_db: home.join("state_5.sqlite"),
            home,
            manifest: backup_dir.join("manifest.json"),
            active_state: root.join("app").join("codex-active-account"),
            backup_dir,
        }
    }

    #[test]
    fn derives_relay_url_once() {
        assert_eq!(
            relay_url("https://example.com").unwrap(),
            "https://example.com/v1"
        );
        assert_eq!(
            relay_url("https://example.com/v1/").unwrap(),
            "https://example.com/v1"
        );
    }

    #[test]
    fn auth_preserves_unknown_fields_and_removes_oauth() {
        let result = build_auth(
            br#"{"custom":true,"tokens":{"access":"old"}}"#,
            true,
            "secret",
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(value["custom"], true);
        assert_eq!(value["OPENAI_API_KEY"], "secret");
        assert!(value.get("tokens").is_none());
    }

    #[test]
    fn config_preserves_unrelated_settings() {
        let result = build_config(
            b"approval_policy = \"never\"\n",
            true,
            "https://example.com/v1",
        )
        .unwrap();
        let result = String::from_utf8(result).unwrap();
        assert!(result.contains("approval_policy = \"never\""));
        assert!(result.contains("model_provider = \"sub2api\""));
        assert!(result.contains("base_url = \"https://example.com/v1\""));
    }

    #[test]
    fn baseline_is_not_overwritten_and_restores_exact_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(temp.path());
        let official_auth = b"{\"tokens\":{\"access\":\"official\"}}\n";
        let official_config = b"model_provider = \"OpenAI\"\n";
        fs::write(&paths.auth, official_auth).unwrap();
        fs::write(&paths.config, official_config).unwrap();
        ensure_baseline(&paths).unwrap();

        fs::write(&paths.auth, b"{\"OPENAI_API_KEY\":\"third-party\"}\n").unwrap();
        fs::write(&paths.config, b"model_provider = \"sub2api\"\n").unwrap();
        ensure_baseline(&paths).unwrap();

        let manifest = load_valid_manifest(&paths).unwrap().unwrap();
        restore_baseline_file(
            &paths.auth,
            &paths.backup_dir.join("auth.json"),
            manifest.auth_existed,
        )
        .unwrap();
        restore_baseline_file(
            &paths.config,
            &paths.backup_dir.join("config.toml"),
            manifest.config_existed,
        )
        .unwrap();
        assert_eq!(fs::read(&paths.auth).unwrap(), official_auth);
        assert_eq!(fs::read(&paths.config).unwrap(), official_config);
    }

    #[test]
    fn thread_snapshot_restores_old_threads_and_falls_back_for_new_threads() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(temp.path());
        let connection = Connection::open(&paths.state_db).unwrap();
        connection
            .execute(
                "CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT)",
                [],
            )
            .unwrap();
        connection
            .execute("INSERT INTO threads VALUES('old', 'OpenAI')", [])
            .unwrap();
        drop(connection);
        let snapshot = read_thread_providers(&paths.state_db).unwrap();
        assert_eq!(
            set_all_thread_providers(&paths.state_db, "sub2api").unwrap(),
            1
        );
        let connection = Connection::open(&paths.state_db).unwrap();
        connection
            .execute("INSERT INTO threads VALUES('new', 'sub2api')", [])
            .unwrap();
        drop(connection);

        restore_thread_providers(&paths.state_db, &snapshot, Some("OpenAI")).unwrap();
        let providers = read_thread_providers(&paths.state_db).unwrap();
        assert!(providers
            .iter()
            .all(|item| item.provider.as_deref() == Some("OpenAI")));
    }
}
