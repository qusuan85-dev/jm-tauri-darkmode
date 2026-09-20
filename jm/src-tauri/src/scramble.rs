//! Putting a page back together.
//!
//! JM stores every page cut into `num` horizontal strips, written bottom strip
//! first. [`descramble_image_bytes`] undoes exactly that. `num` comes from
//! [`crate::paths::segmentation_num`]; a wrong `num` still produces a valid image,
//! just a shredded one, which is why this file is kept free of Tauri types — the
//! standalone harness in `jmwork/pathcheck` includes it and runs both the round-trip
//! test below and a real-page check, on a machine where the crate's own test binary
//! cannot start (it links the WebView2 stack).

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};

use image::ImageFormat;

/// No cancellation; see [`descramble_image_bytes_with_cancel`].
pub fn descramble_image_bytes(bytes: &[u8], num: i64) -> Result<(Vec<u8>, ImageFormat), String> {
    descramble_image_bytes_with_cancel(bytes, num, None)
}

/// Reassembles one page. `num <= 1` means the page was stored unscrambled and is
/// handed back untouched. JPEG input stays JPEG, everything else becomes PNG (the
/// WebP encoder is deliberately not used here).
pub fn descramble_image_bytes_with_cancel(
    bytes: &[u8],
    num: i64,
    cancel: Option<&AtomicBool>,
) -> Result<(Vec<u8>, ImageFormat), String> {
    if num <= 1 {
        let fmt = image::guess_format(bytes).unwrap_or(ImageFormat::Jpeg);
        return Ok((bytes.to_vec(), fmt));
    }

    let fmt_in = image::guess_format(bytes).unwrap_or(ImageFormat::Jpeg);
    let img = image::load_from_memory(bytes).map_err(|e| format!("decode image failed: {e}"))?;

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let num_u32 = num as u32;
    if num_u32 <= 1 || h == 0 || w == 0 {
        return Ok((bytes.to_vec(), fmt_in));
    }

    // Equal strips, with the remainder belonging to the *last* stored strip — which
    // is the first strip of the finished page.
    let rem = h % num_u32;
    let copy_height = h / num_u32;

    let mut blocks: Vec<(u32, u32)> = Vec::with_capacity(num_u32 as usize);
    let mut total_h = 0u32;
    for i in 0..num_u32 {
        let mut end = copy_height * (i + 1);
        if i == num_u32 - 1 {
            end += rem;
        }
        blocks.push((total_h, end));
        total_h = end;
    }

    let src = rgba.as_raw();
    let mut dst = vec![0u8; src.len()];
    let row_bytes = (w * 4) as usize;

    let mut y = 0u32;
    for (start, end) in blocks.into_iter().rev() {
        if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            return Err("cancelled".to_string());
        }
        let seg_h = end.saturating_sub(start);
        for dy in 0..seg_h {
            if dy % 64 == 0 && cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Err("cancelled".to_string());
            }
            let src_y = start + dy;
            let dst_y = y + dy;
            let src_off = (src_y as usize) * row_bytes;
            let dst_off = (dst_y as usize) * row_bytes;
            dst[dst_off..dst_off + row_bytes].copy_from_slice(&src[src_off..src_off + row_bytes]);
        }
        y += seg_h;
    }

    let out_rgba = image::RgbaImage::from_raw(w, h, dst).ok_or("image buffer create failed")?;

    let fmt_out = if fmt_in == ImageFormat::Jpeg {
        ImageFormat::Jpeg
    } else {
        ImageFormat::Png
    };

    if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
        return Err("cancelled".to_string());
    }

    let mut out_bytes = Vec::new();
    if fmt_out == ImageFormat::Jpeg {
        let rgb = image::DynamicImage::ImageRgba8(out_rgba).to_rgb8();
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(&mut Cursor::new(&mut out_bytes), fmt_out)
            .map_err(|e| format!("encode image failed: {e}"))?;
    } else {
        image::DynamicImage::ImageRgba8(out_rgba)
            .write_to(&mut Cursor::new(&mut out_bytes), fmt_out)
            .map_err(|e| format!("encode image failed: {e}"))?;
    }

    Ok((out_bytes, fmt_out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    /// Build the stored form of a synthetic page: strips bottom-first, with the
    /// remainder on the page's first strip (the last one stored).
    fn scramble(original: &RgbImage, num: u32) -> RgbImage {
        let (w, h) = original.dimensions();
        let copy_height = h / num;
        let rem = h % num;

        let mut bounds = Vec::new();
        let mut total = 0u32;
        for i in 0..num {
            let len = copy_height + if i == 0 { rem } else { 0 };
            bounds.push((total, total + len));
            total += len;
        }
        assert_eq!(total, h);

        let mut stored = RgbImage::new(w, h);
        let mut y = 0u32;
        for (start, end) in bounds.iter().rev() {
            for dy in 0..(end - start) {
                for x in 0..w {
                    stored.put_pixel(x, y + dy, *original.get_pixel(x, start + dy));
                }
            }
            y += end - start;
        }
        stored
    }

    fn as_png(img: RgbImage) -> Vec<u8> {
        let mut out = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .expect("encode png");
        out
    }

    #[test]
    fn strips_go_back_in_the_original_order() {
        // 9 rows over 4 strips exercises the remainder (the first strip is 3 tall).
        let (w, h, num) = (4u32, 9u32, 4u32);
        let original = RgbImage::from_fn(w, h, |_, y| Rgb([y as u8, (y * 7) as u8, 3]));

        let (out, fmt) =
            descramble_image_bytes(&as_png(scramble(&original, num)), num as i64).expect("decode");
        assert_eq!(fmt, ImageFormat::Png);

        let decoded = image::load_from_memory(&out).expect("decode result").to_rgb8();
        assert_eq!(decoded.dimensions(), (w, h));
        assert_eq!(
            decoded.as_raw(),
            original.as_raw(),
            "strips were not put back in the original order"
        );
    }

    #[test]
    fn an_unscrambled_page_is_passed_through_untouched() {
        let original = RgbImage::from_fn(3, 5, |x, y| Rgb([x as u8, y as u8, 9]));
        let png = as_png(original.clone());

        for num in [0i64, 1] {
            let (out, fmt) = descramble_image_bytes(&png, num).expect("passthrough");
            assert_eq!(fmt, ImageFormat::Png);
            assert_eq!(out, png, "num={num} must not re-encode the page");
        }
    }

    #[test]
    fn a_failed_page_reports_the_decode_error() {
        let err = descramble_image_bytes(b"not an image", 4).expect_err("should fail");
        assert!(err.contains("decode image failed"), "unexpected error: {err}");
    }
}
