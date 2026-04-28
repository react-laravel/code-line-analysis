# Code Line Analysis

[简体中文](README.zh-CN.md)

Code Line Analysis is an Electron desktop app for scanning local repositories, storing metrics in a local SQLite database, and browsing the results through a React-based desktop UI.

## Highlights

- Analyze multiple folders in one workspace.
- Run incremental scans or full rescans with live progress updates.
- Count total, code, comment, blank, and block-comment lines.
- Track baseline snapshots and line deltas over time.
- Browse results through dashboard, tree, files, tags, top, heatmap, and duplicate-code views.
- Inspect and edit files in-app with Monaco Editor, line jumps, and Git metadata.
- Control scan scope with whitelist and blacklist glob rules.
- Switch the UI between English and Simplified Chinese.

## Views

- Workspace: add folders and switch between analyzed projects.
- Dashboard: summary cards, per-language charts, scans, and baseline actions.
- Folder Manager: configure whitelist and blacklist scan rules.
- Tree: inspect directory totals and open files from a hierarchical view.
- Files: search, filter, sort, and open scanned files.
- Tags: review TODO, FIXME, HACK, NOTE, and XXX markers.
- Top Files and Functions: find large files and long functions quickly.
- Heatmap: inspect recent activity based on file modification time.
- Duplicates: review duplicate code clusters with 6 or more lines.

## Tech Stack

- Electron
- React 18
- TypeScript
- Vite
- better-sqlite3
- Monaco Editor
- Recharts
- simple-git

## Requirements

- Node.js 20 or newer is recommended.
- npm

## Development

Install dependencies and start the app in development mode:

```bash
npm install
npm run dev
```

If the native SQLite module needs to be rebuilt for your local Electron version:

```bash
npm run rebuild
```

## Build and Package

```bash
npm run build
npm run dist
npm run dist:signed
```

- `npm run build` builds the renderer and the Electron main process.
- `npm run dist` creates unsigned desktop artifacts.
- `npm run dist:signed` uses Electron Builder's default signing behavior.
- Packaged output is written to the `release/` directory.

## Usage

1. Open the app and add a folder from the Workspace view.
2. The app can start an initial scan immediately after adding a folder.
3. Use Dashboard actions to run an incremental scan, a full rescan, or manage the baseline.
4. Browse the project through the Tree, Files, Tags, Top, Heatmap, and Duplicates views.
5. Open a file in the editor to inspect metrics, Git info, tags, and optionally save changes.

## Data Storage

Scan results are stored locally in a SQLite database at Electron's user-data path using the file name `codeline.sqlite`.

## Project Structure

- `src/main`: Electron main process, IPC handlers, database access, scanners, parsers, and git integration.
- `src/preload`: preload bridge exposed to the renderer.
- `src/renderer`: React UI, routes, Monaco integration, and page-level views.
- `src/shared`: shared types and IPC-facing contracts.
- `build`: app icon sources and packaging resources.
- `release`: generated build and packaging output.

## Contributor Notes

- When changing IPC contracts, keep `src/main`, `src/preload`, and `src/shared/api.ts` in sync.
- Packaging icons are sourced from `build/icon.png`, `build/icon.icns`, and `build/icon.ico`.

## License

MIT