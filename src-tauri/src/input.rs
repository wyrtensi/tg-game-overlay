use crate::states::Kind;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

/// Converts persisted `KeyboardEvent.code` values to Windows virtual-key codes.
pub fn virtual_key(name: &str) -> Option<i32> {
    match name {
        "ArrowUp" => Some(0x26),
        "ArrowDown" => Some(0x28),
        "ArrowLeft" => Some(0x25),
        "ArrowRight" => Some(0x27),
        "Space" => Some(0x20),
        "Escape" => Some(0x1B),
        code if code.len() == 4 && code.starts_with("Key") => {
            let key = code.as_bytes()[3];
            key.is_ascii_uppercase().then_some(key as i32)
        }
        code if code.len() == 6 && code.starts_with("Digit") => {
            let key = code.as_bytes()[5];
            key.is_ascii_digit().then_some(key as i32)
        }
        code if code.len() == 7 && code.starts_with("Numpad") => {
            let key = code.as_bytes()[6];
            key.is_ascii_digit().then_some(0x60 + (key - b'0') as i32)
        }
        _ => None,
    }
}

#[derive(Default)]
pub struct KeyEdgeTracker {
    previous: [bool; 4],
}

impl KeyEdgeTracker {
    pub fn update(&mut self, pressed: &[bool; 4]) -> Vec<Direction> {
        let directions = [
            Direction::Up,
            Direction::Down,
            Direction::Left,
            Direction::Right,
        ];
        let edges = directions
            .into_iter()
            .enumerate()
            .filter_map(|(index, direction)| {
                (pressed[index] && !self.previous[index]).then_some(direction)
            })
            .collect();
        self.previous = *pressed;
        edges
    }
}

pub struct DirectionInputGate;

impl DirectionInputGate {
    pub fn enabled(kind: Kind, markup: bool, paused: bool) -> bool {
        kind == Kind::Inactive && !markup && !paused
    }
}

#[cfg(test)]
mod tests {
    use super::{Direction, DirectionInputGate, KeyEdgeTracker};
    use crate::states::Kind;

    #[test]
    fn emits_one_edge_until_the_key_is_released() {
        let mut tracker = KeyEdgeTracker::default();
        assert_eq!(
            tracker.update(&[true, false, false, false]),
            vec![Direction::Up]
        );
        assert!(tracker.update(&[true, false, false, false]).is_empty());
        assert!(tracker.update(&[false, false, false, false]).is_empty());
        assert_eq!(
            tracker.update(&[true, false, false, false]),
            vec![Direction::Up]
        );
    }

    #[test]
    fn prioritizes_simultaneous_directions_in_a_stable_order() {
        let mut tracker = KeyEdgeTracker::default();
        assert_eq!(
            tracker.update(&[true, true, true, true]),
            vec![
                Direction::Up,
                Direction::Down,
                Direction::Left,
                Direction::Right
            ]
        );
    }

    #[test]
    fn observes_only_passive_unpaused_game_state() {
        assert!(!DirectionInputGate::enabled(Kind::Active, false, false));
        assert!(!DirectionInputGate::enabled(Kind::Inactive, true, false));
        assert!(!DirectionInputGate::enabled(Kind::Inactive, false, true));
        assert!(DirectionInputGate::enabled(Kind::Inactive, false, false));
    }

    #[test]
    fn resolves_the_physical_codes_saved_by_direction_settings() {
        assert_eq!(super::virtual_key("ArrowUp"), Some(0x26));
        assert_eq!(super::virtual_key("KeyW"), Some(0x57));
        assert_eq!(super::virtual_key("Digit3"), Some(0x33));
        assert_eq!(super::virtual_key("Space"), Some(0x20));
        assert_eq!(super::virtual_key("Escape"), Some(0x1B));
        assert_eq!(super::virtual_key("unknown"), None);
    }
}
