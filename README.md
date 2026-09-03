# CFPanle · 云端部署器

一款基于网页的 **Cloudflare 一键部署面板**：填入 Cloudflare 邮箱与 Global API Key，
即可把 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 一键部署到你的
Cloudflare **Worker / Pages**，并自动创建随机项目名、KV、可选子域名与后台管理地址。

> 单源部署 · 密钥不落盘 · 橙色主题界面

| 项目 | 值 |
| :--- | :--- |
| 部署源 | [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) `_worker.js`（`main` 分支） |
| KV 绑定 | `KV`（无需预置，Worker 首次访问自动初始化） |
| 兼容日期 | `2025-11-04` |
| 后台地址 | `https://<域名或项目地址>/admin` |

## 特性

- **邮箱 + Global API Key 登录**：密钥只在当前请求内转发给 Cloudflare API，前端不写入本地存储。
- **一键部署 / 高级部署**：一键默认 Pages + 随机项目名 + 随机 KV；高级部署可指定 Worker / Pages 与全部变量。
- **随机名称一致管理**：随机项目名与 KV 名称共用同一个 8 位编码（如 `edge-ab9fe59b` / `store-ab9fe59b`）。
- **更新现有项目**：只同步代码，不修改变量、KV、域名或项目配置。
- **可选域名绑定**：Zone 下拉选择，可绑定随机子域名或自定义域名；Worker 支持 Route 绑定。
- **全部变量可配**：`ADMIN`（必填）+ `KEY`/`UUID`/`PROXYIP`/`URL`/`GO2SOCKS5`/`DEBUG`/`OFF_LOG`/`BEST_SUB`/`PRELOAD_RACE_DIAL`/`TCP_CONCURRENT_DIAL`/`PROXY_CONCURRENT_DIAL`（选填，留空不写入）。
- **直接 Cloudflare API 上传**：不依赖 wrangler CLI；对 Pages 传播延迟（`Project not found`）内置自动重试。

## 部署方式

### 方式一：Cloudflare Pages 控制台上传

```bash
npm install
npm run pack:upload
```

生成 `deploy-panel-v2-upload.zip`（含 `index.html`、`app.js`、`styles.css`、`favicon.png`、`_worker.js`），
在 Cloudflare Pages 控制台「上传资产」上传即可，无需构建命令。

### 方式二：wrangler CLI

```bash
npm install
npm run deploy
```

### 方式三：GitHub Actions 自动部署

Fork / Push 到 GitHub 后，在仓库 **Settings → Secrets and variables → Actions** 配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

推送 `main` 分支即自动部署到 Cloudflare Pages（项目名 `deploy-panel-v2`）。

### 本地调试

```bash
npm start
# 默认 8790 端口；若被占用：$env:PORT="8792"; npm start
```

## 使用说明

页面为**橙色系纵向布局**：顶部三栏式标题栏（标题 / 说明 / Key 安全提示）常驻吸顶；
登录后「日志栏 + 部署结果卡片」固定在标题栏下方同样常驻，页面超出可视范围时滚动从操作卡片开始。

1. **登录**：填 Cloudflare 邮箱 + Global API Key（密钥不落盘）。
2. **操作卡片**：切换「随机新建 / 更新现有」。
   - 随机新建：在「一键部署」卡片填写并部署，可绑定随机子域名。
   - 更新现有：选择现有项目后点击「更新现有项目」，只同步代码。
3. **部署结果**：成功 / 失败信息统一显示在独立的「部署结果」卡片（位于日志与操作卡片之间）。
4. **ADMIN 后台密码**：密码框旁有「随机」「复制」按钮；未填写直接部署时对应输入框会标红提示。
5. **高级设置**（仅随机新建时生效），选填部分分三段——
   - **部署主体（必填）**：Account、部署方式（Pages / Worker）、项目名称、ADMIN 密码。
   - **域名 / KV / UUID（选填）**：Zone、自定义域名、KV 名称、现有 KV、UUID（输入框旁有「生成」「复制」）。
   - **更多参数（默认折叠）**：KEY / PROXYIP / URL / GO2SOCKS5 / DEBUG / OFF_LOG / BEST_SUB / PRELOAD_RACE_DIAL / TCP_CONCURRENT_DIAL / PROXY_CONCURRENT_DIAL，以及 workers.dev 启用下拉。

### 一键部署失败排查

若出现 `Project not found`，通常是 Pages 项目刚创建后 Cloudflare 传播延迟所致，后端已内置自动重试；
本地版与托管版均采用 Cloudflare 直接 API 上传，不依赖 wrangler CLI。

## 目录结构

```
├─ public/                    前端（部署器面板）
│  ├─ index.html              页面结构
│  ├─ app.js                  前端逻辑
│  ├─ styles.css              样式（橙色主题）
│  └─ favicon.png             标签页图标
├─ functions/api/[[path]].js  托管版后端（Cloudflare Workers）
├─ server.mjs                 本地版后端（Node，同 API）
├─ scripts/                   构建与打包脚本
├─ .github/workflows/deploy.yml  GitHub Actions 自动部署
├─ wrangler.toml              wrangler 配置
└─ README.md
```

## 技术说明

- 前后端同一套 `/api/*` 接口（`accounts` / `zones` / `resources` / `deploy`）。
- 托管版（`functions/api/[[path]].js`）与本地版（`server.mjs`）逻辑一致，均可独立运行。
- 部署流程：获取或创建 KV → 部署 Worker（PUT scripts + metadata bindings）或
  Pages（创建 / 更新项目 + 直接上传）→ 可选绑定域名 → 列出域名。
