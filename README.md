# Code Kingdom

一个 VSCode 扩展，用于可视化展示项目中每个文件和代码行的开发者贡献情况，帮助团队了解代码的"势力分布"。

## ✨ 功能特性

- 🗺️ **开发人员势力图**：以矩形树图（Treemap）形式展示项目文件树，通过不同颜色可视化每个文件的代码贡献者分布
- 🎨 **自定义作者颜色**：为不同的代码贡献者配置个性化的颜色标识，支持一键修改全部用户颜色
- 📊 **Git Blame 分析**：基于 Git blame 数据，精确统计每个文件中每位开发者的代码行归属
- ⚡ **智能缓存机制**：基于 commit hash 缓存分析结果，避免重复计算，大幅提升性能
- 🔍 **文件详情展示**：显示每个文件的行数统计和贡献者分布情况
- 🎯 **快速文件导航**：点击可视化图中的任意文件可直接在编辑器中打开
- 📁 **尊重 .gitignore**：自动遵循项目中的 .gitignore 规则，过滤不需要分析的文件

## 📖 使用说明

1. 在 VSCode 侧边栏找到 **Code Kingdom** 图标（王国图标）
2. 点击 **"显示开发人员势力图"** 按钮，扩展会自动分析当前项目并生成可视化图表
3. 点击 **"配置作者颜色"** 可以自定义每个开发者的显示颜色
4. 在势力图中点击任意文件矩形可以在编辑器中打开该文件
5. 势力图会根据文件大小和代码行数自动调整矩形的大小

## 💻 系统要求

- **VSCode**: 1.74.0 或更高版本
- **Git**: 项目必须是 Git 仓库，且系统需要安装 Git 命令行工具
- **操作系统**: Windows、macOS 或 Linux

## 🛠️ 开发指南

### 安装依赖

```bash
pnpm install
```

### 编译

```bash
pnpm run compile
```

### 监听模式（开发时自动编译）

```bash
pnpm run watch
```

### 调试扩展

在 VSCode 中按 `F5` 启动扩展开发宿主窗口进行调试

### 代码检查

```bash
pnpm run lint
```

### 运行测试

```bash
pnpm test
```

### 打包插件

```bash
vsce package
```

## 🔧 技术实现

### 核心技术栈

- **语言**: TypeScript
- **框架**: VSCode Extension API
- **依赖**: 
  - `ignore`: 用于解析 .gitignore 规则
  - Git 命令行工具（通过 child_process 调用）

### 主要模块

1. **文件树构建** (`src/fileTree.ts`)
   - 递归扫描工作区目录结构
   - 支持 .gitignore 规则解析和文件过滤
   - 识别文本文件和二进制文件
   - 统计文件行数

2. **Git Blame 分析** (`src/fileTree.ts`)
   - 调用 `git blame --line-porcelain` 命令获取每行代码的作者信息
   - 将相邻的同作者行聚合成段（segments）
   - 支持进度报告和异步处理

3. **智能缓存** (`src/cacheManager.ts`)
   - 基于 Git commit hash 缓存分析结果
   - 使用 VSCode 工作区存储（workspace storage）
   - 自动检测代码变更并刷新视图

4. **可视化渲染** (`src/webviewContent.ts`)
   - 使用 Canvas 绘制矩形树图（Treemap）
   - 实现 MaxRects 装箱算法进行布局优化
   - 根据代码行数按比例显示作者贡献
   - 支持文件名智能换行和自适应字体大小

5. **颜色管理**
   - 基于作者名自动生成唯一颜色（HSL 色彩空间）
   - 支持用户自定义颜色配置
   - 颜色配置全局持久化存储

## 📋 工作原理

1. 用户打开扩展并点击"显示开发人员势力图"
2. 扩展检查当前工作区是否为 Git 仓库
3. 获取当前 commit hash，检查是否有缓存
4. 如无缓存，扫描项目文件树（遵循 .gitignore）
5. 对每个文本文件执行 `git blame` 分析
6. 收集所有开发者信息，为每位开发者分配颜色
7. 使用 MaxRects 算法计算矩形树图布局
8. 在 Webview 中使用 Canvas 绘制可视化图表
9. 将结果缓存，下次打开时直接加载

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源

## 🔗 相关链接

- [GitHub 仓库](https://github.com/LiRenTech/vscode-code-kingdom)
- [问题反馈](https://github.com/LiRenTech/vscode-code-kingdom/issues)
- [VSCode 扩展市场](https://marketplace.visualstudio.com/)

## 🌟 Star History

如果这个项目对你有帮助，请给我们一个 Star ⭐️
