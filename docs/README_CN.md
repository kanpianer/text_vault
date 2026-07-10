# Text Vault - 端到端加密文本保险库 🔐

一个零知识、端到端加密的 Markdown 编辑器。所有数据在浏览器本地加密，服务器只存储加密后的内容，完全保护您的隐私。

---

## ✨ 核心特性

- 🔒 **零知识架构** - 服务器永远无法访问您的数据
- 🔐 **AES-256 加密** - 军事级别的加密标准
- ✍️ **Markdown 编辑** - 支持实时预览、代码高亮、数学公式
- 📑 **多标签管理** - 在一个保险库中管理多个文档
- 💾 **自动保存** - 30 秒无操作后自动保存
- 🔒 **自动锁定** - 2 分钟无操作自动锁定保护数据
- 📱 **响应式设计** - 完美支持手机、平板、电脑
- 🌍 **免费部署** - 使用 Cloudflare 免费计划即可

---

## 🚀 快速部署（5 分钟）

### 方法 1：部署到 Cloudflare（推荐 - 完全免费）

**通过 Web UI 界面操作，无需命令行！**

1️⃣ **构建项目**
```bash
npm install
npm run build
```

2️⃣ **跟随部署指南**
- ⚡ [5 分钟快速指南](./QUICK_START.md) - 最快上手
- 📖 [详细图文教程](./CLOUDFLARE_DEPLOYMENT.md) - 每一步都有说明
- ✅ [检查清单](./DEPLOYMENT_CHECKLIST.md) - 确保不遗漏任何步骤

**Cloudflare 免费额度：**
- ✅ 每天 100,000 次请求
- ✅ 1GB 存储空间
- ✅ 全球 CDN 加速
- ✅ 自动 HTTPS

### 方法 2：本地运行

```bash
npm install
npm run dev
```

访问 http://localhost:3000

---

## 🔐 安全机制

### 加密流程

1. **密钥派生**：使用 PBKDF2 从密码派生 256 位密钥（600,000 轮迭代）
2. **数据加密**：使用 AES-GCM 加密所有内容
3. **认证哈希**：使用双重 SHA-256 哈希验证身份（服务器不存储原始密码）
4. **Salt 随机化**：每个保险库使用独立的随机 salt

### 密码要求

为了确保安全，密码必须满足：
- ✅ 长度 8-18 个字符
- ✅ 至少一个大写字母
- ✅ 至少一个小写字母
- ✅ 至少一个数字
- ✅ 至少一个特殊符号

### 自动保护

- 🕐 30 秒无操作 → 自动保存
- 🕑 2 分钟无操作 → 自动锁定
- 🔒 锁定后必须重新输入密码

---

## 📖 使用说明

### 创建保险库

1. 访问应用 URL
2. 输入保险库名称（1-10 个字符，仅限字母和数字）
3. 点击 "GO"
4. 设置一个强密码
5. 开始使用！

### 编辑文档

- 支持完整的 Markdown 语法
- 代码高亮（100+ 语言）
- 数学公式（LaTeX）
- 任务列表
- 表格、引用、列表等

### 多标签管理

- 点击 "+" 添加新标签
- 拖拽标签重新排序
- 每个标签独立保存内容

### 保存和同步

- 手动保存：按 `Ctrl + S` (Windows) 或 `Cmd + S` (Mac)
- 自动保存：30 秒无操作后自动触发
- 状态指示器显示保存状态

---

## 🛠️ 技术架构

### 前端
- **框架**：React 19 + TypeScript
- **构建工具**：Vite 6
- **样式**：Tailwind CSS 4
- **动画**：Motion 12
- **Markdown**：marked + rehype + remark
- **代码高亮**：highlight.js
- **数学公式**：KaTeX

### 后端（生产环境）
- **平台**：Cloudflare Workers
- **数据库**：Cloudflare KV Storage
- **前端托管**：Cloudflare Pages
- **加密**：Web Crypto API

### 后端（本地开发）
- **服务器**：Express.js
- **存储**：本地 JSON 文件

---

## 📂 项目结构

```
text_vault-1/
├── src/
│   ├── App.tsx              # 主应用组件
│   ├── Editor.tsx           # Markdown 编辑器组件
│   ├── crypto.ts            # 加密/解密工具函数
│   ├── types.ts             # TypeScript 类型定义
│   └── index.css            # 全局样式
├── dist/                    # 构建输出（npm run build）
├── server.ts                # Express 开发服务器
├── worker.js                # Cloudflare Worker 脚本
├── wrangler.toml            # Cloudflare 配置文件
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
├── package.json             # 项目依赖
├── README.md                # 英文说明文档
├── README_CN.md             # 中文说明文档（本文件）
├── QUICK_START.md           # 5 分钟快速部署
├── CLOUDFLARE_DEPLOYMENT.md # 详细部署教程
└── DEPLOYMENT_CHECKLIST.md  # 部署检查清单
```

---

## 🌐 API 接口

所有 API 都使用 JSON 格式，路径前缀为 `/api/vault/:name`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/salts` | 获取加密 salt（不需要认证） |
| GET | `/check` | 检查名称是否可用 |
| POST | `/create` | 创建新保险库 |
| POST | `/get` | 获取加密内容（需要密码哈希） |
| POST | `/update` | 更新内容（需要认证） |
| POST | `/delete` | 删除保险库（需要认证） |

---

## 🌍 浏览器兼容性

需要支持 Web Crypto API 的现代浏览器：

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Opera 76+

---

## 💡 常见问题

### Q: 数据存储在哪里？

A: 在 Cloudflare KV 存储中。数据经过 AES-256 加密，只有您的密码可以解密。

### Q: 忘记密码怎么办？

A: 由于是零知识架构，如果忘记密码，数据将无法恢复。请务必记住密码或将密码安全保存。

### Q: 可以多人共享一个保险库吗？

A: 可以！只要知道保险库名称和密码，任何人都可以访问。但请注意：
- 同时编辑可能导致数据覆盖
- 共享密码存在安全风险

### Q: 支持离线使用吗？

A: 目前不支持。需要连接到 Cloudflare 服务器才能保存和读取数据。

### Q: 费用如何？

A: 使用 Cloudflare 免费计划完全免费！包括：
- 每天 100,000 次请求
- 1GB 存储空间
- 全球 CDN

对于个人使用完全足够。

---

## 🔒 安全建议

1. **使用强密码**
   - 不要使用常见密码
   - 每个保险库使用不同的密码
   - 使用密码管理器保存密码

2. **定期备份**
   - 复制重要内容到本地
   - 不要依赖单一存储方式

3. **谨慎共享**
   - 不要与不信任的人共享密码
   - 定期更改共享保险库的密码

4. **不存储极度敏感信息**
   - 虽然加密强度很高
   - 但不建议存储银行密码、信用卡等

---

## 📄 开源许可

MIT License - 您可以自由使用、修改和分发此项目。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📞 获取帮助

- 📖 [详细部署文档](./CLOUDFLARE_DEPLOYMENT.md)
- ⚡ [快速开始](./QUICK_START.md)
- 💬 [Cloudflare 社区](https://community.cloudflare.com/)

---

**⚠️ 免责声明**：此应用使用强加密保护您的数据，但作者不对数据丢失、安全漏洞或其他问题承担责任。请自行评估风险后使用。
