# ASK Contracts（Host ↔ Guest 事件契约）

> 目标：用一份**可版本化**的契约（contracts），把 Host↔Guest 的交互事件收敛为“可检查、可生成类型、可演进”的 API。

本目录是 **唯一事实来源（source of truth）**：
- 事件名
- 事件方向（Host→Guest / Guest→Host）
- payload 字段与类型
- 版本号

生成产物（TypeScript 类型）位于：
- `askit/src/contracts/generated.ts`

生成脚本：
- `askit/scripts/generate-contracts.ts`


## 请求-响应配对（`response` 声明）

`guestToHost` 事件可声明 `"response"` 字段，指向 `hostToGuest` 中该请求的响应事件：

```json
"GET_APP_INFO": {
  "summary": "Guest 请求当前应用信息",
  "response": "SEND_APP_INFO",
  "payload": {}
}
```

声明后由生成脚本产出 `EVENT_PAIRS`（运行时常量）与 `EventPairs`（类型）：
- guest 侧 `ask.call('GET_APP_INFO')` 查表确定响应事件，**调用方无需也不能再声明配对**
- host 侧 `EventHandler` 分发时查表确定 `responseEvent`，宿主 registry 只写业务函数
- 配对只存在于契约一处；生成期校验 `response` 指向的事件必须存在于 `hostToGuest`，写错直接报错

事件的三类通信语义与 guest API 的对应：

| 契约形态 | 语义 | guest API |
| --- | --- | --- |
| `guestToHost` + `response` | 请求-响应（RPC） | `ask.call(request, payload)` |
| `guestToHost` 无 `response` | 单向通知宿主 | `ask.send(event, payload)` |
| `hostToGuest` | 宿主推送 | `ask.on(event, listener)` |

## 生成与校验

```bash
bun run generate:contracts   # specs/contracts/ask.contracts.v1.json → src/contracts/generated.ts
```

- `// ---` 开头的 key 是**分组注释**，过滤后不进入生成的事件名与类型
- payload 运行时校验（`HOST_TO_GUEST_PAYLOAD_SCHEMA` / `GUEST_TO_HOST_PAYLOAD_SCHEMA`）随契约一并生成，供宿主入口与 DevTools 使用
- `requestId` 是**协议管道字段**，不写在契约 payload 中：生成器对配对事件统一注入到完整载荷类型与运行时 schema（`GuestToHostEventPayloads` / `HostToGuestEventPayloads` 仍含它，线上协议不变），同时导出业务载荷类型（`GuestToHostBusinessPayloads` / `HostToGuestBusinessPayloads`）——`ask.call` 的入参/返回、host handler 的入参/返回都用业务类型，两端业务代码与类型提示均不出现 requestId
- guest 侧 `requestId` 由 `ask.call` 自动生成；host 侧由 `EventHandler` 分发时自动回传
