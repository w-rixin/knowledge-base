//! V1 同步：笔记 `.md` 文件的读写格式（push 写 / pull 读 / 冲突解决读）。
//!
//! ## 当前格式
//! ```text
//! ---
//! title: "<JSON 编码的标题>"
//! ---
//!
//! <正文，原样>
//! ```
//! - `title` 用 `serde_json::to_string` 编码（JSON 字符串字面量，恰好也是合法的 YAML 双引号标量），
//!   `"` `\` 换行等自动转义；外部工具用 YAML front-matter 解析器也能读。
//! - **正文原样存、原样取**（front-matter 闭合 `---` 行之后去掉 format 时加的那一个换行即正文）。
//!   所以 `format → parse` 严格可逆，不论正文是空 / 以空行开头 / 末尾多余换行 / 以 `#` 开头 / 含 `---` 行。
//!
//! ## 为什么改这个格式（修 Bug）
//! 旧格式 `# <标题>\n\n<正文>` 不是无损往返：
//! - 正文本身以 `# xxx` 开头 → push 端把正文当 `.md`（不加标题行）→ pull 端把第一行 `# xxx` 当标题
//!   strip 掉 → **标题和正文双双被改坏**
//! - 正文以空行开头 / 末尾多余换行 → pull 端 `skip_while(empty)` + `lines()` 会吃掉这些 → 正文被改
//! pull 后本地 `content_hash` 偏离远端 → 反复推拉震荡 + 笔记内容被悄悄改写。
//!
//! ## 兼容旧 `.md`
//! [`parse_note_md`] 先看有没有 `---` front-matter；没有就退回旧规则（第一行 `# ` 当标题）。
//! 旧 `.md` 被读一次（旧规则）→ 这条笔记下次被编辑 push 时写成新格式 → 渐进迁移；标题 + 正文都不变 →
//! `content_hash` 不变 → 不会触发额外推拉。

/// 把笔记渲染成 `.md` 文本（push 端用）。见模块文档的格式说明。
pub fn format_note_md(title: &str, content: &str) -> String {
    // JSON 字符串字面量：自动处理 `"` `\` 换行等转义；也是合法的 YAML 双引号标量
    let title_lit = serde_json::to_string(title).unwrap_or_else(|_| format!("{:?}", title));
    format!("---\ntitle: {}\n---\n\n{}", title_lit, content)
}

/// 解析 `.md` 文本 → `(title, content)`（pull / 冲突解决端用）。
///
/// - 新格式（以整行 `---` 开头、含闭合的整行 `---`）：从 front-matter 的 `title:` 行取标题；
///   闭合 `---` 行之后去掉**恰好一个换行**（format 时加的那个空行）即正文（原样）。
/// - 否则（旧 `.md` / 没有 front-matter）：第一行 `# <标题>` → 当标题、跳过紧跟的空行 → 剩余当正文；
///   再没有 `# ` 开头就用 `fallback_title`（一般是 manifest entry 的 title）+ 全文当正文。
pub fn parse_note_md(body: &str, fallback_title: &str) -> (String, String) {
    if let Some((title, content)) = parse_frontmatter(body, fallback_title) {
        return (title, content.to_string());
    }
    // ── 旧格式 fallback（与改造前的 parse 规则一致）
    let mut lines = body.lines();
    let first = lines.next().unwrap_or("").trim();
    if let Some(rest) = first.strip_prefix("# ") {
        let title = rest.trim().to_string();
        let body_rest: String = lines
            .skip_while(|l| l.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return (title, body_rest);
    }
    (fallback_title.to_string(), body.to_string())
}

/// 解析 YAML front-matter；不是该格式时返回 `None`（调用方退回旧规则）。
/// 返回 `(title, content_slice)`，`content_slice` 是闭合 `---` 行之后去掉一个换行后的剩余（原样）。
fn parse_frontmatter<'a>(body: &'a str, fallback_title: &str) -> Option<(String, &'a str)> {
    // 必须以整行 `---` 开头（容错 CRLF）
    let after_open = body
        .strip_prefix("---\n")
        .or_else(|| body.strip_prefix("---\r\n"))?;
    // 在 front-matter 区域内找闭合的整行 `---`（顶格，不缩进）
    let mut offset = 0usize;
    for seg in after_open.split_inclusive('\n') {
        let line = seg.strip_suffix('\n').unwrap_or(seg);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line == "---" {
            let fm_body = &after_open[..offset];
            let after_close = &after_open[offset + seg.len()..];
            // 去掉 format 时在闭合 `---` 与正文之间加的那一个空行（即一个换行；容错 CRLF）
            let content = after_close
                .strip_prefix("\r\n")
                .or_else(|| after_close.strip_prefix('\n'))
                .unwrap_or(after_close);
            let title = parse_title_from_fm(fm_body).unwrap_or_else(|| fallback_title.to_string());
            return Some((title, content));
        }
        offset += seg.len();
    }
    None // 没找到闭合 `---` → 不是合法 front-matter
}

