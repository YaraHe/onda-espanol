# 文档 5 · 数据库设计

> 下列 SQL 如实记录 Stage 3 已部署结构；其后的 Stage 4 目标数据职责已获产品确认，但物理字段、约束及迁移脚本尚待技术设计。本轮不执行数据库变更。

## 5.1 选型与结论

- **结论**：沿用 **Supabase**（Postgres + Auth + 自动 API），按用户隔离存储个人句子、练习记录、设置与账号。
- **理由**：成功讲解的句子及练习记录需要跨设备找回；个人句子与评分历史有不同的清除语义，不能继续只用评分记录充当听熟内容来源。
- **账号**：Supabase Auth **邮箱登录**（邮箱 + 密码，或免密 magic link）。

## 5.2 数据职责划分

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 练习记录 | Supabase（云端） | 按用户隔离，登录后读写 |
| 个人句子集合 | Supabase（云端） | 成功讲解后按用户去重收录；跨设备找回；可移出，不级联删除评分历史 |
| 用户设置（方言与听熟播放偏好） | Supabase（云端） | 按用户隔离；自定义选择引用稳定的个人句子标识 |
| 用户资料（昵称） | Supabase（profiles） | 扩展 auth.users |
| 音频（示范/录音） | 不持久化 | 会话内 |
| 当前任务与待保存评分 | 当前标签页短期快照 | 仅为刷新恢复；不是云端已保存的凭据，不含录音 |

## 5.3 已部署表结构（Stage 3）与 Stage 4 目标

以下是 Stage 3 已部署结构的摘要，不是 Stage 4 新结构的建表命令。`user_settings` 播放偏好由 `202610060001_stage3_listening_preferences.sql` 引入；其中 `learned` 与旧句子引用属于待淘汰数据，不能再作为目标行为。

```sql
-- 用户资料（Supabase Auth 内置 auth.users，此处存昵称等扩展信息）
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id),
  nickname   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 练习记录（一次口语练习一条）
CREATE TABLE practice_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  sentence      TEXT NOT NULL,
  translation   TEXT,
  overall       REAL, accuracy REAL, fluency REAL, completeness REAL,
  speaking_rate REAL,
  raw_feedback  JSONB,          -- Azure 词级反馈明细
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 用户设置（每用户一行）
CREATE TABLE user_settings (
  user_id                    UUID PRIMARY KEY REFERENCES auth.users(id),
  lang                       TEXT DEFAULT 'es-ES',
  listening_scope            TEXT NOT NULL DEFAULT 'all' CHECK (listening_scope IN ('learned', 'all', 'custom')),
  listening_rate             REAL NOT NULL DEFAULT 1.0 CHECK (listening_rate BETWEEN 0.6::REAL AND 1.2::REAL),
  listening_interval_seconds SMALLINT NOT NULL DEFAULT 2 CHECK (listening_interval_seconds IN (1, 2, 4)),
  listening_show_text        BOOLEAN NOT NULL DEFAULT TRUE,
  listening_show_translation BOOLEAN NOT NULL DEFAULT FALSE,
  listening_custom_selection TEXT[] NOT NULL DEFAULT '{}',
  updated_at                 TIMESTAMPTZ DEFAULT now()
);
```

Stage 3 的初始迁移保留已有 `lang` 并补充播放偏好；`202610070001_fix_listening_rate_bounds.sql` 修正 `REAL` 的 1.2 边界。以上是历史事实，不代表未来仍从内置句库与评分记录构建播放候选。

**Stage 4 已确认的逻辑数据模型（物理设计待定）：**

- 个人句子是按用户归属的独立实体，至少能稳定识别一条句子、保留原文与可用译文，并支持跨设备读取、保守去重和轻量移出。自定义听熟选择只引用当前用户仍有效的个人句子稳定标识。字段名称、译文更新规则、唯一约束和移出实现方式留待技术设计。
- `practice_records` 继续作为一次评分一条的独立历史；其 `raw_feedback` 可用于最近可靠反馈和复练目标，不要求新增字段保存原始「提升方向」、完整讲解、原发音标注或录音。同一用户的个人句子去重、评分分组及移出后重新收录与旧评分的关联，必须遵循同一保守句子身份语义；不能仅以个人句子条目 ID 或原文精确字符串作同句依据。评分历史的存续和读取不依赖个人句子条目持续存在，移出不得级联删除历史。具体字段、唯一约束与关联查询方式留待技术设计。
- `user_settings` 的目标播放范围为「全部个人句子／自定义选择」：首次或已存范围值无效时用全部；有效已存自定义范围应恢复，即使部分句子已失效也只过滤失效项，全部失效则呈现自定义空态，不自动改成全部。旧 `learned` 值及内置句/练习记录引用在重置前必须安全降级：无效选择不计数、不播放，不自动导入预置句。现有测试账号的偏好可在用户按账号明确授权后重置，不建设复杂迁移机制。
- 不为现有测试账号自动把旧评分句补入个人集合。旧练习记录在未清理时仍可通过「记录」查看；对指定数据的清理另需用户授权，不删除账号或其他用户数据。

## 5.4 权限模型（RLS）

- 开启 Row Level Security：用户只能读写自己的个人句子、`practice_records` 和 `user_settings`；个人句子的稳定标识不可绕过用户隔离。
- 前端经 Supabase SDK + 登录态 token 直接读写个人句子、练习记录与设置；后端 AI 服务不读写 Supabase 中这些个人数据。后端 AI 接口仍按请求处理用户提交的西语句子和录音（见[文档 6](06-API.md)）。
- 前端使用 Supabase publishable key（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`）连接项目；用户数据仍由登录态和 RLS 隔离，不在前端使用 Supabase secret key。

## 5.5 数据生命周期

| 数据 | 写入时机 | 读取时机 | 生命周期 |
|---|---|---|---|
| 个人句子 | 成功获得讲解后；失败时可单独重试收录 | 选句找回、听熟；跟读任务的云端来源之一 | 长期，可移出；再次成功讲解可重新收录 |
| 练习记录 | 每次口语评分后 | 记录、最近练习、可靠复练反馈 | 长期，用户可清；清除不影响个人句子 |
| 用户设置 | 修改方言或听熟播放偏好后 | 各页读取方言；听熟页读取播放偏好 | 按用户长期保留；移出的句子不再进入有效播放选择 |
| 用户资料 | 注册时 | 展示昵称 | 长期 |

讲解成功但个人句子收录失败时保留讲解，提示未收录并只重试数据写入。评分结果尚待保存时可在当前标签页保留最小短期快照和固定记录 ID；恢复后先核对当前用户云端同 ID 记录及其评分内容，一致才确认已保存，确未保存才以同一 ID 重试。同 ID 内容冲突不得误判已保存或静默覆盖，具体防冲突机制留待技术设计。浏览器快照不作跨设备持久化或云端保存证明，录音始终不入库。

## 5.6 登录与访问流程

- 首次打开 → 引导登录/注册（邮箱）→ 进入选句页。
- 登录后所有云端读写自动带用户身份；未登录无法访问云端数据。
- v1 不做游客模式（避免数据归属混乱）。

## 5.7 与旧「无数据库」方案的关系

- 原以本地存储替代云端记录的方案弃用；个人句子、练习记录与设置以 Supabase 为持久化来源。当前标签页的短期恢复快照不取代云端数据。
- 「最近练习」由云端练习记录实时派生，不再依赖本地。

---

