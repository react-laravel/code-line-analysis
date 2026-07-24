use super::helpers::{basename, normalize_rel_path, normalize_route_path};
use crate::analysis::SourceFile;
use crate::types::ApiRouteEntry;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

static NEXT_ROUTE_EXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\.(?:ts|tsx|js|jsx)$").unwrap());

fn normalize_next_segment(segment: &str) -> Option<String> {
    if segment.is_empty() || segment.starts_with('@') {
        return None;
    }
    static GROUP: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?:\([^)]*\))+").unwrap());
    let normalized = GROUP.replace(segment, "").to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_next_segments_to_path(segments: &[&str]) -> String {
    let visible: Vec<String> = segments
        .iter()
        .filter_map(|s| normalize_next_segment(s))
        .filter(|s| s.to_lowercase() != "index")
        .collect();
    normalize_route_path(&visible.join("/"))
}

fn normalize_next_pages_path(rel_path: &str, prefix: &str) -> String {
    let normalized = normalize_rel_path(rel_path);
    let route_path = NEXT_ROUTE_EXT
        .replace(&normalized[prefix.len()..], "")
        .to_string();
    let segments: Vec<&str> = route_path.split('/').filter(|s| !s.is_empty()).collect();
    normalize_next_segments_to_path(&segments)
}

fn normalize_next_app_page_path(rel_path: &str, prefix: &str) -> String {
    static PAGE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?:^|/)page\.(?:ts|tsx|js|jsx)$").unwrap());
    let normalized = normalize_rel_path(rel_path);
    let route_dir = PAGE.replace(&normalized[prefix.len()..], "");
    let segments: Vec<&str> = route_dir.split('/').filter(|s| !s.is_empty()).collect();
    normalize_next_segments_to_path(&segments)
}

fn is_next_pages_route_file(rel_path: &str) -> bool {
    let rel = normalize_rel_path(rel_path);
    let (prefix, relative) = if rel.starts_with("src/pages/") {
        ("src/pages/", rel.strip_prefix("src/pages/").unwrap_or(""))
    } else if rel.starts_with("pages/") {
        ("pages/", rel.strip_prefix("pages/").unwrap_or(""))
    } else {
        return false;
    };
    let _ = prefix;

    if !NEXT_ROUTE_EXT.is_match(&rel) {
        return false;
    }
    if relative.is_empty() || relative.starts_with("api/") {
        return false;
    }
    let file_name = NEXT_ROUTE_EXT
        .replace(&basename(relative), "")
        .to_string();
    if file_name.starts_with('_') {
        return false;
    }
    !matches!(file_name.as_str(), "404" | "500")
}

fn is_next_app_page_file(rel_path: &str) -> bool {
    let rel = normalize_rel_path(rel_path);
    let (prefix, relative) = if rel.starts_with("src/app/") {
        ("src/app/", rel.strip_prefix("src/app/").unwrap_or(""))
    } else if rel.starts_with("app/") {
        ("app/", rel.strip_prefix("app/").unwrap_or(""))
    } else {
        return false;
    };
    static PAGE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?:^|/)page\.(?:ts|tsx|js|jsx)$").unwrap());
    PAGE.is_match(relative) && !prefix.is_empty()
}

fn is_next_app_route_handler(rel_path: &str) -> bool {
    let rel = normalize_rel_path(rel_path);
    let relative = if rel.starts_with("src/app/") {
        rel.strip_prefix("src/app/").unwrap_or("")
    } else if rel.starts_with("app/") {
        rel.strip_prefix("app/").unwrap_or("")
    } else {
        return false;
    };
    static ROUTE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?:^|/)route\.(?:ts|tsx|js|jsx)$").unwrap());
    ROUTE.is_match(relative)
}

fn normalize_next_app_route_path(rel_path: &str, prefix: &str) -> String {
    static ROUTE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?:^|/)route\.(?:ts|tsx|js|jsx)$").unwrap());
    let normalized = normalize_rel_path(rel_path);
    let route_dir = ROUTE.replace(&normalized[prefix.len()..], "");
    let segments: Vec<&str> = route_dir.split('/').filter(|s| !s.is_empty()).collect();
    normalize_next_segments_to_path(&segments)
}

pub(super) fn parse_next_routes(files: &[SourceFile]) -> (Vec<ApiRouteEntry>, i64) {
    let mut routes = Vec::new();
    let mut seen = HashSet::new();

    for file in files {
        let rel = normalize_rel_path(&file.rel_path);

        if is_next_pages_route_file(&rel) {
            let prefix = if rel.starts_with("src/pages/") {
                "src/pages/"
            } else {
                "pages/"
            };
            seen.insert(rel.clone());
            routes.push(ApiRouteEntry {
                framework: "next-pages".into(),
                methods: vec!["PAGE".into()],
                path: normalize_next_pages_path(&rel, prefix),
                handler: "page component".into(),
                source_file: rel.clone(),
                route_name: None,
            });
            continue;
        }

        if is_next_app_page_file(&rel) {
            let prefix = if rel.starts_with("src/app/") {
                "src/app/"
            } else {
                "app/"
            };
            seen.insert(rel.clone());
            routes.push(ApiRouteEntry {
                framework: "next-app".into(),
                methods: vec!["PAGE".into()],
                path: normalize_next_app_page_path(&rel, prefix),
                handler: "page component".into(),
                source_file: rel.clone(),
                route_name: None,
            });
            continue;
        }

        if is_next_app_route_handler(&rel) {
            let prefix = if rel.starts_with("src/app/") {
                "src/app/"
            } else {
                "app/"
            };
            seen.insert(rel.clone());
            routes.push(ApiRouteEntry {
                framework: "next-app".into(),
                methods: vec![
                    "GET".into(),
                    "POST".into(),
                    "PUT".into(),
                    "PATCH".into(),
                    "DELETE".into(),
                    "OPTIONS".into(),
                    "HEAD".into(),
                ],
                path: normalize_next_app_route_path(&rel, prefix),
                handler: "route handler".into(),
                source_file: rel,
                route_name: None,
            });
        }
    }

    (routes, seen.len() as i64)
}

