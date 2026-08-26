# Sub2API Customer Desktop

面向兑换码客户的 Tauri 2 + React 桌面端。激活使用 `POST /api/v1/customer/activate`；用量、用量明细、通知及通知已读接口使用激活返回的 Access Token 进行 Bearer 鉴权。

## 开发

```powershell
cd D:\data\project\sub2api-customer-desktop
npm install
npm run tauri dev
```

不要用 `npm run dev` 直接做激活联调：它只启动浏览器页面，无法访问操作系统凭据库。桌面端联调请始终使用 `npm run tauri dev`。

开发联调固定使用 `http://8.136.139.105:8080`。正式打包必须通过 `VITE_SUB2API_URL` 配置 HTTPS 服务地址；原生层会拒绝 HTTP 地址。

```powershell
$env:VITE_SUB2API_URL = "https://api.example.com"
npm run tauri build
```

设备 ID 保存到 App 私有存储；`access_token`、`refresh_token` 和 API Key 按账号保存到操作系统凭据库，永不写入日志、普通配置文件或剪贴板。删除账号时会同步删除对应的系统安全凭据。

重复添加时，客户端使用浏览器原生 SHA-256 保存设备相关的卡密指纹，并由原生层在内存中再次比较新旧 Access Token/API Key；两层任一判断为同一账号都会拒绝新增，不会保存或返回原始卡密。

当前已接入：`POST /api/usage`、`POST /api/usage/details`、`GET /api/notifications`、`POST /api/notifications/read`。服务器尚未提供可用的 `/api/usage/reset` 与 Relay API，客户端不会调用这两个路径。
