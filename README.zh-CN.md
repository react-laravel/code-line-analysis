# Code Line Analysis

基于 **Tauri 2** 的本地代码行数统计与仓库分析工具。

> 完整 Electron / 网页版在 [`electron`](https://github.com/react-laravel/code-line-analysis/tree/electron) 分支。

## 开发

```bash
npm install
npm run dev
npm run build
```

## 说明

- 数据落在应用数据目录下的 `codeline.sqlite`
- 扫描尊重 `.gitignore`、全局/工作区规则，以及资源类扩展名排除列表
- 热力图优先使用 `git log --numstat`，否则回退到文件 mtime
