# MiniUsage

MiniUsage 是一个只在本机运行的 Rust 服务和 React Dashboard，用来读取 Codex 的本地会话记录，整理 usage、Session 与费用信息。数据处理、SQLite 数据库和 Dashboard 请求都留在用户的电脑上；服务只监听 `127.0.0.1:3210`，不会把 Codex/OpenAI 会话内容上传到网络。

本仓库正在准备 v0.1.0 的公开分发。下面的安装包名称是计划发布的 artifact 名称；请以 GitHub Releases 中实际可下载的文件为准。本 README 不代表某个 Release 或 CI 已经发布、通过。

## 支持平台与安装

v0.1.0 的正式目标是：

- Windows 10/11 x64：`MiniUsage-v0.1.0-windows-x64-setup.exe`
- macOS Apple Silicon arm64：`MiniUsage-v0.1.0-macos-arm64.dmg`
- macOS Intel x64：`MiniUsage-v0.1.0-macos-x64.dmg`

发布后，Windows 用户运行 x64 安装程序，再从开始菜单或快捷方式启动 MiniUsage；macOS 用户打开对应架构的 DMG 并运行应用。v0.1.0 的 macOS 应用未做 Developer ID 签名或 notarization，首次启动若被系统拦截，请在 Finder 中按住 Control 点按应用并选择“打开”，或在“系统设置 → 隐私与安全性”中选择“仍要打开”。

启动后 MiniUsage 会启动本地服务并打开默认浏览器：

```text
http://127.0.0.1:3210
```

如果浏览器没有自动打开，可以手动访问这个地址。重复启动只会打开已经运行的实例；`3210` 被其他程序占用时会报告端口错误，不会结束或替换其他程序。

## 本地数据位置

`CODEX_HOME` 环境变量优先；未设置时使用当前用户 Home 下的 `.codex`：

- macOS：`~/.codex`
- Windows：`C:\Users\<user>\.codex`

默认数据库位置为：

- macOS：`~/Library/Application Support/MiniUsage/mu.sqlite3`
- Windows：`C:\Users\<user>\AppData\Local\MiniUsage\mu.sqlite3`（Local AppData）

rollout、Session、SQLite 和扫描状态均保存在本机。MiniUsage 的更新服务只向固定公开仓库查询 latest Release，不发送 Codex Home、会话正文或 OpenAI 凭据。

## 更新行为

核心服务准备好后，后台会立即异步检查一次更新，之后每 4 小时检查一次。Dashboard 提供“检查更新”按钮；主动检查时按钮显示“检查中…”，发现新版本后显示“版本升级”。检查失败不会阻塞启动、扫描或 Dashboard；自动检查失败保持静默。

MiniUsage 不会自动下载、执行或覆盖安装新版。“版本升级”只打开对应的 GitHub Release 页面，由用户自行下载和安装。

## 从源码构建

源码构建需要 Rust stable/Cargo、Node.js/npm。最终用户使用发布的安装包时不需要安装 Rust、Cargo、Node.js、npm、SQLite、Visual Studio 或 Windows SDK；SQLite 已由应用使用的 bundled runtime 提供。

安装前端依赖并运行正式构建：

```sh
cd <repo>/frontend
npm ci
npm run build
cd <repo>

cargo fmt --check
cargo check --locked
cargo test --locked
cargo build --release --locked --features embedded-frontend
```

开发时可以在一个终端运行 `cargo run`，在另一个终端运行：

```sh
cd <repo>/frontend
npm run dev
```

然后打开 Vite 显示的本机地址。正式 release binary 会把 `frontend/dist` 中的 HTML、JavaScript、CSS 和字体嵌入可执行文件，运行时不需要仓库目录或 `frontend/dist`。

## 正式测试命令

Rust 与前端的分发测试至少执行：

```sh
cargo fmt --check
cargo check --locked
cargo test --locked

cd <repo>/frontend
npm ci
npm run test
npm run check
npm run build
```

CI、Release artifact 和安装包 smoke 的状态以对应 GitHub Actions 运行记录及 Release 页面为准。
