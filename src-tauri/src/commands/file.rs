use crate::db;
use crate::error::{AppError, AppResult};
use crate::parsers::languages::detect_lang;
use crate::parsers::line_parser::count_lines;
use crate::parsers::tag_scanner::scan_tags;
use crate::scan::walk::ensure_inside_root;
use crate::state::AppState;
use crate::types::FileMeta;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn meta_from_content(
    rel_path: &str,
    content: &str,
    size: i64,
    mtime: i64,
) -> (FileMeta, String, Option<crate::parsers::languages::LangDef>) {
    let (ext, lang_def, lang_id) = detect_lang(rel_path);
    let counts = count_lines(content, lang_def.as_ref());
    let mut hasher = Sha1::new();
    hasher.update(content.as_bytes());
    let hash = hex::encode(hasher.finalize());
    (
        FileMeta {
            rel_path: rel_path.to_string(),
            size,
            mtime,
            lang: lang_id,
            total: counts.total,
            code: counts.code,
            comment: counts.comment,
            blank: counts.blank,
            block_comment: counts.block_comment,
            hash,
        },
        ext,
        lang_def,
    )
}

#[tauri::command]
pub fn file_read(
    state: State<'_, AppState>,
    folder_id: i64,
    rel_path: String,
) -> AppResult<serde_json::Value> {
    let conn = state.db.lock();
    let root = PathBuf::from(db::folder_root(&conn, folder_id)?);
    drop(conn);
    let abs = ensure_inside_root(&root, &rel_path).map_err(AppError::msg)?;
    let content = std::fs::read_to_string(&abs)?;
    let meta_fs = std::fs::metadata(&abs)?;
    let size = meta_fs.len() as i64;
    let mtime = meta_fs
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let (meta, _, _) = meta_from_content(&rel_path, &content, size, mtime);
    Ok(serde_json::json!({ "content": content, "meta": meta }))
}

#[tauri::command]
pub fn file_write(
    state: State<'_, AppState>,
    folder_id: i64,
    rel_path: String,
    content: String,
) -> AppResult<FileMeta> {
    let root = {
        let conn = state.db.lock();
        PathBuf::from(db::folder_root(&conn, folder_id)?)
    };
    let abs = ensure_inside_root(&root, &rel_path).map_err(AppError::msg)?;
    std::fs::write(&abs, &content)?;

    let meta_fs = std::fs::metadata(&abs)?;
    let size = meta_fs.len() as i64;
    let mtime = meta_fs
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let (meta, ext, lang_def) = meta_from_content(&rel_path, &content, size, mtime);
    let tags = scan_tags(&content, lang_def.as_ref());
    let scanned_at = now_ms();

    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO files(folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, scanned_at, deleted)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,0)
         ON CONFLICT(folder_id, rel_path) DO UPDATE SET
           lang=excluded.lang, ext=excluded.ext, size=excluded.size, mtime=excluded.mtime, hash=excluded.hash,
           total=excluded.total, code=excluded.code, comment=excluded.comment, blank=excluded.blank,
           block_comment=excluded.block_comment, scanned_at=excluded.scanned_at, deleted=0",
        rusqlite::params![
            folder_id,
            rel_path,
            meta.lang,
            ext,
            meta.size,
            meta.mtime,
            meta.hash,
            meta.total,
            meta.code,
            meta.comment,
            meta.blank,
            meta.block_comment,
            scanned_at,
        ],
    )?;
    let file_id: i64 = conn.query_row(
        "SELECT id FROM files WHERE folder_id = ? AND rel_path = ?",
        rusqlite::params![folder_id, rel_path],
        |r| r.get(0),
    )?;
    conn.execute("DELETE FROM tags WHERE file_id = ?", [file_id])?;
    for tag in tags {
        conn.execute(
            "INSERT INTO tags(file_id, kind, line_no, text) VALUES(?,?,?,?)",
            rusqlite::params![file_id, tag.kind, tag.line_no, tag.text],
        )?;
    }

    Ok(meta)
}

#[tauri::command]
pub fn file_meta(
    state: State<'_, AppState>,
    folder_id: i64,
    rel_path: String,
) -> AppResult<Option<FileMeta>> {
    let conn = state.db.lock();
    let row = conn.query_row(
        "SELECT rel_path, size, mtime, lang, total, code, comment, blank, block_comment, hash
         FROM files WHERE folder_id = ? AND rel_path = ? AND deleted = 0",
        rusqlite::params![folder_id, rel_path],
        |r| {
            Ok(FileMeta {
                rel_path: r.get(0)?,
                size: r.get(1)?,
                mtime: r.get(2)?,
                lang: r.get(3)?,
                total: r.get(4)?,
                code: r.get(5)?,
                comment: r.get(6)?,
                blank: r.get(7)?,
                block_comment: r.get(8)?,
                hash: r.get(9)?,
            })
        },
    );
    Ok(row.ok())
}
