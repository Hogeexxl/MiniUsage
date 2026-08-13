# Codex rollout 数据口径

- 文档版本：v0.1
- 基线源码：`MiniUsage-69be2a4`（commit `69be2a4d5095679192fa7c1667a0a7e39ab7234e`）
- 基线审查文档：`MiniUsage_OpenAI_Token字段定义修正审查_v0.3.md`
- 当前数据源：Codex 本地 rollout JSONL
- 当前 Adapter：`usage/adapters/openai/codex.rs`（待新增）

---

## 1. 目的与边界

本文件只定义 **Codex rollout 原始 Token usage schema → MU `NormalizedTokenUsage`** 的数据口径。

当前 MU 实际数据链路：

```text
~/.codex/sessions/**/rollout-*.jsonl
~/.codex/archived_sessions/**/rollout-*.jsonl
        ↓
CodexRolloutParser
        ↓
Codex raw token_count
        ↓
CodexRolloutAdapter
        ↓
NormalizedTokenUsage
```

本文件不把 Responses API 或 Chat Completions API 当作当前 MU 的实际数据入口。它们仅用于确认 OpenAI Token 语义；当前实现只需要 Codex rollout Adapter。

---

## 2. 当前源码识别的 token_count 原始结构

当前 `src/codex/usage.rs` 只在 rollout 的：

```text
type = "event_msg"
payload.type = "token_count"
```

中读取 Token usage。

典型结构：

```json
{
  "timestamp": "2026-08-09T00:00:00Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 10000,
        "cached_input_tokens": 6000,
        "cache_write_input_tokens": 2000,
        "output_tokens": 1500,
        "reasoning_output_tokens": 500,
        "total_tokens": 11500
      },
      "last_token_usage": {
        "input_tokens": 1000,
        "cached_input_tokens": 600,
        "cache_write_input_tokens": 200,
        "output_tokens": 150,
        "reasoning_output_tokens": 50,
        "total_tokens": 1150
      }
    }
  }
}
```

`payload.timestamp` 存在时优先作为 occurrence time；否则当前 parser 回退到外层 `timestamp`。

---

## 3. Snapshot 层级

Codex rollout 的 `token_count.info` 下存在两个不同角色的 Token snapshot。

| Codex rollout 原始字段 | MU Adapter 输出角色 | 定义 | 是否新增（相对当前代码） |
|---|---|---|---|
| `payload.info.total_token_usage` | `current_total_usage: NormalizedTokenUsage` | 当前 token_count 时点的累计 Token snapshot。当前处理器把它作为 required cumulative baseline，用于链式校验、delta 恢复和 Turn compensation | 否；当前已有 `TokenCountInfo.current_total` / `UsageEvent.current_total`，后续仅改为标准类型/命名 |
| `payload.info.last_token_usage` | `last_usage: Option<NormalizedTokenUsage>` | Codex 提供的最近一次 usage 增量 snapshot。存在且有效时可直接形成 Normal usage event；缺失时当前处理器可在有可信 previous total 时用 cumulative delta 恢复 | 否；当前已有 `TokenCountInfo.last_usage` |

这两个字段的**内部 Token 字段结构相同**，均按下一节映射到 `NormalizedTokenUsage`。

---

## 4. Codex 原始字段 → Normalized 字段映射

下表同时适用于：

```text
payload.info.total_token_usage.*
payload.info.last_token_usage.*
```

