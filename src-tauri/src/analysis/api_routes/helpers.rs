use regex::Regex;
use std::collections::HashSet;

pub(crate) const HTTP_METHOD_ORDER: [&str; 9] = [
    "PAGE", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ANY",
];

pub(crate) fn normalize_rel_path(rel_path: &str) -> String {
    rel_path
        .replace('\\', "/")
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

pub(crate) fn dirname(rel_path: &str) -> String {
    let n = normalize_rel_path(rel_path);
    n.rfind('/')
        .map(|i| n[..i].to_string())
        .unwrap_or_default()
}

pub(crate) fn basename(rel_path: &str) -> String {
    let n = normalize_rel_path(rel_path);
    n.rsplit('/').next().unwrap_or(&n).to_string()
}

pub(crate) fn normalize_route_path(route_path: &str) -> String {
    let normalized = route_path.trim().trim_start_matches('/');
    if normalized.is_empty() {
        return "/".into();
    }
    format!("/{}", normalized.replace("//", "/"))
}

pub(crate) fn sort_methods(methods: &[String]) -> Vec<String> {
    let mut uniq: Vec<String> = methods
        .iter()
        .map(|m| m.to_uppercase())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    uniq.sort_by(|a, b| {
        let ai = HTTP_METHOD_ORDER.iter().position(|x| *x == a.as_str());
        let bi = HTTP_METHOD_ORDER.iter().position(|x| *x == b.as_str());
        let ai = ai.unwrap_or(HTTP_METHOD_ORDER.len());
        let bi = bi.unwrap_or(HTTP_METHOD_ORDER.len());
        ai.cmp(&bi).then_with(|| a.cmp(b))
    });
    uniq
}

pub(crate) fn split_args(args: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0i32;
    let chars: Vec<char> = args.chars().collect();

    for (index, &ch) in chars.iter().enumerate() {
        let previous = if index > 0 { chars[index - 1] } else { '\0' };

        if let Some(q) = quote {
            current.push(ch);
            if ch == q && previous != '\\' {
                quote = None;
            }
            continue;
        }

        if ch == '\'' || ch == '"' || ch == '`' {
            quote = Some(ch);
            current.push(ch);
            continue;
        }

        if ch == '(' || ch == '[' || ch == '{' {
            depth += 1;
        }
        if ch == ')' || ch == ']' || ch == '}' {
            depth = (depth - 1).max(0);
        }

        if ch == ',' && depth == 0 {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
            current.clear();
            continue;
        }

        current.push(ch);
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_string());
    }
    out
}

pub(crate) fn read_string_literal(value: &str) -> Option<String> {
    let v = value.trim();
    let re = Regex::new(r#"^['"`]([^'"`]+)['"`]$"#).ok()?;
    re.captures(v).map(|c| c.get(1).unwrap().as_str().to_string())
}

pub(crate) fn read_first_string(value: &str) -> Option<String> {
    Regex::new(r#"['"`]([^'"`]+)['"`]"#)
        .ok()?
        .captures(value)
        .map(|c| c.get(1).unwrap().as_str().to_string())
}

pub(crate) fn find_matching_paren(value: &str, open_index: usize) -> Option<usize> {
    let chars: Vec<char> = value.chars().collect();
    let mut quote: Option<char> = None;
    let mut depth = 0i32;

    for (index, &ch) in chars.iter().enumerate().skip(open_index) {
        let previous = if index > 0 { chars[index - 1] } else { '\0' };

        if let Some(q) = quote {
            if ch == q && previous != '\\' {
                quote = None;
            }
            continue;
        }

        if ch == '\'' || ch == '"' || ch == '`' {
            quote = Some(ch);
            continue;
        }

        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

pub(crate) fn find_matching_brace(value: &str, open_index: usize) -> Option<usize> {
    let chars: Vec<char> = value.chars().collect();
    let mut quote: Option<char> = None;
    let mut depth = 0i32;

    for (index, &ch) in chars.iter().enumerate().skip(open_index) {
        let previous = if index > 0 { chars[index - 1] } else { '\0' };

        if let Some(q) = quote {
            if ch == q && previous != '\\' {
                quote = None;
            }
            continue;
        }

        if ch == '\'' || ch == '"' || ch == '`' {
            quote = Some(ch);
            continue;
        }

        if ch == '{' {
            depth += 1;
        }
        if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

