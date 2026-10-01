use crate::error::AppResult;
use crate::types::{GitAuthorStat, GitFileInfo, GitRepoInfo, HeatmapBucket};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::time::{Duration, Instant};

const GIT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_GIT_OUTPUT: usize = 32 * 1024 * 1024;

/// Repository configuration is untrusted. In particular, index refresh can
/// execute core.fsmonitor, and blame/log can execute attribute textconv helpers.
fn git_command(root: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .args([
            "--no-pager",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.quotePath=false",
            "-c",
            "log.showSignature=false",
            "-c",
            "protocol.allow=never",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .current_dir(root);
    command
}

/// Read incrementally with a deadline. Dropping/cancelling a request kills and
/// reaps Git, rather than leaving a blame process running after its tab closes.
fn stream_command(
    mut command: Command,
    delimiter: u8,
    cancel: Option<&AtomicBool>,
    timeout: Duration,
    mut consume: impl FnMut(&[u8]) -> bool,
) -> bool {
    if cancel.is_some_and(|c| c.load(Ordering::Acquire)) || timeout.is_zero() {
        return false;
    }
    let Ok(mut child) = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let (sender, receiver) = sync_channel(8);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout.take((MAX_GIT_OUTPUT + 1) as u64));
        loop {
            let mut record = Vec::new();
            match reader.read_until(delimiter, &mut record) {
                Ok(0) => break,
                Ok(_) => {
                    if sender.send(record).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let deadline = Instant::now() + timeout;
    let mut bytes = 0;
    let success = loop {
        if cancel.is_some_and(|c| c.load(Ordering::Acquire)) || Instant::now() >= deadline {
            break false;
        }
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(record) => {
                bytes += record.len();
                if bytes > MAX_GIT_OUTPUT {
                    break false;
                }
                let record = record.strip_suffix(&[delimiter]).unwrap_or(&record);
                if !consume(record) {
                    break true;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => match child.try_wait() {
                Ok(Some(status)) => break status.success(),
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break false,
            },
        }
    };
    drop(receiver);
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    success
}

fn run_git(root: &Path, args: &[&str]) -> Option<String> {
    run_git_cancellable(root, args, None)
}

fn run_git_cancellable(root: &Path, args: &[&str], cancel: Option<&AtomicBool>) -> Option<String> {
    let mut output = String::new();
    let success = stream_command(
        git_command(root, args),
        b'\n',
        cancel,
        GIT_TIMEOUT,
        |line| {
            output.push_str(&String::from_utf8_lossy(line));
            output.push('\n');
            true
        },
    );
    success.then_some(output)
}

fn is_repo(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

pub fn get_git_file_info(
    root: &Path,
    rel_path: &str,
    cancel: Option<&AtomicBool>,
) -> AppResult<Option<GitFileInfo>> {
    if !run_git_cancellable(root, &["rev-parse", "--is-inside-work-tree"], cancel)
        .is_some_and(|s| s.trim() == "true")
    {
        return Ok(None);
    }
    let log = run_git_cancellable(
        root,
        &[
            "log",
            "--no-ext-diff",
            "--no-textconv",
            "-n",
            "1",
            "--pretty=format:%H%n%an%n%aI",
            "--",
            rel_path,
        ],
        cancel,
    );
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
    // A working-tree blame also executes filter.<driver>.clean/process, even
    // with --no-textconv. Read committed blobs explicitly to avoid all filters.
    if let Some(blame) = run_git_cancellable(
        root,
        &[
            "blame",
            "--no-textconv",
            "--line-porcelain",
            "HEAD",
            "--",
            rel_path,
        ],
        cancel,
    ) {
        let mut counts: HashMap<String, i64> = HashMap::new();
        for line in blame.lines() {
            if let Some(a) = line.strip_prefix("author ") {
                *counts.entry(a.to_string()).or_default() += 1;
            }
        }
        let mut authors: Vec<_> = counts
            .into_iter()
            .map(|(author, lines)| GitAuthorStat { author, lines })
            .collect();
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

/// Query only requested paths present in HEAD. Uncommitted paths must not make
/// log traverse the entire repository history. Argument batches avoid OS argv
/// limits, and all batches share one deadline.
pub fn get_git_last_dates(root: &Path, rel_paths: &[String]) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    if rel_paths.is_empty() {
        return out;
    }
    let deadline = Instant::now() + GIT_TIMEOUT;
    let wanted: std::collections::HashSet<&str> = rel_paths.iter().map(String::as_str).collect();
    let mut committed = Vec::new();
    if !stream_command(
        git_command(root, &["ls-tree", "-r", "--name-only", "-z", "HEAD"]),
        b'\0',
        None,
        deadline.saturating_duration_since(Instant::now()),
        |record| {
            let path = String::from_utf8_lossy(record);
            if wanted.contains(path.as_ref()) {
                committed.push(path.into_owned());
            }
            true
        },
    ) {
        return out;
    }
    committed.sort();
    let mut offset = 0;
    while offset < committed.len() && Instant::now() < deadline {
        let start = offset;
        let mut arg_bytes = 0;
        while offset < committed.len()
            && (offset == start || arg_bytes + committed[offset].len() < 32 * 1024)
        {
            arg_bytes += committed[offset].len() + 1;
            offset += 1;
        }
        let batch = &committed[start..offset];
        let batch_wanted: std::collections::HashSet<&str> =
            batch.iter().map(String::as_str).collect();
        let mut args = vec![
            "log",
            "--no-ext-diff",
            "--no-textconv",
            "--pretty=format:__CLA_COMMIT__%aI%x00",
            "--name-only",
            "-z",
            "--",
        ];
        args.extend(batch.iter().map(String::as_str));
        let mut timestamp = None;
        let mut first_path = false;
        let mut expect_commit = true;
        stream_command(
            git_command(root, &args),
            b'\0',
            None,
            deadline.saturating_duration_since(Instant::now()),
            |record| {
                let record = String::from_utf8_lossy(record);
                if record.is_empty() {
                    expect_commit = true;
                } else if expect_commit {
                    let date = record.strip_prefix("__CLA_COMMIT__").unwrap_or("");
                    timestamp = chrono::DateTime::parse_from_rfc3339(date)
                        .ok()
                        .map(|d| d.timestamp_millis());
                    first_path = true;
                    expect_commit = false;
                } else if !record.is_empty() {
                    let path = if first_path {
                        record.strip_prefix('\n').unwrap_or(&record)
                    } else {
                        &record
                    };
                    first_path = false;
                    if let Some(ts) = timestamp {
                        if batch_wanted.contains(path) {
                            out.entry(path.to_string()).or_insert(ts);
                        }
                    }
                }
                !batch.iter().all(|path| out.contains_key(path))
            },
        );
    }
    out
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
            return Some(format!("https://{host}/{}", path.trim_end_matches(".git")));
        }
    }
    // ssh://git@host/path or git://host/path
    if let Some(rest) = trimmed
        .strip_prefix("ssh://")
        .or_else(|| trimmed.strip_prefix("git://"))
    {
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        if let Some((host, path)) = rest.split_once('/') {
            return Some(format!("https://{host}/{}", path.trim_end_matches(".git")));
        }
    }
    None
}

pub fn get_git_repo_info(root: &Path) -> AppResult<Option<GitRepoInfo>> {
    if !is_repo(root) {
        return Ok(None);
    }
    let log = run_git(
        root,
        &[
            "log",
            "--no-ext-diff",
            "--no-textconv",
            "-n",
            "1",
            "--pretty=format:%H%n%aI",
        ],
    );
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
    if !is_repo(root) {
        return Ok(vec![]);
    }
    if run_git(root, &["rev-parse", "--verify", "HEAD"]).is_none() {
        return Ok(vec![]);
    }
    let since = format!("{}.days", days.clamp(1, 3660));
    let mut buckets: HashMap<String, (std::collections::HashSet<String>, i64)> = HashMap::new();
    let mut current = String::new();
    let success = stream_command(
        git_command(
            root,
            &[
                "log",
                "--no-ext-diff",
                "--no-textconv",
                &format!("--since={since}"),
                "--date=short",
                "--pretty=format:__CLA_DATE__%ad",
                "--numstat",
                "--",
            ],
        ),
        b'\n',
        None,
        GIT_TIMEOUT,
        |line| {
            let line = String::from_utf8_lossy(line);
            if line.trim().is_empty() {
                return true;
            }
            if let Some(date) = line.strip_prefix("__CLA_DATE__") {
                current = date.trim().to_string();
                buckets
                    .entry(current.clone())
                    .or_insert_with(|| (std::collections::HashSet::new(), 0));
                return true;
            }
            if current.is_empty() {
                return true;
            }
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                return true;
            }
            let added: i64 = parts[0].parse().unwrap_or(0);
            let deleted: i64 = parts[1].parse().unwrap_or(0);
            let file = parts[2].to_string();
            if let Some(b) = buckets.get_mut(&current) {
                b.0.insert(file);
                b.1 += added + deleted;
            }
            true
        },
    );
    if !success {
        return Err(crate::error::AppError::msg(
            "Git history query failed or exceeded its time/output limit",
        ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{atomic::AtomicU64, Arc};

    struct Repo(PathBuf);

    impl Repo {
        fn new() -> Self {
            static SEQUENCE: AtomicU64 = AtomicU64::new(1);
            let path = std::env::temp_dir().join(format!(
                "cla-git-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            let repo = Self(path);
            repo.git(&["init", "--template="]);
            repo.git(&["config", "user.email", "fixture@example.invalid"]);
            repo.git(&["config", "user.name", "Fixture Author"]);
            repo
        }

        fn git(&self, args: &[&str]) -> String {
            let output = Command::new("git")
                .args(["-c", "core.hooksPath=/dev/null"])
                .args(args)
                .current_dir(&self.0)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {:?}: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).into_owned()
        }

        fn commit(&self, date: &str) {
            self.git(&["add", "--all"]);
            let output = Command::new("git")
                .args([
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "commit.gpgSign=false",
                    "commit",
                    "-m",
                    "fixture",
                ])
                .env("GIT_AUTHOR_DATE", date)
                .env("GIT_COMMITTER_DATE", date)
                .current_dir(&self.0)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn latest_dates_are_exact_for_literal_and_uncommitted_paths() {
        let repo = Repo::new();
        let paths = [
            "[literal].rs",
            " unicode 空格.rs",
            "line\nbreak.rs",
            "__CLA_COMMIT__2024-06-03T10:00:00+08:00",
        ];
        for path in paths {
            std::fs::write(repo.0.join(path), "first\n").unwrap();
        }
        repo.commit("2024-06-01T10:00:00+08:00");
        std::fs::write(repo.0.join(paths[0]), "newer\n").unwrap();
        repo.commit("2024-06-02T10:00:00+08:00");
        std::fs::write(repo.0.join("never_committed.rs"), "new\n").unwrap();
        repo.git(&["add", "--", "never_committed.rs"]);
        let mut requested: Vec<String> = paths.into_iter().map(str::to_string).collect();
        requested.push("never_committed.rs".into());
        let dates = get_git_last_dates(&repo.0, &requested);
        let timestamp = |date| {
            chrono::DateTime::parse_from_rfc3339(date)
                .unwrap()
                .timestamp_millis()
        };
        assert_eq!(dates.len(), 4);
        assert_eq!(dates[paths[0]], timestamp("2024-06-02T10:00:00+08:00"));
        for path in &paths[1..] {
            assert_eq!(dates[*path], timestamp("2024-06-01T10:00:00+08:00"));
        }
        assert!(!dates.contains_key("never_committed.rs"));
    }

    #[test]
    fn blame_accepts_a_filename_that_looks_like_an_option() {
        let repo = Repo::new();
        std::fs::write(repo.0.join("--help"), "one\ntwo\n").unwrap();
        repo.commit("2024-06-01T10:00:00+08:00");
        let info = get_git_file_info(&repo.0, "--help", None).unwrap().unwrap();
        assert!(info.last_sha.is_some());
        assert_eq!(info.top_authors[0].author, "Fixture Author");
        assert_eq!(info.top_authors[0].lines, 2);
    }

    #[cfg(unix)]
    #[test]
    fn malicious_repository_helpers_are_not_executed() {
        use std::os::unix::fs::PermissionsExt;
        let repo = Repo::new();
        std::fs::write(repo.0.join("file.txt"), "one\ntwo\n").unwrap();
        std::fs::write(repo.0.join("clean.txt"), "one\ntwo\n").unwrap();
        std::fs::write(
            repo.0.join(".gitattributes"),
            "file.txt diff=untrusted\nclean.txt filter=untrusted\n",
        )
        .unwrap();
        repo.commit("2024-06-01T10:00:00+08:00");
        for (name, body) in [
            (
                "fsmonitor.sh",
                "#!/bin/sh\nprintf hit > fsmonitor.executed\n",
            ),
            (
                "textconv.sh",
                "#!/bin/sh\nprintf hit > textconv.executed\ncat \"$1\"\n",
            ),
            ("clean.sh", "#!/bin/sh\nprintf hit > clean.executed\ncat\n"),
        ] {
            let path = repo.0.join(name);
            std::fs::write(&path, body).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        repo.git(&["config", "core.fsmonitor", "./fsmonitor.sh"]);
        repo.git(&["config", "diff.untrusted.textconv", "./textconv.sh"]);
        repo.git(&["config", "filter.untrusted.clean", "./clean.sh"]);
        // Establish that the fixture really executes helpers with the previous
        // command, and that --no-textconv alone still executes clean filters.
        repo.git(&["blame", "--line-porcelain", "--", "file.txt"]);
        repo.git(&[
            "-c",
            "core.fsmonitor=false",
            "blame",
            "--no-textconv",
            "--line-porcelain",
            "--",
            "clean.txt",
        ]);
        for marker in ["fsmonitor.executed", "textconv.executed", "clean.executed"] {
            assert!(
                repo.0.join(marker).exists(),
                "fixture did not execute {marker}"
            );
            std::fs::remove_file(repo.0.join(marker)).unwrap();
        }
        for path in ["file.txt", "clean.txt"] {
            let info = get_git_file_info(&repo.0, path, None).unwrap().unwrap();
            assert_eq!(info.top_authors[0].lines, 2);
        }
        assert_eq!(
            get_git_last_dates(
                &repo.0,
                &["file.txt".into(), "clean.txt".into(), "never.txt".into()]
            )
            .len(),
            2
        );
        assert!(get_git_repo_info(&repo.0).unwrap().is_some());
        assert!(!get_git_heatmap(&repo.0, 3660).unwrap().is_empty());
        for marker in ["fsmonitor.executed", "textconv.executed", "clean.executed"] {
            assert!(
                !repo.0.join(marker).exists(),
                "unsafe helper executed: {marker}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn log_does_not_execute_a_repository_signature_verifier() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        let repo = Repo::new();
        std::fs::write(repo.0.join("file.txt"), "one\n").unwrap();
        repo.commit("2024-06-01T10:00:00+08:00");
        let original = repo.git(&["cat-file", "commit", "HEAD"]);
        let (headers, message) = original.split_once("\n\n").unwrap();
        let forged = format!("{headers}\ngpgsig -----BEGIN PGP SIGNATURE-----\n bogus\n -----END PGP SIGNATURE-----\n\n{message}");
        let mut child = Command::new("git")
            .args(["hash-object", "-t", "commit", "-w", "--stdin"])
            .current_dir(&repo.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(forged.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let sha = String::from_utf8(output.stdout).unwrap();
        repo.git(&["update-ref", "HEAD", sha.trim()]);
        let verifier = repo.0.join("verifier.sh");
        std::fs::write(
            &verifier,
            "#!/bin/sh\nprintf hit > verifier.executed\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&verifier, std::fs::Permissions::from_mode(0o755)).unwrap();
        repo.git(&["config", "log.showSignature", "true"]);
        repo.git(&["config", "gpg.program", "./verifier.sh"]);
        repo.git(&["log", "-n", "1"]);
        assert!(repo.0.join("verifier.executed").exists());
        std::fs::remove_file(repo.0.join("verifier.executed")).unwrap();
        assert!(get_git_file_info(&repo.0, "file.txt", None)
            .unwrap()
            .is_some());
        assert_eq!(get_git_last_dates(&repo.0, &["file.txt".into()]).len(), 1);
        assert!(!get_git_heatmap(&repo.0, 3660).unwrap().is_empty());
        assert!(get_git_repo_info(&repo.0).unwrap().is_some());
        assert!(!repo.0.join("verifier.executed").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_running_child_is_killed_on_cancel_and_deadline() {
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_copy = Arc::clone(&cancel);
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            cancel_copy.store(true, Ordering::Release);
        });
        let mut child = Command::new("sleep");
        child.arg("30");
        let start = Instant::now();
        assert!(!stream_command(
            child,
            b'\n',
            Some(&cancel),
            Duration::from_secs(5),
            |_| true
        ));
        assert!(start.elapsed() < Duration::from_secs(2));
        thread.join().unwrap();
        let mut child = Command::new("sleep");
        child.arg("30");
        let start = Instant::now();
        assert!(!stream_command(
            child,
            b'\n',
            None,
            Duration::from_millis(60),
            |_| true
        ));
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn child_output_is_bounded_even_without_record_separators() {
        let mut child = Command::new("head");
        child.args(["-c", &(MAX_GIT_OUTPUT + 1).to_string(), "/dev/zero"]);
        let mut consumed = 0;
        assert!(!stream_command(
            child,
            b'\n',
            None,
            Duration::from_secs(5),
            |record| {
                consumed += record.len();
                true
            }
        ));
        assert_eq!(consumed, 0);
    }
}
