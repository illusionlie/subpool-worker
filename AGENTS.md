# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 非显而易见命令/流程
- `npm run build` 仅执行 `wrangler deploy --dry-run`；若缺少 `wrangler.toml` 会失败。CI 会先用 `wrangler.toml.example` 生成它（见 `.github/workflows/generate-test.yml`）。
- `npm run deploy` 会先 `npm run check`（lint + node --test），再 dry-run，最后正式 deploy。
- CI 的 lint 比本地脚本更严格：`npx eslint . --max-warnings 0`（warning 也会失败）。
- 运行单个测试文件：`node --test test/admin-auth.test.js`；运行单个用例可加 `--test-name-pattern "<name>"`。

## 关键约定（必须遵守）
- 任何读写 KV 前必须先执行 `ConfigService.init(env, ctx)`；`KVService` 依赖 `ConfigService.getKV()`，未初始化会直接抛错。
- 更新全局配置必须 `deepMerge({}, oldConfig, patch)`，不能整对象覆盖（否则会丢未暴露字段与凭据字段）。
- 订阅组只能通过 `KVService.saveGroup/deleteGroup` 维护；这两者会同步 `groups:index`，直接写 `group:<token>` 会破坏索引一致性。
- 普通/JSON/静态资源响应应使用 `response.normal/json/fromAsset` 统一安全头；订阅正文路径是少数允许直接 `new Response(content, { headers })` 的例外。
- 管理后台未初始化时，仅开放 `/admin/api/init*` 与 `/admin/api/login`；其余 `/admin` 路径会被回到 init 页或返回 403/500。
- 订阅转换会把 `https://<host>/sub/<token>?format=base64` 插到转换 URL 列表首位；subconverter 失败时回退为 base64 原始节点而非直接 5xx。
- 远程订阅抓取有 4 秒总超时，且禁止抓取与当前请求同域 URL（递归保护）。
- 临时调试日志靠请求头 `X-Debug-Log == DEBUG_SECRET`，可绕过 `LOG_LEVEL` 过滤。
- `logger.error(err, { customMessage })` 会序列化堆栈；`error/fatal` 与 `{ notify: true }` 都会触发 Telegram 通知。

## 代码风格（项目特有）
- `public/**/*.js` 按 script 语义运行（非 ESM）；`src/**/*.js` 按 module + worker globals 运行。
- 未使用变量/参数需使用 `_` 前缀命名（如 `_err`），否则 ESLint 直接报错。
- 认证相关白盒测试依赖 `__adminInternals` 导出；改动 `src/handlers/admin.js` 私有逻辑时要同步测试可见性。