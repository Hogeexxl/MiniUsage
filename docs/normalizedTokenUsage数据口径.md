# normalizedTokenUsage 数据口径

- 文档版本：v0.2
- 基线源码：`MiniUsage-69be2a4`（commit `69be2a4d5095679192fa7c1667a0a7e39ab7234e`）
- 基线审查文档：`MiniUsage_OpenAI_Token字段定义修正审查_v0.3.md`
- 适用范围：MiniUsage（MU）内部 Token canonical 数据模型、账本、聚合、Query API、Session usage；当前版本仅考虑 GPT-5.6+ 的独立 cache-write 计量语义

---

## 1. 目的

`NormalizedTokenUsage` 是 MU 在 Provider / Product-specific 原始数据之后使用的唯一标准 Token 数据模型。

当前数据链路固定为：

```text
OpenAI
  └─ Codex
      └─ rollout JSONL
          ↓ CodexRolloutParser
      Codex raw usage
          ↓ CodexRolloutAdapter / normalize
      NormalizedTokenUsage
          ↓
      SQLite / Aggregation / Query API / Frontend
```

设计原则：

1. Provider 原始字段名只存在于 Adapter 边界之前；
2. Adapter 之后只使用 MU canonical 字段；
3. `NormalizedTokenUsage` 只保存基础 Token 计数，不混入 Session 元数据或 Provider 数据质量状态；
4. `cache_hit_rate`、`estimated_cost` 等属于派生指标，在聚合/查询层计算；
5. Session 的 `inclusive_usage`、`self_usage`、`subagent_usage` 是同一套标准 Token 数据在不同统计范围下的结果，不另造 Token 字段体系；
6. 当前版本仅支持 GPT-5.6+ 口径：`cache_write_tokens` 只有“可确定（`Some(value)`）”和“无法确定（`None`）”两种状态，不兼容 GPT-5.6 之前没有独立 cache-write 计量的模型。

---

## 2. `NormalizedTokenUsage` 标准定义

建议 Rust 定义：

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

> 当前 MU / SQLite 均以 `i64` 作为 Token 整数类型，因此 canonical 层继续使用 `i64`，并通过校验保证值非负。

### 2.1 全部基础字段

| Normalized 字段名称 | 中文名 | 类型 | 字段定义 | 与其他字段的关系 | 是否新增（相对当前代码） | 当前代码对应字段 |
|---|---|---|---|---|---|---|
| `input_tokens` | 输入 Token | `i64` | 本次 usage 的全部输入 Token。包含缓存读取、缓存写入和普通未缓存输入。 | `input = cached + cache_write + uncached`（cache-write 已知时） | 否，保留 | `input_tokens` |
| `cached_tokens` | 缓存读取 Token | `i64` | `input_tokens` 中实际从 Prompt Cache 读取的 Token 数。 | `0 <= cached_tokens <= input_tokens` | **是，标准字段改名** | `cached_input_tokens` |
| `cache_write_tokens` | 缓存写入 Token | `Option<i64>` | `input_tokens` 中本次写入 Prompt Cache 的 Token 数。当前版本仅考虑 GPT-5.6+；原始数据可确定时记录实际值（包括 `0`），无法确定时为 `null`。 | 已知时：`cached + cache_write <= input` | **是，标准字段改名** | `cache_write_input_tokens` |
| `output_tokens` | 输出 Token | `i64` | 本次 usage 的全部模型输出 Token，包含 reasoning Token。 | `reasoning_tokens <= output_tokens` | 否，保留 | `output_tokens` |
| `reasoning_tokens` | 推理 Token | `i64` | `output_tokens` 中用于模型 reasoning 的 Token 子集。 | `0 <= reasoning_tokens <= output_tokens` | **是，标准字段改名** | `reasoning_output_tokens` |
| `total_tokens` | 总 Token | `i64` | 本次 usage 总 Token 数。MU canonical 值固定为输入与输出之和。 | `total_tokens = input_tokens + output_tokens` | 否；但 Domain 需统一语义 | Aggregation/API/DB 已有 `total_tokens`；`TokenVector` 当前为 `reported_total_tokens` |

### 2.2 基础字段包含关系

```text
total_tokens
├─ input_tokens
│  ├─ cached_tokens
│  ├─ cache_write_tokens
│  └─ uncached_input_tokens
└─ output_tokens
   ├─ reasoning_tokens
   └─ other_output_tokens
```

必须满足：

```text
total_tokens = input_tokens + output_tokens
```

