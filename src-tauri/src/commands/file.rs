use crate::db;
use crate::error::{AppError, AppResult};
use crate::parsers::languages::detect_lang;
use crate::parsers::line_parser::count_lines;
use crate::parsers::tag_scanner::scan_tags;
use crate::parsers::func_detect::find_functions;
use crate::scan::walk::{ensure_inside_root, read_regular_file};
use crate::state::AppState;
use crate::types::FileMeta;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_EDITOR_BYTES: u64 = 5 * 1024 * 1024;

fn content_hash(content: &[u8]) -> String {
    hex::encode(Sha1::digest(content))
}

#[cfg(unix)]
fn write_checked(root: &std::path::Path, rel: &str, content: &[u8], expected_hash: &str) -> AppResult<std::fs::Metadata> {
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let (parent, name) = crate::scan::walk::open_parent(root, rel)?;
    let open = || -> AppResult<std::fs::File> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
        if fd < 0 { return Err(AppError::msg("File changed or removed on disk; reload before saving")); }
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        if !file.metadata()?.is_file() { return Err(AppError::msg("Only regular files can be saved")); }
        Ok(file)
    };
    let verify = |file: &std::fs::File| -> AppResult<()> {
        if file.metadata()?.len() > MAX_EDITOR_BYTES { return Err(AppError::msg("File exceeds the 5 MiB editor limit")); }
        let mut bytes = Vec::new();
        file.take(MAX_EDITOR_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_EDITOR_BYTES { return Err(AppError::msg("File exceeds the 5 MiB editor limit")); }
        if content_hash(&bytes) != expected_hash { return Err(AppError::msg("File changed on disk; reload before saving")); }
        Ok(())
    };
    let original = open()?;
    verify(&original)?;
    let temp_name = std::ffi::CString::new(format!(".cla-save-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))).unwrap();
    let fd = unsafe { libc::openat(parent.as_raw_fd(), temp_name.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW, 0o600) };
    if fd < 0 { return Err(std::io::Error::last_os_error().into()); }
    let result = (|| -> AppResult<std::fs::Metadata> {
        let mut temp = unsafe { std::fs::File::from_raw_fd(fd) };
        temp.set_permissions(original.metadata()?.permissions())?;
        temp.write_all(content)?;
        temp.sync_all()?;
        let saved_metadata = temp.metadata()?;
        verify(&open()?)?;
        if unsafe { libc::renameat(parent.as_raw_fd(), temp_name.as_ptr(), parent.as_raw_fd(), name.as_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(saved_metadata)
    })();
    if result.is_err() { unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0); } }
    result
}

#[cfg(not(unix))]
fn write_checked(root: &std::path::Path, rel: &str, content: &[u8], expected_hash: &str) -> AppResult<std::fs::Metadata> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let (bytes, _) = read_regular_file(root, rel, MAX_EDITOR_BYTES)?.ok_or_else(|| AppError::msg("File changed or exceeds the 5 MiB editor limit"))?;
    if content_hash(&bytes) != expected_hash { return Err(AppError::msg("File changed on disk; reload before saving")); }
    let abs = ensure_inside_root(root, rel).map_err(AppError::msg)?;
    let temp_path = abs.with_file_name(format!(".cla-save-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    // A failed create_new must never unlink another save's existing temp file.
    let mut temp = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp_path)?;
    let result = (|| -> AppResult<std::fs::Metadata> {
        temp.set_permissions(std::fs::metadata(&abs)?.permissions())?;
        temp.write_all(content)?;
        temp.sync_all()?;
        let saved_metadata = temp.metadata()?;
        let (bytes, _) = read_regular_file(root, rel, MAX_EDITOR_BYTES)?.ok_or_else(|| AppError::msg("File changed on disk"))?;
        if content_hash(&bytes) != expected_hash { return Err(AppError::msg("File changed on disk; reload before saving")); }
        std::fs::rename(&temp_path, abs)?;
        Ok(saved_metadata)
    })();
    drop(temp);
    if result.is_err() { let _ = std::fs::remove_file(temp_path); }
    result
}

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
    let (bytes, meta_fs) = read_regular_file(&root, &rel_path, MAX_EDITOR_BYTES)?
        .ok_or_else(|| AppError::msg("Only regular files up to 5 MiB can be opened"))?;
    let content = String::from_utf8(bytes).map_err(|_| AppError::msg("File is not UTF-8 text"))?;
    let size = content.len() as i64;
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
    expected_hash: String,
) -> AppResult<FileMeta> {
    let root = {
        let conn = state.db.lock();
        PathBuf::from(db::folder_root(&conn, folder_id)?)
    };
    ensure_inside_root(&root, &rel_path).map_err(AppError::msg)?;
    if content.len() as u64 > MAX_EDITOR_BYTES { return Err(AppError::msg("File exceeds the 5 MiB editor limit")); }
    let meta_fs = write_checked(&root, &rel_path, content.as_bytes(), &expected_hash)?;
    let size = meta_fs.len() as i64;
    let mtime = meta_fs
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let (meta, ext, lang_def) = meta_from_content(&rel_path, &content, size, mtime);
    let tags = scan_tags(&content, lang_def.as_ref());
    let functions = find_functions(&content, &ext);
    let scanned_at = now_ms();

    let mut conn = state.db.lock();
    let tx = conn.transaction()?;
    let conn = &tx;
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

    conn.execute("DELETE FROM duplicates WHERE file_id = ?", [file_id])?;
    conn.execute("DELETE FROM duplicate_cache WHERE file_id = ?", [file_id])?;
    conn.execute("DELETE FROM functions WHERE file_id = ?", [file_id])?;
    for function in functions {
        conn.execute("INSERT INTO functions(file_id, name, start_line, end_line, length) VALUES(?,?,?,?,?)",
            rusqlite::params![file_id, function.name, function.start_line, function.end_line, function.length])?;
    }
    tx.commit()?;
    state.data_revision.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn save_detects_conflicts_preserves_permissions_and_replaces_atomically() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
        let root = std::env::temp_dir().join(format!("cla-save-{}", now_ms()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("main.rs");
        std::fs::write(&path, b"original").unwrap();
        let original_inode = std::fs::metadata(&path).unwrap().ino();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        assert!(write_checked(&root, "main.rs", b"new", &content_hash(b"old version")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let saved = write_checked(&root, "main.rs", b"new", &content_hash(b"original")).unwrap();
        assert_eq!(saved.len(), 3);
        assert_ne!(saved.ino(), original_inode);
        assert_eq!(saved.ino(), std::fs::metadata(&path).unwrap().ino());
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
        assert!(write_checked(&root, "missing.rs", b"new", &content_hash(b"")).is_err());
        symlink(std::env::temp_dir(), root.join("outside")).unwrap();
        assert!(write_checked(&root, "outside/missing.rs", b"new", &content_hash(b"")).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        symlink(&path, root.join("alias.rs")).unwrap();
        assert!(write_checked(&root, "alias.rs", b"changed", &content_hash(b"new")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        std::fs::File::create(root.join("huge.rs")).unwrap().set_len(MAX_EDITOR_BYTES + 1).unwrap();
        assert!(write_checked(&root, "huge.rs", b"changed", &content_hash(b"")).is_err());
        assert_eq!(std::fs::metadata(root.join("huge.rs")).unwrap().len(), MAX_EDITOR_BYTES + 1);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 4);
        std::fs::remove_dir_all(root).unwrap();
    }
}
