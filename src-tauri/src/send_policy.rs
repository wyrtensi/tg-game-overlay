#[derive(Debug, PartialEq, Eq)]
pub enum TextSendAction {
    Forward,
    ReportDisconnected,
}

pub fn text_send_action(connected: bool) -> TextSendAction {
    if connected {
        TextSendAction::Forward
    } else {
        TextSendAction::ReportDisconnected
    }
}
