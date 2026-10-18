use crate::send_policy::{text_send_action, TextSendAction};

#[test]
fn disconnected_text_send_reports_a_failure_instead_of_echoing_a_message() {
    assert_eq!(text_send_action(false), TextSendAction::ReportDisconnected);
}

#[test]
fn connected_text_send_is_forwarded_to_the_telegram_worker() {
    assert_eq!(text_send_action(true), TextSendAction::Forward);
}
