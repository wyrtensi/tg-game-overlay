use std::f64::consts::TAU;

const MAX_DISTANCE: f64 = 10_000.0;

pub fn sector_for_vector(x: f64, y: f64, phrase_count: usize, dead_zone_px: f64) -> Option<usize> {
    if phrase_count == 0 || x.hypot(y) < dead_zone_px {
        return None;
    }
    let angle = x.atan2(y).rem_euclid(TAU);
    Some(((angle / TAU * phrase_count as f64).round() as usize) % phrase_count)
}

#[derive(Clone, Debug, Default)]
pub struct WheelSelection {
    x: f64,
    y: f64,
    selected: Option<usize>,
}

#[derive(Clone, Debug, Default)]
pub struct WheelLifecycle {
    open: bool,
    selection: WheelSelection,
    origin: Option<(i32, i32)>,
}

impl WheelLifecycle {
    pub fn open_at(&mut self, origin: Option<(i32, i32)>) {
        self.open = true;
        self.selection.reset();
        self.origin = origin;
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn origin(&self) -> Option<(i32, i32)> {
        self.origin
    }

    pub fn update_mouse(
        &mut self,
        delta_x: i32,
        delta_y: i32,
        phrase_count: usize,
        dead_zone_px: u32,
    ) -> Option<Option<usize>> {
        if !self.open {
            return None;
        }
        let previous = self.selection.selected();
        let selected = self
            .selection
            .add_raw_delta(delta_x, delta_y, phrase_count, dead_zone_px);
        (previous != selected).then_some(selected)
    }

    pub fn cancel(&mut self) -> bool {
        let was_open = self.open;
        self.open = false;
        self.selection.reset();
        self.origin = None;
        was_open
    }

    pub fn release(&mut self) -> Option<Option<usize>> {
        if !self.open {
            return None;
        }
        self.open = false;
        let selected = self.selection.selected();
        self.selection.reset();
        self.origin = None;
        Some(selected)
    }
}

impl WheelSelection {
    pub fn reset(&mut self) {
        self.x = 0.0;
        self.y = 0.0;
        self.selected = None;
    }

    pub fn add_raw_delta(
        &mut self,
        delta_x: i32,
        delta_y: i32,
        phrase_count: usize,
        dead_zone_px: u32,
    ) -> Option<usize> {
        self.x = (self.x + f64::from(delta_x)).clamp(-MAX_DISTANCE, MAX_DISTANCE);
        self.y = (self.y - f64::from(delta_y)).clamp(-MAX_DISTANCE, MAX_DISTANCE);
        self.selected = sector_for_vector(self.x, self.y, phrase_count, f64::from(dead_zone_px));
        self.selected
    }

    pub fn selected(&self) -> Option<usize> {
        self.selected
    }
}

#[cfg(test)]
mod tests {
    use super::{sector_for_vector, WheelLifecycle, WheelSelection};

    #[test]
    fn maps_up_and_right_to_clockwise_phrase_indexes() {
        assert_eq!(sector_for_vector(0.0, 10.0, 4, 5.0), Some(0));
        assert_eq!(sector_for_vector(10.0, 0.0, 4, 5.0), Some(1));
    }

    #[test]
    fn keeps_the_center_neutral() {
        assert_eq!(sector_for_vector(1.0, 1.0, 4, 5.0), None);
    }

    #[test]
    fn handles_the_wrap_boundary_without_a_gap() {
        assert_eq!(sector_for_vector(-0.01, 10.0, 8, 5.0), Some(0));
        assert_eq!(sector_for_vector(0.01, 10.0, 8, 5.0), Some(0));
    }

    #[test]
    fn accumulates_raw_mouse_deltas_with_a_bounded_distance() {
        let mut selection = WheelSelection::default();
        assert_eq!(selection.add_raw_delta(0, -10, 4, 5), Some(0));
        assert_eq!(selection.selected(), Some(0));
    }

    #[test]
    fn sends_only_the_selected_phrase_on_release() {
        let mut wheel = WheelLifecycle::default();
        wheel.open_at(None);
        assert_eq!(wheel.update_mouse(0, -10, 4, 5), Some(Some(0)));
        assert_eq!(wheel.release(), Some(Some(0)));
        assert!(!wheel.is_open());
        assert_eq!(wheel.release(), None);
    }

    #[test]
    fn closes_without_a_phrase_when_released_in_the_centre() {
        let mut wheel = WheelLifecycle::default();
        wheel.open_at(Some((480, 270)));

        assert_eq!(wheel.release(), Some(None));
        assert!(!wheel.is_open());
    }

    #[test]
    fn retains_the_opening_point_until_the_wheel_closes() {
        let mut wheel = WheelLifecycle::default();
        wheel.open_at(Some((480, 270)));

        assert_eq!(wheel.origin(), Some((480, 270)));

        wheel.cancel();
        assert_eq!(wheel.origin(), None);
    }
}
