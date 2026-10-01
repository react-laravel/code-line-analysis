use crate::scan::filters::is_excluded_asset_path;
use crate::types::FolderRules;
use globset::{Glob, GlobSetBuilder};
use ignore::WalkBuilder;
use std::path::{Component, Path, PathBuf};

fn expand_blacklist(pattern: &str) -> Vec<String> {
    let normalized = pattern.trim().replace('\\', "/").trim_start_matches("./").trim_matches('/').to_string();
    if normalized.is_empty() { return vec![]; }
    if normalized.contains('/') {
        vec![normalized.clone(), format!("{normalized}/**")]
    } else {
        vec![normalized.clone(), format!("**/{normalized}"), format!("**/{normalized}/**")]
    }
}

fn expand_whitelist(pattern: &str) -> Vec<String> {
    let trimmed = pattern.trim().replace('\\', "/").trim_start_matches("./").to_string();
    let directory_like = trimmed.ends_with('/');
    let normalized = trimmed.trim_matches('/').to_string();
    if normalized.is_empty() { return vec![]; }
    if directory_like {
        vec![format!("{normalized}/**")]
    } else {
        vec![normalized]
    }
}

fn build_globset(patterns: &[String]) -> Option<globset::GlobSet> {
    if patterns.is_empty() { return None; }
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        if let Ok(g) = Glob::new(p) {
            builder.add(g);
        }
    }
    builder.build().ok()
}

pub fn walk_folder(root: &Path, rules: &FolderRules) -> Vec<String> {
    let blacklist_patterns: Vec<String> = rules.blacklist.iter().flat_map(|p| expand_blacklist(p)).collect();
    let whitelist_patterns: Vec<String> = rules.whitelist.iter().flat_map(|p| expand_whitelist(p)).collect();
    let blacklist = build_globset(&blacklist_patterns);
    let whitelist = if whitelist_patterns.is_empty() { None } else { build_globset(&whitelist_patterns) };

    let mut out = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .follow_links(false)
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if !entry.file_type().is_some_and(|kind| kind.is_file()) { continue; }
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str.is_empty() { continue; }
        // Match Electron fast-glob `dot: false`
        if rel_str.split('/').any(|s| s.starts_with('.')) { continue; }
        if is_excluded_asset_path(&rel_str) { continue; }
        if let Some(ref bl) = blacklist {
            if bl.is_match(&rel_str) { continue; }
        }
        if let Some(ref wl) = whitelist {
            if !wl.is_match(&rel_str) { continue; }
        }
        // skip dotfiles/dirs already partially handled; also skip .git internals
        if rel_str.split('/').any(|s| s == ".git") { continue; }
        out.push(rel_str);
    }
    out.sort();
    out
}

pub fn ensure_inside_root(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    // Reject '..'/absolute components up front: for nonexistent targets (file_write)
    // canonicalize() below fails and starts_with alone would let "../evil" escape root.
    if Path::new(rel_path)
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err("Path outside folder root rejected".into());
    }
    let root_c = root.canonicalize().map_err(|e| e.to_string())?;
    let mut existing = root_c.join(rel_path);
    let mut missing = Vec::new();
    while !existing.try_exists().map_err(|e| e.to_string())? {
        missing.push(existing.file_name().ok_or("Invalid path")?.to_os_string());
        if !existing.pop() { return Err("Invalid path".into()); }
    }
    let mut abs = existing.canonicalize().map_err(|e| e.to_string())?;
    if abs == root_c || abs.starts_with(&root_c) {
        for component in missing.into_iter().rev() { abs.push(component); }
        Ok(abs)
    } else {
        Err("Path outside folder root rejected".into())
    }
}

/// Open an ordinary file without following file or directory symlinks. On Unix
/// each directory handle anchors the next open, including across rename races.
#[cfg(unix)]
pub fn open_regular_file(root: &Path, rel_path: &str) -> std::io::Result<Option<std::fs::File>> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let (parent, name) = open_parent(root, rel_path)?;
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK) };
    if fd < 0 {
        let err = std::io::Error::last_os_error();
        if matches!(err.raw_os_error(), Some(libc::ELOOP | libc::ENOENT | libc::ENOTDIR)) { return Ok(None); }
        return Err(err);
    }
    let file = unsafe { std::fs::File::from_raw_fd(fd) };
    if !file.metadata()?.is_file() { return Ok(None); }
    Ok(Some(file))
}

