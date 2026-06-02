//! Stage-2 composite + encode with `ffmpeg`.
//!
//! Takes the stage-1 window capture and frames it onto a 1920x1080
//! canvas: the background is scaled to cover the canvas (no black
//! bars), the window video is scaled into a padded area with rounded
//! corners and a blurred drop shadow, then centered. The result is an
//! X-ready H.264 MP4 with a silent AAC track for broad upload
//! compatibility. A single `filter_complex` pass does the framing.

use std::path::Path;
use std::process::{Command, Stdio};
use tracing::info;

/// Output canvas dimensions (16:9, X-ready).
const CANVAS_WIDTH: u32 = 1920;
const CANVAS_HEIGHT: u32 = 1080;
/// Padded area the window video is fit into (~84% of the canvas), so
/// the framed window keeps margins for the background + shadow.
const WINDOW_MAX_WIDTH: u32 = 1613;
const WINDOW_MAX_HEIGHT: u32 = 908;
/// Rounded-corner radius applied to the window video, in pixels.
const CORNER_RADIUS: u32 = 20;
/// Drop-shadow blur radius and offset.
const SHADOW_BLUR: u32 = 24;
const SHADOW_OFFSET_X: i32 = 0;
const SHADOW_OFFSET_Y: i32 = 24;

/// Borrowed configuration for [`composite_and_encode`] (kept to a single
/// struct to respect the 5-parameter limit).
pub(crate) struct CompositeArgs<'a> {
    pub(crate) ffmpeg: &'a Path,
    /// Stage-1 captured window video.
    pub(crate) window_mp4: &'a Path,
    /// Optional background still image; falls back to a generated
    /// gradient when `None`.
    pub(crate) background: Option<&'a Path>,
    /// Final X-ready MP4 to write.
    pub(crate) output: &'a Path,
}

/// Composite the captured window onto a framed background and encode an
/// X-ready MP4. Blocking; call from a background thread.
pub(crate) fn composite_and_encode(args: &CompositeArgs) -> Result<(), String> {
    if let Some(parent) = args.output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("failed to create output dir {}: {error}", parent.display())
        })?;
    }

    let mut command = Command::new(args.ffmpeg);
    command
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning");

    // Input 0: the captured window video.
    command.arg("-i").arg(args.window_mp4);
    // Input 1: the background (file or generated gradient).
    build_background_input(&mut command, args.background);
    // Input 2: silent stereo audio for upload compatibility.
    append_silent_audio_input(&mut command);

    command.arg("-filter_complex").arg(build_filter_complex());
    append_encode_args(&mut command, args.output);
    command.stdin(Stdio::null());

    #[cfg(target_os = "windows")]
    super::apply_no_window_flag(&mut command);

    info!(
        window = %args.window_mp4.display(),
        output = %args.output.display(),
        background = %args.background.map(|p| p.display().to_string()).unwrap_or_else(|| "gradient".into()),
        "started ffmpeg composite/encode"
    );

    let result = command.output().map_err(|error| {
        format!(
            "failed to spawn ffmpeg composite ({}): {error}",
            args.ffmpeg.display()
        )
    })?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "ffmpeg composite exited with {}: {}",
            result.status,
            stderr.trim()
        ));
    }

    info!(output = %args.output.display(), "ffmpeg composite/encode finished");
    Ok(())
}

/// Append the background source: a looped still image when one resolves,
/// otherwise a soft dark-blue gradient generated via the `gradients`
/// lavfi source so there is never a black canvas.
fn build_background_input(command: &mut Command, background: Option<&Path>) {
    match background {
        Some(path) => {
            command.arg("-loop").arg("1").arg("-i").arg(path);
        }
        None => {
            command.arg("-f").arg("lavfi").arg("-i").arg(format!(
                "gradients=s={CANVAS_WIDTH}x{CANVAS_HEIGHT}:c0=0x1a2740:c1=0x0d1320:x0=0:y0=0:x1={CANVAS_WIDTH}:y1={CANVAS_HEIGHT}"
            ));
        }
    }
}

/// Append a silent stereo audio source so the MP4 always carries an AAC
/// track (some platforms reject video-only uploads).
fn append_silent_audio_input(command: &mut Command) {
    command
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("anullsrc=channel_layout=stereo:sample_rate=44100");
}

/// Build the single-pass `filter_complex`: cover-scale the background,
/// round the window corners, build a blurred drop shadow, then overlay
/// the shadow and the window centered on the canvas.
fn build_filter_complex() -> String {
    let alpha = rounded_corner_alpha_expr();
    format!(
        "[1:v]scale={CANVAS_WIDTH}:{CANVAS_HEIGHT}:force_original_aspect_ratio=increase,\
crop={CANVAS_WIDTH}:{CANVAS_HEIGHT},setsar=1[bg];\
[0:v]scale={WINDOW_MAX_WIDTH}:{WINDOW_MAX_HEIGHT}:force_original_aspect_ratio=decrease,\
format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha}'[win];\
[win]split=2[wmain][wshadow];\
[wshadow]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.5,boxblur={SHADOW_BLUR}:1[sh];\
[bg][sh]overlay=(W-w)/2+{SHADOW_OFFSET_X}:(H-h)/2+{SHADOW_OFFSET_Y}[bgsh];\
[bgsh][wmain]overlay=(W-w)/2:(H-h)/2,format=yuv420p[outv]"
    )
}

/// `geq` alpha expression for a rounded rectangle: opaque everywhere
/// except outside the corner arcs. `W`/`H` are the (scaled) window dims
/// so it adapts regardless of the fitted size.
fn rounded_corner_alpha_expr() -> String {
    let radius = CORNER_RADIUS;
    format!(
        "if(gt(abs(W/2-X),W/2-{radius})*gt(abs(H/2-Y),H/2-{radius}),\
if(lte(hypot((W/2-{radius})-abs(W/2-X),(H/2-{radius})-abs(H/2-Y)),{radius}),255,0),255)"
    )
}

/// Append the X-ready encode args: H.264 High / yuv420p / crf 18 /
/// preset slow / faststart at 30fps, plus the mapped silent AAC track.
fn append_encode_args(command: &mut Command, output: &Path) {
    command
        .arg("-map")
        .arg("[outv]")
        .arg("-map")
        .arg("2:a")
        .arg("-c:v")
        .arg("libx264")
        .arg("-profile:v")
        .arg("high")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-crf")
        .arg("18")
        .arg("-preset")
        .arg("slow")
        .arg("-r")
        .arg("30")
        .arg("-c:a")
        .arg("aac")
        .arg("-shortest")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output);
}
