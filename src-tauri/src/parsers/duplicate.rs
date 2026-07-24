use sha1::{Digest, Sha1};

#[derive(Debug, Clone)]
pub struct DupSlice {
    pub hash: String,
    pub start_line: i64,
    pub end_line: i64,
}

fn normalize(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

fn is_comment_line(line: &str) -> bool {
    line.starts_with("//") || line.starts_with("/*") || line.starts_with("*/") || line.starts_with('*') || line.starts_with('#')
}

fn is_import_or_decl(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with("import")
        || lower.starts_with("export import")
        || lower.starts_with("use ")
        || lower.starts_with("namespace")
        || lower.starts_with("require")
        || lower.starts_with("include")
        || Regexish::is_type_decl(line)
}

struct Regexish;
impl Regexish {
    fn is_type_decl(line: &str) -> bool {
        once_cell::sync::Lazy::<regex::Regex>::force(&TYPE_DECL).is_match(line)
    }
}

static TYPE_DECL: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"^(?:export\s+)?(?:abstract\s+|final\s+)?(?:class|interface|trait|enum|record|module)\b").unwrap()
});

fn is_callable_decl(line: &str) -> bool {
    if line.contains("function") { return true; }
    false
}

fn is_boundary(line: &str) -> bool {
    line.is_empty() || is_comment_line(line) || is_import_or_decl(line) || is_callable_decl(line)
}

fn is_structural(line: &str) -> bool {
    if line.is_empty() { return true; }
    let only = line.chars().all(|c| "{}()[];,".contains(c));
    only
}

fn is_substantive(line: &str) -> bool {
    !line.is_empty() && !is_structural(line) && !is_comment_line(line) && !is_import_or_decl(line) && !is_callable_decl(line)
}

pub fn find_duplicate_slices(content: &str, window_size: i64) -> Vec<DupSlice> {
    let window = window_size.max(3) as usize;
    let lines: Vec<String> = content.lines().map(normalize).collect();
    let mut segments: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if is_boundary(line) {
            if !current.is_empty() {
                segments.push(std::mem::take(&mut current));
            }
            continue;
        }
        if is_substantive(line) {
            current.push(index);
        }
    }
    if !current.is_empty() { segments.push(current); }

    let mut out = Vec::new();
    for segment in segments {
        if segment.len() < window { continue; }
        for i in 0..=(segment.len() - window) {
            let window_indexes = &segment[i..i + window];
            let start_index = window_indexes[0];
            let end_index = *window_indexes.last().unwrap();
            let joined = window_indexes.iter().map(|&idx| lines[idx].as_str()).collect::<Vec<_>>().join("\n");
            let mut hasher = Sha1::new();
            hasher.update(joined.as_bytes());
            let digest = hasher.finalize();
            let hex = hex::encode(&digest[..8]); // 16 hex chars
            out.push(DupSlice {
                hash: hex,
                start_line: (start_index + 1) as i64,
                end_line: (end_index + 1) as i64,
            });
        }
    }
    out
}
