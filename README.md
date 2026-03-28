# Sub Pool Worker

一个基于 Cloudflare Workers 的轻量订阅池服务，目标是：

- 统一管理多组订阅来源
- 按客户端格式分发订阅
- 通过 Web 管理后台完成配置、导入导出与运维

> 当前实现是 **Worker + KV + Worker Assets** 架构，静态页面由 `public/` 提供，业务逻辑在 `src/`。

---

## 核心能力

- **订阅组管理**：按组维护名称、Token、来源节点、过滤规则与地区访问策略
- **订阅聚合与过滤**：支持内联节点 + 远程订阅混合输入，过滤器支持正则与普通字符串
- **格式转换**：按 URL 参数 / User-Agent 自动识别目标格式并接入 subconverter
- **失败回退**：subconverter 异常时回退为 base64 原始节点，而不是直接返回 5xx
- **管理后台**：首次初始化、登录鉴权、会话续期、配置管理、订阅组 CRUD
- **登录失败防护**：基于 IP 的失败计数与临时封禁
- **数据备份**：支持配置与订阅组 JSON 导入/导出（带回滚保护）
- **访问防护**：可按组限制中国大陆访问
- **日志与通知**：结构化日志 + Telegram 通知；支持 `X-Debug-Log` 临时提升日志输出

---

## 路由总览

| 路径 | 说明 |
| --- | --- |
| `GET /sub/:token` | 订阅入口。支持按参数/UA 选择输出格式 |
| `ALL /admin`、`ALL /admin/*` | 管理后台页面与 API |
| `ALL /favicon.ico` | 固定返回 404 |
| `ALL /robots.txt` | 返回禁止抓取策略 |
| 其他路径 | 回退到 `public/index.html` |

参考实现：

- 路由入口：[`src/router.js`](src/router.js)
- Worker 入口：[`src/index.js`](src/index.js)

---

## 项目结构

```text
.github/
└── workflows/
    └── generate-test.yml            # CI：lint + test + deploy dry-run 校验

public/
├── index.html                       # 默认回退页（未知路径 / 订阅异常回退）
└── admin/
    ├── index.html                   # 管理后台主页面
    ├── init.html                    # 首次初始化页面
    ├── login.html                   # 登录页
    └── js/
        └── index.js                 # 管理后台前端逻辑（非 ESM script）

src/
├── index.js                         # Worker fetch 入口
├── router.js                        # 总路由
├── utils.js                         # 过滤、响应头封装、静态资源封装
├── handlers/
│   ├── admin.js                     # 管理模块导出 + 测试白盒导出
│   ├── subscription.js              # /sub/:token 处理
│   └── admin/
│       ├── entry-controller.js      # 管理入口：初始化状态、登录态、页面/API分流
│       ├── page-controller.js       # 管理页静态资源分发
│       ├── public-controller.js     # 无需登录 API：init status/init/login
│       └── protected-api-controller.js # 需登录 API：config/groups/import/export/logout
├── services/
│   ├── auth.js                      # JWT 与 Cookie
│   ├── config.js                    # 全局配置加载 + deepMerge
│   ├── kv.js                        # KV 访问与 groups:index 维护
│   ├── logger.js                    # 结构化日志 + 通知触发
│   ├── subconverter.js              # 订阅抓取、识别、转换与回退
│   ├── telegram.js                  # Telegram 消息发送
│   └── admin/
│       ├── credential-service.js    # 密码哈希/校验/迁移
│       ├── session-service.js       # JWT secret 管理
│       └── import-export-service.js # 后台导入导出规范化与回滚
├── repositories/
│   └── admin/
│       ├── config-repository.js
│       ├── group-repository.js
│       ├── init-lock-repository.js
│       └── login-attempt-repository.js

test/
├── admin-api-flow.test.js
├── admin-auth.test.js
├── subconverter.test.js
├── subscription-regression.test.js
└── utils.test.js

wrangler.toml.example                # Wrangler 模板
package.json
README.md
```

---

## 运行环境

- Node.js 18+（建议与 CI 对齐使用 Node.js 22）
- Cloudflare 账号
- Wrangler CLI（项目使用 v4）
- 一个 Workers KV 命名空间

---

## 快速开始（手动部署）

### 1) 安装依赖

```bash
npm ci
```

### 2) 创建 KV 命名空间

```bash
wrangler kv namespace create "KV"
```

### 3) 配置 `wrangler.toml`

复制 [`wrangler.toml.example`](wrangler.toml.example) 为 `wrangler.toml`，并替换占位符：

- `__WORKER_NAME__`：Worker 名称
- `__KV_NAMESPACE_ID__`：KV 命名空间 ID
- `__DEBUG_SECRET__`：调试日志密钥
- `__INIT_SECRET__`：后台初始化密钥（仅初始化管理员密码时使用）

说明：

- 已启用 `[assets]` 并绑定 `ASSETS`
- `run_worker_first = true`，确保先经过 Worker 统一鉴权与安全响应头

### 4) 部署

```bash
npm run deploy
```

`npm run deploy` 的执行顺序是：

1. `npm run check`
2. `npm run build`（`wrangler deploy --dry-run`）
3. `wrangler deploy`

---

## 本地开发与检查

### 本地开发

```bash
npm run dev
```

默认访问：`http://localhost:8787`

### 常用质量命令

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | ESLint 检查 |
| `npm test` | Node 内置测试 |
| `npm run check` | 串行执行 lint + test |
| `npm run build` | Cloudflare deploy dry-run 校验 |

注意：`npm run build` 依赖本地存在 `wrangler.toml`，否则会失败。

### 单测细粒度运行

```bash
node --test test/admin-auth.test.js
node --test test/admin-auth.test.js --test-name-pattern "<case-name>"
```

