//! Thin Win32 layer: who is in front, where its window is, and focus handling.

use std::{ffi::c_void, mem::size_of, sync::OnceLock};

use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, BOOL, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows, GetAncestor, GetCursorPos,
    GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, RegisterClassW, SetForegroundWindow,
    SetWindowLongPtrW, TranslateMessage, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    GA_ROOTOWNER, GWL_EXSTYLE, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE,
    WINEVENT_OUTOFCONTEXT, WM_INPUT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

#[derive(Clone, Debug, Default)]
pub struct ForegroundInfo {
    pub hwnd: isize,
    pub exe: Option<String>,
    /// True when the window belongs to this application, including the
    /// WebView2 child window, which lives in a process of its own.
    pub is_own: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RectPx {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug)]
pub struct ProfileCandidate {
    pub exe: String,
    pub title: String,
}

type Callback = Box<dyn Fn(ForegroundInfo) + Send + Sync>;

static CALLBACK: OnceLock<Callback> = OnceLock::new();
type RawMouseCallback = Box<dyn Fn(i32, i32) + Send + Sync>;
static RAW_MOUSE_CALLBACK: OnceLock<RawMouseCallback> = OnceLock::new();

fn hwnd_of(handle: isize) -> HWND {
    HWND(handle as *mut c_void)
}

pub fn foreground_info() -> ForegroundInfo {
    let hwnd = unsafe { GetForegroundWindow() };
    info_of(hwnd)
}

/// Lists visible top-level windows that can be used to anchor an overlay.
pub fn profile_candidates() -> Vec<ProfileCandidate> {
    let mut candidates: Vec<ProfileCandidate> = Vec::new();
    let pointer = &mut candidates as *mut Vec<ProfileCandidate>;
    unsafe {
        let _ = EnumWindows(Some(collect_profile_candidate), LPARAM(pointer as isize));
    }
    candidates.sort_by(|left, right| left.exe.cmp(&right.exe));
    candidates.dedup_by(|left, right| left.exe == right.exe);
    candidates
}

unsafe extern "system" fn collect_profile_candidate(hwnd: HWND, data: LPARAM) -> BOOL {
    if !unsafe { IsWindowVisible(hwnd).as_bool() } || owns_window(hwnd) {
        return BOOL(1);
    }
    let Some(exe) = exe_name(hwnd) else {
        return BOOL(1);
    };
    let title = window_title(hwnd).unwrap_or_else(|| exe.clone());
    let candidates = unsafe { &mut *(data.0 as *mut Vec<ProfileCandidate>) };
    candidates.push(ProfileCandidate { exe, title });
    BOOL(1)
}

fn info_of(hwnd: HWND) -> ForegroundInfo {
    let root = unsafe { GetAncestor(hwnd, GA_ROOTOWNER) };
    let root = if root.0.is_null() { hwnd } else { root };

    ForegroundInfo {
        hwnd: root.0 as isize,
        exe: exe_name(root),
        is_own: owns_window(root),
    }
}

fn owns_window(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

/// Executable name in lower case, e.g. "dota2.exe". Protected processes give nothing.
fn exe_name(hwnd: HWND) -> Option<String> {
    if hwnd.0.is_null() {
        return None;
    }

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = [0u16; 520];
    let mut size = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    };
    unsafe {
        let _ = CloseHandle(handle);
    };
    result.ok()?;

    let path = String::from_utf16_lossy(&buffer[..size as usize]);
    path.rsplit(['\\', '/'])
        .next()
        .map(|name| name.to_lowercase())
}

fn window_title(hwnd: HWND) -> Option<String> {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    (copied > 0).then(|| String::from_utf16_lossy(&buffer[..copied as usize]))
}

pub fn window_rect(handle: isize) -> Option<RectPx> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd_of(handle), &mut rect) }.ok()?;

    Some(RectPx {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    })
}

/// Returns the cursor in physical pixels relative to the specified window.
pub fn cursor_position_in_window(handle: isize) -> Option<(i32, i32)> {
    let rect = window_rect(handle)?;
    let mut cursor = POINT::default();
    unsafe { GetCursorPos(&mut cursor) }.ok()?;
    Some((cursor.x - rect.x, cursor.y - rect.y))
}

/// A window with WS_EX_NOACTIVATE never steals focus from the game.
pub fn set_no_activate(handle: isize, on: bool) {
    let hwnd = hwnd_of(handle);
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let flag = WS_EX_NOACTIVATE.0 as isize;
    let next = if on { current | flag } else { current & !flag };

    if next != current {
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next) };
    }
}

/// A tool window stays out of the alt-tab list.
pub fn set_tool_window(handle: isize, on: bool) {
    let hwnd = hwnd_of(handle);
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let flag = WS_EX_TOOLWINDOW.0 as isize;
    let next = if on { current | flag } else { current & !flag };

    if next != current {
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next) };
    }
}

pub fn focus_window(handle: isize) {
    if handle == 0 {
        return;
    }
    unsafe {
        let _ = SetForegroundWindow(hwnd_of(handle));
    }
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if let Some(callback) = CALLBACK.get() {
        let info = if hwnd.0.is_null() {
            foreground_info()
        } else {
            info_of(hwnd)
        };
        callback(info);
    }
}

/// Starts a thread that reports every foreground change. The hook needs a message
/// pump on its own thread, otherwise the callback is never invoked. Windows of
/// this process are reported too: focus moving from the game straight to the
/// settings window has to hide the overlay like any other application would.
pub fn watch_foreground<F>(callback: F)
where
    F: Fn(ForegroundInfo) + Send + Sync + 'static,
{
    if CALLBACK.set(Box::new(callback)).is_err() {
        return;
    }

    std::thread::spawn(|| unsafe {
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_MINIMIZEEND,
            None,
            Some(win_event_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        if hook.is_invalid() {
            return;
        }

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}

unsafe extern "system" fn raw_input_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_INPUT {
        let handle = HRAWINPUT(lparam.0 as *mut c_void);
        let mut data = RAWINPUT::default();
        let mut size = size_of::<RAWINPUT>() as u32;
        let read = unsafe {
            GetRawInputData(
                handle,
                RID_INPUT,
                Some(&mut data as *mut RAWINPUT as *mut c_void),
                &mut size,
                size_of::<RAWINPUTHEADER>() as u32,
            )
        };
        if read != u32::MAX && read > 0 && data.header.dwType == RIM_TYPEMOUSE.0 {
            let mouse = unsafe { data.data.mouse };
            if let Some(callback) = RAW_MOUSE_CALLBACK.get() {
                callback(mouse.lLastX, mouse.lLastY);
            }
        }
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

/// Receives relative mouse motion without moving the cursor or taking focus.
/// The message-only sink gets the same raw input as the game; it never consumes it.
pub fn watch_raw_mouse<F>(callback: F)
where
    F: Fn(i32, i32) + Send + Sync + 'static,
{
    if RAW_MOUSE_CALLBACK.set(Box::new(callback)).is_err() {
        return;
    }

    std::thread::spawn(|| unsafe {
        let instance = GetModuleHandleW(PCWSTR::null())
            .map(|module| HINSTANCE(module.0))
            .unwrap_or_default();
        let class = WNDCLASSW {
            lpfnWndProc: Some(raw_input_window_proc),
            hInstance: instance,
            lpszClassName: w!("TgGameOverlayRawInput"),
            ..Default::default()
        };
        let _ = RegisterClassW(&class);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("TgGameOverlayRawInput"),
            PCWSTR::null(),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            None,
            instance,
            None,
        ) else {
            return;
        };
        let devices = [RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        }];
        if RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32).is_err() {
            return;
        }

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}
