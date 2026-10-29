use super::languages::LangDef;

#[derive(Debug, Clone, Default)]
pub struct LineCounts {
    pub total: i64,
    pub code: i64,
    pub comment: i64,
    pub blank: i64,
    pub block_comment: i64,
}

pub fn count_lines(content: &str, lang: Option<&LangDef>) -> LineCounts {
    // Proper split preserving lines like JS
    let lines: Vec<&str> = {
        let mut out = Vec::new();
        let mut start = 0;
        let bytes = content.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\r' {
                out.push(&content[start..i]);
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    i += 2;
                } else {
                    i += 1;
                }
                start = i;
            } else if bytes[i] == b'\n' {
                out.push(&content[start..i]);
                i += 1;
                start = i;
            } else {
                i += 1;
            }
        }
        out.push(&content[start..]);
        out
    };

    let mut counts = LineCounts {
        total: lines.len() as i64,
        ..Default::default()
    };
    // Languages without comments or strings (JSON, Markdown) need only a
    // whitespace check. In particular, generated JSON can be one very long line.
    let Some(lang) = lang.filter(|lang| {
        !lang.line.is_empty() || !lang.block.is_empty() || !lang.string.is_empty()
    }) else {
        for ln in &lines {
            if ln.trim().is_empty() {
                counts.blank += 1;
            } else {
                counts.code += 1;
            }
        }
        return counts;
    };

    let mut in_block: Option<(&str, &str)> = None;
    for raw in &lines {
        let trimmed = raw.trim();
        if trimmed.is_empty() && in_block.is_none() {
            counts.blank += 1;
            continue;
        }
        let mut i = 0;
        let bytes = raw.as_bytes();
        let mut saw_code = false;
        let mut saw_comment = false;
        let mut saw_block = false;
        let mut in_string: Option<(&str, &str)> = None;

        // Keep a byte cursor at UTF-8 boundaries and borrow the remaining slice.
        // Building that suffix for each character made long lines quadratic.
        while i < raw.len() {
            if let Some((_, end)) = in_block {
                saw_block = true;
                if let Some(pos) = raw[i..].find(end) {
                    i += end.len() + pos;
                    in_block = None;
                } else {
                    i = raw.len();
                }
                continue;
            }
            if let Some((_, end)) = in_string {
                // naive find end
                if let Some(cursor) = raw[i..].find(end) {
                    // handle escapes roughly
                    let mut abs = i + cursor;
                    loop {
                        let mut bs = 0;
                        let mut k = abs;
                        while k > i {
                            k -= 1;
                            if bytes[k] == b'\\' {
                                bs += 1;
                            } else {
                                break;
                            }
                        }
                        if bs % 2 == 0 {
                            break;
                        }
                        let after = abs + end.len();
                        if let Some(n) = raw[after..].find(end) {
                            abs = after + n;
                        } else {
                            abs = raw.len();
                            break;
                        }
                    }
                    if abs >= raw.len() {
                        i = raw.len();
                    } else {
                        i = abs + end.len();
                        in_string = None;
                    }
                } else {
                    i = raw.len();
                }
                continue;
            }

            let ch = raw[i..].chars().next().unwrap();
            if ch == ' ' || ch == '\t' {
                i += 1;
                continue;
            }

            let rest = &raw[i..];
            let mut matched = false;
            for m in lang.line {
                if rest.starts_with(m) {
                    saw_comment = true;
                    i = raw.len();
                    matched = true;
                    break;
                }
            }
            if matched {
                break;
            }

            for &(start, end) in lang.block {
                if rest.starts_with(start) {
                    i += start.len();
                    if let Some(pos) = raw[i..].find(end) {
                        saw_block = true;
                        i += pos + end.len();
                    } else {
                        saw_block = true;
                        in_block = Some((start, end));
                        i = raw.len();
                    }
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }

            for &(s, e) in lang.string {
                if rest.starts_with(s) {
                    i += s.len();
                    in_string = Some((s, e));
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }

            saw_code = true;
            i += ch.len_utf8();
        }

        if saw_block {
            counts.block_comment += 1;
        } else if saw_comment && !saw_code {
            counts.comment += 1;
        } else if saw_code {
            counts.code += 1;
        } else if saw_comment {
            counts.comment += 1;
        } else {
            counts.blank += 1;
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::count_lines;
    use crate::parsers::languages::detect_lang;
    use std::time::{Duration, Instant};

    #[test]
    fn handles_unicode_before_escaped_string_delimiters() {
        let (_, lang, _) = detect_lang("example.ts");
        let counts = count_lines(r#"const message = "中文\"内容";"#, lang.as_ref());

        assert_eq!(counts.total, 1);
        assert_eq!(counts.code, 1);
    }

    #[test]
    fn handles_unicode_inside_block_comments() {
        let (_, lang, _) = detect_lang("example.ts");
        let counts = count_lines("/* 中文注释 */\nconst value = 1;", lang.as_ref());

        assert_eq!(counts.total, 2);
        assert_eq!(counts.block_comment, 1);
        assert_eq!(counts.code, 1);
    }

    #[test]
    fn preserves_comment_counts_and_crlf_with_unicode() {
        let (_, lang, _) = detect_lang("example.ts");
        let counts = count_lines(
            "/* 中文注释\r\n   continued */\r\nconst 名称 = \"/* string */\"; // comment\r\n// TODO: fix\r\n",
            lang.as_ref(),
        );

        assert_eq!(counts.total, 5);
        assert_eq!(counts.code, 1);
        assert_eq!(counts.comment, 1);
        assert_eq!(counts.block_comment, 2);
        assert_eq!(counts.blank, 1);
    }

    #[test]
    fn counts_megabyte_generated_json_without_scanning_syntax() {
        let (_, lang, _) = detect_lang("geometry.json");
        let content = format!("[{}0]", "123,".repeat(500_000));
        let started = Instant::now();
        let counts = count_lines(&content, lang.as_ref());

        assert_eq!(counts.total, 1);
        assert_eq!(counts.code, 1);
        assert_eq!(counts.comment, 0);
        assert_eq!(counts.blank, 0);
        assert!(started.elapsed() < Duration::from_secs(5), "long JSON line took {:?}", started.elapsed());
    }

    #[test]
    fn counts_megabyte_generated_javascript_line_in_linear_time() {
        let (_, lang, _) = detect_lang("geometry.js");
        let content = format!("export const geometry = [{}0]; // generated", "123,".repeat(500_000));
        let started = Instant::now();
        let counts = count_lines(&content, lang.as_ref());

        assert_eq!(counts.total, 1);
        assert_eq!(counts.code, 1);
        assert_eq!(counts.comment, 0);
        assert!(started.elapsed() < Duration::from_secs(5), "long JS line took {:?}", started.elapsed());
    }
}
