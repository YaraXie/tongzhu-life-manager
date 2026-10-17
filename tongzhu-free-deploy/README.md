# 同住 · 合租生活管家（Render 免费部署版）

保留原站完整界面和功能，使用 Node.js 24 + Render Free Web Service + Turso Free 外部数据库。附有 `render.yaml`，无需改写框架或运行 npm install。

**这是部署源码包，目前还不是已发布的网站。** 先读 [中文部署说明](DEPLOYMENT.zh-CN.md)，完成发布和国内网络验收后，才能提交新链接。

功能包含费用 AA、清洁值日、公共物品与提醒、室友公约、账号密码、邀请与多人共享、补货采购闭环、一句话录入及确认草稿。

## 快速部署

1. 将解压后的所有文件上传到自己的 GitHub 仓库根目录，确认根目录直接有 `Dockerfile` 和 `render.yaml`。
2. 在 [Turso](https://app.turso.tech/) 的 Free 方案创建空白 libSQL 数据库，取得 Database URL 与具有读写权限的数据库 Token。
3. 在 [Render](https://dashboard.render.com/) 选择 New → Blueprint，连接该仓库，填写 `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN`。确认是 **Free、Singapore** 后部署。
4. 等待服务变为 Live，打开分配的 `https://实际名称.onrender.com`，检查 `/api/health`，再按中文说明验收。

账号和房间数据放在 Turso；Render 的临时磁盘不用于线上数据持久化。凭据只填写在 Render 服务端环境变量里，不要上传仓库。

## 开发与检查

- Node.js 24；`npm start` 启动，`npm test` 运行自动检查。
- 本机未设置 Turso 时可用 SQLite；Render 环境缺少 Turso 配置则拒绝启动，防止误用临时磁盘。
- 原始源版本 `20170d9228f9f1992d029ca0927cd25c159696f2`（原站第 5 版）。界面、浏览器脚本、房间业务与表定义保持一致，见 `upstream-checksums.json`。
- 所附 bcryptjs 3.0.3 使用 BSD-3-Clause 许可，见 `vendor/bcryptjs/LICENSE`。

Render Free 在无访问 15 分钟后休眠，再次打开约需一分钟。免费额度和服务政策以平台为准；最终作品域名需要单独验证国内直连。提交后保留同一服务和域名，后续在同一仓库更新即可。
