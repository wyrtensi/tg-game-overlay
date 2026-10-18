/**
 * Overlay states. The state machine itself lives in Rust (src-tauri/src/states.rs)
 * because it drives the window operations; the pages only render what it reports.
 */
export type OverlayKind = "off" | "hidden" | "inactive" | "active";

export type ProfileMode = "show" | "hidden" | "blocked";