当 `cache_write_tokens` 已知时：

```text
uncached_input_tokens
= input_tokens - cached_tokens - cache_write_tokens
```

缓存读取和缓存写入已经包含在 `input_tokens` 中，禁止再次加到 `total_tokens`。

---

## 3. MU 派生 Token 指标

以下字段由 `NormalizedTokenUsage` 计算，不属于 Provider 原始字段，也不应作为 Adapter 输入。

| 派生字段 | 中文名 | 类型 | 定义 / 公式 | 是否新增（相对当前代码） | 当前实现状态 |
|---|---|---|---|---|---|
| `uncached_input_tokens` | 未缓存输入 Token | `Option<i64>` | 当前版本仅面向 GPT-5.6+：`cache_write_tokens` 可确定时为 `input_tokens - cached_tokens - cache_write_tokens`；无法确定时为 `null` | **是** | 当前代码未暴露该字段 |
| `other_output_tokens` | 非推理输出 Token | `i64` | `output_tokens - reasoning_tokens` | **是（可即时派生）** | 当前代码未暴露；当前版本无必须上屏需求 |
| `cache_hit_rate` | 缓存命中率 | `Option<f64>` | Token-based：`cached_tokens / input_tokens`；`input_tokens == 0` 时为 `null` | 否，保留 | 当前 `TokenTotals.cache_hit_rate` 已实现，公式正确 |
| `estimated_cost` | 预估费用 | `Option<f64>` | 基于模型、各 Token 类别及价格表计算；不属于 Token 数量本身 | 否，保留 | 当前 DTO 已有，v1 固定为 `null` |

聚合多个 usage 时，`cache_hit_rate` 必须先累加 Token 再计算：

```text
cache_hit_rate
= Σ cached_tokens / Σ input_tokens
```

禁止对多个请求/事件自身的命中率做简单平均。

### 3.1 不进入 canonical 的旧字段

| 当前字段 | 处理 | 原因 |
|---|---|---|
| `cache_tokens` | **删除；不迁移、不保留、不进入任何新 canonical / derived schema** | 该字段属于旧 MU 数据定义错误。正确的缓存读取字段已经由 `cached_tokens` 表达；不得把 `cache_tokens` 迁移或改名为 `cached_tokens` |
| `cache_write_status` | **删除** | 当前版本只需要 `cache_write_tokens = Some(value)` 与 `None` 两态，`Option<i64>` 已足够表达可观测性，无需另设状态字段 |
| `reported_total_tokens` | 不作为 canonical 公共字段 | 仅可在 Codex raw/validation 边界临时保留，用于校验上游 `total_tokens`；校验通过后 canonical 只保留 `total_tokens` |

> 当前版本不保留任何 `cached_tokens + cache_write_tokens` 合计字段。旧 `cache_tokens` 直接废弃。

---

## 4. Session 内 Token 数据口径

Session 不定义第二套 Token 字段。一个 Session 需要保存/返回三个**统计范围（usage scope）**，每个 scope 都使用同一套 canonical Token 字段和派生指标。

建议逻辑结构：

```rust
pub struct SessionTokenUsage {
    pub inclusive_usage: TokenUsageView,
    pub self_usage: TokenUsageView,
    pub subagent_usage: TokenUsageView,
}

pub struct TokenUsageView {
    pub usage: NormalizedTokenUsage,
    pub uncached_input_tokens: Option<i64>,
    pub other_output_tokens: i64,
    pub cache_hit_rate: Option<f64>,
    pub estimated_cost: Option<f64>,
}
```

> `TokenUsageView` 是表达层示意名称；实现时可以继续采用扁平 DTO，但字段语义必须等价。

### 4.1 Session usage scope

| Session 字段 | 中文名 | 定义 | 是否新增（相对当前代码） | 当前代码位置/状态 |
|---|---|---|---|---|
| `inclusive_usage` | Session 总用量（含 Subagent） | 当前 root Session 自身 Thread + 所有 descendant/Subagent Thread 在范围内的 usage 聚合 | 否 | 后端 `SessionUsageDto.inclusive_usage` 已存在；Spec06-02 可见 Token 固定读取该字段 |
| `self_usage` | Session 自身用量 | 仅 `thread_id == root_session_id` 的 usage 聚合 | 否 | 后端 `SessionUsageDto.self_usage` 已存在；预留给后续 Session 详情 |
| `subagent_usage` | Subagent 用量 | `root_session_id` 相同且 `thread_id != root_session_id` 的全部 descendant usage 聚合 | 否 | 后端 `SessionUsageDto.subagent_usage` 已存在；预留给后续 Session 详情 |

