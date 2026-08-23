# ZX打卡
一个手机优先的多人减肥打卡网页，可记录体重（斤）、运动、饮食、喝水和早晚刷牙状态。用户可以注册账号，并通过 8 位用户码只读查看其他用户的打卡记录。

## 项目结构

- `src/` — React 前端（Vite）
- `netlify/functions/api.mts` — 后端 API 入口（注册 / 登录 / 会话 / 打卡记录 / 用户码查看）
- `netlify/functions/groups.mts` — 同行月相接口（双向关联、共同打卡统计）
- `netlify/functions/lib/` — 后端实现（认证、存储、加密、频率限制）
- `backups/` — 云端数据备份（不提交到 Git）

## 本地运行

本地开发需要 [Netlify CLI](https://docs.netlify.com/cli/get-started/) 以同时运行前端和函数：

```bash
pnpm install
netlify dev
```

启动后访问 http://localhost:8888 ，`/api/*` 由本地函数提供，数据读写使用本地模拟的 Blobs 存储（不会触碰线上数据）。

生产构建：
```bash
pnpm build
pnpm preview
```

## 后端说明

- API 路径：`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`、`/api/records`（GET/PUT）、`/api/profile?code=XXXXXXXX`、`/api/groups`（GET/PUT）。
- 数据存储：Netlify Blobs（store 名 `zx-checkin`），直接读写线上同一份数据，部署新版本不会影响已有用户和记录。
- 会话：`zx_session` HttpOnly Cookie（HMAC-SHA256 签名，30 天有效），使用站点环境变量 `SESSION_SECRET`。
- 密码：加盐 `scrypt`（`N=16384, r=8, p=1`）哈希保存，与历史数据格式兼容。

## 数据与账号说明
- 账号密码使用加盐 `scrypt` 哈希保存，登录状态使用 HttpOnly Cookie。
- 打卡记录保存在 Netlify Blobs 云存储中，可跨设备访问。
- 每位用户拥有独立用户码；只有本人可编辑记录，其他登录用户通过用户码只读查看。
- 同行关系由任意一方添加或取消，双方页面同步生效；共同打卡天数只统计处于关联关系期间、双方都打卡的日期。解除关系不会删除此前的共同统计，重新关联后会在原有天数上继续累计。
- 首次登录可将旧版浏览器本地记录导入云端。
- 用户名全局唯一；用户码 8 位大写字母或数字，全局唯一。
- 注册、登录、查询接口带有简单的频率限制（15 分钟窗口），防止滥用。
