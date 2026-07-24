# AGENTS.md

## Project Overview

Code Line Analysis is a Tauri 2 desktop app for scanning repositories, collecting code statistics, and browsing results in a React renderer.

The full Electron / static-web edition lives on the `electron` branch.

## Common Commands

- `npm run dev`: start Tauri (Vite renderer + Rust backend)
- `npm run build`: package the desktop app
- `npm run dev:ui` / `npm run build:ui`: frontend only
- `cargo check --manifest-path src-tauri/Cargo.toml`

## Repository Layout

- `src-tauri`: Rust backend (SQLite, scanner, parsers, stats, git, analysis, commands)
- `src/renderer`: React UI and Tauri runtime bridge
- `src/shared`: types shared with the renderer API contract

## Implementation Notes

- Desktop icons live under `src-tauri/icons/` (source also in `build/icon.png`)
- When changing the API surface, keep `src/shared/api.ts` and `src/renderer/runtime/tauri-api.ts` aligned with Rust command names
- Progress events use the exact name `scan:progress`
- CI: `.github/workflows/ci.yml` runs `build:ui` + `cargo check`
- Web deploy workflow targets the `electron` branch only
