# 同住：Render + Turso 免费部署说明

本包保留当前作品的完整功能，尚未在 Render 发布。你已验证 Render 官方示例能在自己的国内网络直连；新作品域名发布后仍需独立测试。

Render 托管页面和接口，Turso 保存账号和房间数据。浏览器只访问同一个 Render 网址，不需要直接连接 Turso。

## 1. 准备代码仓库

1. 解压 `tongzhu-free-deploy.zip`。
2. 登录 GitHub，新建自己的仓库，例如 `tongzhu-life-manager`。可以使用私有仓库，之后授权 Render 访问该仓库。
3. 上传解压后的全部文件并提交。仓库首页应直接看到 `Dockerfile`、`render.yaml`、`package.json`、`server.mjs`，以及 `public`、`src`、`lib`、`drizzle`、`vendor` 文件夹。
4. 不要只把 zip 上传成一个附件，也不要在根目录多套一层文件夹。无需在电脑安装 Node.js、Docker 或 npm 依赖。

## 2. 创建免费的数据库

1. 打开 https://app.turso.tech/ 完成注册，在组织/账户的 Billing 页面确认使用 **Free**。当前官方 Free 为 $0/月，不要求信用卡；不要启用付费升级或 Overages。
2. 创建一个空白数据库，例如 `tongzhu`。如果要求选择引擎，选 **libSQL**；位置可选可用的 Singapore / 新加坡，或靠近 Render 服务的地区。
3. 进入该数据库的连接配置，复制 **Database URL**，通常以 `libsql://` 开头。使用数据库根地址，不加 `/v2/pipeline`。
4. 创建对这个数据库有**读写权限**的数据库 Auth Token。有效期需要覆盖评审时间；如果提供 Never / 不过期选项，可用于这个独立演示数据库。不要使用只读 Token，也不要使用整个账户的 Platform API Token。
5. URL 和 Token 稍后只填入 Render 环境变量。请自行保存 Token，不要发到聊天、写进网页、提交到仓库或截图展示。

数据库表由应用首次连接时自动创建，无需手工粘贴 SQL。

如果控制台没有找到创建 libSQL 或 Token 的入口，可以按官方 CLI 文档使用以下命令（可选）：

```bash
turso auth login
turso db create tongzhu
turso db show tongzhu --url
turso db tokens create tongzhu --expiration never
```

上面创建库的命令不带 `--tursodb`，因此创建 libSQL 引擎。命令输出的 Token 同样只填写在 Render 服务端。

## 3. 发布到 Render

推荐用包内 Blueprint，自动填好服务类型、运行环境和地区。

1. 打开 https://dashboard.render.com/ 注册或登录。账号验证由你本人完成。
2. 选择 **New → Blueprint**，连接 GitHub 并选择刚才的仓库。若看不到仓库，检查 GitHub 授权的仓库范围。
3. 选择包含源码的分支，读取根目录 `render.yaml`。
4. 确认将创建的资源：仅一个 **Web Service**，运行环境 **Docker**，方案 **Free**，地区 **Singapore**。包内没有付费存储卷和 Render Postgres。若显示付费方案，先改回 Free。
5. 按提示填写下面两个环境变量，再创建/部署。

| 变量名 | 填写内容 |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso Database URL，例如 `libsql://你的数据库地址.turso.io` |
| `TURSO_AUTH_TOKEN` | 对应数据库的读写 Auth Token，不加额外引号或 `Bearer ` |

6. 等待构建与发布完成，服务状态变为 **Live**。打开服务页面显示的 `https://实际名称.onrender.com`。
7. 打开 `https://实际名称.onrender.com/api/health`，应该返回 `ok: true`，再执行下一节验收。

Render 自动注入 `RENDER_EXTERNAL_URL`；应用用它校验写入来源，默认域名无需手填 `PUBLIC_ORIGIN`。Dockerfile 已设置 Node.js 24 并启动 `node server.mjs`，无需输入 Build Command 或 Start Command。

如果不用 Blueprint，可选择 **New → Web Service**，连接同一个仓库，手动选择 **Docker / Singapore / Free**，Health Check Path 填 `/api/health`，添加上面两个变量，再发布。Root Directory 留空，Dockerfile Path 为 `./Dockerfile`。

## 4. 提交前验收

