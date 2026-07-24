use crate::scan::filters::is_excluded_asset_path;
use crate::types::FolderRules;
use globset::{Glob, GlobSetBuilder};
use ignore::WalkBuilder;
use std::path::{Path, PathBuf};

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
        if !path.is_file() { continue; }
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
    let abs = root.join(rel_path);
    let abs = abs.canonicalize().unwrap_or(abs);
    let root_c = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if abs == root_c || abs.starts_with(&root_c) {
        Ok(root.join(rel_path))
    } else {
        Err("Path outside folder root rejected".into())
    }
}
