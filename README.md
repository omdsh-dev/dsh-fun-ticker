# dsh-fun-ticker

DSH（DeepSeek Harness）行情跑马灯插件：会话底部一条常驻横向跑马灯，加密 / 汇率 / A股 / 指数 / 港美股任意组合，用户自主增删标的；点击条目查看明细（含迷你 sparkline）。全部数据免费免 key，客户端不直连上游 —— 宿主侧代理 + 缓存。

> 本仓库为 DSH monorepo 中 `packages/fun/ticker` 的单包快照。源码与该目录内容一致，可直接放回 monorepo 的 `packages/fun/ticker/` 目录构建。

## 结构

- `src/index.ts` — 宿主入口：注册 `dsh-ticker` 设置命名空间与 `/plugins/dsh-ticker/api` 前缀路由。
- `src/proxy.ts` — 按 symbol 内存缓存、按类别批量刷新、sparkline 滚动窗口、HTTP 路由（`/quotes`、`/settings`、`/suggest`）。
- `src/sources.ts` — 四类上游的抓取与归一化（Binance/CoinGecko、Frankfurter、eastmoney ulist、Sina GBK）。
- `src/contract.ts` / `src/settings.ts` — 双端共享的 symbol 语法、设置类型与 schemastery schema。
- `src/client/*` — 浏览器端：跑马灯条、管理/明细弹层、设置页区块。

## 上游（免 key，仅四个域，客户端不可指定 URL）

| 类别 | 上游 | 说明 |
|---|---|---|
| 加密 | `data-api.binance.vision`（CoinGecko 兜底） | 24hr 批量 + 1m kline 播种 sparkline；未知交易对仅标该格 not-found |
| 汇率 | `api.frankfurter.dev` | ECB 汇率；timeseries 一次请求取现值/昨值/60 日播种 |
| A股/指数 | `push2.eastmoney.com` / `push2his.eastmoney.com` | ulist 一次请求带全部标的（×100 缩放修正），kline 播种 sparkline |
| 港美股 | `hq.sinajs.cn` | GBK 转码解析 |

## Symbol 语法

| 类别 | 示例 | 规则 |
|---|---|---|
| 加密 | `BTCUSDT` | 4–12 位大写字母数字对 |
| 汇率 | `USD/CNY` | `XXX/YYY` 三字母币种对 |
| A股 | `600519` | 6 位数字（6/9 开头→沪，其余→深） |
| 指数 | `SH000001` / `SZ399001` / `SZ399006` | 上证/深证成指/创业板指 |
| 港股 | `hk00700` | `hk` + 4–5 位代码 |
| 美股 | `gb_aapl` | `gb_` + 代码 |

## 设置

命名空间 `dsh-ticker`：`symbols`（预置 BTCUSDT / ETHUSDT / 上证指数 / USD/CNY）、`colorScheme`（红涨绿跌 / 绿涨红跌）、`speed`（慢/中/快）、`refreshInterval`（10s/30s/1min）、`sparklinePoints`（10–120）、`showDetailButton`。

## 构建与挂载（DSH monorepo 内）

1. 把本仓库内容放到 monorepo 的 `packages/fun/ticker/`（workspace glob `packages/*/*` 已覆盖），`pnpm install`。
2. 构建：`tsc -b packages/fun/ticker/tsconfig.json && pnpm --filter @deepseek-ai/dsh-fun-ticker bundle`。
3. 在 tsconfig.client.json 的 references 中加 `{ "path": "./packages/fun/ticker" }`。
4. 在 `packages/host/apiproxy/src/api-proxy.ts` 的 `WEB_SETTINGS_NAMESPACES` 中加入 `'dsh-ticker'`（供 RPC 设置通道暴露；插件自身的代理路由不依赖此项）。
5. 组合挂载（web 组合的 cordis 补丁层，如 `$DSH_HOME/profiles/web/cordis.patch.yml`）：

```yaml
- insert:
    - id: fun-ticker
      name: '@deepseek-ai/dsh-fun-ticker'
```

6. 若组合目录不在 monorepo 内，确保包可解析（如 `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-fun-ticker` 指向包目录）。
7. 刷新浏览器页面；客户端 bundle 由 `/plugins/@deepseek-ai/dsh-fun-ticker/client.js` 提供（no-cache，重建后刷新即生效）。

## 说明

- 设置读写走插件自己的 `/plugins/dsh-ticker/api/settings` 路由（宿主 settings 文档持久化），不依赖 apiproxy 的 RPC 暴露。
- 限流与缓存：宿主侧 `Map<symbol, {data, ts}>`，刷新间隔内只打一次上游；sparkline 每刷新间隔 append 一点并按设置裁点。
- 断流整条变灰 + 末格「更新于 HH:MM」；单源失败只灰对应格。
- `prefers-reduced-motion` 时跑马灯退化为静态列表。

## Model Experience

The ticker is a read-only surface: every user-editable fact (symbol list order,
palette, speed, cadence, sparkline window) persists through the plugin's own
proxy route into the durable settings document, and the poller honors edits on
its next tick without a reload.