/// 从 front-matter 文本里取 `title` 字段的值。
fn parse_title_from_fm(fm_body: &str) -> Option<String> {
    for line in fm_body.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("title:") {
            let val = val.trim();
            if val.is_empty() {
                continue;
            }
            // 我们写的是 serde_json::to_string(title) → JSON 字符串字面量（双引号包裹）
            if val.starts_with('"') {
                return Some(
                    serde_json::from_str::<String>(val)
                        .unwrap_or_else(|_| val.trim_matches('"').to_string()),
                );
            }
            // 裸标量（可能被人手动编辑过 front-matter）
            return Some(val.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(title: &str, content: &str) {
        let md = format_note_md(title, content);
        let (t2, c2) = parse_note_md(&md, "FALLBACK_SHOULD_NOT_BE_USED");
        assert_eq!(t2, title, "title round-trip 失败; md = {:?}", md);
        assert_eq!(c2, content, "content round-trip 失败; md = {:?}", md);
    }

    #[test]
    fn round_trip_plain() {
        round_trip("我的笔记", "正文\n第二段");
    }

    #[test]
    fn round_trip_empty_content() {
        round_trip("空笔记", "");
    }

    #[test]
    fn round_trip_content_starts_with_heading() {
        // 旧格式会把这个 # 当标题、丢掉正文第一行；新格式必须可逆
        round_trip("真标题", "# 这是正文里的二级标题\n下面是内容");
        round_trip("真标题", "# H1\n\n## H2\n正文");
    }

    #[test]
    fn round_trip_content_leading_blank_lines() {
        round_trip("t", "\n\n开头有空行");
        round_trip("t", "\n");
    }

    #[test]
    fn round_trip_content_trailing_newlines() {
        round_trip("t", "结尾有换行\n\n");
        round_trip("t", "x\n");
    }

    #[test]
    fn round_trip_title_with_special_chars() {
        round_trip("含: 冒号 \"引号\" #井号 和\\反斜杠", "x");
        round_trip("含\n换行的标题", "x"); // 罕见但要可逆（serde_json 把换行转义成 \n 字面，title 行仍单行）
        round_trip("纯-连字符--标题", "y");
        round_trip("emoji 📝 标题", "z");
        round_trip("", "正文"); // 空标题
    }

    #[test]
    fn round_trip_content_with_frontmatter_like_text() {
        // 正文里恰好也有 `---` 行——闭合 `---` 取的是 front-matter 区域里**第一个**整行 `---`，正文里的不受影响
        round_trip("t", "正文里有\n---\n看起来像分隔线的东西");
        round_trip("t", "---");
        round_trip("t", "---\ntitle: 假的\n---\n这其实是正文");
    }

    // ── 旧格式 fallback
    #[test]
    fn legacy_md_with_h1_title() {
        let (t, c) = parse_note_md("# 我的旧笔记\n\n正文1\n正文2", "fb");
        assert_eq!(t, "我的旧笔记");
        assert_eq!(c, "正文1\n正文2");
    }

    #[test]
    fn legacy_md_no_h1_uses_fallback() {
        let (t, c) = parse_note_md("没有标题行的旧正文", "manifest 标题");
        assert_eq!(t, "manifest 标题");
        assert_eq!(c, "没有标题行的旧正文");
    }

    #[test]
    fn legacy_md_content_starts_with_h1_stays_lossy_as_before() {
        // 旧 push 对"正文以 # 开头"的笔记写的 .md = 正文原样（无标题行）。新 parse 对这种旧 .md 仍按
        // 旧规则把第一行 # 当标题——历史遗留损坏，新代码不再制造新损坏；该笔记一旦被重新 push 即写成
        // front-matter 新格式而修复。
        let (t, c) = parse_note_md("# 我是正文H1\n正文", "fb");
        assert_eq!(t, "我是正文H1");
        assert_eq!(c, "正文");
    }

    #[test]
    fn new_format_shape_is_yaml_frontmatter() {
        let md = format_note_md("我的标题", "正文");
        assert!(md.starts_with("---\n"));
        assert!(md.contains("\ntitle: \"我的标题\"\n"), "got = {:?}", md);
        assert!(md.contains("\n---\n\n正文"), "got = {:?}", md);
    }

    #[test]
    fn parse_handles_crlf_frontmatter() {
        let md = "---\r\ntitle: \"win 标题\"\r\n---\r\n\r\n正文行1\nline2";
        let (t, c) = parse_note_md(md, "fb");
        assert_eq!(t, "win 标题");
        assert_eq!(c, "正文行1\nline2");
    }

    #[test]
    fn parse_bare_scalar_title() {
        let (t, c) = parse_note_md("---\ntitle: 裸标量标题\n---\n\n正文", "fb");
        assert_eq!(t, "裸标量标题");
        assert_eq!(c, "正文");
    }

    #[test]
    fn parse_frontmatter_missing_title_uses_fallback() {
        let (t, c) = parse_note_md("---\nother: x\n---\n\n正文", "兜底标题");
        assert_eq!(t, "兜底标题");
        assert_eq!(c, "正文");
    }

    #[test]
    fn parse_unclosed_frontmatter_falls_back_to_legacy() {
        // 以 `---\n` 开头但没有闭合 `---` → 不当 front-matter，走旧规则（首行 `---` 不是 `# `，用 fallback + 全文）
        let (t, c) = parse_note_md("---\ntitle: x\n这里没有闭合标记\n正文", "兜底");
        assert_eq!(t, "兜底");
        assert_eq!(c, "---\ntitle: x\n这里没有闭合标记\n正文");
    }
}
