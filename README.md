# Code Line Analysis

[简体中文](README.zh-CN.md)

Code Line Analysis is an Electron desktop app and deployable static web app for scanning local repositories, storing metrics in a local SQLite database on desktop, and browsing results through a React UI.

## Highlights

- Analyze multiple folders in one workspace.
- Drag a folder into the web build and analyze it locally in the browser.
- Scan folders with live progress updates.
- Count total, code, comment, blank, and block-comment lines.
- Browse results through dashboard, tree, files, tags, top, heatmap, and duplicate-code views.
- Inspect and edit files in-app with Monaco Editor, line jumps, and Git metadata.
- Control scan scope with global whitelist and blacklist rules, then refine them per workspace.
- Switch the UI between English and Simplified Chinese.

## Views

- Workspace: add folders and switch between analyzed projects.
- Dashboard: summary cards and per-language charts.
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
npm run build:web
npm run build
npm run dist
npm run dist:signed
```

- `npm run build:web` creates the static web build in `dist/renderer`.
- `npm run build` builds the renderer and the Electron main process.
- `npm run dist` creates unsigned desktop artifacts.
- `npm run dist:signed` uses Electron Builder's default signing behavior.
- Packaged output is written to the `release/` directory.

## Web Deployment

The renderer can now be deployed as a static site. Build it with:

```bash
npm run build:web
```

Then publish the contents of `dist/renderer` to any static host such as Nginx, GitHub Pages, Vercel, or Netlify. The app uses `HashRouter`, so no SPA rewrite rule is required.

See [WEB_DEPLOY.md](WEB_DEPLOY.md) for deployment steps, browser requirements, and web-mode limitations.

## Usage

1. Open the app and add a folder from the Workspace view.
2. The app can start an initial scan immediately after adding a folder.
3. Configure global whitelist and blacklist rules in Settings when you need app-wide defaults.
4. Refine scan scope for an individual workspace in Folder Manager.
5. Browse the project through the Tree, Files, Tags, Top, Heatmap, and Duplicates views.
6. Open a file in the editor to inspect metrics, Git info, tags, and optionally save changes.

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