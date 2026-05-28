//! Markdown section helpers for granular spec edits.
//!
//! Specs are stored as a single `markdown_contents` blob, but the
//! `update_spec_section` / `append_to_spec` tools let agents mutate one
//! `## ` section (or append a block) without re-emitting the whole body.
//! Section structure is the prompt-enforced spec contract (`## Goals`,
//! `## Non-Goals`, ...) — these helpers operate purely on the level-2
//! heading layout and never validate which sections exist.

/// Normalize a heading for comparison: drop any leading `#` markers and
/// surrounding whitespace, then lowercase. Accepts both `"## Goals"` and
/// `"Goals"` so callers don't have to know whether to include the prefix.
fn normalize_heading(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('#')
        .trim()
        .to_lowercase()
}

/// If `line` is a level-2 (`## `) markdown heading, return its title text
/// (everything after the `## ` marker, trimmed). Deeper headings (`### `)
/// and non-heading lines return `None`.
fn level2_heading_title(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix("## ")?;
    // `### Foo` would have already failed the `"## "` prefix check because
    // the third byte is `#`, not a space, so `rest` here is always the
    // title of a genuine level-2 heading.
    Some(rest.trim())
}

/// Replace the body of the `## ` section whose heading matches
/// `heading` with `new_body`, keeping the heading line itself. Matching
/// is case-insensitive and tolerant of a missing `## ` prefix on
/// `heading`.
///
/// On success returns the full rebuilt markdown. On failure (no heading
/// matched) returns `Err` carrying the list of available level-2 heading
/// titles so the caller can surface an actionable error.
pub(crate) fn replace_section(
    body: &str,
    heading: &str,
    new_body: &str,
) -> Result<String, Vec<String>> {
    let target = normalize_heading(heading);
    let lines: Vec<&str> = body.lines().collect();

    // Collect the (line index, original title) of every level-2 heading.
    let headings: Vec<(usize, &str)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| level2_heading_title(line).map(|title| (i, title)))
        .collect();

    let Some(pos) = headings
        .iter()
        .position(|(_, title)| normalize_heading(title) == target)
    else {
        return Err(headings
            .into_iter()
            .map(|(_, title)| title.to_string())
            .collect());
    };

    let heading_idx = headings[pos].0;
    let next_idx = headings
        .get(pos + 1)
        .map(|(i, _)| *i)
        .unwrap_or(lines.len());

    let mut out = String::with_capacity(body.len() + new_body.len());

    // Everything up to and including the matched heading line.
    for line in &lines[..=heading_idx] {
        out.push_str(line);
        out.push('\n');
    }

    // The replacement body, with surrounding blank lines normalized away.
    let trimmed_new = new_body.trim_matches('\n');
    if !trimmed_new.is_empty() {
        out.push_str(trimmed_new);
        out.push('\n');
    }

    // The remainder (the next section onward), separated by a blank line.
    if next_idx < lines.len() {
        out.push('\n');
        for line in &lines[next_idx..] {
            out.push_str(line);
            out.push('\n');
        }
    }

    Ok(out)
}

/// Append `markdown` to the end of `body`, separated by a blank line, and
/// ensure the result ends with a single trailing newline.
pub(crate) fn append_block(body: &str, markdown: &str) -> String {
    let existing = body.trim_end_matches('\n');
    let addition = markdown.trim_matches('\n');
    if existing.is_empty() {
        return format!("{addition}\n");
    }
    if addition.is_empty() {
        return format!("{existing}\n");
    }
    format!("{existing}\n\n{addition}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "## Goals\nOld goal line.\n\n## Non-Goals\nNot this.\n";

    #[test]
    fn replaces_a_middle_section_keeping_others() {
        let out = replace_section(SAMPLE, "## Goals", "New goal.").unwrap();
        assert_eq!(
            out,
            "## Goals\nNew goal.\n\n## Non-Goals\nNot this.\n"
        );
    }

    #[test]
    fn replaces_the_final_section() {
        let out = replace_section(SAMPLE, "Non-Goals", "Still nothing.").unwrap();
        assert_eq!(
            out,
            "## Goals\nOld goal line.\n\n## Non-Goals\nStill nothing.\n"
        );
    }

    #[test]
    fn heading_match_is_case_insensitive_and_prefix_tolerant() {
        assert!(replace_section(SAMPLE, "goals", "x").is_ok());
        assert!(replace_section(SAMPLE, "## GOALS", "x").is_ok());
    }

    #[test]
    fn missing_heading_returns_available_headings() {
        let err = replace_section(SAMPLE, "## Design", "x").unwrap_err();
        assert_eq!(err, vec!["Goals".to_string(), "Non-Goals".to_string()]);
    }

    #[test]
    fn does_not_match_deeper_headings() {
        let body = "## Goals\ntext\n### Subsection\nsub\n";
        let out = replace_section(body, "Subsection", "x");
        assert!(out.is_err(), "### headings must not be treated as level-2");
    }

    #[test]
    fn append_adds_blank_line_separator() {
        let out = append_block("## Goals\nLine.\n", "## Extra\nMore.");
        assert_eq!(out, "## Goals\nLine.\n\n## Extra\nMore.\n");
    }

    #[test]
    fn append_to_empty_body() {
        assert_eq!(append_block("", "## New\nbody"), "## New\nbody\n");
    }
}
