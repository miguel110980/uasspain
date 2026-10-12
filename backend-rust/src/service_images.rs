//! Service-only image processing: bounded decoding, no scripts or private photo
//! metadata. Animated GIF/WebP frames and their timings remain byte-for-byte.
use crate::error::AppError;
use image::{ImageDecoder, ImageFormat, ImageReader};
use std::io::Cursor;

fn invalid() -> AppError {
    AppError::Validation("Imagen de servicio no válida.".into())
}

pub(crate) async fn sanitize(name: &str, mime: &str, data: &[u8]) -> Result<Vec<u8>, AppError> {
    if name.len() > 255
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
        || data.is_empty()
        || data.len() > 10 * 1024 * 1024
    {
        return Err(invalid());
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .ok_or_else(invalid)?;
    let format = match (extension.as_str(), mime) {
        ("jpg" | "jpeg", "image/jpeg") => ImageFormat::Jpeg,
        ("png", "image/png") => ImageFormat::Png,
        ("webp", "image/webp") => ImageFormat::WebP,
        ("gif", "image/gif") => ImageFormat::Gif,
        _ => return Err(invalid()),
    };
    if image::guess_format(data).map_err(|_| invalid())? != format {
        return Err(invalid());
    }
    let owned = data.to_vec();
    tokio::task::spawn_blocking(move || process(format, &owned))
        .await
        .map_err(|_| AppError::Internal)?
}

fn process(format: ImageFormat, data: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(data), format);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| invalid())?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > 32_000_000 {
        return Err(invalid());
    }
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    let mut pixels = image::DynamicImage::from_decoder(decoder).map_err(|_| invalid())?;
    pixels.apply_orientation(orientation);
    match format {
        ImageFormat::Gif => strip_gif(data),
        ImageFormat::WebP => strip_webp(data),
        _ => {
            let mut output = Cursor::new(Vec::new());
            pixels
                .write_to(&mut output, format)
                .map_err(|_| invalid())?;
            Ok(output.into_inner())
        }
    }
}

fn strip_webp(data: &[u8]) -> Result<Vec<u8>, AppError> {
    // https://developers.google.com/speed/webp/docs/riff_container
    if data.len() < 12 {
        return Err(invalid());
    }
    let end = u32::from_le_bytes(data[4..8].try_into().map_err(|_| invalid())?) as usize + 8;
    if end != data.len() {
        return Err(invalid());
    }
    let mut output = data[..12].to_vec();
    let mut offset = 12;
    while offset < end {
        let header = data.get(offset..offset + 8).ok_or_else(invalid)?;
        let size = u32::from_le_bytes(header[4..8].try_into().map_err(|_| invalid())?) as usize;
        let next = offset
            .checked_add(8)
            .and_then(|v| v.checked_add(size))
            .and_then(|v| v.checked_add(size % 2))
            .filter(|v| *v <= end)
            .ok_or_else(invalid)?;
        if !matches!(&header[..4], b"EXIF" | b"XMP ") {
            let start = output.len();
            output.extend_from_slice(&data[offset..next]);
            if &header[..4] == b"VP8X" {
                if size != 10 {
                    return Err(invalid());
                }
                output[start + 8] &= !(0x08 | 0x04);
            }
        }
        offset = next;
    }
    let size = u32::try_from(output.len() - 8).map_err(|_| invalid())?;
    output[4..8].copy_from_slice(&size.to_le_bytes());
    Ok(output)
}

fn sub_blocks(data: &[u8], mut offset: usize) -> Result<usize, AppError> {
    loop {
        let size = usize::from(*data.get(offset).ok_or_else(invalid)?);
        offset += 1;
        if size == 0 {
            return Ok(offset);
        }
        offset = offset
            .checked_add(size)
            .filter(|next| *next <= data.len())
            .ok_or_else(invalid)?;
    }
}

fn strip_gif(data: &[u8]) -> Result<Vec<u8>, AppError> {
    if data.len() < 13 {
        return Err(invalid());
    }
    let mut offset = 13
        + if data[10] & 0x80 != 0 {
            (2usize << (data[10] & 7)) * 3
        } else {
            0
        };
    let mut output = data.get(..offset).ok_or_else(invalid)?.to_vec();
    let mut frames = 0;
    while offset < data.len() {
        let start = offset;
        match data[offset] {
            0x3b => {
                output.push(0x3b);
                return Ok(output);
            }
            0x21 => {
                let label = *data.get(offset + 1).ok_or_else(invalid)?;
                offset = sub_blocks(data, offset + 2)?;
                let loop_control = data.get(start + 2) == Some(&11)
                    && data
                        .get(start + 3..start + 14)
                        .is_some_and(|id| id == b"NETSCAPE2.0" || id == b"ANIMEXTS1.0");
                if label == 0xf9 || (label == 0xff && loop_control) {
                    output.extend_from_slice(&data[start..offset]);
                }
            }
            0x2c => {
                let descriptor = data.get(offset..offset + 10).ok_or_else(invalid)?;
                frames += 1;
                if frames > 500 {
                    return Err(invalid());
                }
                offset += 10
                    + if descriptor[9] & 0x80 != 0 {
                        (2usize << (descriptor[9] & 7)) * 3
                    } else {
                        0
                    };
                offset = sub_blocks(data, offset + 1)?;
                output.extend_from_slice(&data[start..offset]);
            }
            _ => return Err(invalid()),
        }
    }
    Err(invalid())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn checks_content_mime_paths_and_metadata() {
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let mut source = png.into_inner();
        source.extend_from_slice(b"PRIVATE_TRAILING_METADATA");
        let result = sanitize("valid.png", "image/png", &source).await.unwrap();
        assert!(
            !result
                .windows(25)
                .any(|value| value == b"PRIVATE_TRAILING_METADATA")
        );
        assert!(image::load_from_memory(&result).is_ok());
        for (name, mime) in [
            ("../valid.png", "image/png"),
            ("valid.svg", "image/svg+xml"),
            ("valid.jpg", "image/jpeg"),
            ("valid.png", "text/html"),
        ] {
            assert!(sanitize(name, mime, &source).await.is_err());
        }
        assert!(
            sanitize("fake.png", "image/png", b"\x89PNG\r\n\x1a\ncorrupt")
                .await
                .is_err()
        );
    }
    #[test]
    fn gif_comments_are_removed_without_changing_animation_blocks() {
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut source, ImageFormat::Gif)
            .unwrap();
        let original = source.into_inner();
        let mut commented = original[..original.len() - 1].to_vec();
        commented.extend_from_slice(b"\x21\xfe\x06SECRET\x00\x3b");
        assert_eq!(strip_gif(&commented).unwrap(), original);
    }
    #[test]
    fn webp_exif_and_xmp_are_removed() {
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut source, ImageFormat::WebP)
            .unwrap();
        let original = source.into_inner();
        let mut with_metadata = original.clone();
        with_metadata.extend_from_slice(b"EXIF\x06\x00\x00\x00SECRET");
        let size = (with_metadata.len() - 8) as u32;
        with_metadata[4..8].copy_from_slice(&size.to_le_bytes());
        assert_eq!(strip_webp(&with_metadata).unwrap(), original);
        assert!(strip_webp(&with_metadata[..with_metadata.len() - 1]).is_err());
    }
}
