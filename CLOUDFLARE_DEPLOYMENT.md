# 📦 Cloudflare Workers 部署指南

本指南将帮助您通过 **Cloudflare Web UI** 将 Text Vault 应用部署到 Cloudflare Workers（完全使用免费计划）。

## ✅ 前提条件

1. **Cloudflare 账户**（免费注册）：https://dash.cloudflare.com/sign-up
2. **本地已安装 Node.js**（用于构建项目）

---

## 🚀 部署步骤

### 第一步：构建项目

1. 打开命令行/终端，进入项目根目录
2. 运行以下命令安装依赖并构建：

```bash
npm install
npm run build
```

✅ 构建成功后，会在项目根目录生成 `dist` 文件夹，包含所有前端静态文件。

---

### 第二步：登录 Cloudflare Dashboard

1. 访问 https://dash.cloudflare.com/
2. 使用您的账户登录（如果没有账户，请先注册）

---

### 第三步：创建 KV Namespace（数据存储）

**KV Namespace** 是 Cloudflare 提供的键值数据库，用于存储您的加密保险库数据。

1. 在左侧菜单中，点击 **Workers & Pages**
2. 点击 **KV** 标签页
3. 点击 **Create a namespace** 按钮
4. 输入名称：`text-vault-storage`
5. 点击 **Add** 按钮
6. ✅ **记录下生成的 Namespace ID**（例如：`1234567890abcdef`）

