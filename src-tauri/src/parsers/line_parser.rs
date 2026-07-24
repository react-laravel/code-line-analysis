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
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' { i += 2; } else { i += 1; }
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

    let mut counts = LineCounts { total: lines.len() as i64, ..Default::default() };
    let Some(lang) = lang else {
        for ln in &lines {
            if ln.trim().is_empty() { counts.blank += 1; } else { counts.code += 1; }
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
        let chars: Vec<char> = raw.chars().collect();
        let mut saw_code = false;
        let mut saw_comment = false;
        let mut saw_block = false;
        let mut in_string: Option<(&str, &str)> = None;

        while i < chars.len() {
            if let Some((_, end)) = in_block {
                saw_block = true;
                let rest: String = chars[i..].iter().collect();
                if let Some(pos) = rest.find(end) {
                    i += end.chars().count() + pos;
                    in_block = None;
                } else {
                    i = chars.len();
                }
                continue;
            }
            if let Some((_, end)) = in_string {
                let rest: String = chars[i..].iter().collect();
                // naive find end
                if let Some(cursor) = rest.find(end) {
                    // handle escapes roughly
                    let mut abs = i + cursor;
                    loop {
                        let mut bs = 0;
                        let mut k = abs;
                        while k > i {
                            k -= 1;
                            if chars[k] == '\\' { bs += 1; } else { break; }
                        }
                        if bs % 2 == 0 { break; }
                        let after = abs + end.chars().count();
                        let rest2: String = chars[after..].iter().collect();
                        if let Some(n) = rest2.find(end) {
                            abs = after + n;
                        } else {
                            abs = chars.len();
                            break;
                        }
                    }
                    if abs >= chars.len() { i = chars.len(); }
                    else { i = abs + end.chars().count(); in_string = None; }
                } else {
                    i = chars.len();
                }
                continue;
            }

            let ch = chars[i];
            if ch == ' ' || ch == '\t' { i += 1; continue; }

            let rest: String = chars[i..].iter().collect();
            let mut matched = false;
            for m in lang.line {
                if rest.starts_with(m) {
                    saw_comment = true;
                    i = chars.len();
                    matched = true;
                    break;
                }
            }
            if matched { break; }

            for &(start, end) in lang.block {
                if rest.starts_with(start) {
                    i += start.chars().count();
                    let rest2: String = chars[i..].iter().collect();
                    if let Some(pos) = rest2.find(end) {
                        saw_block = true;
                        i += pos + end.chars().count();
                    } else {
                        saw_block = true;
                        in_block = Some((start, end));
                        i = chars.len();
                    }
                    matched = true;
                    break;
                }
            }
            if matched { continue; }

            for &(s, e) in lang.string {
                if rest.starts_with(s) {
                    i += s.chars().count();
                    in_string = Some((s, e));
                    matched = true;
                    break;
                }
            }
            if matched { continue; }

            saw_code = true;
            i += 1;
        }

        if saw_block { counts.block_comment += 1; }
        else if saw_comment && !saw_code { counts.comment += 1; }
        else if saw_code { counts.code += 1; }
        else if saw_comment { counts.comment += 1; }
        else { counts.blank += 1; }
    }
    counts
}
