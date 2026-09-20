//! Minimal streaming PDF writer for image-only documents.
//!
//! Written by hand instead of pulling in a PDF crate for three reasons: no new
//! dependency on the Android build, constant memory usage (pages are streamed to
//! disk, which matters when merging a whole album into one file), and JPEG data
//! is embedded verbatim as `/DCTDecode` — no re-encoding, no quality loss.
//!
//! Supported input is JPEG; anything else is transcoded first by
//! [`to_jpeg`]. Page size is derived from the image aspect ratio at A4 width, so
//! a normal manga page comes out close to A4 and a long webtoon strip becomes a
//! correspondingly long page.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use image::ImageFormat;

/// A4 width in PostScript points.
const PAGE_WIDTH_PT: f32 = 595.276;
/// PDF implementations commonly refuse pages above 14400 units.
const MAX_PAGE_PT: f32 = 14400.0;

/// Extracts `(width, height, components)` from a JPEG's SOF marker.
pub fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32, u8)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 3 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        // Standalone markers without a payload.
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xD9 || marker == 0xDA {
            // End of image / start of scan: no SOF will follow.
            return None;
        }
        let len = ((bytes[i + 2] as usize) << 8) | bytes[i + 3] as usize;
        let is_sof = (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
        if is_sof {
            if i + 9 >= bytes.len() {
                return None;
            }
            let height = ((bytes[i + 5] as u32) << 8) | bytes[i + 6] as u32;
            let width = ((bytes[i + 7] as u32) << 8) | bytes[i + 8] as u32;
            let components = bytes[i + 9];
            return Some((width, height, components));
        }
        i += 2 + len;
    }
    None
}

/// Returns JPEG bytes plus `(width, height)`, re-encoding non-JPEG images.
pub fn to_jpeg(bytes: Vec<u8>, format: Option<ImageFormat>) -> Result<(Vec<u8>, u32, u32), String> {
    if format == Some(ImageFormat::Jpeg) || format.is_none() {
        if let Some((w, h, _)) = jpeg_size(&bytes) {
            return Ok((bytes, w, h));
        }
    }

    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode image failed: {e}"))?;
    let (w, h) = (img.width(), img.height());
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88);
    encoder
        .encode_image(&img)
        .map_err(|e| format!("encode jpeg failed: {e}"))?;
    Ok((out, w, h))
}

/// Streaming, append-only PDF document.
pub struct PdfWriter {
    out: BufWriter<File>,
    /// Byte offset of every object, indexed by (object number - 1).
    offsets: Vec<u64>,
    /// Object numbers of the page dictionaries, in page order.
    pages: Vec<u32>,
    next_object: u32,
}

impl PdfWriter {
    pub fn create(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
        }
        let file = File::create(path).map_err(|e| format!("create pdf failed: {e}"))?;
        let mut out = BufWriter::new(file);
        // A binary comment marks the file as containing binary data.
        out.write_all(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
            .map_err(|e| format!("write pdf header failed: {e}"))?;
        Ok(Self {
            out,
            offsets: Vec::new(),
            pages: Vec::new(),
            // Objects 1 and 2 are reserved for the catalog and the page tree.
            next_object: 3,
        })
    }

    fn position(&mut self) -> Result<u64, String> {
        self.out
            .stream_position_hint()
            .map_err(|e| format!("pdf tell failed: {e}"))
    }

    fn begin_object(&mut self) -> Result<(u32, u64), String> {
        let number = self.next_object;
        self.next_object += 1;
        let offset = self.position()?;
        write!(self.out, "{number} 0 obj\n").map_err(|e| format!("write obj failed: {e}"))?;
        Ok((number, offset))
    }

    fn end_object(&mut self, number: u32, offset: u64) -> Result<(), String> {
        self.out
            .write_all(b"endobj\n")
            .map_err(|e| format!("write endobj failed: {e}"))?;
        let index = (number - 1) as usize;
        if self.offsets.len() <= index {
            self.offsets.resize(index + 1, 0);
        }
        self.offsets[index] = offset;
        Ok(())
    }