1. **国内直连**：关闭代理，用 Wi-Fi 和手机流量分别打开新作品网址。官方示例能打开，不代表每个新域名或运营商都一定可达。等作品网址通过测试后再提交。
2. **完整示例**：首页体验 AA、值日、物品和公约。输入「买了两卷纸巾，30元，三个人平摊」，应先出现可编辑确认草稿；取消不改变数据，确认后增加库存、采购记录和账单。
3. **两人共享**：普通窗口 A 与无痕窗口 B 注册不同本站账号。A 创建房间，B 通过邀请链接加入。A 新增物品或账单，B 约 4 秒后或点击立即同步看到变化。新共享房间初始为空，需要先添加公共物品。
4. **采购接力**：A 发起需要补货，B 认领；B 完成补货并填写数量、金额、分摊人。两端都应看到采购完成、库存增加、AA 账单生成。重复点击确认不应重复记账。
5. **持久化**：记录房间内的账单和库存，重新部署或重启 Render，再打开两端，数据应保留。验证时保留同一个 Turso 数据库与 Token。
6. **保留网址**：提交最终的一个 `https://实际名称.onrender.com` 链接。保持同一服务及其域名，后续更新代码即可，不要删除并重建服务或更换域名。

## 免费方案的使用范围

- Render Free 无访问 15 分钟会休眠，再次请求通常约需一分钟恢复，页面可能先出现平台加载提示。演示前可提前打开作品。
- Render 免费服务的本地 SQLite 会随休眠、重启、重新部署丢失，本版本将线上数据保存到 Turso，并在 Render 缺少数据库配置时拒绝启动。
- 不使用会在创建 30 天后过期的 Render Free Postgres。Turso 当前有 Free 方案，但免费额度、账号审核和政策以平台为准，无法保证永久免费或所有国内网络始终可达。
- 保留 Render 与 Turso 账户、服务、数据库和有效 Token，并留意平台通知与额度。用于轻量评审演示，无需开通付费资源。

## 常见情况

| 现象 | 处理方法 |
| --- | --- |
| 提示缺少 Turso 配置 | 在 Render 的 Environment 中添加两个变量，保存并重新部署 |
| `/api/health` 返回 503 | 检查数据库 URL 是否为根地址、Token 是否属于此库且有读写权限、是否过期；反馈截图不要展示 Token |
| 首页正常，登录提示来源无效 | 通过 Render 分配的 HTTPS 域名访问；若手填过错误的 `PUBLIC_ORIGIN`，删除该变量，使用平台自动值 |
| 刚打开等待较久 | Render Free 可能正在从休眠恢复，等待约一分钟后再试 |
| 本地 HTTP 登录不保持 | 账号使用 Secure Cookie，请在部署后的 HTTPS 域名验收 |
| 老站修改的示例数据没出现 | 示例模式按域名保存在 localStorage；新域名使用初始示例，真实共享数据在 Turso |

以后使用自定义域名时，在 Render 绑定成功后，将 `PUBLIC_ORIGIN` 设置为该 HTTPS 根地址（不带末尾 `/`），重新部署。考试提交后不建议换域名。

## 保留范围与测试证据

- 保留原站第 5 版的完整页面、浏览器脚本、费用 AA、清洁值日、物品提醒、公约、本站账号密码、邀请共享、采购闭环、撤销入账和一句话确认草稿。
- 一句话录入使用已有中文规则解析器，先生成确认草稿，不调用外部大模型或要求额外 API Key。
- 页面、浏览器业务、房间业务代码与表定义可通过 `upstream-checksums.json` 和原始源版本 `20170d9228f9f1992d029ca0927cd25c159696f2` 核对；账号模块只调整 bcrypt 导入路径。附 bcryptjs 3.0.3 授权文件。
- 原站共享表在迁移准备时无账号、房间、成员和动态记录，本包不含旧账号数据库。原域名浏览器中的示例修改不会自动迁移。
- 自动检查 `npm test`（Node.js 24，无需 `npm install`）：原有 112 项，加本地运行与持久化 13 项、模拟 Turso 协议及共享业务集成 13 项，共 138 项。
- Turso 协议测试使用模拟 HTTP 传输和真实 SQLite 执行，不等于真实云端连接验证。本包准备时尚未完成 Render/Turso 云端发布、Docker 镜像构建或真实浏览器端到端验收；需按上面的部署与验收步骤完成。

## 本机运行（可选）

安装 Node.js 24 后，在项目根目录执行：

```bash
PUBLIC_ORIGIN=http://localhost:8080 node server.mjs
```

未设置 Turso 时，本机使用 `data/tongzhu.sqlite`。本地适合检查页面和 API；账号最终应在 HTTPS 环境验收。

## 官方参考（2026-10-16 核对）

- Render 首次部署：https://render.com/docs/your-first-deploy
- Render Blueprint：https://render.com/docs/blueprint-spec
- Render 环境变量：https://render.com/docs/environment-variables
- Render 免费限制：https://render.com/docs/free
- Turso Free：https://turso.tech/pricing
- Turso 创建数据库：https://docs.turso.tech/quickstart
- Turso 数据库 Token：https://docs.turso.tech/cli/db/tokens/create
- Turso HTTP 协议：https://docs.turso.tech/sdk/http/quickstart
