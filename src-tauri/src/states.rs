use crate::config::ProfileMode;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Off,
    Hidden,
    Inactive,
    Active,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub kind: Kind,
    pub game_exe: Option<String>,
    pub game_hwnd: Option<isize>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            kind: Kind::Off,
            game_exe: None,
            game_hwnd: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Event {
    Foreground {
        exe: Option<String>,
        hwnd: isize,
        is_overlay: bool,
    },
    Hotkey,
    Dismiss,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    Show,
    Hide,
    Activate,
    Deactivate,
    Disable,
}

pub struct Transition {
    pub state: State,
    pub effects: Vec<Effect>,
}

pub fn transition(
    state: &State,
    event: &Event,
    profile_mode: &dyn Fn(Option<&str>) -> Option<ProfileMode>,
) -> Transition {
    let next = reduce(state, event, profile_mode);
    let effects = effects_for(state.kind, next.kind);

    Transition { state: next, effects }
}

fn effects_for(previous: Kind, next: Kind) -> Vec<Effect> {
    if previous == next {
        return Vec::new();
    }

    let effect = match (previous, next) {
        (_, Kind::Off) => Effect::Disable,
        (_, Kind::Hidden) => Effect::Hide,
        (_, Kind::Active) => Effect::Activate,
        (Kind::Active, _) => Effect::Deactivate,
        _ => Effect::Show,
    };

    vec![effect]
}

fn reduce(
    state: &State,
    event: &Event,
    profile_mode: &dyn Fn(Option<&str>) -> Option<ProfileMode>,
) -> State {
    match event {
        Event::Foreground {
            exe,
            hwnd,
            is_overlay,
        } => {
            // Focus moving to the overlay itself is not the game going away.
            if *is_overlay {
                return state.clone();
            }

            match profile_mode(exe.as_deref()) {
                Some(ProfileMode::Show) => State {
                    kind: Kind::Inactive,
                    game_exe: exe.clone(),
                    game_hwnd: Some(*hwnd),
                },
                Some(ProfileMode::Blocked) => State::default(),
                // The game is still running behind this window, so the overlay only hides.
                _ if state.game_exe.is_some() => State {
                    kind: Kind::Hidden,
                    ..state.clone()
                },
                _ => State::default(),
            }
        }
        Event::Hotkey => match state.kind {
            Kind::Inactive => State {
                kind: Kind::Active,
                ..state.clone()
            },
            Kind::Active => State {
                kind: Kind::Inactive,
                ..state.clone()
            },
            _ => state.clone(),
        },
        Event::Dismiss => match state.kind {
            Kind::Active => State {
                kind: Kind::Inactive,
                ..state.clone()
            },
            _ => state.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProfileMode;

    fn mode_of(exe: Option<&str>) -> Option<ProfileMode> {
        match exe {
            Some("dota2.exe") => Some(ProfileMode::Show),
            Some("valorant.exe") => Some(ProfileMode::Blocked),
            Some("solitaire.exe") => Some(ProfileMode::Hidden),
            _ => None,
        }
    }

    fn apply(events: &[Event]) -> State {
        let mut state = State::default();
        for event in events {
            state = transition(&state, event, &mode_of).state;
        }
        state
    }

    fn game() -> Event {
        Event::Foreground {
            exe: Some("dota2.exe".into()),
            hwnd: 42,
            is_overlay: false,
        }
    }

    fn other() -> Event {
        Event::Foreground {
            exe: Some("chrome.exe".into()),
            hwnd: 7,
            is_overlay: false,
        }
    }

    fn overlay() -> Event {
        Event::Foreground {
            exe: Some("tg-game-overlay.exe".into()),
            hwnd: 9,
            is_overlay: true,
        }
    }

    #[test]
    fn starts_switched_off() {
        assert_eq!(State::default().kind, Kind::Off);
    }

    #[test]
    fn shows_the_feed_when_a_known_game_comes_to_front() {
        assert_eq!(apply(&[game()]).kind, Kind::Inactive);
    }

    #[test]
    fn stays_off_in_an_application_without_a_profile() {
        assert_eq!(apply(&[other()]).kind, Kind::Off);
    }

    #[test]
    fn stays_off_in_a_blocked_game() {
        let event = Event::Foreground {
            exe: Some("valorant.exe".into()),
            hwnd: 1,
            is_overlay: false,
        };
        assert_eq!(apply(&[event]).kind, Kind::Off);
    }

    #[test]
    fn opens_the_input_on_the_hotkey() {
        assert_eq!(apply(&[game(), Event::Hotkey]).kind, Kind::Active);
    }

    #[test]
    fn closes_the_input_on_the_same_hotkey() {
        assert_eq!(apply(&[game(), Event::Hotkey, Event::Hotkey]).kind, Kind::Inactive);
    }

    #[test]
    fn closes_the_input_on_dismiss() {
        assert_eq!(apply(&[game(), Event::Hotkey, Event::Dismiss]).kind, Kind::Inactive);
    }

    #[test]
    fn ignores_the_hotkey_outside_a_game() {
        assert_eq!(apply(&[other(), Event::Hotkey]).kind, Kind::Off);
    }

    #[test]
    fn hides_with_the_game_when_another_window_takes_over() {
        assert_eq!(apply(&[game(), other()]).kind, Kind::Hidden);
    }

    #[test]
    fn keeps_the_input_open_when_focus_moves_to_the_overlay() {
        assert_eq!(apply(&[game(), Event::Hotkey, overlay()]).kind, Kind::Active);
    }

    #[test]
    fn comes_back_passive_when_the_game_returns() {
        assert_eq!(apply(&[game(), Event::Hotkey, other(), game()]).kind, Kind::Inactive);
    }

    #[test]
    fn remembers_the_game_window_for_handing_focus_back() {
        assert_eq!(apply(&[game(), Event::Hotkey]).game_hwnd, Some(42));
    }

    #[test]
    fn a_blocked_game_switches_the_overlay_off_completely() {
        let blocked = Event::Foreground {
            exe: Some("valorant.exe".into()),
            hwnd: 1,
            is_overlay: false,
        };
        assert_eq!(apply(&[game(), blocked]).kind, Kind::Off);
    }

    #[test]
    fn asks_to_show_the_feed_when_a_game_appears() {
        let result = transition(&State::default(), &game(), &mode_of);
        assert_eq!(result.effects, vec![Effect::Show]);
    }

    #[test]
    fn asks_to_take_focus_when_the_input_opens() {
        let state = apply(&[game()]);
        let result = transition(&state, &Event::Hotkey, &mode_of);
        assert_eq!(result.effects, vec![Effect::Activate]);
    }

    #[test]
    fn asks_to_hand_focus_back_when_the_input_closes() {
        let state = apply(&[game(), Event::Hotkey]);
        let result = transition(&state, &Event::Dismiss, &mode_of);
        assert_eq!(result.effects, vec![Effect::Deactivate]);
    }

    #[test]
    fn asks_to_hide_when_the_game_goes_away() {
        let state = apply(&[game()]);
        let result = transition(&state, &other(), &mode_of);
        assert_eq!(result.effects, vec![Effect::Hide]);
    }

    #[test]
    fn does_nothing_when_the_same_game_window_is_reported_twice() {
        let state = apply(&[game()]);
        let result = transition(&state, &game(), &mode_of);
        assert!(result.effects.is_empty());
    }
}