| Codex rollout 原始字段名称 | 对应 Normalized 字段名称 | Normalized 中文名 | Normalized 类型 | 是否新增（相对当前代码） | 处理规则 |
|---|---|---|---|---|---|
| `input_tokens` | `input_tokens` | 输入 Token | `i64` | 否 | 原值映射；必须为非负整数 |
| `cached_input_tokens` | `cached_tokens` | 缓存读取 Token | `i64` | **是，标准字段改名** | 仅字段名映射，数值不变 |
| `cache_write_input_tokens` | `cache_write_tokens` | 缓存写入 Token | `Option<i64>` | **是，标准字段改名** | 字段存在：映射非负整数；历史字段缺失：映射为 `null`，不得按模型名推断 0 |
| `output_tokens` | `output_tokens` | 输出 Token | `i64` | 否 | 原值映射；必须为非负整数 |
| `reasoning_output_tokens` | `reasoning_tokens` | 推理 Token | `i64` | **是，标准字段改名** | 仅字段名映射，数值不变；必须 `<= output_tokens` |
| `total_tokens` | `total_tokens` | 总 Token | `i64` | 否；但 Domain 语义需统一 | 原始值先用于校验 `total_tokens == input_tokens + output_tokens`；校验通过后写入 canonical `total_tokens` |

字段映射的本质是：

```text
Codex cached_input_tokens
        ↓ mapping
MU cached_tokens

Codex cache_write_input_tokens
        ↓ mapping
MU cache_write_tokens

Codex reasoning_output_tokens
        ↓ mapping
MU reasoning_tokens
```

---

## 5. Adapter 后的标准结果

上述 raw snapshot：

```json
{
  "input_tokens": 10000,
  "cached_input_tokens": 6000,
  "cache_write_input_tokens": 2000,
  "output_tokens": 1500,
  "reasoning_output_tokens": 500,
  "total_tokens": 11500
}
```

经过 `CodexRolloutAdapter` 后必须得到：

```json
{
  "input_tokens": 10000,
  "cached_tokens": 6000,
  "cache_write_tokens": 2000,
  "output_tokens": 1500,
  "reasoning_tokens": 500,
  "total_tokens": 11500
}
```

Adapter 不计算 Session scope，也不负责聚合 cache hit rate。

---

## 6. 缺失值与非法值规则

### 6.1 `payload.info`

当前源码允许：

```text
payload.info missing / null
```

此时该 `token_count` 不产生可用 Token snapshot。

### 6.2 `total_token_usage`

`total_token_usage` 在 `info` 存在时属于 required snapshot。

以下情况视为 required total invalid：

```text
total_token_usage 缺失
不是 object
required Token 字段缺失
required Token 字段不是整数
字段违反 NormalizedTokenUsage 不变量
```

不得把非法 snapshot 写入 canonical 账本。

### 6.3 `last_token_usage`

`last_token_usage` 是 optional snapshot：

```text
缺失       → Missing
存在且合法 → Valid(NormalizedTokenUsage)
存在但非法 → Invalid
```

缺失不等价于 0。

当前处理器在 `last_token_usage` 缺失且存在可信 previous cumulative total 时，可以通过：

```text
recovered_usage
= current_total_usage - previous_total_usage
```

恢复本次增量 usage。

### 6.4 `cache_write_input_tokens`

新口径固定为：

```text
raw field exists
    → cache_write_tokens = value

raw field missing
    → cache_write_tokens = null
```

禁止继续使用当前旧逻辑：

```text
missing + 某模型被认为“不支持”
    → cache_write_tokens = 0
```

也就是说，`CacheWriteStatus::UnsupportedZero` 不应再参与新的 canonical 规则。

---

## 7. Adapter 校验规则

每一个 raw Token snapshot 在生成 `NormalizedTokenUsage` 前必须验证：

```text
input_tokens >= 0
cached_input_tokens >= 0
cache_write_input_tokens == missing OR >= 0
output_tokens >= 0
reasoning_output_tokens >= 0
total_tokens >= 0

cached_input_tokens <= input_tokens
reasoning_output_tokens <= output_tokens
total_tokens == input_tokens + output_tokens

cache_write_input_tokens exists
    => cached_input_tokens + cache_write_input_tokens <= input_tokens
```

映射后等价为：

```text
cached_tokens <= input_tokens
reasoning_tokens <= output_tokens
total_tokens == input_tokens + output_tokens

cache_write_tokens != null
    => cached_tokens + cache_write_tokens <= input_tokens
```

---

