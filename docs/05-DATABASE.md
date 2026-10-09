# 文档 5 · 数据库设计

> 下列 SQL 如实记录 Stage 3 已部署结构；Stage 4 的 S4-1 物理设计和隔离验证状态见下文。S4-1 迁移尚未在 Production 执行；短期恢复相关数据设计仍待后续技术设计。

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

**Stage 4 逻辑数据模型与 S4-1 隔离验证过的物理设计：**

- 个人句子使用独立的 `public.personal_sentences` 表：`id`（UUID）、`user_id`（归属 `auth.users`）、`sentence`（展示原文）、可空 `translation`、`identity_key` 和 `created_at`。唯一约束为 `(user_id, identity_key)`，因此同一用户去重、不同用户仍可各自收录同一句。个人句子不引用练习记录；删除个人句子不会级联删除评分。
- `identity_key` 由共享应用函数生成：去除首尾空白、Unicode NFC 规范化、将连续空白折叠为一个空格，再按西班牙语规则转小写。规则保留重音和标点，因此 `cafe`/`café`、`Hola.`/`Hola!` 等仍是不同身份。个人集合去重、听熟候选去重和历史评分分组共用此函数。
- 已存在的句子保留首次收录的展示原文；只有尚无有效译文时才补入非空译文，不以重复讲解覆盖已有译文。移出后再次收录会创建新的个人句子 ID，但沿用同一 `identity_key`，因此历史评分仍可按身份找回。
- `practice_records` 继续作为一次评分一条的独立历史；其 `raw_feedback` 可用于最近可靠反馈和复练目标，不保存原始「提升方向」、完整讲解、原发音标注或录音。记录详情按当前用户分页读取评分，再用共享身份函数分组；暂不向历史表回填身份键。迁移增加 `(user_id, created_at DESC, id DESC)` 查询索引。若未来个人记录量使全量分页分组变慢，再评估保存身份键及回填方案。
- `user_settings.listening_custom_selection` 继续使用 `TEXT[]`，新自定义听熟选择保存当前用户有效个人句子的 UUID 字符串。S4-1 不重写旧 `learned` 范围或旧句库/练习记录引用；消费方在 S4-2 按有效个人句子 ID 过滤，旧引用失效时不播放错误句子。现有测试账号的偏好重置仍需按账号单独授权。
- 不为现有测试账号自动把旧评分句补入个人集合。旧练习记录在未清理时仍可通过「记录」查看；对指定数据的清理另需用户授权，不删除账号或其他用户数据。

`202610090001_stage4_personal_sentences.sql` 已在 `espanol-stage4-test` 隔离项目执行并验证；Production 尚未执行该迁移。SQL Editor 的成功只证明 SQL 已在该测试数据库运行，不证明 Supabase CLI migration history 已登记。该隔离项目当前仍需在迁移工具接入后单独验证历史登记流程。

## 5.4 权限模型（RLS）

- 开启 Row Level Security：用户只能访问自己的个人句子、`practice_records` 和 `user_settings`；个人句子的稳定标识不可绕过用户隔离。个人句子和评分记录授予 authenticated 用户 CRUD；设置表沿用既有 SELECT/INSERT/UPDATE 授权，不授予客户端 DELETE。anon 对这三张表没有表权限。
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

