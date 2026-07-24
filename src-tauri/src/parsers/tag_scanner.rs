use super::languages::LangDef;
use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone)]
pub struct FoundTag {
    pub kind: String,
    pub line_no: i64,
    pub text: String,
}

static TAG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(TODO|FIXME|HACK|NOTE|XXX)\b[ \t:\-]*([^\r\n]*)").unwrap()
});

fn push_matches(out: &mut Vec<FoundTag>, text: &str, line_no: i64) {
    if text.trim().is_empty() { return; }
    for caps in TAG_RE.captures_iter(text) {
        let kind = caps.get(1).unwrap().as_str().to_uppercase();
        let body = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
        out.push(FoundTag {
            kind,
            line_no,
            text: body.chars().take(240).collect(),
        });
    }
}

pub fn scan_tags(content: &str, lang: Option<&LangDef>) -> Vec<FoundTag> {
    let Some(lang) = lang else { return vec![] };
    let lines: Vec<&str> = {
        let mut out = Vec::new();
        let mut start = 0usize;
        let b = content.as_bytes();
        let mut i = 0usize;
        while i < b.len() {
            if b[i] == b'\r' {
                out.push(&content[start..i]);
                if i + 1 < b.len() && b[i + 1] == b'\n' { i += 2; } else { i += 1; }
                start = i;
            } else if b[i] == b'\n' {
                out.push(&content[start..i]);
                i += 1; start = i;
            } else { i += 1; }
        }
        out.push(&content[start..]);
        out
    };
    let mut out = Vec::new();
    let mut in_block: Option<(&str, &str)> = None;
    for (line_index, raw) in lines.iter().enumerate() {
        let line_no = (line_index + 1) as i64;
        let mut index = 0usize;
        let mut in_string: Option<(&str, &str)> = None;
        let mut comment_parts: Vec<String> = Vec::new();
        let chars: Vec<char> = raw.chars().collect();
        while index < chars.len() {
            if let Some((_, end)) = in_block {
                let rest: String = chars[index..].iter().collect();
                if let Some(pos) = rest.find(end) {
                    comment_parts.push(rest[..pos].to_string());
                    index += pos + end.chars().count();
                    in_block = None;
                } else {
                    comment_parts.push(rest);
                    index = chars.len();
                }
                continue;
            }
            if let Some((_, end)) = in_string {
                let rest: String = chars[index..].iter().collect();
                if let Some(pos) = rest.find(end) {
                    index += pos + end.chars().count();
                    in_string = None;
                } else {
                    index = chars.len();
                }
                continue;
            }
            let rest: String = chars[index..].iter().collect();
            let mut matched = false;
            for m in lang.line {
                if rest.starts_with(m) {
                    comment_parts.push(rest[m.len()..].to_string());
                    index = chars.len();
                    matched = true;
                    break;
                }
            }
            if matched { break; }
            for &(start, end) in lang.block {
                if rest.starts_with(start) {
                    let after = index + start.chars().count();
                    let rest2: String = chars[after..].iter().collect();
                    if let Some(pos) = rest2.find(end) {
                        comment_parts.push(rest2[..pos].to_string());
                        index = after + pos + end.chars().count();
                    } else {
                        comment_parts.push(rest2);
                        in_block = Some((start, end));
                        index = chars.len();
                    }
                    matched = true;
                    break;
                }
            }
            if matched { continue; }
            for &(s, e) in lang.string {
                if rest.starts_with(s) {
                    index += s.chars().count();
                    in_string = Some((s, e));
                    matched = true;
                    break;
                }
            }
            if matched { continue; }
            index += 1;
        }
        for part in comment_parts {
            push_matches(&mut out, &part, line_no);
        }
    }
    out
}
