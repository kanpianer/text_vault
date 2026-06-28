# Text Vault - 端到端加密文本保险库

这是一个零知识、端到端加密的 Markdown 编辑器应用。所有数据在浏览器本地加密，服务器只存储加密后的内容。

> **🚀 快速开始：** [START_HERE.md](./START_HERE.md) | **📚 部署文档：** [部署指南索引.md](./部署指南索引.md)

View your app in AI Studio: https://ai.studio/apps/624170db-aff8-4820-bbbd-3fe8a820c761

## 🚀 快速部署到 Cloudflare（免费）

### 方式 1：5 分钟快速部署 ⚡

**完全使用 Cloudflare 免费计划，通过 Web UI 部署：**

👉 [5 分钟快速开始指南](./QUICK_START.md)

或查看详细文档：
- 📖 [完整部署指南](./CLOUDFLARE_DEPLOYMENT.md) - 带截图和详细说明
- ✅ [部署检查清单](./DEPLOYMENT_CHECKLIST.md) - 逐步检查部署状态

### 方式 2：本地开发运行

### 方式 2：本地开发运行

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key

3. Run the app:
   ```bash
   npm run dev
   ```

访问 http://localhost:3000

## 🔒 安全特性

- **零知识架构**：服务器无法访问您的数据
- **端到端加密**：使用 AES-GCM 256 位加密
- **密码派生**：使用 PBKDF2 派生加密密钥
- **双重哈希认证**：密码哈希的哈希用于验证
- **自动锁定**：2 分钟无操作自动锁定

## 📝 功能特性

- ✍️ Markdown 编辑器，支持实时预览
- 🎨 语法高亮和数学公式支持
- 📑 多标签页管理
- 💾 自动保存（30 秒无操作后）
- 🔐 强制密码策略
- 📱 响应式设计，支持移动端

## 🛠️ 技术栈

- **前端**：React 19 + TypeScript + Vite
- **样式**：Tailwind CSS + Motion（动画）
- **加密**：Web Crypto API
- **后端**：Cloudflare Workers + KV Storage
- **原本后端**：Express.js + Node.js（本地开发用）

## 📂 项目结构

```
text_vault-1/
├── src/
│   ├── App.tsx           # 主应用组件
│   ├── Editor.tsx        # Markdown 编辑器
│   ├── crypto.ts         # 加密解密逻辑
│   └── types.ts          # TypeScript 类型定义
├── dist/                 # 构建输出（前端静态文件）
├── server.ts             # Express 服务器（本地开发）
├── worker.js             # Cloudflare Worker（生产环境）
├── wrangler.toml         # Cloudflare 配置
├── CLOUDFLARE_DEPLOYMENT.md    # 详细部署指南
└── DEPLOYMENT_CHECKLIST.md     # 部署检查清单
```

## 🔐 密码要求

- 长度：8-18 个字符
- 必须包含：
  - 大写字母
  - 小写字母
  - 数字
  - 特殊符号

## 📋 API 端点

- `GET /api/vault/:name/salts` - 获取加密 salt
- `GET /api/vault/:name/check` - 检查名称可用性
- `POST /api/vault/:name/create` - 创建新保险库
- `POST /api/vault/:name/get` - 获取加密数据
- `POST /api/vault/:name/update` - 更新保险库
- `POST /api/vault/:name/delete` - 删除保险库

## 🌐 浏览器支持

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- 需要支持 Web Crypto API

## 📄 许可证

MIT License

---

**安全提醒**：虽然此应用使用了强加密，但请不要存储极度敏感的信息（如银行密码、信用卡号等）。定期备份重要数据。
