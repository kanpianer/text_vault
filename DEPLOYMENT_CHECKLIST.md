# ✅ Cloudflare 部署检查清单

使用此清单确保每一步都正确完成。

## 准备阶段

- [ ] 已注册 Cloudflare 账户
- [ ] 本地已安装 Node.js
- [ ] 在项目目录运行 `npm install`
- [ ] 运行 `npm run build` 成功生成 `dist` 文件夹

## Cloudflare Dashboard 配置

### KV Namespace（数据存储）

- [ ] 创建 KV namespace
- [ ] 名称设为：`text-vault-storage`
- [ ] ✏️ 记录 Namespace ID：`_____________________`

### Cloudflare Pages（前端）

- [ ] 创建 Pages 项目
- [ ] 项目名称：`text-vault-app`（或自定义）
- [ ] 上传 `dist` 文件夹**内**的所有文件
- [ ] 部署成功
- [ ] ✏️ 记录 Pages URL：`https://________________________.pages.dev`

### Cloudflare Worker（后端 API）

- [ ] 创建 Worker
- [ ] Worker 名称：`text-vault-api`（或自定义）
- [ ] 复制 `worker.js` 的全部内容到编辑器
- [ ] 修改代码中的 Pages URL（第 215 行左右）
- [ ] 保存并部署代码

### KV Binding（连接数据存储）

- [ ] 进入 Worker Settings > Variables
- [ ] 添加 KV Namespace Binding
- [ ] Variable name: `VAULTS`（必须完全一致）
- [ ] 选择 `text-vault-storage` namespace
- [ ] 点击 Deploy

## 测试阶段

- [ ] 访问 Worker URL
- [ ] 能看到前端界面
- [ ] 创建新保险库成功
- [ ] 输入内容并保存
- [ ] 刷新页面后数据仍存在
- [ ] 锁定保险库后能重新解锁
- [ ] 打开浏览器控制台（F12）无错误

## 验证数据存储

- [ ] Dashboard > Workers & Pages > KV
- [ ] 点击 `text-vault-storage`
- [ ] 能看到保存的保险库键名

## 完成！

✅ 所有检查项都完成，应用已成功部署！

---

## 🔗 记录您的部署信息

- **Worker URL**: `https://________________________________________`
- **Pages URL**: `https://________________________________________`
- **KV Namespace ID**: `________________________________________`

---

## 🆘 遇到问题？

参考 [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md) 的"故障排查"部分。
