# 文档 6 · 接口设计

> 本文档定义后端服务（Render/Railway）暴露的 AI 能力接口。练习记录、设置、登录由前端经 Supabase SDK 直连访问，不走本组接口（见[文档 5](05-DATABASE.md)）。
> Stage 4 新增的个人句子读写也由前端经 Supabase 登录态完成；本轮产品决策不新增后端 AI 接口，也不修改下述请求/响应字段。S4-1 云端物理结构见[文档 5](05-DATABASE.md)，已在隔离测试项目验证，尚未迁移到 Production。

## 6.1 通用约定

| 项 | 约定 |
|---|---|
| 协议 | HTTPS + RESTful JSON（`/api/tts` 返回音频流例外） |
| Base URL | 后端服务域名，如 `https://<service>.onrender.com` |
| 鉴权 | 三个 AI 接口均要求 Supabase Auth 登录态；前端传 `Authorization: Bearer <access_token>`，API 使用 Supabase Auth `GET /auth/v1/user` 校验令牌并取用户 ID。不使用 service-role key，不读取用户数据库表 |
| 来源限制 | CORS 白名单约束浏览器跨域读取；鉴权仍独立保护直连请求，CORS 不是鉴权手段 |
| 请求体限制 | `audio` ≤ 10MB，解码后录音时长 1–30 秒 |
| 超时 | explain 15s / assess 30s / tts 15s |
| 限流 | 单 API 进程内按已验证用户执行接口额度，并按 IP 做宽松短时保护；TTS 另有进程级总额度，评分另有进程级单并发管道（从转码前到 Azure 响应完成）。进程重启会清空计数；多实例不共享计数，分享前部署需保持单实例或另行批准共享配额方案 |
| 额度记账 | 先完成请求格式、参数与录音校验，再在每次即将发起的付费上游请求前记账；无效请求、额度拒绝及评分并发忙碌不扣用户额度。已发起但失败/超时的上游请求仍计入；讲解内部重试每次上游尝试分别计数 |
| 错误格式 | 统一返回 `{ "error": { "code": "...", "message": "..." } }` |

## 6.2 POST /api/explain — 语法讲解 + 语调标注

**基础信息**

| 项 | 说明 |
|---|---|
| 方法 | POST |
| 业务用途 | 对一句西语生成结构化语法讲解与语调标注 |
| 调用权限 | 已登录用户 |
| 请求协议 | HTTPS + JSON |
| 调用约束 | 超时 15s；`sentence` ≤ 200 字符；每用户 5 次/滚动 10 分钟、20 次/滚动 24 小时；每次 DeepSeek 上游尝试分别计数，内部质量重试会消耗额外额度 |

**请求参数**

| 参数名 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `sentence` | string | 是 | 西语句子（1–30 词） |
| `lang` | string | 否 | 方言：`es-ES`（默认）/ `es-MX` |

**返回数据（同步返回）**

| 字段 | 类型 | 含义 |
|---|---|---|
| `translation` | string | 中文翻译 |
| `tenseMood` | string | 时态·语态（无动词句为「不适用」） |
| `verbs` | array | 动词变位列表（无动词句为 `[]`） |
| `verbs[].form` | string | 变位形式 |
| `verbs[].infinitive` | string | 原形 |
| `verbs[].person` | string | 人称 |
| `verbs[].notes` | string | 说明 |
| `structure` | string | 语序结构 |
| `annotation` | object | 语调标注 |
| `annotation.stress` | array | 重音音节 |
| `annotation.liaison` | array | 连读点 |
| `annotation.pauses` | array | 停顿点 |
| `annotation.pitchPattern` | string | 升降调描述 |
| `memoryTip` | string | 记忆要点 |
| `compare` | string | 中英对比 |

