# 客户端待补接口说明与 Codex 分析提示词

## 当前情况

客户端为 Windows Tauri 桌面应用，开发联调服务地址为：

```text
http://8.136.139.105:8080
```

生产环境未来会切换为 HTTPS 域名；当前 IP 地址仅用于开发联调。

目前已确认服务端存在并可调用的接口：

```http
POST /api/v1/customer/activate
Content-Type: application/json

{
  "code": "兑换码",
  "device_id": "稳定的设备 UUID"
}
```

对空请求，该接口返回 HTTP 400 及参数校验错误，证明路由已部署。

当前服务端尚未部署以下路径，访问时返回 HTTP 404：

```text
/api/verify
/api/usage
/api/usage/details
/api/notifications
```

客户端已经恢复为使用 `/api/v1/customer/activate` 完成激活。账号切换、删除、本地安全凭据保存均在客户端本地完成，不需要额外的服务端接口。

## 目标

补齐下列接口，使客户端现有的额度、用量明细和通知页面可以进行真实联调。

请优先复用 `/api/v1/customer/activate` 中已有的兑换码与设备绑定逻辑；不要引入不必要的新认证体系。

## 安全与通用约束

- 所有请求和响应均为 JSON，响应 `Content-Type` 为 `application/json; charset=utf-8`。
- `code`（兑换码）、`access_token`、`refresh_token`、`api_key` 均为敏感数据：服务端不得写入日志或错误响应；客户端只保存至 Windows Credential Manager，不写入普通配置、数据库、日志或剪贴板。
- 客户端保存稳定的 `device_id`，并将其用于激活后续接口的设备校验。
- 正式环境仅使用 HTTPS；开发环境可暂时使用 HTTP。
- 业务失败应返回稳定、可程序识别的 `reason` 或 `message`，不要把内部堆栈、SQL、令牌或上游响应原样返回。
- 建议统一响应包装：`code` 为业务码，HTTP 状态码表达传输/鉴权/限流等语义。

建议的成功包装：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

建议的失败包装：

```json
{
  "code": 400,
  "message": "bad request",
  "reason": "INVALID_REQUEST",
  "data": null
}
```

## 1. 激活接口（已存在，建议扩充响应字段）

### `POST /api/v1/customer/activate`

请求：

```json
{
  "code": "REDEMPTION_CODE",
  "device_id": "UUID"
}
```

现有客户端要求成功响应至少包含：

```json
{
  "code": 0,
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "api_key": "...",
    "expires_in": 86400,
    "expires_at": "2026-09-24T10:00:00+08:00"
  }
}
```

为让客户端账号配置展示真实数据，建议在同一个 `data` 内增加以下非敏感字段，无需新增“账号资料”接口：

```json
{
  "account_name": "客户账号",
  "tier": "Pro",
  "base_url": "https://relay.example.com/v1",
  "default_model": "gpt-5.5"
}
```

建议错误语义：

| HTTP 状态 | `reason` | 含义 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 缺少或格式错误的兑换码、设备 ID |
| 403 | `DEVICE_MISMATCH` | 兑换码已绑定其他设备 |
| 404 | `REDEEM_CODE_NOT_FOUND` | 兑换码不存在 |
| 409 | `REDEEM_CODE_USED` / `REDEEM_CODE_EXPIRED` / `REDEEM_CODE_LOCKED` | 已使用、过期或处理中 |
| 429 | `RATE_LIMITED` | 限流；建议附带 `Retry-After` 响应头 |

## 2. 查询额度（待实现）

### `POST /api/usage`

用途：为“剩余额度”卡片和刷新按钮提供真实数据。

请求：

```json
{
  "code": "REDEMPTION_CODE",
  "device_id": "UUID"
}
```

如果服务端更适合 Bearer 鉴权，也可以改用：

```http
Authorization: Bearer ACCESS_TOKEN
```

