# Sub2API Customer Desktop

面向兑换码客户的 Tauri 2 + React 桌面端。激活使用 `POST /api/v1/customer/activate`；用量、用量明细、通知及通知已读接口使用激活返回的 Access Token 进行 Bearer 鉴权。

## 开发

```powershell
cd D:\data\project\sub2api-customer-desktop
npm install
npm run tauri dev
```

不要用 `npm run dev` 直接做激活联调：它只启动浏览器页面，无法访问操作系统凭据库。桌面端联调请始终使用 `npm run tauri dev`。

开发和正式打包默认使用 `http://8.136.139.105:8080`。如需切换服务地址，可在打包时设置 `VITE_SUB2API_URL`，支持 HTTP 和 HTTPS。

```powershell
$env:VITE_SUB2API_URL = "http://api.example.com"
npm run tauri build
```

设备 ID 保存到 App 私有存储；`access_token`、`refresh_token` 和 API Key 按账号保存到操作系统凭据库，永不写入日志、应用普通配置文件或剪贴板。用户主动执行“一键修改”时，API Key 会按 Codex 的认证格式写入 `%CODEX_HOME%\auth.json`；首次修改前的官方认证备份保存在 Tauri 应用私有数据目录。删除账号时会同步删除对应的系统安全凭据；如果该账号正在用于 Codex，会先恢复官方配置。

重复添加时，客户端使用浏览器原生 SHA-256 保存设备相关的卡密指纹，并由原生层在内存中再次比较新旧 Access Token/API Key；两层任一判断为同一账号都会拒绝新增，不会保存或返回原始卡密。

当前已接入：`POST /api/usage`、`POST /api/usage/details`、`GET /api/notifications`、`POST /api/notifications/read`。Codex 模型地址由管理服务地址追加 `/v1` 派生，Provider 为 `sub2api`，默认模型为 `gpt-5.5`。

## Codex 一键配置

“一键修改”会定位 `CODEX_HOME`，未设置时使用当前用户目录下的 `.codex`，并执行以下操作：

1. 校验 `auth.json`、`config.toml` 和存在时的 `state_5.sqlite`。
2. 在应用私有数据目录创建首次官方配置基线；后续账号切换不会覆盖该基线。
3. 原子写入 API Key 与 `sub2api` Provider。
4. 使用 SQLite 事务将历史任务迁移到 `sub2api`。
5. 写后诊断失败时恢复本次操作前的文件和线程 Provider。

“还原官方配置”会恢复首次修改前的 `auth.json` 和 `config.toml`。修改前已经存在的历史任务恢复各自原 Provider；第三方使用期间新建的任务使用官方基线中的 Provider。操作完成后需要重启 Codex。

首次版本不包含 `127.0.0.1:19927` 本地代理。配置备份可能包含官方 OAuth 材料，不会返回 WebView 或写入日志。