    /// Appends one page holding a single image scaled to fill it.
    pub fn add_jpeg(&mut self, jpeg: &[u8], width: u32, height: u32, components: u8) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("image has zero size".to_string());
        }
        let color_space = match components {
            1 => "/DeviceGray",
            4 => "/DeviceCMYK",
            _ => "/DeviceRGB",
        };

        let mut page_width = PAGE_WIDTH_PT;
        let mut page_height = PAGE_WIDTH_PT * height as f32 / width as f32;
        if page_height > MAX_PAGE_PT {
            let scale = MAX_PAGE_PT / page_height;
            page_height = MAX_PAGE_PT;
            page_width *= scale;
        }
        page_width = page_width.max(1.0);
        page_height = page_height.max(1.0);

        // Image XObject: JPEG bytes verbatim.
        let (image_obj, image_off) = self.begin_object()?;
        write!(
            self.out,
            "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} \
             /ColorSpace {color_space} /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            jpeg.len()
        )
        .map_err(|e| format!("write image dict failed: {e}"))?;
        self.out
            .write_all(jpeg)
            .map_err(|e| format!("write image data failed: {e}"))?;
        self.out
            .write_all(b"\nendstream\n")
            .map_err(|e| format!("write image tail failed: {e}"))?;
        self.end_object(image_obj, image_off)?;

        // Content stream: place the unit square, scaled to the page.
        let content = format!(
            "q\n{:.3} 0 0 {:.3} 0 0 cm\n/Im0 Do\nQ\n",
            page_width, page_height
        );
        let (content_obj, content_off) = self.begin_object()?;
        write!(
            self.out,
            "<< /Length {} >>\nstream\n",
            content.as_bytes().len()
        )
        .map_err(|e| format!("write content dict failed: {e}"))?;
        self.out
            .write_all(content.as_bytes())
            .map_err(|e| format!("write content failed: {e}"))?;
        self.out
            .write_all(b"endstream\n")
            .map_err(|e| format!("write content tail failed: {e}"))?;
        self.end_object(content_obj, content_off)?;

        let (page_obj, page_off) = self.begin_object()?;
        write!(
            self.out,
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {:.3} {:.3}] \
             /Resources << /XObject << /Im0 {image_obj} 0 R >> >> /Contents {content_obj} 0 R >>\n",
            page_width, page_height
        )
        .map_err(|e| format!("write page dict failed: {e}"))?;
        self.end_object(page_obj, page_off)?;

        self.pages.push(page_obj);
        Ok(())
    }

    /// Writes the page tree, catalog, xref table and trailer.
    pub fn finish(mut self) -> Result<usize, String> {
        let page_count = self.pages.len();

        // Page tree (object 2).
        let mut kids = String::new();
        for p in &self.pages {
            kids.push_str(&format!("{p} 0 R "));
        }
        let pages_offset = self.position()?;
        write!(
            self.out,
            "2 0 obj\n<< /Type /Pages /Count {page_count} /Kids [{}] >>\nendobj\n",
            kids.trim_end()
        )
        .map_err(|e| format!("write pages failed: {e}"))?;
        if self.offsets.len() < 2 {
            self.offsets.resize(2, 0);
        }
        self.offsets[1] = pages_offset;

        // Catalog (object 1).
        let catalog_offset = self.position()?;
        self.out
            .write_all(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
            .map_err(|e| format!("write catalog failed: {e}"))?;
        self.offsets[0] = catalog_offset;

        let xref_offset = self.position()?;
        let total = self.offsets.len() + 1; // + the free object 0
        write!(self.out, "xref\n0 {total}\n").map_err(|e| format!("write xref failed: {e}"))?;
        self.out
            .write_all(b"0000000000 65535 f \n")
            .map_err(|e| format!("write xref head failed: {e}"))?;
        for offset in &self.offsets {
            write!(self.out, "{offset:010} 00000 n \n")
                .map_err(|e| format!("write xref entry failed: {e}"))?;
        }
        write!(
            self.out,
            "trailer\n<< /Size {total} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
        )
        .map_err(|e| format!("write trailer failed: {e}"))?;

        self.out
            .flush()
            .map_err(|e| format!("flush pdf failed: {e}"))?;
        Ok(page_count)
    }
}

/// `BufWriter` has no cheap "current offset" on stable Rust, so track it by
/// flushing and asking the file. Flushing per object keeps memory flat and the
/// cost is negligible next to the network downloads.
trait StreamPositionHint {
    fn stream_position_hint(&mut self) -> std::io::Result<u64>;
}

impl StreamPositionHint for BufWriter<File> {
    fn stream_position_hint(&mut self) -> std::io::Result<u64> {
        use std::io::Seek;
        self.flush()?;
        self.get_mut().stream_position()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_jpeg(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
        let mut img = image::RgbImage::new(w, h);
        for px in img.pixels_mut() {
            *px = image::Rgb(rgb);
        }
        let mut out = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90);
        enc.encode_image(&image::DynamicImage::ImageRgb8(img))
            .expect("encode sample jpeg");
        out
    }

    #[test]
    fn parses_jpeg_size_and_components() {
        let jpeg = sample_jpeg(40, 24, [200, 30, 30]);
        let (w, h, c) = jpeg_size(&jpeg).expect("jpeg header");
        assert_eq!((w, h, c), (40, 24, 3));
        assert!(jpeg_size(b"not a jpeg").is_none());
    }

    #[test]
    fn writes_a_renderable_multipage_pdf() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/pdf-test");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("sample.pdf");

        let mut writer = PdfWriter::create(&path).expect("create");
        for (i, rgb) in [[220, 40, 40], [40, 160, 90], [50, 90, 220]].iter().enumerate() {
            let jpeg = sample_jpeg(600, 900, *rgb);
            let (w, h, c) = jpeg_size(&jpeg).expect("jpeg header");
            writer.add_jpeg(&jpeg, w, h, c).expect("add page");
            let _ = i;
        }
        let pages = writer.finish().expect("finish");
        assert_eq!(pages, 3);

        let bytes = std::fs::read(&path).expect("read back");
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(bytes.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/Count 3"));
        assert!(text.contains("/Filter /DCTDecode"));
        // Every xref entry must point at an object header.
        assert_eq!(text.matches(" 00000 n \n").count(), 11);
    }

    #[test]
    fn re_encodes_non_jpeg_input() {
        let mut png = Vec::new();
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::new(12, 8));
        img.write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .expect("encode png");
        let (jpeg, w, h) = to_jpeg(png, Some(ImageFormat::Png)).expect("transcode");
        assert_eq!((w, h), (12, 8));
        assert_eq!(jpeg_size(&jpeg).map(|(w, h, _)| (w, h)), Some((12, 8)));
    }
}
