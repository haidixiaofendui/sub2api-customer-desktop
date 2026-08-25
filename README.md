# Sub2API Customer Desktop

面向兑换码客户的 Tauri 2 + React 桌面端。它仅调用 `POST /api/v1/customer/activate` 完成设备激活；接口文档未定义的账号列表、额度、用量与通知功能均不展示。

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

设备 ID 保存到 App 私有存储；`access_token`、`refresh_token` 和 API Key 保存到操作系统凭据库，永不写入日志、普通配置文件或剪贴板。