> 返回方式：v1 同步非流式（输出短）；后续可升级流式以降低首字延迟。
> 字段分级与确定性校验：`translation`、`structure` 必须为非空字符串；`verbs` 必须为数组，非空时每项的 `form`、`infinitive`、`person`、`notes` 必须为非空字符串；`tenseMood` 必须为非空字符串。真正无动词的句子（如 `¡Hola!`）允许 `verbs: []`、`tenseMood: "不适用"`。以下可确定的矛盾视为无效结果：① `verbs` 为空但 `tenseMood` 不是「不适用」，或 `verbs` 非空却为「不适用」；② `verbs` 为空但 `structure` 明确将句子成分标为「动词」「系动词」「助动词」「谓语动词」或「系词」；③ `verbs` 为空但原句命中下述有界高置信词形规则。关键字段缺失、类型错误或上述矛盾均由服务端重试一次，第二次仍无效则返回 `EMPTY_UPSTREAM`。非关键字段（`annotation`/`memoryTip`/`compare`）缺失或异常不导致整页报错：讲解页对 `memoryTip`/`compare` 显示缺失提示；有效 `annotation` 由跟读页使用，不凭空生成缺失或无效标注。
>
> 当前高置信词形规则仅匹配完整词（忽略大小写与 Unicode 组合写法）：`soy`、`eres`、`es`、`somos`、`sois`；`estoy`、`estás`、`está`、`estamos`、`estáis`、`están`；`hay`。歧义较高的形式只在紧邻、以空白分隔的明确人称线索下判定：`ellos/ellas/ustedes son`、`vos sos`、`yo he`、`tú has`、`él/ella/usted ha`、`nosotros/nosotras hemos`、`vosotros/vosotras habéis`、`ellos/ellas/ustedes han`。这是一组有限的确定性校验规则，不按新发现的动词逐例扩充，也不根据一般词尾推断词性。
>
> 服务端不保证独立识别任意自由输入句的所有动词，也不保证翻译、语序和动词分析的全部语言学正确性。若 DeepSeek 的结构合法、字段彼此一致，且未命中上述确定性矛盾，内容仍可能在语言学上错误而返回 200；这属于 AI 教学内容质量风险，不表示错误讲解是预期的产品结果。

**错误情况**

| 错误码 | 含义 | 处理 |
|---|---|---|
| `EMPTY_SENTENCE` | 句子为空 | 前端置灰防提交 |
| `NOT_SPANISH` | 疑似非西语 | 提示确认 |
| `UPSTREAM_ERROR` | DeepSeek 调用失败 | 提示重试 |
| `EMPTY_UPSTREAM` | 关键字段缺失、类型错误或确定性矛盾（重试一次后仍无效） | 提示稍后重试 |
| `UNAUTHORIZED` | 缺少、失效或无法验证 Supabase 登录令牌 | 重新登录后重试 |
| `RATE_LIMITED` | 当前用户达到讲解额度 | 显示等待时间，不自动重试 |

## 6.3 POST /api/assess — 口语评估

**基础信息**

| 项 | 说明 |
|---|---|
| 方法 | POST |
| 业务用途 | 上传录音，返回发音三维评分与逐词反馈 |
| 调用权限 | 已登录用户 |
| 请求协议 | HTTPS + multipart/form-data |
| 调用约束 | `audio` ≤ 10MB、解码后 1–30 秒；超时 30s；每用户 10 次/滚动 10 分钟、20 次/滚动 24 小时；全 API 进程最多 1 个进入转码及 Azure 评分阶段的请求；接收 webm/opus 与 mp4/aac，服务端 ffmpeg 统一转码后再评估 |

**请求参数**

| 参数名 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `audio` | file（webm/opus 或 mp4/aac） | 是 | 浏览器录音原格式（客户端探测后上传实际 MIME），后端转码 |
| `sentence` | string | 是 | 参考文本（评估对照） |
| `lang` | string | 否 | 方言：`es-ES`（默认）/ `es-MX` |

**返回数据（同步返回）**

| 字段 | 类型 | 含义 |
|---|---|---|
| `overall` | number | 总分 0–100 |
| `accuracy` | number | 准确度 |
| `fluency` | number | 流利度 |
| `completeness` | number | 完整度 |
| `speakingRate.wpm` | number | 语速（词/分） |
| `speakingRate.referenceWpm` | number | 母语基准 |
| `speakingRate.verdict` | string | 偏慢 / 适中 / 偏快 |
| `words` | array | 逐词反馈 |
| `words[].word` | string | 词 |
| `words[].accuracy` | number | 该词准确度 |
| `words[].errorType` | string | 错误类型 |
| `words[].feedback` | string | 该词提示 |
| `suggestions` | string[] | 提升建议 |

