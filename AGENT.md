# Code Line Analysis — Agent 指南

## 项目概述

基于 **Tauri 2 + React + TypeScript + Vite** 的桌面代码分析工具。`main` 为全 Rust 后端；完整 Electron / Web 版在 `electron` 分支。

## 技术栈

- **Shell**: Tauri 2（`src-tauri/`）
- **Backend**: Rust（rusqlite、ignore/walk、rayon、git CLI）
- **Frontend**: React 19 + Monaco + ECharts
- **桥接**: `src/renderer/runtime/tauri-api.ts` → `invoke` / `listen`

## 目录

```text
src/renderer/           React UI
src/shared/             Api / types 契约
src-tauri/src/
  commands/             Tauri commands
  scan/ parsers/        扫描与解析
  stats/ analysis/ git/ 统计、分析、Git
  watch.rs              目录监听
```

## 命令

```bash
npm run dev
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

CI（`.github/workflows/ci.yml`）：`npm run build:ui` + `cargo check`。

## 规范

- 不要自动跑长驻 `tauri dev`
- 对照 `electron` 分支行为做 parity，优先 happy path
- IPC 契约以 `src/shared/api.ts` + `tauri-api.ts` 为准
- 扫描期间仅在读缓存/落库时持有 DB Mutex
