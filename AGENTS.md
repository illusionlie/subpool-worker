# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 非显而易见命令/流程
- `npm run build` 会先执行 `npm ci`，再执行 `wrangler deploy --dry-run --outdir=dist`（CI 的 dry-run 也是走此脚本）。
- `npm run deploy` 依赖 `npm run build` 后再 `wrangler deploy`（需要先生成 `wrangler.toml`）。
- GitHub Actions 会用 `wrangler.toml.example` 生成 `wrangler.toml`（替换 `WORKER_NAME`/`CF_KV_NAMESPACE_ID`/`JWT_SECRET`/`DEBUG_SECRET`/`INIT_SECRET`，可选 `CUSTOM_DOMAIN`）。
- 未配置任何测试/lint 脚本；CI 的 `generate-test` 实际是 dry-run deploy。

## 关键约定/流程（代码中发现）
- 每次请求都会在路由层调用 `ConfigService.init(env)`，并用 `deepMerge` 将 KV 配置叠加到默认配置（不能直接覆盖整对象）。
- KV 绑定名称固定为 `KV`，`ConfigService.getKV()` 在未绑定时会抛错。
- 订阅组索引必须通过 `KVService.saveGroup/deleteGroup` 维护 `groups:index`，避免直接写 `group:<token>` 破坏索引。
- 管理后台保存全局配置时必须 `deepMerge` 旧配置，避免丢失前端未暴露字段。
- Subconverter 生成流程会把自身 `https://<host>/sub/<token>?format=base64` 插到转换 URL 列表首位；若转换失败回退为 Base64 原始节点。
- Subconverter 远程抓取禁止递归同域；抓取有 4 秒超时。

## 代码风格/错误处理约定
- 统一使用 `response.normal/response.json` 生成响应以带齐 CSP/安全头（除订阅内容直接返回 `new Response`）。
- 记录异常优先用 `logger.error(err, { customMessage })` 以序列化堆栈；`{ notify: true }` 会触发 Telegram 通知。
- 调试日志可通过请求头 `X-Debug-Log` 与 `DEBUG_SECRET` 匹配来临时覆盖日志级别。