![创建 KV Namespace 示意图](https://i.imgur.com/KVExample.png)

---

### 第四步：上传前端到 Cloudflare Pages
0. Fork 本仓库
1. 在左侧菜单，搜索并选择 **Workers & Pages**
2. 点击 **Create application** 按钮
3. 点击下方 **Looking to deploy Pages?** 右侧的 **Get started**
4. 点击 **Import an existing Git repository** 后方的 **Get started**
5. 选择 **GitHub account** 对应的 **text_vault** 仓库
6. 点击 **Begin setup**
7. **Framework preset**选择 **React(Vite)**
8. **Project name** 输入你想设定的名称，如：`text-vault`
9. 点击 **Save and Deploy** 按钮
10. ✅ 部署完成！**记录下 Pages URL**（例如：`https://text-vault.pages.dev`）

---

### 第五步：创建 Worker（后端 API）

1. 返回 **Workers & Pages** 页面
2. 点击 **Create application**
3. 选择 **Workers** 标签
4. 点击 **Create Worker**
5. 输入 Worker 名称：`text-vault-api`
6. 点击 **Deploy** 按钮

---

### 第六步：配置 Worker 代码

1. 在 Worker 部署成功后，点击 **Edit Code** 按钮
2. 删除编辑器中的所有默认代码
3. 打开项目根目录的 `worker.js` 文件，**复制全部内容**
4. 粘贴到 Cloudflare 编辑器中
5. **重要**：找到代码底部的这一行：

```javascript
return env.ASSETS.fetch(request);
```

将它替换为（使用您在第四步记录的 Pages URL）：

```javascript
// 将下面的 URL 替换为您的 Pages URL
const pagesUrl = 'https://text-vault-app.pages.dev';
const url = new URL(request.url);
return fetch(pagesUrl + url.pathname + url.search);
```

6. 点击 **Save and Deploy** 按钮

---

### 第七步：绑定 KV Namespace

1. 点击左上角的 **< text-vault-api** 返回 Worker 详情页
2. 点击 **Settings** 标签
3. 在左侧菜单选择 **Variables**
4. 向下滚动到 **KV Namespace Bindings** 区域
5. 点击 **Add binding** 按钮
6. 填写配置：
   - **Variable name**: `VAULTS`（⚠️ 必须是这个名称）
   - **KV namespace**: 选择 `text-vault-storage`
7. 点击 **Deploy** 按钮

---

### 第八步：测试应用

1. 访问您的 Worker URL（例如：`https://text-vault-api.your-subdomain.workers.dev`）
2. 您应该能看到应用界面
3. 测试功能：
   - ✅ 创建新的加密保险库
   - ✅ 保存和编辑内容
   - ✅ 刷新页面后数据依然存在
   - ✅ 锁定和解锁保险库

---

### 🎉 完成！

您的加密文本保险库现在已经成功部署到 Cloudflare，完全使用免费计划！

---

## 📊 免费计划限制

### Workers 免费计划
- ✅ 每天 **100,000** 次请求
- ✅ 每次请求 **10ms** CPU 时间
- ✅ 最多 **100** 个 Worker 脚本

### Pages 免费计划
- ✅ **无限**请求
- ✅ **500** 次构建/月
- ✅ **20,000** 个文件

### KV 免费计划
- ✅ 每天 **100,000** 次读取
- ✅ 每天 **1,000** 次写入
- ✅ **1 GB** 存储空间

**💡 对于个人加密文本保险库应用，这些限制完全足够！**

---

## ❓ 常见问题

### Q1: 如何查看和管理存储的数据？

1. 进入 **Workers & Pages** > **KV**
2. 点击 `text-vault-storage` namespace
3. 可以查看所有保险库名称
4. 数据都是加密的，只能通过密码解密

### Q2: 如何更新 Worker 代码？

1. 进入 Worker 详情页
2. 点击 **Edit Code**
3. 修改代码
4. 点击 **Save and Deploy**

### Q3: 如何更新前端页面？

1. 本地修改代码后重新构建：`npm run build`
2. 进入 Pages 项目页面
3. 点击 **Create a new deployment**
4. 上传新的 `dist` 文件夹内容

### Q4: 如何绑定自定义域名？

**绑定到 Worker：**
1. 进入 Worker 详情页
2. 点击 **Settings** > **Triggers**
3. 点击 **Add Custom Domain**
4. 输入域名（需要在 Cloudflare 管理 DNS）

**绑定到 Pages：**
1. 进入 Pages 项目页面
2. 点击 **Custom domains**
3. 点击 **Set up a custom domain**
4. 按照提示配置

### Q5: 如何监控应用使用情况？

1. 进入 Worker 详情页
2. 点击 **Metrics** 标签
3. 查看：
   - 请求数量
   - 错误率
   - CPU 使用时间
   - 带宽使用

### Q6: 多个人可以访问同一个保险库吗？

可以！只要知道保险库名称和密码，任何人都可以访问。这适合团队共享加密笔记。但请注意：
- ⚠️ 同时编辑可能导致数据覆盖
- ⚠️ 共享密码存在安全风险

---

## 🔒 安全建议

1. **使用强密码**
   - 至少 8-18 个字符
   - 包含大小写字母、数字和符号

2. **定期备份**
   - 虽然数据存储在 Cloudflare KV 中很安全
   - 但建议定期导出重要内容

3. **监控访问**
   - 定期查看 Worker Metrics
   - 发现异常流量及时处理

4. **HTTPS 加密**
   - Cloudflare Workers 默认使用 HTTPS
   - 所有数据传输都是加密的

5. **不要共享敏感密码**
   - 每个保险库使用独立的强密码
   - 不要在多个服务中重复使用

---

## 🛠️ 故障排查

### ❌ 问题：API 请求返回 500 错误

**解决方案：**
1. 打开 Worker 详情页
2. 点击 **Logs** > **Begin log stream**
3. 重现错误，查看日志
4. 检查 KV namespace 绑定是否正确（变量名必须是 `VAULTS`）

### ❌ 问题：无法访问前端页面

**解决方案：**
1. 确认 Pages 部署成功（直接访问 Pages URL）
2. 检查 Worker 代码中的 Pages URL 是否正确
3. 打开浏览器控制台（F12）查看错误信息

### ❌ 问题：数据保存失败

**解决方案：**
1. 检查 KV 写入配额是否用完
   - Dashboard > Workers & Pages > KV > 查看使用量
2. 确认 KV namespace 绑定正确
3. 查看 Worker 日志了解详细错误

### ❌ 问题：显示 "Vault not found" 但确实存在

**解决方案：**
1. 检查保险库名称是否正确（区分大小写）
2. 确认数据确实保存在 KV 中
   - 进入 KV namespace 查看键值
3. 可能是 KV 同步延迟，稍等片刻重试

---

## 🎯 下一步优化

1. **🎨 自定义外观**
   - 修改 CSS 样式
   - 添加自己的品牌元素

2. **📱 PWA 支持**
   - 添加 Service Worker
   - 支持离线使用

3. **🔔 监控告警**
   - 设置 Cloudflare 告警
   - 当流量或错误超过阈值时通知

4. **🌍 自定义域名**
   - 绑定自己的域名
   - 提升专业度

5. **🔐 高级安全**
   - 添加两步验证
   - 实现密码重置机制

---

## 📞 获取帮助

- **Cloudflare 文档**: https://developers.cloudflare.com/workers/
- **Cloudflare 社区**: https://community.cloudflare.com/
- **KV 文档**: https://developers.cloudflare.com/kv/

---

**🎉 恭喜！您的加密文本保险库现在已经在 Cloudflare 的全球网络上运行了！**
