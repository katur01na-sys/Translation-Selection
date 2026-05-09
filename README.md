# Translation-Selection (波兰语助手) 🇵🇱🇨🇳

**Translation-Selection (波兰语助手)** 是一款基于 Electron + React 构建的现代化桌面端跨语言学术与翻译辅助应用。
旨在为涉及波兰语和汉语双语环境的学生、研究人员及翻译工作者提供一站式的词汇查阅、语料选择和论文/报告辅助生成工具。

## 🌟 核心功能 (Features)

- **中波双语学术辅助**：专为中文和波兰语（Polskiej）语境打造的垂直领域词典与翻译选择助手。
- **高性能前端渲染**：基于 `React 18` + `Vite` 构建，使用 `react-window` 处理海量词汇长列表渲染，保证界面流畅不卡顿。
- **现代化桌面体验**：基于 `Electron` 的原生桌面端能力封装，支持多端部署和系统级快捷操作。
- **自动化部署体系**：内置 `deploy.sh` 脚本，支持一键构建前端资源并自动刷新替换 macOS `.app` 包，实现无缝热加载更新。
- **多进程任务协同**：后台配置独立进程（如 `bg_review.js`），支持异步审核、高耗时任务拆分与调度。

## 🛠 技术栈 (Tech Stack)

- **核心框架**: Electron
- **前端架构**: React 18, Vite 5
- **性能优化**: react-window (长列表虚拟化)
- **脚本引擎**: Bash (用于快速构建和应用内联部署)
- **环境要求**: Node.js >= 18.x

## 🚀 快速启动 (Quick Start)

### 1. 克隆项目
```bash
git clone https://github.com/katur01na-sys/Translation-Selection.git
cd Translation-Selection
```

### 2. 安装依赖
由于项目分为 `polskiej-frontend` (前端) 和 `polskiej-chinese-src` (Electron 主进程)，需要分别安装依赖：
```bash
# 安装前端依赖
cd polskiej-frontend
npm install

# 安装后端/桌面端主进程依赖
cd ../polskiej-chinese-src
npm install
```

### 3. 一键构建与本地部署 (Mac 用户)
在根目录下运行部署脚本即可自动完成前端构建、文件拷贝及应用重启：
```bash
# 将自动编译 React 代码并把产物打入桌面端的 .app 中，随后自动启动软件
bash deploy.sh
```

## 📂 项目结构 (Structure)

```text
├── polskiej-frontend/         # React 前端渲染层 (Renderer Process)
│   ├── src/                   # 界面 UI 和业务逻辑
│   └── package.json           # 前端依赖配置
├── polskiej-chinese-src/      # Electron 桌面端主进程 (Main Process)
│   ├── build/                 # 应用图标 (icon.icns 等)
│   ├── dist-electron/         # 主进程代码 (main.js, preload.js, bg_review.js)
│   └── package.json           # 桌面端依赖
├── deploy.sh                  # MacOS 本地一键部署与调试脚本
└── README.md                  # 项目说明
```

## 📄 许可证 (License)
MIT License.