Session Token 基础计数满足逐字段关系：

```text
inclusive_usage
= self_usage + subagent_usage
```

适用于：

```text
input_tokens
cached_tokens
output_tokens
reasoning_tokens
total_tokens
```

对于 `cache_write_tokens`：

- `self_usage.cache_write_tokens` 与 `subagent_usage.cache_write_tokens` 均已知时，可相加得到 inclusive；
- 任一侧 `cache_write_tokens` 无法确定为 `null` 时，inclusive 的 cache-write 也必须为 `null`，不得猜测为 0。

对于派生字段：

```text
inclusive.cache_hit_rate
= inclusive.cached_tokens / inclusive.input_tokens
```

禁止：

```text
inclusive.cache_hit_rate
= average(self.cache_hit_rate, subagent.cache_hit_rate)
```

### 4.2 Session 相关但不是 Token 字段的元数据

以下字段与 Session usage 展示有关，但不属于 `NormalizedTokenUsage`：

| 字段 | 中文名 | 说明 |
|---|---|---|
| `subagent_count` | Subagent 数量 | 当前范围内 root Session 下实际产生 usage 的非 root Thread 数量 |
| `models_used` | 使用模型 | 当前范围 Session 内 usage 事件对应的模型集合 |
| `last_activity_at_ms` | 最后活动时间 | Session 当前范围内最后 usage 活动时间 |
| `session_count` | Session 数量 | Summary / Model 聚合中的 Session 计数，不是 Token 数量 |

---

## 5. Turn / Ledger 内部 Token 状态也统一复用 `NormalizedTokenUsage`

当前 SQLite `turns` 表存在大量前缀展开字段：

```text
start_total_input_tokens
start_total_cached_input_tokens
...
last_total_input_tokens
last_total_cached_input_tokens
...
accounted_input_tokens
accounted_cached_input_tokens
...
```

这些不是新的 Token 种类，而是**同一 Token 向量在不同生命周期角色下的存储展开**。

建议在 Domain 层统一表达为：

| 角色字段 | 类型 | 定义 | 相对当前代码 |
|---|---|---|---|
| `start_total_usage` | `Option<NormalizedTokenUsage>` | Turn 开始边界对应的累计 total snapshot | 结构化重构；当前由 `start_total_*` 多列展开 |
| `last_total_usage` | `Option<NormalizedTokenUsage>` | Turn 内最后可信累计 total snapshot | 结构化重构；当前由 `last_total_*` 多列展开 |
| `accounted_usage` | `NormalizedTokenUsage` | Turn 已通过事件账本计入的 usage 合计 | 结构化重构；当前由 `accounted_*` 多列展开 |
| `previous_total_usage` | `Option<NormalizedTokenUsage>` | 处理当前 token_count 前的累计 baseline | 结构化重构；当前 `UsageEvent.previous_total: Option<TokenVector>` |
| `current_total_usage` | `NormalizedTokenUsage` | 当前 token_count 的累计 snapshot | 结构化重构；当前 `UsageEvent.current_total: TokenVector` |
| `event_usage` | `NormalizedTokenUsage` | 本次写入 usage ledger 的增量 usage | 结构化重构；当前 `UsageEvent.usage: TokenVector` |

SQLite 是否立即把多列物理 schema 改成复合结构不是本数据口径要求；即使 SQLite 继续扁平存列，列名也应逐步迁移到 canonical 命名，例如：

```text
start_total_cached_tokens
start_total_cache_write_tokens
start_total_reasoning_tokens
```

核心要求是：前缀只表示**角色**，后缀必须使用同一套 canonical Token 字段。

---

## 6. 当前字段迁移总表

| 当前 MU 字段 | 新 canonical 字段 | 中文名 | 处理方式 |
|---|---|---|---|
| `input_tokens` | `input_tokens` | 输入 Token | 保留 |
| `cached_input_tokens` | `cached_tokens` | 缓存读取 Token | 改名 |
| `cache_write_input_tokens` | `cache_write_tokens` | 缓存写入 Token | 改名；保留 nullable |
| `output_tokens` | `output_tokens` | 输出 Token | 保留 |
| `reasoning_output_tokens` | `reasoning_tokens` | 推理 Token | 改名 |
| `reported_total_tokens` | 不进入公共 canonical；验证后落为 `total_tokens` | 上游报告总 Token（内部校验） | 限定在 raw/validation 边界 |
| `total_tokens` | `total_tokens` | 总 Token | 保留，固定 `input + output` |
| `cache_hit_rate` | `cache_hit_rate` | 缓存命中率 | 保留为 derived |
| `cache_tokens` | 删除 | — | **旧代码定义错误；不迁移、不保留；不得映射为 `cached_tokens`** |
| `cache_write_status` | 删除 | — | `cache_write_tokens: Option<i64>` 已表达“可确定/无法确定”两态 |
| `estimated_cost` | `estimated_cost` | 预估费用 | 保留为 derived usage metric |

