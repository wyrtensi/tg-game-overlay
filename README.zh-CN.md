<p align="center">
  <img src="branding/banner.png" alt="tg-game-overlay：在游戏上方显示 Telegram 聊天" width="100%">
</p>

<p align="center">
  <a href="https://github.com/wyrtensi/tg-game-overlay/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/wyrtensi/tg-game-overlay?filter=v*&label=app&color=5b8cff"></a>
  <a href="https://github.com/wyrtensi/tg-game-overlay/releases?q=server"><img alt="中继服务器" src="https://img.shields.io/github/v/release/wyrtensi/tg-game-overlay?filter=server-v*&label=relay%20server&color=8a5cff"></a>
  <a href="https://github.com/wyrtensi/tg-game-overlay/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wyrtensi/tg-game-overlay/ci.yml?branch=main&label=ci"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4">
  <img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-24c8db">
  <img alt="端到端加密中继" src="https://img.shields.io/badge/relay-end--to--end%20encrypted-2ea44f">
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/github/license/wyrtensi/tg-game-overlay?color=lightgrey"></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.ru.md">Русский</a> · <b>简体中文</b></p>

**tg-game-overlay** 为没有内置聊天的游戏提供一个叠加在游戏上方的聊天窗口。
消息直接浮现在游戏画面上，无需 Alt+Tab 即可回复，朋友们可以在自己的叠加层或普通
Telegram 客户端中看到。

聊天可以通过两种方式传输：

- **Telegram**（主要模式）：用您自己的账号登录，镜像任意聊天、群组或论坛话题。
- **自建中继服务器**：一个由您自己部署的小型 Docker 服务。消息在每台电脑上进行端到端
  加密，服务器只转发密文并提供共享的贴纸目录。

> 界面支持英语、俄语和简体中文，默认跟随 Windows 显示语言，可在 **设置 → 启动** 中
> 更改。仅支持 Windows 10 和 11。

## 功能

- 透明且可点击穿透的聊天窗口绘制在游戏窗口内部，区域可按游戏分别设置；分辨率变化后
  依然对齐，并随游戏一起隐藏。
- 一个快捷键即可在游戏中输入文字；按 Esc 或 Enter 把焦点还给游戏。
- 支持贴纸（包括 TGS、WebP、WebM 动态贴纸）以及粘贴图片。
- **短语轮盘**：按住快捷键，甩动鼠标，松开即可发送预设短语。
- **方向信号**：按方向键即可向聊天中的所有人显示一个大箭头。
- 常驻托盘，从不抢占焦点；每个游戏可设为显示、隐藏或屏蔽。
- 外观可调：文字大小、颜色、气泡、阴影和时长。
- 界面提供英语、俄语和简体中文。

## 安装

