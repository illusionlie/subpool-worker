# Sub Pool Worker

一个基于 Cloudflare Workers 的轻量级订阅池服务，用于管理和分发代理订阅链接。

## 功能特点

- 🔄 订阅聚合：将多个订阅链接/节点合并为一个，按组管理
- 🌐 格式转换：可配置远端 subconverter 进行订阅格式转换
- 🔐 管理后台：提供基于 Web 的管理界面
- 🚫 失败封禁: 防暴力破解的登录失败封禁机制
- 📱 Telegram 通知：可选的关键操作通过 Telegram 机器人通知
- 🛡️ 访问控制：支持阻止特定地区访问和简单的机器人防护
- 📝 日志记录: 完整的访问日志和错误记录
- 🗃️ KV 存储：使用 Cloudflare KV 进行配置和数据存储

## 项目结构

```text
public/                 # Worker Assets 静态页面资源
├── admin/
│   ├── index.html      # 管理后台页面
│   └── login.html      # 登录页面
└── index.html          # 默认欢迎页

src/
├── handlers/           # 请求处理器
│   ├── admin.js        # 管理后台处理
│   └── subscription.js # 订阅请求处理
├── services/           # 核心服务
│   ├── auth.js         # JWT 认证服务
│   ├── config.js       # 配置管理服务
│   ├── kv.js           # KV 存储服务
│   ├── logger.js       # 日志服务
│   ├── subconverter.js # 订阅转换服务
│   └── telegram.js     # Telegram 通知服务
├── index.js            # 入口文件
├── router.js           # 路由配置
└── utils.js            # 工具函数
```

## 快速开始

### 环境准备

- Node.js 18+
- Cloudflare 账户
- Wrangler CLI

### 命令行部署到 Cloudflare

1. 克隆本项目：

   ```bash
   git clone https://github.com/illusionlie/subpool-worker.git
   cd sub-pool
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 创建 KV 命名空间：

   ```bash
   wrangler kv namespace create "KV"
   ```

4. 配置 Cloudflare：
   - 复制 [wrangler.toml.example](wrangler.toml.example) 到 `wrangler.toml`
   - `wrangler.toml.example` 已启用 Worker Assets，会自动上传 `public/` 目录中的静态页面资源
   - 修改配置文件中的占位符：
     - `__WORKER_NAME__`：你的 Worker 名称
     - `__KV_NAMESPACE_ID__`：你的 KV 命名空间 ID
     - `__DEBUG_SECRET__`：调试密钥（随机字符串）
     - `__INIT_SECRET__`：初始化密钥（高强度随机字符串，仅首次初始化管理员密码时使用）

5. 部署到 Cloudflare：

   ```bash
   npm run deploy
   ```

### 通过 Github Actions 部署到 Cloudflare

1. 复刻本项目到你的 Github 账户

2. 在你的 Cloudflare 账户中创建：
   - 一个 Workers KV，命名随意
   - 帐户 API 令牌（只需要 Workers KV 存储和 Workers 脚本 的编辑权限）

>
> 保管妥当你的 KV ID和 API 令牌，不要将其分享给任何人或暴露在公开环境！
>

3. 在复刻的 Github 项目中创建（设置->机密和变量->操作->仓库机密）：

 *    **`WORKER_NAME`**
       *   **值**: 部署后的 Worker 名称

 *    **`CF_API_TOKEN`**
      *   **值**: Cloudflare API 令牌

 *    **`CF_KV_NAMESPACE_ID`**
      *   **值**: Workers KV ID

 *    **`DEBUG_SECRET`**
      *   **值**: 用于覆写日志等级的密钥

 *    **`INIT_SECRET`**
        *   **值**: 初始化密钥（高强度随机字符串）

 *    **`CUSTOM_DOMAIN`**
       *   **值**: 自定义域（可选）

### 本地检查

- 运行 [`npm run lint`](package.json:8) 执行 ESLint 静态检查
- 运行 [`npm test`](package.json:9) 执行 Node 内置测试
- 运行 [`npm run check`](package.json:10) 串行执行 lint 与测试
- 运行 [`npm run build`](package.json:11) 执行 Cloudflare Workers dry-run 构建校验

### 本地开发

1. 启动开发服务器：

   ```bash
   npm run dev
   ```

2. 访问 `http://localhost:8787` 查看应用

