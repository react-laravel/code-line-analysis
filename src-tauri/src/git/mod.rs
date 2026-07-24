use crate::error::AppResult;
use crate::types::{GitAuthorStat, GitFileInfo, GitRepoInfo, HeatmapBucket};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

fn run_git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

fn is_repo(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

pub fn get_git_file_info(root: &Path, rel_path: &str) -> AppResult<Option<GitFileInfo>> {
    if !is_repo(root) { return Ok(None); }
    let log = run_git(root, &["log", "-n", "1", "--pretty=format:%H%n%an%n%aI", "--", rel_path]);
    let (last_sha, last_author, last_date) = if let Some(log) = log {
        let mut lines = log.lines();
        let sha = lines.next().map(|s| s.to_string());
        let author = lines.next().map(|s| s.to_string());
        let date = lines.next().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s.trim())
                .ok()
                .map(|d| d.timestamp_millis())
        });
        (sha, author, date)
    } else {
        (None, None, None)
    };

    let mut top_authors = Vec::new();
    if let Some(blame) = run_git(root, &["blame", "--line-porcelain", rel_path]) {
        let mut counts: HashMap<String, i64> = HashMap::new();
        for line in blame.lines() {
            if let Some(a) = line.strip_prefix("author ") {
                *counts.entry(a.to_string()).or_default() += 1;
            }
        }
        let mut authors: Vec<_> = counts.into_iter().map(|(author, lines)| GitAuthorStat { author, lines }).collect();
        authors.sort_by(|a, b| b.lines.cmp(&a.lines));
        authors.truncate(5);
        top_authors = authors;
    }

    Ok(Some(GitFileInfo {
        last_sha,
        last_author,
        last_date,
        top_authors,
    }))
}

pub fn get_git_file_last_date(root: &Path, rel_path: &str) -> Option<i64> {
    if !is_repo(root) {
        return None;
    }
    let log = run_git(
        root,
        &["log", "-n", "1", "--pretty=format:%aI", "--", rel_path],
    )?;
    chrono::DateTime::parse_from_rfc3339(log.trim())
        .ok()
        .map(|d| d.timestamp_millis())
}

fn normalize_remote_web(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Some(
            trimmed
                .trim_end_matches(".git")
                .trim_end_matches(".GIT")
                .to_string(),
        );
    }
    if let Some(rest) = trimmed.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            return Some(format!(
                "https://{host}/{}",
                path.trim_end_matches(".git")
            ));
        }
    }
    // ssh://git@host/path or git://host/path
    if let Some(rest) = trimmed
        .strip_prefix("ssh://")
        .or_else(|| trimmed.strip_prefix("git://"))
    {
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        if let Some((host, path)) = rest.split_once('/') {
            return Some(format!(
                "https://{host}/{}",
                path.trim_end_matches(".git")
            ));
        }
    }
    None
}

pub fn get_git_repo_info(root: &Path) -> AppResult<Option<GitRepoInfo>> {
    if !is_repo(root) { return Ok(None); }
    let log = run_git(root, &["log", "-n", "1", "--pretty=format:%H%n%aI"]);
    let (last_commit_sha, last_commit_date) = if let Some(log) = log {
        let mut lines = log.lines();
        let sha = lines.next().map(|s| s.to_string());
        let date = lines.next().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s.trim())
                .ok()
                .map(|d| d.timestamp_millis())
        });
        (sha, date)
    } else {
        (None, None)
    };
    let remote = run_git(root, &["remote", "get-url", "origin"]).map(|s| s.trim().to_string());
    let web = remote.as_deref().and_then(normalize_remote_web);
    Ok(Some(GitRepoInfo {
        last_commit_sha,
        last_commit_date,
        remote_origin_url: remote,
        remote_origin_web_url: web,
    }))
}

pub fn get_git_heatmap(root: &Path, days: i64) -> AppResult<Vec<HeatmapBucket>> {
    if !is_repo(root) { return Ok(vec![]); }
    let since = format!("{}.days", days.max(1));
    let raw = match run_git(root, &[
        "log", &format!("--since={since}"), "--date=short",
        "--pretty=format:__CLA_DATE__%ad", "--numstat", "--",
    ]) {
        Some(s) => s,
        None => return Ok(vec![]),
    };
    let mut buckets: HashMap<String, (std::collections::HashSet<String>, i64)> = HashMap::new();
    let mut current = String::new();
    for line in raw.lines() {
        if line.trim().is_empty() { continue; }
        if let Some(date) = line.strip_prefix("__CLA_DATE__") {
            current = date.trim().to_string();
            buckets.entry(current.clone()).or_insert_with(|| (std::collections::HashSet::new(), 0));
            continue;
        }
        if current.is_empty() { continue; }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 { continue; }
        let added: i64 = parts[0].parse().unwrap_or(0);
        let deleted: i64 = parts[1].parse().unwrap_or(0);
        let file = parts[2].to_string();
        if let Some(b) = buckets.get_mut(&current) {
            b.0.insert(file);
            b.1 += added + deleted;
        }
    }
    let mut out: Vec<HeatmapBucket> = buckets
        .into_iter()
        .map(|(date, (files, lines))| HeatmapBucket {
            date,
            files: files.len() as i64,
            lines,
        })
        .collect();
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}
