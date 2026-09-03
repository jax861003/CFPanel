# CFPanel · 云端部署器

往 Cloudflare 上部署 Worker 这件事，听起来不难，真做起来全是琐碎活：装 wrangler、建 KV、把变量一个个填进配置、再想域名怎么绑。步骤我闭着眼都能数出来，每次还是会被某个 API 的格式卡一下。

这个面板就是把那套流程收进一个网页。填上 Cloudflare 邮箱和 Global API Key，选 Pages 还是 Worker，点一下，剩下的随机项目名、KV、变量、可选子域名，它自己搞定。面板部署完之后还能留着，以后要更新代码、改参数，打开页面再点一次就行，不用再翻 CLI。

默认部署的是 [edgetunnel](https://github.com/cmliu/edgetunnel)，cmliu 的项目。装好会自动生成一个 `/admin` 后台地址，后台密码你自己设。

**一个前提说清楚**：Global API Key 只在当前请求里转给 Cloudflare API 用一下就丢，不写进浏览器本地存储，也不落盘到服务器。放心用。

## 它能干什么

- **一键部署**：默认走 Pages，随机项目名、随机 KV、随机子域名，填个后台密码就能跑
- **高级部署**：自己想说了算的时候，手动选 Worker 还是 Pages，项目名、域名、KV、各个变量都自己填
- **更新已有项目**：账号里已经部署过的项目，直接在面板里选，只同步代码，不动它现有的变量、KV 和域名
- **绑定域名**：Zone 下拉选一个域名，自动帮你绑上随机子域名或者自定义域名，Worker 还支持 Route 绑定
- **随机名成对**：随机项目名和 KV 名共用一个 8 位随机串，比如 `edge-ab9fe59b` / `store-ab9fe59b`，在控制台里也好认

## 先把面板部署起来

CFPanel 本身是纯静态页面 + 一层很薄的 API，前后端打包在一起，可以直接传成 Cloudflare Pages。三条路任选。

**控制台上传（最省事）**

```bash
npm install
npm run pack:upload
```

项目根目录会生成 `deploy-panel-v2-upload.zip`（里面是 `index.html`、`app.js`、`styles.css`、`favicon.png`、`_worker.js` 五个文件）。去 Cloudflare 控制台 → Pages → 创建项目 → 上传资产，把这个 zip 拖进去就行，不用配任何构建命令。

**wrangler 命令行**

```bash
npm install
npm run deploy
```

**GitHub Actions 自动部署**

fork 一份之后，在仓库 Settings → Secrets and variables → Actions 里加两个 secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

之后推 main 分支就会自动部署（项目名固定 `deploy-panel-v2`）。

**本地先跑起来看看**

```bash
npm start
```

默认监听 8790 端口，被占用了就 `$env:PORT="8792"; npm start` 换一个，浏览器开 `http://localhost:8790` 就能用。

## 在面板里部署 edgetunnel

1. **登录**：填 Cloudflare 邮箱 + Global API Key。
2. **选操作**：左侧「操作」卡片里选「随机新建」还是「更新现有」。
   - 随机新建：在一键部署卡片填个 ADMIN 后台密码（旁边有随机生成、复制的按钮），点「一键部署」。想自己控制的，展开「高级设置」。
   - 更新现有：下拉里会列出账号里已有的 Worker / Pages 项目，选一个点「更新现有项目」，只同步代码。
3. **看结果**：成功或失败会显示在「部署结果」卡片，完整过程在日志栏里能翻到。

高级设置里的参数分三段：

**部署主体（必填）**：Account（默认登录账号）、部署方式（Pages / Worker）、项目名称（留空就随机）、ADMIN 后台密码。

**域名 / KV / UUID（选填）**：Zone 域名、自定义域名、KV 名称、要不要复用现有 KV、UUID（旁边有生成和复制按钮）。

**更多参数（默认折叠）**：edgetunnel 的全部可选变量，留空的不会写入：

| 变量 | 作用 |
| --- | --- |
| `KEY` | 订阅密钥 |
| `PROXYIP` | 全局反代地址 |
| `URL` | 伪装主页 |
| `GO2SOCKS5` | 强制走代理的域名，逗号分隔 |
| `DEBUG` | 调试日志 |
| `OFF_LOG` | 关闭日志 |
| `BEST_SUB` | 优选订阅 |
| `PRELOAD_RACE_DIAL` | 预连接竞速 |
| `TCP_CONCURRENT_DIAL` | TCP 并发数 |
| `PROXY_CONCURRENT_DIAL` | 代理并发数 |

另外还有 workers.dev 是否启用的下拉。

## 常见问题

**部署报 `Project not found`？**
Pages 项目刚创建时 Cloudflare 侧还没同步完，属于传播延迟，面板内置了自动重试，等一下一般自己就好。这也是为什么它直接调 Cloudflare 官方 API 传代码，不依赖本机装 wrangler。

**Global API Key 安全吗？**
只存在当前请求里，转发给 Cloudflare API 用完即弃，前端不写 localStorage，后端不落盘。部署面板时也不用把 Key 写进任何配置。

## 目录结构

```
public/                   面板前端
  index.html              页面结构
  app.js                  前端逻辑
  styles.css              样式
  favicon.png             图标
functions/api/[[path]].js 托管版后端（部署在 Cloudflare Workers 里）
server.mjs                本地版后端（Node，接口和托管版一致）
scripts/                  打包脚本
.github/workflows/        Actions 自动部署
wrangler.toml             wrangler 配置
```
