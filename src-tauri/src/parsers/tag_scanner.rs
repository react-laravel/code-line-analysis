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
    // No comment syntax means there can be no comment tags. This also avoids
    // walking megabyte-long generated JSON lines character by character.
    if lang.line.is_empty() && lang.block.is_empty() { return vec![]; }
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
        // Borrow suffixes at UTF-8 byte boundaries instead of allocating a copy
        // for every character, so generated source lines take linear work.
        while index < raw.len() {
            if let Some((_, end)) = in_block {
                let rest = &raw[index..];
                if let Some(pos) = rest.find(end) {
                    comment_parts.push(rest[..pos].to_string());
                    index += pos + end.len();
                    in_block = None;
                } else {
                    comment_parts.push(rest.to_string());
                    index = raw.len();
                }
                continue;
            }
            if let Some((_, end)) = in_string {
                if let Some(pos) = raw[index..].find(end) {
                    index += pos + end.len();
                    in_string = None;
                } else {
                    index = raw.len();
                }
                continue;
            }
            let rest = &raw[index..];
            let mut matched = false;
            for m in lang.line {
                if rest.starts_with(m) {
                    comment_parts.push(rest[m.len()..].to_string());
                    index = raw.len();
                    matched = true;
                    break;
                }
            }
            if matched { break; }
            for &(start, end) in lang.block {
                if rest.starts_with(start) {
                    let after = index + start.len();
                    let rest2 = &raw[after..];
                    if let Some(pos) = rest2.find(end) {
                        comment_parts.push(rest2[..pos].to_string());
                        index = after + pos + end.len();
                    } else {
                        comment_parts.push(rest2.to_string());
                        in_block = Some((start, end));
                        index = raw.len();
                    }
                    matched = true;
                    break;
                }
            }
            if matched { continue; }
            for &(s, e) in lang.string {
                if rest.starts_with(s) {
                    index += s.len();
                    in_string = Some((s, e));
                    matched = true;
                    break;
                }
            }
            if matched { continue; }
            index += rest.chars().next().unwrap().len_utf8();
        }
        for part in comment_parts {
            push_matches(&mut out, &part, line_no);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::scan_tags;
    use crate::parsers::languages::detect_lang;
    use std::time::{Duration, Instant};

    #[test]
    fn finds_tag_after_unicode_block_comment() {
        let (_, lang, _) = detect_lang("example.ts");
        let tags = scan_tags("/* 中文说明 */ // TODO: fix this", lang.as_ref());

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].kind, "TODO");
        assert_eq!(tags[0].text, "fix this");
        assert_eq!(tags[0].line_no, 1);
    }

    #[test]
    fn scans_unicode_multiline_comments_and_ignores_string_tags() {
        let (_, lang, _) = detect_lang("example.ts");
        let tags = scan_tags(
            "const 名称 = \"// TODO: inside string\";\r\n/* 中文 FIXME: repair\r\n NOTE: investigate */ // TODO: next\r\n",
            lang.as_ref(),
        );

        assert_eq!(tags.len(), 3);
        assert_eq!((tags[0].kind.as_str(), tags[0].text.as_str(), tags[0].line_no), ("FIXME", "repair", 2));
        assert_eq!((tags[1].kind.as_str(), tags[1].text.as_str(), tags[1].line_no), ("NOTE", "investigate", 3));
        assert_eq!((tags[2].kind.as_str(), tags[2].text.as_str(), tags[2].line_no), ("TODO", "next", 3));
    }

    #[test]
    fn skips_megabyte_json_without_comment_syntax() {
        let (_, lang, _) = detect_lang("geometry.json");
        let content = format!("[{}\"TODO: data\"]", "123,".repeat(500_000));
        let started = Instant::now();
        let tags = scan_tags(&content, lang.as_ref());

        assert!(tags.is_empty());
        assert!(started.elapsed() < Duration::from_secs(5), "long JSON line took {:?}", started.elapsed());
    }

    #[test]
    fn finds_comment_tag_after_megabyte_generated_javascript_line() {
        let (_, lang, _) = detect_lang("geometry.js");
        let content = format!("export const geometry = [{}0]; // TODO: generated", "123,".repeat(500_000));
        let started = Instant::now();
        let tags = scan_tags(&content, lang.as_ref());

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].kind, "TODO");
        assert_eq!(tags[0].text, "generated");
        assert_eq!(tags[0].line_no, 1);
        assert!(started.elapsed() < Duration::from_secs(5), "long JS line took {:?}", started.elapsed());
    }
}
