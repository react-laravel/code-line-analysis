use crate::analysis::SourceFile;
use crate::types::{FileRelationEdge, FileRelationGraph, FileRelationNode};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const TEST_DIR_SEGMENTS: &[&str] = &[
    "__tests__", "__test__", "tests", "test", "spec", "specs", "e2e", "cypress",
];

const EXTENSION_PRIORITY: &[&str] = &[
    ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
    ".css", ".scss", ".sass", ".less", ".py", ".php",
];

static IMPORT_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r#"(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]"#).unwrap(),
        Regex::new(r#"\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)"#).unwrap(),
        Regex::new(r#"\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)"#).unwrap(),
        Regex::new(r#"\b(?:require|require_once|include|include_once)\s*\(?\s*["'`]([^"'`]+)["'`]\s*\)?"#).unwrap(),
        Regex::new(r#"@import\s+(?:url\()?\s*["'`]([^"'`]+)["'`]"#).unwrap(),
        Regex::new(r#"\bfrom\s+(\.+[A-Za-z0-9_./-]*)\s+import\b"#).unwrap(),
    ]
});

struct ComposerNamespaceMapping {
    prefix: String,
    dir_path: String,
}

fn normalize_rel_path(rel_path: &str) -> String {
    let binding = rel_path.replace('\\', "/");
    let parts: Vec<&str> = binding.split('/').collect();
    let mut normalized = Vec::new();
    for part in parts {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            normalized.pop();
            continue;
        }
        normalized.push(part);
    }
    normalized.join("/")
}

fn dirname(rel_path: &str) -> String {
    let normalized = normalize_rel_path(rel_path);
    normalized
        .rfind('/')
        .map(|i| normalized[..i].to_string())
        .unwrap_or_default()
}

fn join_path(base: &str, specifier: &str) -> String {
    normalize_rel_path(&[base, specifier].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("/"))
}

fn strip_extension(rel_path: &str) -> String {
    let normalized = normalize_rel_path(rel_path);
    let file_name = normalized.rsplit('/').next().unwrap_or(&normalized);
    if let Some(ext_index) = file_name.rfind('.') {
        if ext_index > 0 {
            return normalized[..normalized.len() - (file_name.len() - ext_index)].to_string();
        }
    }
    normalized
}

fn extension_priority(rel_path: &str) -> usize {
    let lower = rel_path.to_lowercase();
    EXTENSION_PRIORITY
        .iter()
        .position(|ext| lower.ends_with(ext))
        .unwrap_or(EXTENSION_PRIORITY.len())
}

fn pick_preferred_path(current: Option<&str>, next: &str) -> String {
    let Some(current) = current else {
        return next.to_string();
    };
    let cp = extension_priority(current);
    let np = extension_priority(next);
    if np != cp {
        return if np < cp { next.to_string() } else { current.to_string() };
    }
    if next.len() < current.len() {
        next.to_string()
    } else {
        current.to_string()
    }
}

fn add_lookup_entry(lookup: &mut HashMap<String, String>, key: &str, rel_path: &str) {
    if key.is_empty() {
        return;
    }
    lookup.insert(
        key.to_string(),
        pick_preferred_path(lookup.get(key).map(|s| s.as_str()), rel_path),
    );
    let lower = key.to_lowercase();
    if lower != key {
        lookup.insert(
            lower.clone(),
            pick_preferred_path(lookup.get(&lower).map(|s| s.as_str()), rel_path),
        );
    }
}

fn build_lookup(files: &[SourceFile]) -> HashMap<String, String> {
    let mut lookup = HashMap::new();
    for file in files {
        let normalized = normalize_rel_path(&file.rel_path);
        let without_ext = strip_extension(&normalized);
        add_lookup_entry(&mut lookup, &normalized, &normalized);
        add_lookup_entry(&mut lookup, &without_ext, &normalized);

        let file_name = normalized.rsplit('/').next().unwrap_or("");
        if Regex::new(r"^index\.[^/.]+$").unwrap().is_match(file_name) {
            let dir_path = dirname(&normalized);
            add_lookup_entry(&mut lookup, &dir_path, &normalized);
        }
    }
    lookup
}

fn collect_specifiers(content: &str) -> HashSet<String> {
    let mut specifiers = HashSet::new();
    for pattern in IMPORT_PATTERNS.iter() {
        for caps in pattern.captures_iter(content) {
            if let Some(spec) = caps.get(1) {
                let trimmed = spec.as_str().trim();
                if !trimmed.is_empty() {
                    specifiers.insert(trimmed.to_string());
                }
            }
        }
    }
    specifiers
}

fn normalize_php_namespace(specifier: &str) -> String {
    normalize_rel_path(&specifier.trim().trim_start_matches('\\').replace('\\', "/"))
}

fn strip_php_use_alias(specifier: &str) -> String {
    Regex::new(r"\s+as\s+[A-Za-z_][A-Za-z0-9_]*$")
        .unwrap()
        .replace(specifier, "")
        .to_string()
}

fn strip_php_use_qualifier(specifier: &str) -> String {
    Regex::new(r"^(?:function|const)\s+")
        .unwrap()
        .replace(specifier, "")
        .trim()
        .to_string()
}

fn split_php_use_items(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn expand_php_use_statement(statement: &str) -> Vec<String> {
    let normalized = Regex::new(r"\s+")
        .unwrap()
        .replace_all(statement.trim(), " ")
        .to_string();
    if normalized.is_empty() || normalized.starts_with('(') || normalized.contains('$') {
        return vec![];
    }

    if let Some(group_start) = normalized.find('{') {
        let group_end = normalized.rfind('}');
        if group_end.map(|e| e > group_start).unwrap_or(false)
            && group_start > 0
            && normalized.as_bytes()[group_start - 1] == b'\\'
        {
            let prefix = normalize_php_namespace(&strip_php_use_qualifier(
                &normalized[..group_start - 1],
            ));
            let members = split_php_use_items(&normalized[group_start + 1..group_end.unwrap()]);
            return members
                .into_iter()
                .map(|m| {
                    normalize_php_namespace(&format!(
                        "{}/{}",
                        prefix,
                        strip_php_use_alias(&strip_php_use_qualifier(&m))
                    ))
                })
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    split_php_use_items(&normalized)
        .into_iter()
        .map(|m| normalize_php_namespace(&strip_php_use_alias(&strip_php_use_qualifier(&m))))
        .filter(|s| !s.is_empty())
        .collect()
}

fn collect_php_use_specifiers(content: &str) -> HashSet<String> {
    static USE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*use\s+([\s\S]*?);").unwrap());
    let mut specifiers = HashSet::new();
    for caps in USE.captures_iter(content) {
        if let Some(body) = caps.get(1) {
            for spec in expand_php_use_statement(body.as_str()) {
                specifiers.insert(spec);
            }
        }
    }
    specifiers
}

fn collect_specifiers_for_file(file: &SourceFile) -> HashSet<String> {
    let mut specifiers = collect_specifiers(&file.content);
    if file.lang.to_lowercase() == "php" {
        for spec in collect_php_use_specifiers(&file.content) {
            specifiers.insert(spec);
        }
    }
    specifiers
}

fn parse_composer_namespace_mappings(files: &[SourceFile]) -> Vec<ComposerNamespaceMapping> {
    let mut mappings = Vec::new();

    for file in files {
        let normalized = normalize_rel_path(&file.rel_path);
        if normalized != "composer.json" && !normalized.ends_with("/composer.json") {
            continue;
        }

        let parsed: Value = match serde_json::from_str(&file.content) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let composer_dir = dirname(&normalized);

        for section_name in ["autoload", "autoload-dev"] {
            let Some(section) = parsed.get(section_name).and_then(|v| v.as_object()) else {
                continue;
            };
            for key in ["psr-4", "psr-0"] {
                let Some(record) = section.get(key).and_then(|v| v.as_object()) else {
                    continue;
                };
                for (prefix, raw_dirs) in record {
                    let normalized_prefix =
                        normalize_php_namespace(prefix).trim_end_matches('/').to_string();
                    let dirs: Vec<&str> = if let Some(arr) = raw_dirs.as_array() {
                        arr.iter().filter_map(|v| v.as_str()).collect()
                    } else if let Some(s) = raw_dirs.as_str() {
                        vec![s]
                    } else {
                        continue;
                    };
                    for raw_dir in dirs {
                        if raw_dir.trim().is_empty() {
                            continue;
                        }
                        mappings.push(ComposerNamespaceMapping {
                            prefix: normalized_prefix.clone(),
                            dir_path: join_path(&composer_dir, raw_dir),
                        });
                    }
                }
            }
        }
    }

    mappings.sort_by(|a, b| {
        b.prefix
            .len()
            .cmp(&a.prefix.len())
            .then_with(|| a.dir_path.cmp(&b.dir_path))
    });
    mappings
}

fn resolve_lookup_candidate(candidate: &str, lookup: &HashMap<String, String>) -> Option<String> {
    let normalized = normalize_rel_path(candidate);
    let mut keys = vec![normalized.clone()];
    let without_ext = strip_extension(&normalized);
    if without_ext != normalized {
        keys.push(without_ext);
    }
    for key in keys {
        if let Some(resolved) = lookup.get(&key).or_else(|| lookup.get(&key.to_lowercase())) {
            return Some(resolved.clone());
        }
    }
    None
}

fn resolve_php_specifier(
    specifier: &str,
    lookup: &HashMap<String, String>,
    composer_mappings: &[ComposerNamespaceMapping],
) -> Option<String> {
    let normalized = normalize_php_namespace(specifier);
    if normalized.is_empty() {
        return None;
    }

    for mapping in composer_mappings {
        if !mapping.prefix.is_empty()
            && normalized != mapping.prefix
            && !normalized.starts_with(&format!("{}/", mapping.prefix))
        {
            continue;
        }
        let suffix = if mapping.prefix.is_empty() {
            normalized.clone()
        } else {
            normalized[mapping.prefix.len()..]
                .trim_start_matches('/')
                .to_string()
        };
        if suffix.is_empty() {
            continue;
        }
        if let Some(resolved) =
            resolve_lookup_candidate(&join_path(&mapping.dir_path, &suffix), lookup)
        {
            return Some(resolved);
        }
    }

    resolve_lookup_candidate(&normalized, lookup)
}

fn resolve_alias_specifier(specifier: &str, lookup: &HashMap<String, String>) -> Option<String> {
    let rest = specifier.strip_prefix("@/")?;
    resolve_lookup_candidate(rest, lookup)
}

fn resolve_local_specifier(
    file: &SourceFile,
    specifier: &str,
    lookup: &HashMap<String, String>,
    composer_mappings: &[ComposerNamespaceMapping],
) -> Option<String> {
    if specifier.starts_with("@/") {
        return resolve_alias_specifier(specifier, lookup);
    }
    if !specifier.starts_with('.') {
        if file.lang.to_lowercase() == "php" {
            return resolve_php_specifier(specifier, lookup, composer_mappings);
        }
        return None;
    }
    let resolved_base = join_path(&dirname(&file.rel_path), specifier);
    resolve_lookup_candidate(&resolved_base, lookup)
}

fn is_test_file_path(rel_path: &str) -> bool {
    let normalized = normalize_rel_path(rel_path);
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let file_name = segments.last().copied().unwrap_or(&normalized);

    if segments
        .iter()
        .take(segments.len().saturating_sub(1))
        .any(|s| TEST_DIR_SEGMENTS.contains(&s.to_lowercase().as_str()))
    {
        return true;
    }

    static PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
        vec![
            Regex::new(r"\.(?:test|spec)\.[^/.]+$").unwrap(),
            Regex::new(r"[_-](?:test|spec)\.[^/.]+$").unwrap(),
            Regex::new(r"[A-Z][A-Za-z0-9]*(?:Test|Tests|Spec|Specs)\.[^/.]+$").unwrap(),
        ]
    });
    PATTERNS.iter().any(|p| p.is_match(file_name))
}

fn top_level_group(rel_path: &str) -> String {
    let normalized = normalize_rel_path(rel_path);
    normalized
        .split('/')
        .find(|s| !s.is_empty())
        .unwrap_or("(root)")
        .to_string()
}

pub fn build_file_relation_graph(files: &[SourceFile]) -> FileRelationGraph {
    let normalized_files: Vec<SourceFile> = files
        .iter()
        .map(|f| SourceFile {
            rel_path: normalize_rel_path(&f.rel_path),
            ..f.clone()
        })
        .collect();

    let lookup = build_lookup(&normalized_files);
    let composer_mappings = parse_composer_namespace_mappings(&normalized_files);
    let mut edges_map: HashMap<String, FileRelationEdge> = HashMap::new();
    let mut incoming_counts: HashMap<String, i64> = HashMap::new();
    let mut outgoing_counts: HashMap<String, i64> = HashMap::new();
    let mut unresolved_count = 0i64;

    for file in &normalized_files {
        let mut targets = HashSet::new();
        for specifier in collect_specifiers_for_file(file) {
            let target = resolve_local_specifier(file, &specifier, &lookup, &composer_mappings);
            if target.is_none() {
                if specifier.starts_with('.')
                    || specifier.starts_with("@/")
                    || file.lang.to_lowercase() == "php"
                {
                    unresolved_count += 1;
                }
                continue;
            }
            let target = target.unwrap();
            if target == file.rel_path {
                continue;
            }
            targets.insert(target);
        }

        if targets.is_empty() {
            continue;
        }
        outgoing_counts.insert(file.rel_path.clone(), targets.len() as i64);

        for target in targets {
            *incoming_counts.entry(target.clone()).or_default() += 1;
            let edge_key = format!("{}=>{}", file.rel_path, target);
            let value = edges_map
                .get(&edge_key)
                .map(|e| e.value + 1)
                .unwrap_or(1);
            edges_map.insert(
                edge_key,
                FileRelationEdge {
                    source: file.rel_path.clone(),
                    target,
                    value,
                },
            );
        }
    }

    let mut nodes: Vec<FileRelationNode> = normalized_files
        .iter()
        .filter(|file| {
            incoming_counts.get(&file.rel_path).copied().unwrap_or(0) > 0
                || outgoing_counts.get(&file.rel_path).copied().unwrap_or(0) > 0
        })
        .map(|file| FileRelationNode {
            id: file.rel_path.clone(),
            rel_path: file.rel_path.clone(),
            lang: file.lang.clone(),
            total: file.total,
            code: file.code,
            incoming: incoming_counts.get(&file.rel_path).copied().unwrap_or(0),
            outgoing: outgoing_counts.get(&file.rel_path).copied().unwrap_or(0),
            group: top_level_group(&file.rel_path),
            is_test: is_test_file_path(&file.rel_path),
        })
        .collect();

    nodes.sort_by(|a, b| {
        (b.incoming + b.outgoing)
            .cmp(&(a.incoming + a.outgoing))
            .then_with(|| b.code.cmp(&a.code))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });

    let mut edges: Vec<FileRelationEdge> = edges_map.into_values().collect();
    edges.sort_by(|a, b| {
        b.value
            .cmp(&a.value)
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.target.cmp(&b.target))
    });

    let connected_files = nodes.len() as i64;

    FileRelationGraph {
        nodes,
        edges,
        scanned_files: normalized_files.len() as i64,
        connected_files,
        unresolved_count,
    }
}
