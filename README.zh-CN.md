# Code Line Analysis

[English](README.md)

Code Line Analysis 是一个基于 Electron 的桌面应用，用于扫描本地代码仓库、将统计结果保存到本地 SQLite 数据库，并通过 React 桌面界面进行浏览和编辑。

## 功能概览

- 在一个工作区中管理和分析多个文件夹。
- 支持增量扫描和完整重扫，并显示实时进度。
- 统计总行数、代码行、注释行、空行和块注释行。
- 支持设置基线快照，并查看当前结果相对基线的增量。
- 提供仪表盘、目录树、文件列表、标签、最大文件/函数、热力图、重复代码等视图。
- 内置 Monaco 编辑器，可查看文件、跳转标签行、查看 Git 信息并保存修改。
- 支持白名单/黑名单 glob 规则控制扫描范围。
- 界面支持英文和简体中文切换。

## 内置视图

- Workspace：添加文件夹并切换当前分析项目。
- Dashboard：查看汇总卡片、语言分布图、扫描按钮和基线操作。
- Folder Manager：配置白名单和黑名单扫描规则。
- Tree：以目录树方式查看聚合统计并直接打开文件。
- Files：按路径、语言、扩展名和行数筛选、排序文件。
- Tags：集中查看 TODO、FIXME、HACK、NOTE、XXX 等标记。
- Top Files and Functions：快速定位大文件和长函数。
- Heatmap：基于文件修改时间查看近期活跃度。
- Duplicates：查看长度不少于 6 行的重复代码簇。

## 技术栈

- Electron
- React 18
- TypeScript
- Vite
- better-sqlite3
- Monaco Editor
- Recharts
- simple-git

## 环境要求

- 建议使用 Node.js 20 或更高版本。
- npm

## 本地开发

安装依赖并启动开发环境：

```bash
npm install
npm run dev
```

如果本地 Electron 版本与原生 SQLite 模块不匹配，可执行：

```bash
npm run rebuild
```

## 构建与打包

```bash
npm run build
npm run dist
npm run dist:signed
```

- `npm run build`：构建 renderer 和 Electron main 进程。
- `npm run dist`：生成未签名的桌面安装包。
- `npm run dist:signed`：按 Electron Builder 默认签名流程打包。
- 打包产物输出到 `release/` 目录。

## 使用方式

1. 启动应用后，在 Workspace 页面添加一个待分析文件夹。
2. 添加后应用可以立即触发首次扫描。
3. 在 Dashboard 中执行增量扫描、完整重扫，或设置/重置基线。
4. 通过 Tree、Files、Tags、Top、Heatmap、Duplicates 等页面浏览结果。
5. 打开任意文件后，可查看指标、Git 信息、标签跳转，并在编辑模式下保存修改。

## 数据存储

扫描结果会保存在 Electron 用户数据目录下的本地 SQLite 数据库中，文件名为 `codeline.sqlite`。

## 项目结构

- `src/main`：Electron 主进程、IPC 处理、数据库访问、扫描器、解析器、Git 集成。
- `src/preload`：暴露给 renderer 的 preload bridge。
- `src/renderer`：React 界面、路由、Monaco 集成和各页面视图。
- `src/shared`：主进程与渲染进程共享的类型和接口契约。
- `build`：应用图标和打包资源。
- `release`：构建和打包输出目录。

## 贡献说明

- 如果修改 IPC 契约，请同步维护 `src/main`、`src/preload` 和 `src/shared/api.ts`。
- 打包图标资源位于 `build/icon.png`、`build/icon.icns` 和 `build/icon.ico`。

## License

MIT