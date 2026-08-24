# Sub2API Customer Desktop

面向兑换码客户的 Tauri 2 + React 桌面端。它调用 `POST /api/v1/customer/activate` 完成设备激活，再读取当前用户自己的 API Key 与用量。

## 开发

```powershell
cd customer-tauri
npm install
npm run tauri dev
```

默认服务地址为 `http://localhost:8080`。交付时请通过 `VITE_SUB2API_URL` 配置 HTTPS 地址。

```powershell
$env:VITE_SUB2API_URL = "https://api.example.com"
npm run tauri build
```

仅保存非敏感的设备标识。JWT 和 API Key 只驻留在内存中，重启应用后需再次输入兑换码以恢复会话。请不要把测试 HTTP 地址用于正式环境。

## 演示模式

演示入口默认不包含在生产包中。需要测试时使用以下命令构建：

```powershell
$env:VITE_DEMO_MODE = "true"
npm run tauri build
```

这会显示“填入演示数据”按钮；使用 `DEMO-2026-START` 激活即可查看完整界面。演示模式完全离线，展示的密钥和用量均不可用。