---

## 7. 验证规则

任何进入 MU canonical 层的 `NormalizedTokenUsage` 必须满足：

```text
input_tokens >= 0
cached_tokens >= 0
cache_write_tokens == null OR cache_write_tokens >= 0
output_tokens >= 0
reasoning_tokens >= 0
total_tokens >= 0

cached_tokens <= input_tokens
reasoning_tokens <= output_tokens
total_tokens == input_tokens + output_tokens

cache_write_tokens != null
    => cached_tokens + cache_write_tokens <= input_tokens
```

派生规则：

```text
cache_write_tokens != null
    => uncached_input_tokens
       = input_tokens - cached_tokens - cache_write_tokens

cache_write_tokens == null
    => uncached_input_tokens = null

# 当前版本不提供 GPT-5.6 之前模型的特殊分支；
# 不允许因 cache_write_tokens 缺失而退化为 input_tokens - cached_tokens。

input_tokens == 0
    => cache_hit_rate = null

input_tokens > 0
    => cache_hit_rate = cached_tokens / input_tokens
```

所有算术必须进行 overflow 检查。

---

## 8. 标准示例

### 8.1 单个 normalized usage

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

派生结果：

```json
{
  "uncached_input_tokens": 2000,
  "other_output_tokens": 1000,
  "cache_hit_rate": 0.6,
  "estimated_cost": null
}
```

### 8.2 Session usage

```json
{
  "inclusive_usage": {
    "input_tokens": 10000,
    "cached_tokens": 6000,
    "cache_write_tokens": 2000,
    "output_tokens": 1500,
    "reasoning_tokens": 500,
    "total_tokens": 11500,
    "cache_hit_rate": 0.6,
    "estimated_cost": null
  },
  "self_usage": {
    "input_tokens": 7000,
    "cached_tokens": 5000,
    "cache_write_tokens": 1000,
    "output_tokens": 1000,
    "reasoning_tokens": 300,
    "total_tokens": 8000,
    "cache_hit_rate": 0.7142857143,
    "estimated_cost": null
  },
  "subagent_usage": {
    "input_tokens": 3000,
    "cached_tokens": 1000,
    "cache_write_tokens": 1000,
    "output_tokens": 500,
    "reasoning_tokens": 200,
    "total_tokens": 3500,
    "cache_hit_rate": 0.3333333333,
    "estimated_cost": null
  }
}
```

这里：

```text
inclusive.input_tokens  = 7000 + 3000 = 10000
inclusive.output_tokens = 1000 + 500  = 1500
inclusive.total_tokens  = 8000 + 3500 = 11500
inclusive.cache_hit_rate = 6000 / 10000 = 0.6
```

---

## 9. 当前版本实施边界

当前版本只考虑 **GPT-5.6+** 的 Token usage 语义，并只需要完成：

```text
Codex rollout raw
→ adapters/openai/codex.rs
→ NormalizedTokenUsage
→ SQLite / aggregate / Query DTO / frontend canonical rename
```

当前版本不要求实现：

```text
ResponsesUsageAdapter
ChatCompletionsUsageAdapter
Anthropic Adapter
Gemini Adapter
```

这些仅作为后续扩展点。GPT-5.6 之前模型的“无独立 cache-write 计量”兼容逻辑也不属于当前版本。

---

## 10. 最终定稿

MU 标准基础 Token 字段固定为：

```text
input_tokens
cached_tokens
cache_write_tokens
output_tokens
reasoning_tokens
total_tokens
```

MU 当前需要保留/新增的派生 usage 字段为：

```text
uncached_input_tokens
other_output_tokens
cache_hit_rate
estimated_cost
```

Session 只增加统计范围，不增加 Token 种类：

```text
inclusive_usage
self_usage
subagent_usage
```

任何 Provider-specific 字段名都不得穿透 `CodexRolloutAdapter` 进入 MU canonical 层。
