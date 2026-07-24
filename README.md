# Code Line Analysis

基于 Tauri 2 的代码行数统计与仓库分析桌面应用。

> Electron 完整版（含网页部署）保留在 [`electron`](https://github.com/react-laravel/code-line-analysis/tree/electron) 分支。

[简体中文](README.zh-CN.md)

## 功能（main / Tauri）

- 多工作区文件夹扫描，实时进度
- 按语言统计 total / code / comment / blank / block-comment
- 仪表盘、目录树、文件列表、Tags、Top、热力图、重复代码
- Monaco 内嵌查看/编辑，Git 元数据
- 全局与工作区白名单/黑名单规则
- Laravel / Next API 路由、文件引用关系、Laravel Schema（对齐 electron 分析契约）
- 工作区目录监听（变更后自动重扫）
- 树节点右键：复制名称/路径、打开、在文件管理器中显示
- 中英文界面

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 |
| 后端 | Rust（SQLite / 扫描 / Git CLI / 分析） |
| 前端 | React 19 + TypeScript + Vite + Monaco + ECharts |

## 快速开始

```bash
npm install
npm run dev      # tauri dev（Vite + Rust）
npm run build    # tauri build
```

本地也可只起 UI：`npm run dev:ui`。

## 项目结构

```text
src/shared/              API 契约与共享类型
src/renderer/            React UI
src/renderer/runtime/    Tauri invoke 桥
src-tauri/               Rust 后端
  src/commands/          Tauri 命令
  src/scan/              目录遍历与扫描
  src/parsers/           行计数 / tags / 函数 / 重复片段
  src/stats/             聚合查询
  src/analysis/          API 路由 / 关系图 / Laravel schema
  src/git/               git CLI
  src/watch.rs           目录监听
```

Electron / 网页版源码与部署脚本见 [`electron`](https://github.com/react-laravel/code-line-analysis/tree/electron) 分支。

## 许可证

MIT