1. 从 [最新版本](https://github.com/wyrtensi/tg-game-overlay/releases/latest)
   下载 `tg-game-overlay_<版本>_x64-setup.exe` 并运行。Windows 11 自带 WebView2；
   在 Windows 10 上如果缺少，安装程序会自动下载。
2. 应用启动后位于托盘中。左键点击托盘图标打开设置。
3. 按照顶部 **游戏准备** 卡片的提示操作，它总会指出下一步。

### Telegram 模式

发布版本中 **不包含 Telegram API 密钥**。每位用户使用自己的密钥，只需几分钟：

1. 打开 [my.telegram.org](https://my.telegram.org)，登录后选择
   **API development tools**。
2. 创建一个应用（名称任意，平台选 *Desktop*），复制 `api_id` 和 `api_hash`。
3. 在应用中打开 **Telegram → 您自己的 Telegram API 密钥**，粘贴两项并保存。
   它们只为您的 Windows 用户保存（DPAPI），不会离开这台电脑。
4. 使用手机号码和 Telegram 发送的验证码登录，然后选择要镜像的聊天。

Telegram 会话和密钥都在您的账户下用 Windows DPAPI 加密。应用直接连接 Telegram，
中间没有我们的任何服务器。

### 自建服务器模式

1. 您的朋友中有人部署中继服务器（见下文），并分享地址和 **访问密钥**。
2. 在 **连接方式** 中选择 **自建服务器**，填写地址（例如 `203.0.113.10:8790`）、
   访问密钥、房间名、房间密码以及其他人看到的名字。
3. 输入相同房间名和密码的人会进入同一个聊天。密码错误只会进入另一个空房间。

## 中继服务器

一个约一千行代码的 Node.js 服务，只有一个依赖（`ws`）。空闲时约占 20 MiB 内存，
可以与其他服务一起轻松运行在 1 GB 内存的 VPS 上。

```sh
mkdir tg-overlay-relay && cd tg-overlay-relay
curl -LO https://raw.githubusercontent.com/wyrtensi/tg-game-overlay/main/server/docker-compose.yml
curl -LO https://raw.githubusercontent.com/wyrtensi/tg-game-overlay/main/server/.env.example
cp .env.example .env
openssl rand -base64 32   # 填为 ACCESS_KEY，分享给朋友
openssl rand -base64 32   # 填为 ADMIN_KEY，自己保管
docker compose up -d
curl http://localhost:8790/health   # ok
```

这些文件以及贴纸上传脚本也会作为 `tg-game-overlay-server-<版本>.tar.gz` 附在每个
[`server-v*` 版本](https://github.com/wyrtensi/tg-game-overlay/releases?q=server) 中。
镜像发布为 `ghcr.io/wyrtensi/tg-game-overlay-server`。默认端口为 8790，不需要
80 和 443 端口。贴纸使用 `server/scripts/upload-stickers.mjs` 和管理员密钥上传，
每个客户端按内容哈希在本地缓存。完整的运维说明见 [server/README.md](server/README.md)。

### 加密原理

- 每个客户端根据房间名和密码推导密钥（PBKDF2-SHA256，600 000 次迭代，再经 HKDF），
  并使用 AES-256-GCM 加密每条消息，每次使用新的随机 nonce，并以房间 id 作为关联数据。
  消息会填充到 256 字节的整数倍。
- 服务器只能看到房间 id（一个哈希值）、密文大小和时间，无法读取消息中的文字、名字、
  贴纸或图片。
- 访问密钥从不通过网络发送：客户端用 HMAC 回应随机挑战。
- 需要了解的限制：前面没有 TLS 代理时，元数据在网络上可见；同一房间的所有人共用一个
  密钥，因此房间适合朋友之间使用；贴纸目录受访问密钥保护，但未加密。

网络协议见 [server/PROTOCOL.md](server/PROTOCOL.md)。

## 从源码构建

需要 Windows、Rust（MSVC 工具链）及 Visual Studio Build Tools（C++ 工作负载）、
Node.js 20+。

```sh
npm install
npm run tauri dev       # 开发
npm run tauri build     # 安装程序位于 src-tauri/target/release/bundle
```

可选：如需在私人构建中内置自己的 Telegram 密钥，将
`{"apiId": 123, "apiHash": "..."}` 放入 `src-tauri/credentials.json`（已被 git 忽略），
或设置 `TG_API_ID` / `TG_API_HASH`。公开发布版本使用 `TGO_NO_EMBEDDED_KEYS=1` 构建，
因此不会混入任何密钥。

```sh
npm test                          # 前端和中继客户端（vitest）
cd src-tauri && cargo test        # 后端（Rust）
cd server && npm test             # 中继服务器（node:test）
```

## 工作原理

- `src-tauri/`：Rust 后端，包括叠加层状态机、前台窗口跟踪、快捷键、托盘、配置以及
  DPAPI 保护的密钥。
- `src/overlay/`：绘制在游戏上方的透明页面。
- `src/main/`：设置窗口。
- `src/telegram/`：持有 MTProto 客户端（GramJS）的隐藏工作窗口。
- `src/relay/`：中继传输的隐藏工作窗口，包括 WebCrypto、WebSocket 客户端和贴纸缓存。
- `src/i18n/`：英文和中文词典，以俄文原文为键；若可见文字缺少翻译，测试会失败。
- `server/`：中继服务器。

各页面之间不直接通信，由 Rust 充当总线。事件和命令见 [CONTRACT.md](CONTRACT.md)。

## 已知限制

- 独占全屏模式（较老的 DX9 到 DX11 游戏）会遮挡置顶窗口，请在无边框窗口模式下运行
  此类游戏。
- 游戏按可执行文件名匹配，受保护的进程可能无法提供该名称。

## 许可证

[MIT](LICENSE)