## 8. `cache_hit_rate` 不来自 rollout 原始字段

Codex rollout 当前没有：

```text
cache_hit_rate
```

MU 在聚合层根据 normalized Token 计算：

```text
cache_hit_rate
= cached_tokens / input_tokens
```

当 `input_tokens == 0`：

```text
cache_hit_rate = null
```

Session / Summary / Model 聚合也必须先累计 normalized Token，再计算该比例。

---

## 9. Session Token 信息不是 Codex rollout 的直接字段

以下 MU Session 字段：

```text
inclusive_usage
self_usage
subagent_usage
```

**都不是 Codex token_count 原始字段。**

它们是在 rollout 解析完成后，结合 MU 已解析的：

```text
thread_id
root_session_id
```

以及 usage ledger 聚合得到。

当前定义：

```text
self_usage
= root_session_id 相同
  且 thread_id == root_session_id 的 usage

subagent_usage
= root_session_id 相同
  且 thread_id != root_session_id 的 usage

inclusive_usage
= 同一 root_session_id 下全部 Thread usage
= self_usage + subagent_usage
```

因此 `CodexRolloutAdapter` 只负责**单个 raw Token snapshot → NormalizedTokenUsage**，不得在 Adapter 内计算 Session inclusive/self/subagent。

---

## 10. 当前代码需要调整的位置

### 10.1 `src/codex/usage.rs`

当前 `UsageRawAdapter` 同时承担：

```text
JSONL raw parse
+ Token 字段语义标准化
+ cache-write 状态推断
```

建议拆分职责：

```text
CodexRolloutParser
    ↓
CodexRawTokenUsage
    ↓
usage/adapters/openai/codex.rs
    ↓
NormalizedTokenUsage
```

Raw 结构应保留 Codex 原名，例如：

```rust
pub struct CodexRawTokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub cache_write_input_tokens: Option<i64>,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}
```

Adapter 输出：

```rust
pub struct NormalizedTokenUsage {
    pub input_tokens: i64,
    pub cached_tokens: i64,
    pub cache_write_tokens: Option<i64>,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
}
```

### 10.2 当前 `TokenVector`

当前：

```text
input_tokens
cached_input_tokens
cache_write_input_tokens
cache_write_status
output_tokens
reasoning_output_tokens
reported_total_tokens
```

调整后：

```text
NormalizedTokenUsage
input_tokens
cached_tokens
cache_write_tokens
output_tokens
reasoning_tokens
total_tokens
```

其中：

- `cache_write_status` 移出 Token canonical；
- `reported_total_tokens` 仅允许作为 Adapter 校验过程中的临时 raw 值，不进入公共 normalized schema。

---

## 11. 当前版本实施范围

当前版本只实现：

```text
usage/
├─ normalized.rs
├─ adapters/
│  ├─ mod.rs
│  └─ openai/
│     ├─ mod.rs
│     └─ codex.rs
└─ aggregate.rs
```

当前不创建/实现：

```text
responses.rs
chat_completions.rs
anthropic.rs
gemini.rs
```

后续若 MU 真正直接消费其他 raw schema，再按实际数据源增加对应 Adapter。

---

## 12. 最终映射定稿

```text
Codex rollout                         MU NormalizedTokenUsage
────────────────────────────────────────────────────────────
input_tokens                       → input_tokens
cached_input_tokens                → cached_tokens
cache_write_input_tokens           → cache_write_tokens
output_tokens                      → output_tokens
reasoning_output_tokens            → reasoning_tokens
total_tokens                       → total_tokens
```

Snapshot 角色：

```text
total_token_usage                  → current_total_usage
last_token_usage                   → last_usage
```

边界原则：

> Codex 原始字段名只存在于 `CodexRolloutParser` / `CodexRolloutAdapter` 边界内；一旦进入 MU Domain、SQLite canonical 账本、Aggregation、Query API 和 Frontend，统一使用 `NormalizedTokenUsage` 字段名称。
