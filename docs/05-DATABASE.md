# 文档 5 · 数据库设计

## 5.1 选型与结论

- **结论**：v1 引入 **Supabase**（Postgres + Auth + 自动 API），存储多用户的练习记录、设置与账号。
- **理由**：产品会分享给朋友多人使用；练习记录和设置需要云端持久化（换设备不丢、清缓存不丢），并为阶段 2 的进度趋势、共享句库打基础。
- **账号**：Supabase Auth **邮箱登录**（邮箱 + 密码，或免密 magic link）。

## 5.2 数据职责划分

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 练习记录 | Supabase（云端） | 按用户隔离，登录后读写 |
| 用户设置（方言） | Supabase（云端） | 按用户隔离 |
| 用户资料（昵称） | Supabase（profiles） | 扩展 auth.users |
| 句库 | 内置静态数据 | v1 保持内置，后续可迁数据库 |
| 音频（示范/录音） | 不持久化 | 会话内 |

## 5.3 表设计

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
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id),
  lang       TEXT DEFAULT 'es-ES',
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 5.4 权限模型（RLS）

- 开启 Row Level Security：用户只能读写自己的 `practice_records` 和 `user_settings`。
- 前端经 Supabase SDK + 登录态 token 直接访问数据；后端 AI 服务不接触用户数据。
- 前端使用 Supabase publishable key（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`）连接项目；用户数据仍由登录态和 RLS 隔离，不在前端使用 Supabase secret key。

## 5.5 数据生命周期

| 数据 | 写入时机 | 读取时机 | 生命周期 |
|---|---|---|---|
| 练习记录 | 每次口语评分后 | 记录页、最近练习、磨耳朵 | 长期，用户可删 |
| 用户设置 | 修改方言后 | 各页读取（决定评估语言 + TTS 音色） | 长期 |
| 用户资料 | 注册时 | 展示昵称 | 长期 |

## 5.6 登录与访问流程

- 首次打开 → 引导登录/注册（邮箱）→ 进入选句页。
- 登录后所有云端读写自动带用户身份；未登录无法访问云端数据。
- v1 不做游客模式（避免数据归属混乱）。

## 5.7 与旧「无数据库」方案的关系

- 原 localStorage 方案弃用；练习记录、设置全部迁到 Supabase。
- 「最近练习」由云端练习记录实时派生，不再依赖本地。

---