> 返回方式：同步返回（Azure 评估完成后一次性返回 JSON）。

**错误情况**

| 错误码 | 含义 | 处理 |
|---|---|---|
| `AUDIO_TOO_SHORT` | 录音 < 1s | 前端前置校验，不发起请求 |
| `INVALID_AUDIO` | 音频为空/转码失败 | 提示重录 |
| `UPSTREAM_ERROR` | Azure 调用失败 | 提示重试 |
| `UNAUTHORIZED` | 缺少、失效或无法验证 Supabase 登录令牌 | 重新登录后重试 |
| `RATE_LIMITED` | 当前用户达到评分额度 | 保留录音，用户可等待后手动重试 |
| `SERVICE_BUSY` | 当前已有评分请求处理中 | 保留录音，提示稍后手动重试 |
| `RECORDING_TOO_LONG` | 解码后录音超过 30 秒 | 明确提示重录或检查录音，不静默评分 |

## 6.4 POST /api/tts — 语音合成

**基础信息**

| 项 | 说明 |
|---|---|
| 方法 | POST |
| 业务用途 | 生成西语整句或选中原句单词的示范音频，以及用户主动开始听熟后的逐句音频 |
| 调用权限 | 已登录用户 |
| 请求协议 | HTTPS + JSON → 返回音频流 |
| 调用约束 | 超时 15s；`sentence` ≤ 200 字符；每用户 8 次/滚动分钟、60 次/滚动 24 小时，应用进程整体 15 次/分钟 |

**请求参数**

| 参数名 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `sentence` | string | 是 | 要朗读的西语整句或选中单词；沿用既有字段名与长度校验 |
| `lang` | string | 否 | 方言：`es-ES`（默认，音色 ElviraNeural）/ `es-MX` |
| `rate` | number | 否 | 语速 0.6–1.2（默认 1.0） |

> 注：v1 不提供 `voice` 参数，音色由 `lang` 决定；多音色选择列入 V2（见[文档 8](08-ROADMAP.md)）。

**返回数据（流式返回）**

- 返回 `audio/mpeg` 音频流，前端按需播放整句或选中词；听熟由用户点击开始后逐句请求。同一页面会话中重复播放已取得的相同音频不再次调用 Azure；首次请求的 `lang`、`rate`、文本组合不同则视为新合成。`lang` 与用户当前方言设置一致。本阶段不通过该接口合成中文翻译。

**错误情况**

| 错误码 | 含义 | 处理 |
|---|---|---|
| `EMPTY_SENTENCE` | 句子为空 | 前端置灰 |
| `UPSTREAM_ERROR` | Azure TTS 失败 | 提示重试 |
| `UNAUTHORIZED` | 缺少、失效或无法验证 Supabase 登录令牌 | 重新登录后重试 |
| `RATE_LIMITED` | 用户或应用整体达到 TTS 额度 | 显示等待时间，不自动重试 |

## 6.5 通用错误码总表

| 错误码 | 含义 | 前端处理 |
|---|---|---|
| `UNAUTHORIZED` | 缺少、失效或无法验证 Supabase 令牌 | 重新登录 |
| `AUTH_UNAVAILABLE` | Supabase Auth 校验服务暂时不可达或 API 鉴权配置缺失 | 稍后重试；服务端失败关闭，不放行 AI 请求 |
| `RATE_LIMITED` | 用户或应用额度已用尽 | 显示等待时间；不自动重试 |
| `SERVICE_BUSY` | Azure 评分并发槽已占用 | 保留录音，稍后手动重试 |
| `INVALID_PARAM` | 参数缺失/类型错误 | 提示 |
| `EMPTY_SENTENCE` | 句子为空 | 置灰/提示 |
| `NOT_SPANISH` | 疑似非西语 | 提示确认 |
| `AUDIO_TOO_SHORT` | 录音过短 | 提示重录 |
| `INVALID_AUDIO` | 音频无效/转码失败 | 提示重录 |
| `UPSTREAM_ERROR` | DeepSeek/Azure 调用失败 | 提示重试 |

---

