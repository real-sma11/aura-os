//! Full-desktop screen capture for the computer-use executor.
//!
//! Captures the primary monitor via `xcap`, downscales it to fit the advertised
//! display box (Anthropic recommends a bounded ~WXGA target for accurate
//! clicks), then PNG- and base64-encodes the result. Also exposes the pure
//! [`scale_point_to_physical`] helper that maps advertised (model-space)
//! coordinates back onto physical desktop pixels for input synthesis.
//!
//! Invariant: we never log the encoded image payload — only its dimensions.

use std::io::Cursor;

use base64::Engine;
use image::{imageops::FilterType, ImageFormat, RgbaImage};
use xcap::Monitor;

/// A captured-and-encoded screenshot plus the geometry needed to map
/// advertised (model-space) coordinates back to physical desktop pixels.
pub(crate) struct CapturedScreenshot {
    /// Base64 (standard alphabet) PNG of the advertised-space image.
    pub(crate) base64: String,
    /// Width of the encoded (advertised-space) PNG in pixels.
    pub(crate) width: u32,
    /// Height of the encoded (advertised-space) PNG in pixels.
    pub(crate) height: u32,
}

/// Resolve the primary monitor, falling back to the first available one.
fn primary_monitor() -> Result<Monitor, String> {
    let monitors =
        Monitor::all().map_err(|error| format!("failed to enumerate monitors: {error}"))?;
    let mut first: Option<Monitor> = None;
    for monitor in monitors {
        if first.is_none() {
            first = Some(monitor.clone());
        }
        if monitor.is_primary().unwrap_or(false) {
            return Ok(monitor);
        }
    }
    first.ok_or_else(|| "no monitors available for capture".to_string())
}

/// Physical pixel size of the primary monitor, used as the input-scaling
/// origin. Read from the monitor's device mode so it matches the dimensions of
/// the image returned by [`capture_primary`].
pub(crate) fn primary_physical_size() -> Result<(u32, u32), String> {
    let monitor = primary_monitor()?;
    let width = monitor
        .width()
        .map_err(|error| format!("failed to read monitor width: {error}"))?;
    let height = monitor
        .height()
        .map_err(|error| format!("failed to read monitor height: {error}"))?;
    Ok((width, height))
}

/// Capture the primary monitor and encode it into the advertised display box.
pub(crate) fn capture_primary(adv_w: u32, adv_h: u32) -> Result<CapturedScreenshot, String> {
    let monitor = primary_monitor()?;
    let image = monitor
        .capture_image()
        .map_err(|error| format!("failed to capture monitor image: {error}"))?;
    let scaled = scale_to_box(&image, adv_w, adv_h);
    let width = scaled.width();
    let height = scaled.height();
    let base64 = encode_png_base64(&scaled)?;
    Ok(CapturedScreenshot {
        base64,
        width,
        height,
    })
}

/// Downscale `image` to fit within `adv_w` x `adv_h`, preserving aspect ratio.
/// The advertised box is a cap: images already inside it are returned as-is
/// (we never upscale).
fn scale_to_box(image: &RgbaImage, adv_w: u32, adv_h: u32) -> RgbaImage {
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 || adv_w == 0 || adv_h == 0 {
        return image.clone();
    }
    if width <= adv_w && height <= adv_h {
        return image.clone();
    }
    let ratio = f64::min(
        f64::from(adv_w) / f64::from(width),
        f64::from(adv_h) / f64::from(height),
    );
    let new_w = ((f64::from(width) * ratio).round() as u32).max(1);
    let new_h = ((f64::from(height) * ratio).round() as u32).max(1);
    image::imageops::resize(image, new_w, new_h, FilterType::Triangle)
}

/// PNG-encode then base64-encode an image.
fn encode_png_base64(image: &RgbaImage) -> Result<String, String> {
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|error| format!("failed to PNG-encode screenshot: {error}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(buffer.into_inner()))
}

/// Map a point from advertised (model) space to physical desktop pixels.
///
/// The advertised box (`adv_w` x `adv_h`) is the coordinate system the model
/// reasons in; physical desktop pixels (`phys_w` x `phys_h`) are what the input
/// backend expects. Inputs are clamped to the advertised bounds before scaling
/// so out-of-range coordinates from the model can never land off-screen.
pub(crate) fn scale_point_to_physical(
    adv_x: i32,
    adv_y: i32,
    adv_w: u32,
    adv_h: u32,
    phys_w: u32,
    phys_h: u32,
) -> (i32, i32) {
    (
        scale_axis(adv_x, adv_w, phys_w),
        scale_axis(adv_y, adv_h, phys_h),
    )
}

/// Scale a single clamped axis value from advertised to physical pixels.
fn scale_axis(value: i32, advertised: u32, physical: u32) -> i32 {
    if advertised == 0 {
        return 0;
    }
    let clamped = value.clamp(0, advertised as i32);
    ((i64::from(clamped) * i64::from(physical)) / i64::from(advertised)) as i32
}

#[cfg(test)]
mod tests {
    use super::scale_point_to_physical;

    #[test]
    fn scale_point_identity_when_box_matches_physical() {
        assert_eq!(
            scale_point_to_physical(640, 400, 1280, 800, 1280, 800),
            (640, 400)
        );
    }

    #[test]
    fn scale_point_scales_up_to_larger_physical_display() {
        // Advertised 1280x800 -> physical 2560x1600 is a clean 2x.
        assert_eq!(
            scale_point_to_physical(640, 400, 1280, 800, 2560, 1600),
            (1280, 800)
        );
    }

    #[test]
    fn scale_point_scales_down_to_smaller_physical_display() {
        assert_eq!(
            scale_point_to_physical(1280, 800, 1280, 800, 640, 400),
            (640, 400)
        );
    }

    #[test]
    fn scale_point_clamps_negative_to_origin() {
        assert_eq!(
            scale_point_to_physical(-50, -10, 1280, 800, 1920, 1080),
            (0, 0)
        );
    }

    #[test]
    fn scale_point_clamps_overshoot_to_physical_max() {
        assert_eq!(
            scale_point_to_physical(5000, 5000, 1280, 800, 1920, 1080),
            (1920, 1080)
        );
    }

    #[test]
    fn scale_point_zero_advertised_is_origin() {
        assert_eq!(scale_point_to_physical(10, 10, 0, 0, 1920, 1080), (0, 0));
    }
}