### 前端资源位置

- `public/admin/index.html`：管理后台主页面
- `public/admin/login.html`：登录页
- `public/admin/init.html`：首次初始化页（设置初始管理员密码）
- `public/index.html`：默认欢迎页 / 拦截回退页
- Worker 通过 `wrangler.toml` 中的 `[assets]` 配置加载这些静态资源，并在代码中统一补充鉴权与安全响应头

## 使用说明

### 管理后台使用

1. 访问 `/admin` 路径进入管理后台。首次访问会进入初始化页面，请先设置管理员密码。

>
> **初始化完成后请妥善保管密码；如遗忘需通过 KV 手动重置。**
> **初始化页面需要输入 `INIT_SECRET`（部署密钥），请与管理员密码分离保管。**
>

2. 输入部署时配置的 `INIT_SECRET` 与你设置的管理员密码完成初始化（系统会自动生成 JWT 密钥）

3. 使用你设置的管理员密码登录

4. 管理后台主要能力：
   - 订阅组管理：名称、Token、是否允许中国大陆访问、订阅来源（逐行：可为 URL 或内联节点）
   - 过滤器：启用后可填写多条规则；支持两种写法：
     - 正则：/pattern/flags（如：/过期/i）
     - 简单字符串：会自动转换为正则并同时匹配 URL 编码形式
   - 全局设置：登录失败防护、修改密码、Telegram 通知、Subconverter 后端与配置地址

### Telegram 通知配置

1. 创建 Telegram 机器人并获取 Bot Token
2. 获取聊天 ID (Chat ID)
3. 在管理后台配置 Telegram 设置
4. 启用通知功能

### 订阅接口

- 路径：`GET /sub/:token`
- 客户端格式选择（任一参数存在即生效）：
  - `?clash` → Clash
  - `?sb` 或 `?singbox` → Sing-box
  - `?surge` → Surge
  - `?quanx` → Quantumult X
  - `?loon` → Loon
  - `?b64` 或 `?base64` → Base64（直接返回 Base64 原始节点）
- 响应头（示例）：
  - `Profile-Update-Interval: <分钟>`
  - `Subscription-Userinfo: upload=0; download=0; total=<字节>; expire=<UNIX时间>`
  - 若为转换产物（如 Clash/Sing-box），会附带 `Content-Disposition` 以便客户端保存为配置文件
- 区域限制与反爬：
  - 每个订阅组可单独设置“允许中国大陆 IP 访问”
  - 若启用全局“阻止爬虫”，将基于 UA、HTTP/TLS/请求头多维打分阻断访问

### Subconverter 对接说明

- 工作流程：
  1) 将订阅来源分为“内联节点”和“远程订阅 URL”；并发拉取远程内容
  2) 自动识别 YAML/JSON 配置类内容，或 Base64/原生节点，并进行过滤与去重
  3) 目标为 Clash/Sing-box 时：拼装回调 URL + 远程配置 URL 列表，转交 Subconverter 转换
  4) 转换失败时降级返回 Base64 原始节点
- 配置项（管理后台 → 全局设置）：
  - Subconverter 后端地址（不含协议）与协议（https/http）
  - Subconverter 配置文件 URL
  
## 技术栈

- [Cloudflare Workers](https://workers.cloudflare.com/): Serverless 执行环境
- [Cloudflare Worker Assets](https://developers.cloudflare.com/workers/static-assets/): 静态页面托管与缓存
- [Cloudflare KV](https://developers.cloudflare.com/workers/learning/how-kv-works/): 全球分布式键值存储
- [itty-router](https://github.com/kwhitley/itty-router): 轻量级 Worker 路由器
- [GitHub Actions](https://github.com/features/actions): CI/CD 自动化部署
- JavaScript (ES Module)
- HTML/CSS/原生 JavaScript (管理界面)

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 安全特性

- JWT Token 认证
- 登录失败次数限制
- IP 封禁机制
- 防止中国地区访问（可配置）
- 机器人访问检测

## 作者

Copyright (c) 2025 IllusionLie

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 致谢

- [CF-Workers-SUB](https://github.com/cmliu/CF-Workers-SUB) by [cmliu](https://github.com/cmliu)