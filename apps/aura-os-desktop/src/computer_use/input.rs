//! Synthetic OS input (mouse + keyboard) for the computer-use executor.
//!
//! Thin wrappers over `enigo`. Every entry point builds a fresh `Enigo`, maps
//! our string-keyed action vocabulary onto enigo enums, and returns
//! `Result<_, String>` with context — no `unwrap`/`panic`. Coordinates arrive
//! in advertised (model) space and are scaled to physical desktop pixels via
//! [`crate::computer_use::screenshot::scale_point_to_physical`].

use enigo::{
    Axis, Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};

use crate::computer_use::screenshot::scale_point_to_physical;

/// Physical-space geometry needed to map advertised coordinates onto the real
/// desktop before issuing input.
#[derive(Clone, Copy)]
pub(crate) struct InputScale {
    pub(crate) adv_w: u32,
    pub(crate) adv_h: u32,
    pub(crate) phys_w: u32,
    pub(crate) phys_h: u32,
}

impl InputScale {
    fn to_physical(self, x: i32, y: i32) -> (i32, i32) {
        scale_point_to_physical(x, y, self.adv_w, self.adv_h, self.phys_w, self.phys_h)
    }
}

/// Build a fresh input backend; this is where macOS would surface a missing
/// Accessibility grant as a connection error.
fn new_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default())
        .map_err(|error| format!("failed to initialize input backend: {error}"))
}

/// Move the mouse to an advertised-space coordinate.
pub(crate) fn mouse_move(scale: InputScale, x: i32, y: i32) -> Result<(), String> {
    let (px, py) = scale.to_physical(x, y);
    let mut enigo = new_enigo()?;
    enigo
        .move_mouse(px, py, Coordinate::Abs)
        .map_err(|error| format!("move_mouse failed: {error}"))
}

/// Click a mouse button `clicks` times, optionally moving to `target` first.
pub(crate) fn click_button(
    scale: InputScale,
    button_name: &str,
    target: Option<(i32, i32)>,
    clicks: u32,
) -> Result<(), String> {
    let button = parse_button(button_name);
    let mut enigo = new_enigo()?;
    if let Some((x, y)) = target {
        let (px, py) = scale.to_physical(x, y);
        enigo
            .move_mouse(px, py, Coordinate::Abs)
            .map_err(|error| format!("move before click failed: {error}"))?;
    }
    let clicks = clicks.clamp(1, 5);
    for _ in 0..clicks {
        enigo
            .button(button, Click)
            .map_err(|error| format!("{button_name} click failed: {error}"))?;
    }
    Ok(())
}

/// Press the left button at the current location, drag to `target`, release.
pub(crate) fn left_click_drag(scale: InputScale, x: i32, y: i32) -> Result<(), String> {
    let (px, py) = scale.to_physical(x, y);
    let mut enigo = new_enigo()?;
    enigo
        .button(Button::Left, Press)
        .map_err(|error| format!("drag press failed: {error}"))?;
    let move_result = enigo
        .move_mouse(px, py, Coordinate::Abs)
        .map_err(|error| format!("drag move failed: {error}"));
    // Always attempt to release so a failed move cannot leave the button stuck.
    let release_result = enigo
        .button(Button::Left, Release)
        .map_err(|error| format!("drag release failed: {error}"));
    move_result.and(release_result)
}

/// Enter unicode text via the fast text path (layout-independent).
pub(crate) fn type_text(text: &str) -> Result<(), String> {
    let mut enigo = new_enigo()?;
    enigo
        .text(text)
        .map_err(|error| format!("text entry failed: {error}"))
}

/// Press a key or key-combo (e.g. `"Return"`, `"ctrl+s"`). Modifiers are held
/// while the final key is clicked, then released in reverse order.
pub(crate) fn press_key(combo: &str) -> Result<(), String> {
    let tokens: Vec<&str> = combo
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .collect();
    let keys = tokens
        .iter()
        .map(|token| map_key(token))
        .collect::<Result<Vec<Key>, String>>()?;
    let (last, modifiers) = keys
        .split_last()
        .ok_or_else(|| "key action requires a non-empty key".to_string())?;
    let mut enigo = new_enigo()?;
    for modifier in modifiers {
        enigo
            .key(*modifier, Press)
            .map_err(|error| format!("modifier press failed: {error}"))?;
    }
    let result = enigo
        .key(*last, Click)
        .map_err(|error| format!("key press failed: {error}"));
    for modifier in modifiers.iter().rev() {
        // Best-effort release; report the primary key result.
        let _ = enigo.key(*modifier, Release);
    }
    result
}

/// Scroll by advertised wheel-click counts on each axis (vertical first).
pub(crate) fn scroll(dx: i32, dy: i32) -> Result<(), String> {
    let mut enigo = new_enigo()?;
    if dy != 0 {
        enigo
            .scroll(dy, Axis::Vertical)
            .map_err(|error| format!("vertical scroll failed: {error}"))?;
    }
    if dx != 0 {
        enigo
            .scroll(dx, Axis::Horizontal)
            .map_err(|error| format!("horizontal scroll failed: {error}"))?;
    }
    Ok(())
}

/// Map a button name to an enigo [`Button`], defaulting to the left button.
fn parse_button(name: &str) -> Button {
    match name.to_ascii_lowercase().as_str() {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    }
}

/// Map a key token onto an enigo [`Key`]. Single characters become
/// `Key::Unicode`; named keys cover the common navigation/editing/modifier set.
fn map_key(token: &str) -> Result<Key, String> {
    let lower = token.to_ascii_lowercase();
    let key = match lower.as_str() {
        "return" | "enter" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "up" | "uparrow" => Key::UpArrow,
        "down" | "downarrow" => Key::DownArrow,
        "left" | "leftarrow" => Key::LeftArrow,
        "right" | "rightarrow" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "page_up" => Key::PageUp,
        "pagedown" | "page_down" => Key::PageDown,
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "meta" | "super" | "cmd" | "command" | "win" => Key::Meta,
        _ => {
            let mut chars = token.chars();
            match (chars.next(), chars.next()) {
                (Some(single), None) => Key::Unicode(single),
                _ => return Err(format!("unsupported key: {token}")),
            }
        }
    };
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::{map_key, parse_button};
    use enigo::{Button, Key};

    #[test]
    fn parse_button_defaults_to_left() {
        assert_eq!(parse_button("left"), Button::Left);
        assert_eq!(parse_button("unknown"), Button::Left);
        assert_eq!(parse_button("RIGHT"), Button::Right);
        assert_eq!(parse_button("middle"), Button::Middle);
    }

    #[test]
    fn map_key_named_keys() {
        assert_eq!(map_key("Return").unwrap(), Key::Return);
        assert_eq!(map_key("enter").unwrap(), Key::Return);
        assert_eq!(map_key("ESC").unwrap(), Key::Escape);
        assert_eq!(map_key("ctrl").unwrap(), Key::Control);
    }

    #[test]
    fn map_key_single_char_is_unicode() {
        assert_eq!(map_key("a").unwrap(), Key::Unicode('a'));
    }

    #[test]
    fn map_key_rejects_unknown_multichar() {
        assert!(map_key("notakey").is_err());
    }
}
