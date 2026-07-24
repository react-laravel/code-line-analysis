use once_cell::sync::Lazy;
use regex::Regex;

pub fn normalize_rel_path(rel_path: &str) -> String {
    rel_path
        .replace('\\', "/")
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn snake_case(value: &str) -> String {
    let re1 = Regex::new(r"([a-z0-9])([A-Z])").unwrap();
    let re2 = Regex::new(r"[-\s]+").unwrap();
    re2.replace_all(&re1.replace_all(value, "${1}_${2}"), "_")
        .to_lowercase()
}

pub fn singular(value: &str) -> String {
    if value.ends_with("ies") {
        format!("{}y", &value[..value.len() - 3])
    } else if value.ends_with("ses") {
        value[..value.len() - 2].to_string()
    } else if value.ends_with('s') && !value.ends_with("ss") {
        value[..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

pub fn plural(value: &str) -> String {
    if value.ends_with('y') && !Regex::new(r"[aeiou]y$").unwrap().is_match(value) {
        format!("{}ies", &value[..value.len() - 1])
    } else if Regex::new(r"(s|x|z|ch|sh)$").unwrap().is_match(value) {
        format!("{value}es")
    } else if value.ends_with('s') {
        value.to_string()
    } else {
        format!("{value}s")
    }
}

pub fn default_table_name(class_name: &str) -> String {
    plural(&snake_case(class_name))
}

pub fn read_string_literal(value: &str) -> Option<String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"^['"]([^'"]+)['"]$"#).unwrap());
    RE.captures(value.trim())
        .map(|c| c.get(1).unwrap().as_str().to_string())
}

pub fn read_first_string(value: &str) -> Option<String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"['"]([^'"]+)['"]"#).unwrap());
    RE.captures(value)
        .map(|c| c.get(1).unwrap().as_str().to_string())
}

pub fn split_args(args: &str) -> Vec<String> {
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

        if ch == '\'' || ch == '"' {
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

pub fn named_string_arg(args: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"{name}\s*:\s*['"]([^'"]+)['"]"#);
    Regex::new(&pattern)
        .ok()?
        .captures(args)
        .map(|c| c.get(1).unwrap().as_str().to_string())
}

pub fn has_chain(chain: &str, method: &str) -> bool {
    let pattern = format!(r"->{method}\s*\(");
    Regex::new(&pattern).map(|re| re.is_match(chain)).unwrap_or(false)
}

pub fn class_name_from_class_expr(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .trim_start_matches('\\')
        .trim_end_matches("::class")
        .replace(['\'', '"'], "");
    if normalized.is_empty() || normalized.contains('$') {
        return None;
    }
    normalized.split('\\').filter(|s| !s.is_empty()).last().map(|s| s.to_string())
}

pub fn class_base_name(value: Option<&str>) -> Option<String> {
    value.and_then(|v| {
        v.split('\\')
            .filter(|s| !s.is_empty())
            .last()
            .map(|s| s.to_string())
    })
}

pub fn table_name_from_class(value: Option<&str>) -> Option<String> {
    class_base_name(value).map(|c| default_table_name(&c))
}

pub fn default_foreign_key_for_table(table_name: &str) -> String {
    format!("{}_id", singular(table_name))
}

pub fn default_pivot_table_name(source_table: &str, target_table: &str) -> String {
    let mut parts = vec![singular(source_table), singular(target_table)];
    parts.sort();
    parts.join("_")
}

pub fn default_morph_id_column(morph_name: &str) -> String {
    format!("{}_id", snake_case(morph_name))
}

pub fn default_morph_type_column(morph_name: &str) -> String {
    format!("{}_type", snake_case(morph_name))
}

pub fn default_morph_pivot_table(morph_name: &str) -> String {
    plural(&snake_case(morph_name))
}

pub fn infer_constrained_table(source_column: &str) -> String {
    plural(&source_column.replace("_id", ""))
}

pub fn format_table_columns(table_name: &str, columns: &[Option<String>]) -> String {
    let visible: Vec<String> = columns.iter().filter_map(|c| c.clone()).collect();
    if visible.is_empty() {
        format!("{table_name}.?")
    } else {
        visible
            .iter()
            .map(|c| format!("{table_name}.{c}"))
            .collect::<Vec<_>>()
            .join(" / ")
    }
}

pub fn format_bare_columns(columns: &[Option<String>]) -> String {
    let visible: Vec<String> = columns.iter().filter_map(|c| c.clone()).collect();
    if visible.is_empty() {
        "?".into()
    } else {
        visible.join(" / ")
    }
}

pub fn column_name_for_foreign_id_for(args: &str) -> Option<String> {
    let class_name = class_name_from_class_expr(split_args(args).first()?.as_str())?;
    Some(format!("{}_id", snake_case(&class_name)))
}

pub fn is_test_file_path(rel_path: &str) -> bool {
    let normalized = normalize_rel_path(rel_path);
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let file_name = segments.last().copied().unwrap_or(&normalized);
    const TEST_DIRS: &[&str] = &["tests", "__tests__", "__test__", "spec", "specs"];
    if segments
        .iter()
        .take(segments.len().saturating_sub(1))
        .any(|s| TEST_DIRS.contains(&s.to_lowercase().as_str()))
    {
        return true;
    }
    static PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
        vec![
            Regex::new(r"Test\.php$").unwrap(),
            Regex::new(r"Spec\.php$").unwrap(),
            Regex::new(r"_test\.php$").unwrap(),
            Regex::new(r"_spec\.php$").unwrap(),
        ]
    });
    PATTERNS.iter().any(|p| p.is_match(file_name))
}
