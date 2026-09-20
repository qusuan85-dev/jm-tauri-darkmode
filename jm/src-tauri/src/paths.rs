//! Pure helpers shared by the album export.
//!
//! Deliberately free of Tauri types so they can be exercised by the standalone
//! harness in `tools/` — the crate's own test binary cannot start on Windows
//! (it links the WebView2 stack), and a silent mistake in here is expensive:
//! passing a chapter's bare file name straight to the HTTP client makes every
//! exported page fail.

/// Builds the downloadable URL for one page, mirroring the web layer's
/// `normalizeImgUrl`.
///
/// `api_chapter` returns bare file names ("00001.jpg"), so the CDN base and the
/// chapter id must be prefixed.
pub fn normalize_image_url(img_base: &str, chapter_id: &str, name: &str) -> String {
    if name.is_empty() {
        return String::new();
    }
    if name.starts_with("http://") || name.starts_with("https://") {
        return name.to_string();
    }
    let base = img_base.trim_end_matches('/');
    if name.starts_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/media/photos/{chapter_id}/{name}")
    }
}

/// Bare file name of a page path.
pub fn picture_name_of(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// Bare file name with its suffix removed — the form the scramble parameters are
/// keyed by.
///
/// The suffix must go: `https://…/media/photos/1474506/00001.webp` is descrambled
/// with `md5("147450600001")`, *not* `md5("147450600001.webp")`. Hashing the name
/// with its extension yields a different split count on most pages, which
/// re-shuffles every page into unreadable strips. The reference client stores the
/// two parts separately (`img_file_name` / `img_file_suffix`), and the reader
/// (`ReadingPage.pictureNameFromPath`) already trims at the first dot.
pub fn picture_stem_of(path: &str) -> String {
    let name = picture_name_of(path);
    match name.rfind('.') {
        Some(idx) => name[..idx].to_string(),
        None => name,
    }
}

pub const SCRAMBLE_220980: i64 = 220_980;
pub const SCRAMBLE_268850: i64 = 268_850;
/// 2023-02-08 changed the image split count table.
pub const SCRAMBLE_421926: i64 = 421_926;

/// How many horizontal strips one page was split into (and therefore how many the
/// reader has to put back together).
///
/// Mirrors the reference implementation: `ord(last hex char of md5(id + name)) % x
/// * 2 + 2`, where `x` is 10 below `SCRAMBLE_421926` and 8 from there on. `0` means
/// the page is stored unscrambled.
pub fn segmentation_num(chapter_id: i64, scramble_id: i64, picture_name: &str) -> i64 {
    if chapter_id < scramble_id {
        return 0;
    }
    if chapter_id < SCRAMBLE_268850 {
        return 10;
    }

    let stem = picture_stem_of(picture_name);
    let digest = short_hash(&format!("{chapter_id}{stem}"));
    let last = digest.as_bytes().last().copied().unwrap_or(b'0') as i64; // ord(hex[-1])

    let modulus = if chapter_id > SCRAMBLE_421926 { 8 } else { 10 };
    (last % modulus) * 2 + 2
}

/// Numeric key used to restore reading order from the file name prefix.
pub fn picture_page_key(path: &str) -> i64 {
    let name = picture_name_of(path);
    let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<i64>().unwrap_or(i64::MAX)
}

fn short_hash(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

/// Makes an arbitrary title safe to use as a single path component.
///
/// Non-ASCII is kept on purpose: Chinese/Japanese titles are the norm here, and
/// an ASCII-only filter turned every one of them into `unknown`, so exporting
/// two different comics to the same folder overwrote the first. Only characters
/// that are illegal in a path component are dropped, `..` can no longer escape
/// the destination, and the result is capped in *bytes* because Android's
/// filesystems reject components above 255 bytes (three bytes per CJK
/// character) — truncation keeps a short hash so names stay distinct.
pub fn sanitize_path_component(s: &str) -> String {
    const MAX_BYTES: usize = 120;

    let cleaned: String = s
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let base = if trimmed.is_empty() { "unknown" } else { trimmed };
    if base.len() <= MAX_BYTES {
        return base.to_string();
    }

    let mut end = MAX_BYTES;
    while end > 0 && !base.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}-{}", &base[..end], &short_hash(base)[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_file_names_get_the_cdn_prefix() {
        assert_eq!(
            normalize_image_url("https://cdn.example.com", "12345", "00001.jpg"),
            "https://cdn.example.com/media/photos/12345/00001.jpg"
        );
        // A trailing slash on the base must not double up.
        assert_eq!(
            normalize_image_url("https://cdn.example.com/", "1", "00002.webp"),
            "https://cdn.example.com/media/photos/1/00002.webp"
        );
        assert_eq!(
            normalize_image_url("https://cdn.example.com", "1", "/abs/path.jpg"),
            "https://cdn.example.com/abs/path.jpg"
        );
        assert_eq!(
            normalize_image_url("https://cdn.example.com", "1", "https://other/x.jpg"),
            "https://other/x.jpg"
        );
    }

    #[test]
    fn cjk_titles_are_preserved() {
        assert_eq!(sanitize_path_component("淫らな彼女"), "淫らな彼女");
        assert_eq!(sanitize_path_component("[作者] 标题 第1话"), "[作者] 标题 第1话");
        // Path traversal and separators are neutralised.
        assert_eq!(sanitize_path_component(".."), "unknown");
        assert_eq!(sanitize_path_component("a/b\\c"), "abc");
        assert_eq!(sanitize_path_component("   "), "unknown");
    }

    #[test]
    fn long_titles_are_truncated_on_a_char_boundary() {
        let long = "あ".repeat(200); // 600 bytes
        let out = sanitize_path_component(&long);
        // 120 bytes is exactly 40 three-byte characters, plus "-" and 8 hex chars.
        assert_eq!(out.len(), 120 + 1 + 8, "unexpected length {}", out.len());
        let prefix: String = long.chars().take(40).collect();
        assert!(out.starts_with(&prefix));
        // Distinct oversize names stay distinct.
        let a = sanitize_path_component(&"あ".repeat(200));
        let b = sanitize_path_component(&"い".repeat(200));
        assert_ne!(a, b);
    }

    #[test]
    fn page_order_comes_from_the_name_prefix() {
        let mut pages = vec!["10.jpg", "2.jpg", "1.jpg", "cover.jpg"];
        pages.sort_by_key(|p| picture_page_key(p));
        assert_eq!(pages, vec!["1.jpg", "2.jpg", "10.jpg", "cover.jpg"]);
    }

    #[test]
    fn picture_stem_drops_the_suffix_but_keeps_inner_dots() {
        assert_eq!(picture_stem_of("00001.webp"), "00001");
        assert_eq!(picture_stem_of("00001.jpg"), "00001");
        assert_eq!(picture_stem_of("00001"), "00001");
        assert_eq!(picture_stem_of("media/photos/1/00001.webp"), "00001");
        assert_eq!(picture_stem_of("00001.tar.webp"), "00001.tar");
        assert_eq!(picture_stem_of("cover"), "cover");
    }

    /// Real numbers taken from a served chapter (album 1474506): every page below
    /// was downloaded, descrambled with each candidate count, and the count that
    /// produced a seamless page is the expected value. Getting the suffix handling
    /// wrong changes most of them (the reader would show shredded strips).
    #[test]
    fn segmentation_num_matches_real_pages() {
        let chapter = 1_474_506;
        let expected = [
            ("00001.webp", 12),
            ("00002.webp", 4),
            ("00003.webp", 2),
            ("00004.webp", 14),
            ("00005.webp", 6),
            ("00006.webp", 10),
            ("00007.webp", 6),
            ("00008.webp", 8),
            ("00009.webp", 14),
            ("00010.webp", 4),
            ("00011.webp", 14),
            ("00012.webp", 6),
        ];
        for (name, want) in expected {
            assert_eq!(
                segmentation_num(chapter, SCRAMBLE_220980, name),
                want,
                "wrong split count for {name}"
            );
        }
    }

    #[test]
    fn segmentation_num_accepts_names_with_or_without_the_suffix() {
        let chapter = 1_474_506;
        // The reader sends "00001", the exporter sends "00001.webp" — both must
        // hash the same string.
        assert_eq!(
            segmentation_num(chapter, SCRAMBLE_220980, "00011.webp"),
            segmentation_num(chapter, SCRAMBLE_220980, "00011")
        );
        // Hashing the suffix as well lands on a different count for this page.
        let with_suffix = (short_hash(&format!("{chapter}00001.webp"))
            .as_bytes()
            .last()
            .copied()
            .unwrap_or(b'0') as i64
            % 8)
            * 2
            + 2;
        assert_ne!(with_suffix, segmentation_num(chapter, SCRAMBLE_220980, "00001.webp"));
    }

    #[test]
    fn segmentation_num_handles_the_legacy_branches() {
        // Before the album's own scramble_id nothing is scrambled.
        assert_eq!(segmentation_num(100_000, SCRAMBLE_220980, "00001.jpg"), 0);
        // Then a fixed ten-way split up to 2021, then the md5 table.
        assert_eq!(segmentation_num(250_000, SCRAMBLE_220980, "00001.jpg"), 10);
        assert!(segmentation_num(300_000, SCRAMBLE_220980, "00001.jpg") >= 2);
        assert!(segmentation_num(500_000, SCRAMBLE_220980, "00001.jpg") <= 16);
    }
}
