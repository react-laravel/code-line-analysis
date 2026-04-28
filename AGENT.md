# AGENT.md

## Project Overview

Code Line Analysis is an Electron desktop app for scanning repositories, collecting code statistics, and browsing results in a React renderer.

## Common Commands

- `npm run dev`: start the Vite renderer and Electron main process in development.
- `npm run build`: build the renderer and the Electron main process.
- `npm run dist`: create packaged desktop artifacts without macOS code signing.
- `npm run dist:signed`: create packaged desktop artifacts with electron-builder's default signing behavior.
- `npm run rebuild`: rebuild native modules for the current Electron version.

## Repository Layout

- `src/main`: Electron main process, IPC registration, database access, git integration, scanners, and parsers.
- `src/preload`: preload bridge exposed to the renderer.
- `src/renderer`: React UI, routes, Monaco integration, and page-level views.
- `src/shared`: types shared between the main process and renderer.

## Implementation Notes

- Desktop app icon source lives at `build/icon.png`.
- Generated platform icons live at `build/icon.icns` and `build/icon.ico`.
- Packaging icon configuration is defined in `package.json` under `build`.
- Runtime window and dock icon wiring is defined in `src/main/index.ts`.
- Packaged runtime icon loading depends on `extraResources` copying `build/icon.png` to `Resources/icon.png`.
- When changing IPC contracts, keep `src/main`, `src/preload`, and `src/shared/api.ts` aligned.
