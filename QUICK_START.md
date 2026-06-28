# 🚀 5 分钟快速部署指南

通过 Cloudflare Web UI 部署您的加密文本保险库，完全免费！

---

## 第 1 步：构建项目 (2 分钟)

打开命令行，在项目目录执行：

```bash
npm install
npm run build
```

✅ 完成后会生成 `dist` 文件夹

---

## 第 2 步：创建 KV 存储 (1 分钟)

1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages** > **KV**
3. 点击 **Create a namespace**
4. 名称输入：`text-vault-storage`
5. 点击 **Add**
6. ✏️ **记下 Namespace ID**

---

## 第 3 步：部署前端 (1 分钟)

1. 在 Dashboard 点击 **Create application** > **Pages**
2. 选择 **Upload assets**
3. 项目名称：`text-vault-app`
4. 将 `dist` 文件夹内的文件拖拽上传
5. 点击 **Deploy site**
6. ✏️ **记下 Pages URL**（例如：https://text-vault-app.pages.dev）

---

## 第 4 步：部署后端 Worker (1 分钟)

1. 点击 **Create application** > **Workers** > **Create Worker**
2. 名称：`text-vault-api`
3. 点击 **Deploy**
4. 点击 **Edit Code**
5. 删除默认代码，粘贴 `worker.js` 的全部内容
6. **重要**：找到代码最后几行，修改：
   ```javascript
   const pagesUrl = 'https://text-vault-app.pages.dev'; // <-- 改成您的 Pages URL
   ```
7. 点击 **Save and Deploy**

---

## 第 5 步：连接数据存储 (30 秒)

1. 返回 Worker 详情页
2. 点击 **Settings** > **Variables**
3. 找到 **KV Namespace Bindings**
4. 点击 **Add binding**
5. 填写：
   - Variable name: `VAULTS`
   - KV namespace: `text-vault-storage`
6. 点击 **Deploy**

---

## 🎉 完成！测试您的应用

访问您的 Worker URL（例如：`https://text-vault-api.your-subdomain.workers.dev`）

**测试步骤：**
1. 输入保险库名称（例如：`mytest`）
2. 点击 GO
3. 设置密码（必须包含大小写字母、数字、符号）
4. 创建保险库
5. 输入一些文本并保存
6. 刷新页面，重新输入密码解锁
7. ✅ 数据应该还在！

---

## 📊 您现在拥有：

- ✅ 全球 CDN 加速的应用
- ✅ 端到端加密的数据存储
- ✅ 每天 100,000 次请求额度
- ✅ 1GB 免费存储空间
- ✅ 完全免费的部署

---

## ❓ 遇到问题？

查看详细文档：[CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md)

常见问题：
- **500 错误**：检查 KV binding 是否正确（变量名必须是 `VAULTS`）
- **页面无法访问**：确认 Pages URL 在 worker.js 中配置正确
- **数据保存失败**：查看 Worker 日志（Settings > Logs）

---

**下一步：**
- 🌍 绑定自定义域名
- 🎨 自定义界面样式
- 📱 添加 PWA 支持