---

## CI 说明（当前仓库行为）

工作流 [`.github/workflows/generate-test.yml`](.github/workflows/generate-test.yml) 当前做的是：

1. `npx eslint . --max-warnings 0`
2. `npm test`
3. 基于 [`wrangler.toml.example`](wrangler.toml.example) 生成临时 `wrangler.toml`
4. 执行 `npm run build` 做 deploy dry-run 校验

> 当前 CI **不是自动正式部署**，而是“可部署性检查”。

---

## 管理后台流程（初始化 / 登录）

### 初始化阶段

- 未初始化时，仅开放：
  - `GET /admin/api/init/status`
  - `POST /admin/api/init`
  - `POST /admin/api/login`
- 访问 `/admin` 会引导到初始化页 `public/admin/init.html`
- `POST /admin/api/init` 需要提供 `INIT_SECRET`（Header `X-Init-Secret` 或 JSON 字段）
- 初始化成功后：
  - 生成并保存密码哈希（PBKDF2）
  - 生成 JWT secret
  - 下发登录 Cookie

### 登录与会话

- 登录 API：`POST /admin/api/login`
- 登录成功后通过 HttpOnly Cookie 维护会话
- 已登录访问后台时会自动续签 JWT
- 未登录访问受保护 API 返回 401，页面访问将跳转到登录页

参考实现：

- 入口控制：[`src/handlers/admin/entry-controller.js`](src/handlers/admin/entry-controller.js)
- 公共 API：[`src/handlers/admin/public-controller.js`](src/handlers/admin/public-controller.js)
- 受保护 API：[`src/handlers/admin/protected-api-controller.js`](src/handlers/admin/protected-api-controller.js)

---

## 订阅处理与转换逻辑

订阅主入口：[`src/handlers/subscription.js`](src/handlers/subscription.js)

### 输出格式选择

支持以下参数（存在即生效）：

- `?clash`
- `?sb` 或 `?singbox`
- `?surge`
- `?quanx`
- `?loon`
- `?b64` 或 `?base64`

若都未命中，默认输出 base64。

### 转换链路

[`src/services/subconverter.js`](src/services/subconverter.js) 的核心流程：

1. 拆分来源：内联节点 + 远程订阅 URL
2. 并发抓取远程订阅（总超时 4 秒）
3. 禁止抓取与当前请求同域 URL（递归保护）
4. 识别 YAML/JSON 配置、Base64、原生节点并归并
5. 应用过滤规则并去重
6. 目标为非 base64 时，将 `https://<host>/sub/<token>?format=base64` 插入转换 URL 列表首位
7. 调用 subconverter 转换
8. 转换失败回退为 base64 原始节点

### 访问控制

- 每个订阅组可配置是否允许中国大陆访问

---

## 管理后台 API 一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/api/init/status` | 否 | 查询是否初始化 / INIT_SECRET 是否可用 |
| POST | `/admin/api/init` | 否 | 执行首次初始化 |
| POST | `/admin/api/login` | 否 | 登录 |
| POST | `/admin/api/logout` | 是 | 登出 |
| GET | `/admin/api/config` | 是 | 获取配置（已脱敏） |
| PUT | `/admin/api/config` | 是 | 更新配置（支持改密） |
| GET | `/admin/api/groups` | 是 | 获取订阅组列表 |
| POST | `/admin/api/groups` | 是 | 创建订阅组 |
| PUT | `/admin/api/groups/:token` | 是 | 更新订阅组 |
| DELETE | `/admin/api/groups/:token` | 是 | 删除订阅组 |
| GET | `/admin/api/utils/gentoken` | 是 | 生成随机 token |
| GET | `/admin/api/export` | 是 | 导出配置+订阅组 |
| POST | `/admin/api/import` | 是 | 导入配置+订阅组（失败回滚） |

---

## KV 数据键说明

| 键 | 说明 |
| --- | --- |
| `config:global` | 全局配置 |
| `groups:index` | 订阅组 token 索引 |
| `group:<token>` | 订阅组详情 |
| `failedAttempts::<ip>` | 登录失败计数 |
| `banned::<ip>` | 登录封禁状态 |
| `admin:init:lock` | 初始化互斥锁 |

---

## 关键配置项（全局）

来自 [`src/services/config.js`](src/services/config.js) 默认配置：

- `fileName`：转换产物下载文件名
- `subUpdateTime`：`Profile-Update-Interval`
- `subscriptionInfo.totalTB / expireDate`：`Subscription-Userinfo`
- `telegram.enabled / botToken / chatId`
- `subconverter.url / protocol / configUrl`
- `failedBan.enabled / maxAttempts / banDuration / failedAttemptsTtl`

---

## 开发注意事项（避免踩坑）

- 任意 KV 读写前必须先初始化配置：`ConfigService.init(env, ctx)`
- 更新全局配置必须做深合并：`deepMerge({}, oldConfig, patch)`，不能整对象覆盖
- 订阅组请走 `KVService.saveGroup/deleteGroup`，不要直接改 `group:<token>`
- 常规响应、JSON、静态资源建议使用统一响应封装（带安全头）
- `public/**/*.js` 是 script 语义；`src/**/*.js` 是 ESM + Worker 运行时语义

---

## 技术栈

- Cloudflare Workers
- Cloudflare Worker Assets
- Cloudflare KV
- itty-router
- Node.js 内置测试框架（`node:test`）
- GitHub Actions（质量检查 + dry-run 校验）

---

## 许可证

MIT，见 [`LICENSE`](LICENSE)。

---

## 致谢

- [CF-Workers-SUB](https://github.com/cmliu/CF-Workers-SUB) by [cmliu](https://github.com/cmliu)