但需与激活接口返回的凭据保持一致，并明确一种优先方案。当前建议优先使用 `code + device_id`，以复用现有绑定模型。

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "quota": 1000,
    "quota_used": 250,
    "rate_limit_5h": 100,
    "usage_5h": 10,
    "rate_limit_1d": 500,
    "usage_1d": 120,
    "rate_limit_7d": 2000,
    "usage_7d": 700,
    "reset_5h": "2026-08-26T00:00:00Z",
    "reset_1d": "2026-08-26T00:00:00Z",
    "reset_7d": "2026-08-31T00:00:00Z",
    "refresh_count": 3,
    "refresh_count_synced": true
  }
}
```

客户端当前至少使用 `quota`、`quota_used` 和 `refresh_count`；其他字段建议一并返回，为后续扩展保留。

> 不需要单独提供 `/api/usage/reset`：客户端的“刷新用量”按钮可以直接调用本接口。只有服务端确实需要异步触发上游同步时，才新增该接口。

## 3. 查询用量明细（待实现）

### `POST /api/usage/details`

用途：展示“用量明细”折叠区域，支持游标分页。

请求：

```json
{
  "code": "REDEMPTION_CODE",
  "device_id": "UUID",
  "before_id": 0
}
```

- 第一次请求传 `before_id: 0`。
- 后续请求传当前页最后一条记录的 `id`。

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "has_more": false,
    "items": [
      {
        "id": 123,
        "request_id": "req_xxx",
        "model": "gpt-5.5",
        "upstream_model": "gpt-5.5",
        "inbound_endpoint": "/v1/responses",
        "upstream_endpoint": "/v1/responses",
        "input_tokens": 100,
        "output_tokens": 200,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
        "total_cost": 0.01,
        "duration_ms": 3000,
        "first_token_ms": 500,
        "created_at": "2026-08-23T00:00:00Z"
      }
    ]
  }
}
```

客户端当前最少使用：`id`、`model`、`input_tokens`、`output_tokens`、`created_at`。`id` 可为数字或字符串，但应在整个接口中保持一致。

## 4. 通知列表（待实现）

### `GET /api/notifications?before_id={id}`

用途：展示顶部通知面板与未读数量。

认证建议：通知内容若对所有客户相同，可公开访问；若包含客户专属内容，则使用 `code + device_id` 或 Bearer Token 鉴权。请不要将专属通知公开返回。

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "has_more": false,
    "unread_count": 1,
    "items": [
      {
        "id": 1,
        "title": "系统通知",
        "content": "通知正文",
        "created_at": "2026-08-25T12:00:00Z",
        "read": false
      }
    ]
  }
}
```

当前客户端最少使用：`id`、`title`、`content`、`created_at`、`read`。

## 5. 标记通知已读（待实现）

### `POST /api/notifications/read`

请求（推荐复用现有兑换码与设备认证）：

```json
{
  "code": "REDEMPTION_CODE",
  "device_id": "UUID",
  "notification_ids": [1, 2, 3]
}
```

或者使用 Bearer Token：

```http
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "notification_ids": [1, 2, 3]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "updated_count": 3
  }
}
```

## 不需要服务端接口的功能

- 账号切换：客户端本地切换已激活的账号。
- 删除账号：客户端删除本地记录以及 Windows Credential Manager 中的对应凭据。
- 显示“API 密钥已安全保存”：客户端不会读取、展示或复制 API Key。
- 本地 UI 状态、折叠面板、弹窗与动画。

## 可选接口：网络信息

当前“网络信息”页面是占位内容。若需要真实显示，可新增：

```http
GET /api/network/trace
```

建议响应：

```json
{
  "code": 0,
  "data": {
    "ip": "203.0.113.1",
    "location": "CN",
    "tls": "TLSv1.3"
  }
}
```

不要依赖 `/cdn-cgi/trace`：当前服务并未部署该路径，且它会绑定 Cloudflare 实现细节。

---

## 可直接交给 Codex 的提示词

```text
请阅读并分析附件《SERVER_API_REQUIREMENTS.md》。这是一个 Windows Tauri 客户端与现有 Go/HTTP 服务端的联调需求。

目标：基于当前已存在的 POST /api/v1/customer/activate，设计并实现最小、可维护且安全的服务端接口，使客户端的额度、用量明细、通知和通知已读页面可以真实联调。

请按以下顺序输出：
1. 先核对仓库现有路由、认证模型、数据表和兑换码/设备绑定逻辑；不要假设文档中的旧 `/api/verify` 已存在。
2. 给出“现有能力 / 缺失能力 / 最小改动方案”的结论，并指出与本说明冲突的实际代码。
3. 复用已有认证、DTO、数据库和错误处理模式；除非代码库没有合适能力，否则不要新增依赖、平行认证体系或重复表。
4. 实现 POST /api/usage、POST /api/usage/details、GET /api/notifications、POST /api/notifications/read。若确有必要再实现 /api/usage/reset，并说明其必要性。
5. 为每个接口补最小有效测试，覆盖：成功、缺参、无效/未绑定设备、分页边界及通知已读权限。
6. 不记录、不回显 card code、access token、refresh token 或 API key；生产环境强制 HTTPS；错误响应不得泄露内部信息。
7. 最后列出变更文件、接口示例、迁移需求（如有）和实际执行过的验证命令。

约束：客户端当前开发环境为 http://8.136.139.105:8080，正式环境未来使用 HTTPS 域名。请以仓库真实实现为准；若文档与代码不一致，先说明证据，再选择最小兼容方案。
```