#[cfg(unix)]
pub(crate) fn open_parent(root: &Path, rel_path: &str) -> std::io::Result<(std::fs::File, std::ffi::CString)> {
    use std::os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::OpenOptionsExt}};
    let invalid = || std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid relative file path");
    let mut parts = Vec::new();
    for component in Path::new(rel_path).components() {
        match component {
            Component::Normal(name) => parts.push(std::ffi::CString::new(name.as_bytes()).map_err(|_| invalid())?),
            Component::CurDir => (),
            _ => return Err(invalid()),
        }
    }
    let name = parts.pop().ok_or_else(invalid)?;
    let canonical_root = root.canonicalize()?;
    let mut dir = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW).open(canonical_root)?;
    for part in parts {
        let fd = unsafe { libc::openat(dir.as_raw_fd(), part.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
        if fd < 0 { return Err(std::io::Error::last_os_error()); }
        dir = unsafe { std::fs::File::from_raw_fd(fd) };
    }
    Ok((dir, name))
}

#[cfg(not(unix))]
pub fn open_regular_file(root: &Path, rel_path: &str) -> std::io::Result<Option<std::fs::File>> {
    let abs = ensure_inside_root(root, rel_path).map_err(|e| std::io::Error::new(std::io::ErrorKind::PermissionDenied, e))?;
    let mut path = root.to_path_buf();
    for component in Path::new(rel_path).components() {
        path.push(component);
        if std::fs::symlink_metadata(&path)?.file_type().is_symlink() { return Ok(None); }
    }
    if !std::fs::symlink_metadata(&abs)?.is_file() { return Ok(None); }
    Ok(Some(std::fs::File::open(abs)?))
}

pub fn read_regular_file(root: &Path, rel_path: &str, max_bytes: u64) -> std::io::Result<Option<(Vec<u8>, std::fs::Metadata)>> {
    use std::io::Read;
    let Some(file) = open_regular_file(root, rel_path)? else { return Ok(None) };
    let metadata = file.metadata()?;
    if metadata.len() > max_bytes { return Ok(None); }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes { return Ok(None); }
    Ok(Some((bytes, metadata)))
}

#[cfg(test)]
mod tests {
    use super::ensure_inside_root;
    use std::path::PathBuf;

    fn test_root() -> PathBuf {
        // Canonicalize so macOS /tmp -> /private/tmp symlinks don't skew starts_with.
        std::env::temp_dir().canonicalize().unwrap()
    }

    #[test]
    fn rejects_parent_dir_components() {
        let root = test_root();
        assert!(ensure_inside_root(&root, "../x").is_err());
        assert!(ensure_inside_root(&root, "a/../../x").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        let root = test_root();
        assert!(ensure_inside_root(&root, "/abs").is_err());
    }

    #[test]
    fn accepts_normal_nested_path() {
        let root = test_root();
        let resolved = ensure_inside_root(&root, "a/b.txt").expect("nested path inside root");
        assert_eq!(resolved, root.join("a/b.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_for_reads_and_nonexistent_write_targets() {
        use std::os::unix::fs::symlink;
        let root = test_root().join(format!("cla-links-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("real.rs"), b"fn main() {}").unwrap();
        symlink(root.join("real.rs"), root.join("alias.rs")).unwrap();
        symlink(test_root(), root.join("outside")).unwrap();
        assert!(ensure_inside_root(&root, "outside/new.rs").is_err());
        assert!(super::read_regular_file(&root, "alias.rs", 1024).unwrap().is_none());
        assert!(super::open_regular_file(&root, "outside/unknown.rs").is_err());
        let paths = super::walk_folder(&root, &crate::types::FolderRules::default());
        assert_eq!(paths, vec!["real.rs"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn skips_fifo_without_blocking_and_limits_large_files_before_read() {
        use std::os::unix::ffi::OsStrExt;
        let root = test_root().join(format!("cla-bounded-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        let fifo = std::ffi::CString::new(root.join("fifo.rs").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(super::open_regular_file(&root, "fifo.rs").unwrap().is_none());
        std::fs::File::create(root.join("huge.rs")).unwrap().set_len(1024 * 1024 * 1024).unwrap();
        assert!(super::read_regular_file(&root, "huge.rs", 1024).unwrap().is_none());
        std::fs::write(root.join("small.rs"), b"abc").unwrap();
        assert_eq!(super::read_regular_file(&root, "small.rs", 3).unwrap().unwrap().0, b"abc");
        std::fs::remove_dir_all(root).unwrap();
    }
}
