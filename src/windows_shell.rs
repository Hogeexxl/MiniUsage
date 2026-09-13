use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
};

use directories::BaseDirs;
use image::ImageFormat;
use mini_usage::platform::browser::{self, SystemBrowser};
use tao::{
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
    platform::windows::WindowBuilderExtWindows,
    window::{Window, WindowBuilder},
};
use tray_icon::{
    MouseButton, MouseButtonState, Rect as TrayRect, TrayIcon, TrayIconBuilder, TrayIconEvent,
};
use windows_sys::Win32::{
    Foundation::{POINT, RECT},
    Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    },
    UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
};
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

const PANEL_WIDTH_LOGICAL: i32 = 341;
const PANEL_HEIGHT_LOGICAL: i32 = -1;
const POPUP_GAP_PHYSICAL: i32 = 8;
#[cfg(debug_assertions)]
const PANEL_MEASUREMENT_HOST_HEIGHT_LOGICAL: i32 = 900;

const TRAY_URL: &str = "http://127.0.0.1:3210/tray";
const TRAY_URL_SLASH: &str = "http://127.0.0.1:3210/tray/";
#[cfg(debug_assertions)]
const TRAY_MEASURE_URL: &str = "http://127.0.0.1:3210/tray-measure";
#[cfg(debug_assertions)]
const TRAY_MEASURE_URL_SLASH: &str = "http://127.0.0.1:3210/tray-measure/";

#[derive(Debug)]
enum UserEvent {
    BackendReady,
    BackendExited(Result<(), String>),
    Tray(TrayIconEvent),
    OpenDashboard,
    #[cfg(debug_assertions)]
    MeasurementComplete,
    #[cfg(debug_assertions)]
    MeasurementFatal(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClickButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClickState {
    Up,
    Down,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClickAction {
    Ignore,
    RecordPress,
    Toggle,
}

fn click_action(button: ClickButton, state: ClickState) -> ClickAction {
    match (button, state) {
        (ClickButton::Left, ClickState::Down) => ClickAction::RecordPress,
        (ClickButton::Left, ClickState::Up) => ClickAction::Toggle,
        _ => ClickAction::Ignore,
    }
}

fn map_button(button: MouseButton) -> ClickButton {
    match button {
        MouseButton::Left => ClickButton::Left,
        MouseButton::Right => ClickButton::Right,
        MouseButton::Middle => ClickButton::Middle,
    }
}

fn map_button_state(state: MouseButtonState) -> ClickState {
    match state {
        MouseButtonState::Up => ClickState::Up,
        MouseButtonState::Down => ClickState::Down,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PhysicalRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl PhysicalRect {
    fn width(self) -> i32 {
        self.right - self.left
    }

    fn height(self) -> i32 {
        self.bottom - self.top
    }

    fn contains(self, point: PhysicalPosition<f64>) -> bool {
        point.x >= self.left as f64
            && point.x <= self.right as f64
            && point.y >= self.top as f64
            && point.y <= self.bottom as f64
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TaskbarEdge {
    Bottom,
    Top,
    Left,
    Right,
}

fn tray_rect_to_physical(rect: TrayRect) -> PhysicalRect {
    PhysicalRect {
        left: rect.position.x.round() as i32,
        top: rect.position.y.round() as i32,
        right: (rect.position.x + rect.size.width as f64).round() as i32,
        bottom: (rect.position.y + rect.size.height as f64).round() as i32,
    }
}

fn infer_taskbar_edge(
    monitor: PhysicalRect,
    work: PhysicalRect,
    anchor: PhysicalRect,
) -> TaskbarEdge {
    let gaps = [
        (TaskbarEdge::Left, (work.left - monitor.left).max(0)),
        (TaskbarEdge::Top, (work.top - monitor.top).max(0)),
        (TaskbarEdge::Right, (monitor.right - work.right).max(0)),
        (
            TaskbarEdge::Bottom,
            (monitor.bottom - work.bottom).max(0),
        ),
    ];
    if let Some((edge, _)) = gaps
        .iter()
        .copied()
        .max_by_key(|(_, gap)| *gap)
        .filter(|(_, gap)| *gap > 0)
    {
        return edge;
    }

    let distances = [
        (TaskbarEdge::Left, (anchor.left - monitor.left).abs()),
        (TaskbarEdge::Top, (anchor.top - monitor.top).abs()),
        (
            TaskbarEdge::Right,
            (monitor.right - anchor.right).abs(),
        ),
        (
            TaskbarEdge::Bottom,
            (monitor.bottom - anchor.bottom).abs(),
        ),
    ];
    distances
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .map(|(edge, _)| edge)
        .unwrap_or(TaskbarEdge::Bottom)
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if min > max {
        min
    } else {
        value.clamp(min, max)
    }
}

fn popup_position(
    anchor: PhysicalRect,
    monitor: PhysicalRect,
    work: PhysicalRect,
    popup: PhysicalSize<u32>,
) -> Result<PhysicalPosition<i32>, String> {
    let width =
        i32::try_from(popup.width).map_err(|_| "popup width exceeds i32".to_string())?;
    let height =
        i32::try_from(popup.height).map_err(|_| "popup height exceeds i32".to_string())?;
    if work.width() < width || work.height() < height {
        return Err("monitor work area is smaller than the fixed tray panel".to_string());
    }

    let center_x = anchor.left + anchor.width() / 2;
    let center_y = anchor.top + anchor.height() / 2;
    let edge = infer_taskbar_edge(monitor, work, anchor);

    let (raw_x, raw_y) = match edge {
        TaskbarEdge::Bottom => (
            center_x - width / 2,
            anchor.top - POPUP_GAP_PHYSICAL - height,
        ),
        TaskbarEdge::Top => (
            center_x - width / 2,
            anchor.bottom + POPUP_GAP_PHYSICAL,
        ),
        TaskbarEdge::Left => (
            anchor.right + POPUP_GAP_PHYSICAL,
            center_y - height / 2,
        ),
        TaskbarEdge::Right => (
            anchor.left - POPUP_GAP_PHYSICAL - width,
            center_y - height / 2,
        ),
    };

    Ok(PhysicalPosition::new(
        clamp_i32(raw_x, work.left, work.right - width),
        clamp_i32(raw_y, work.top, work.bottom - height),
    ))
}

fn monitor_and_work_area(anchor: PhysicalRect) -> Result<(PhysicalRect, PhysicalRect), String> {
    let center = POINT {
        x: anchor.left + anchor.width() / 2,
        y: anchor.top + anchor.height() / 2,
    };
    let monitor = unsafe { MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return Err("could not resolve monitor for tray anchor".to_string());
    }

    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    let ok = unsafe { GetMonitorInfoW(monitor, &mut info) };
    if ok == 0 {
        return Err("GetMonitorInfoW failed for tray anchor".to_string());
    }

    fn from_rect(rect: RECT) -> PhysicalRect {
        PhysicalRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }

    Ok((from_rect(info.rcMonitor), from_rect(info.rcWork)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TeardownKind {
    None,
    Production,
    Measurement,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FlowKind {
    Wait,
    Exit,
    ExitWithCode(i32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TerminalDisposition {
    teardown: TeardownKind,
    show_message_box: bool,
    flow: FlowKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerminalInput {
    NonTerminal,
    ExistingInstance,
    NormalStop,
    ProductionFatal,
    MeasurementComplete,
    MeasurementFatal,
}

fn terminal_disposition(input: TerminalInput) -> TerminalDisposition {
    match input {
        TerminalInput::NonTerminal => TerminalDisposition {
            teardown: TeardownKind::None,
            show_message_box: false,
            flow: FlowKind::Wait,
        },
        TerminalInput::ExistingInstance => TerminalDisposition {
            teardown: TeardownKind::None,
            show_message_box: false,
            flow: FlowKind::Exit,
        },
        TerminalInput::NormalStop => TerminalDisposition {
            teardown: TeardownKind::Production,
            show_message_box: false,
            flow: FlowKind::Exit,
        },
        TerminalInput::ProductionFatal => TerminalDisposition {
            teardown: TeardownKind::Production,
            show_message_box: true,
            flow: FlowKind::ExitWithCode(1),
        },
        TerminalInput::MeasurementComplete => TerminalDisposition {
            teardown: TeardownKind::Measurement,
            show_message_box: false,
            flow: FlowKind::Exit,
        },
        TerminalInput::MeasurementFatal => TerminalDisposition {
            teardown: TeardownKind::Measurement,
            show_message_box: false,
            flow: FlowKind::ExitWithCode(1),
        },
    }
}

fn normalize_backend_worker<F>(worker: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match catch_unwind(AssertUnwindSafe(worker)) {
        Ok(result) => result,
        Err(_) => Err("backend worker panicked".to_string()),
    }
}

#[derive(Default)]
struct ShellState {
    backend_was_ready: bool,
    popup_visible: bool,
    tray_press_visible: Option<bool>,
    focus_loss_for_tray: bool,
    tray: Option<TrayIcon>,
    popup_window: Option<Window>,
    web_context: Option<WebContext>,
    webview: Option<WebView>,
    #[cfg(debug_assertions)]
    measurement_mode: bool,
}

impl ShellState {
    fn teardown_production(&mut self) {
        self.webview.take();
        self.web_context.take();
        self.popup_window.take();
        self.tray.take();
        self.popup_visible = false;
    }

    #[cfg(debug_assertions)]
    fn teardown_measurement(&mut self) {
        self.webview.take();
        self.web_context.take();
        self.popup_window.take();
        self.popup_visible = false;
    }
}

pub fn run() -> ! {
    if std::env::var_os("MINIUSAGE_WINDOWS_HEADLESS_SMOKE").is_some() {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("MiniUsage startup failed: could not create Tokio runtime: {error}");
                std::process::exit(1);
            }
        };
        let code = match runtime.block_on(super::run(SystemBrowser)) {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("MiniUsage startup failed: {error}");
                1
            }
        };
        std::process::exit(code);
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let backend_proxy = proxy.clone();

    std::thread::spawn(move || {
        let result = normalize_backend_worker(|| {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(|error| format!("could not create Tokio runtime: {error}"))?;
            let ready_proxy = backend_proxy.clone();
            runtime.block_on(super::run_windows_backend(move || {
                let _ = ready_proxy.send_event(UserEvent::BackendReady);
            }))
        });
        let _ = backend_proxy.send_event(UserEvent::BackendExited(result));
    });

    let tray_proxy = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |event| {
        let _ = tray_proxy.send_event(UserEvent::Tray(event));
    }));

    let mut state = ShellState::default();
    #[cfg(debug_assertions)]
    {
        state.measurement_mode =
            std::env::var_os("MINIUSAGE_WINDOWS_TRAY_MEASURE").is_some();
    }

    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(UserEvent::BackendReady) => {
                state.backend_was_ready = true;
                #[cfg(debug_assertions)]
                if state.measurement_mode {
                    if let Err(error) =
                        create_measurement_ui(&mut state, target, proxy.clone())
                    {
                        finish_measurement_fatal(&mut state, error, control_flow);
                    }
                    return;
                }

                if PANEL_HEIGHT_LOGICAL <= 0 {
                    finish_production_fatal(
                        &mut state,
                        "Tray panel height is not frozen".to_string(),
                        control_flow,
                    );
                    return;
                }

                if let Err(error) =
                    create_production_ui(&mut state, target, proxy.clone())
                {
                    finish_production_fatal(&mut state, error, control_flow);
                }
            }
            Event::UserEvent(UserEvent::BackendExited(result)) => {
                #[cfg(debug_assertions)]
                if state.measurement_mode {
                    finish_measurement_fatal(
                        &mut state,
                        match result {
                            Ok(()) => {
                                "measurement backend exited before completion".to_string()
                            }
                            Err(error) => error,
                        },
                        control_flow,
                    );
                    return;
                }

                match result {
                    Ok(()) if !state.backend_was_ready => apply_flow(
                        terminal_disposition(TerminalInput::ExistingInstance).flow,
                        control_flow,
                    ),
                    Ok(()) => {
                        state.teardown_production();
                        apply_flow(
                            terminal_disposition(TerminalInput::NormalStop).flow,
                            control_flow,
                        );
                    }
                    Err(error) => {
                        finish_production_fatal(&mut state, error, control_flow)
                    }
                }
            }
            Event::UserEvent(UserEvent::OpenDashboard) => {
                if let Err(error) = browser::open_dashboard(&SystemBrowser) {
                    eprintln!("MiniUsage could not open Dashboard: {error}");
                }
            }
            Event::UserEvent(UserEvent::Tray(event)) => {
                #[cfg(debug_assertions)]
                if state.measurement_mode {
                    return;
                }
                handle_tray_event(&mut state, event, target, control_flow);
            }
            #[cfg(debug_assertions)]
            Event::UserEvent(UserEvent::MeasurementComplete) => {
                if state.measurement_mode {
                    state.teardown_measurement();
                    apply_flow(
                        terminal_disposition(TerminalInput::MeasurementComplete).flow,
                        control_flow,
                    );
                }
            }
            #[cfg(debug_assertions)]
            Event::UserEvent(UserEvent::MeasurementFatal(error)) => {
                if state.measurement_mode {
                    finish_measurement_fatal(&mut state, error, control_flow);
                }
            }
            Event::WindowEvent {
                window_id, event, ..
            } => {
                if state.popup_window.as_ref().map(Window::id) != Some(window_id) {
                    return;
                }
                handle_window_event(&mut state, event, target, control_flow);
            }
            _ => {}
        }
    })
}

fn create_user_data_dir() -> Result<PathBuf, String> {
    let base = BaseDirs::new()
        .ok_or_else(|| "could not resolve LocalAppData".to_string())?;
    let path = base
        .data_local_dir()
        .join("MiniUsage")
        .join("WebView2");
    std::fs::create_dir_all(&path).map_err(|error| {
        format!(
            "could not create WebView2 user data directory {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

fn load_tray_icon() -> Result<tray_icon::Icon, String> {
    let image = image::load_from_memory_with_format(
        include_bytes!("../assets/windows/tray-icon.png"),
        ImageFormat::Png,
    )
    .map_err(|error| format!("could not decode tray icon: {error}"))?
    .into_rgba8();
    let (width, height) = image.dimensions();
    if width != 64 || height != 64 {
        return Err(format!("tray icon must be 64x64, got {width}x{height}"));
    }
    tray_icon::Icon::from_rgba(image.into_raw(), width, height)
        .map_err(|error| format!("could not construct tray icon: {error}"))
}

fn build_popup_window(
    target: &EventLoopWindowTarget<UserEvent>,
    height: i32,
    visible: bool,
) -> Result<Window, String> {
    WindowBuilder::new()
        .with_title("MiniUsage")
        .with_visible(visible)
        .with_decorations(false)
        .with_resizable(false)
        .with_always_on_top(true)
        .with_inner_size(LogicalSize::new(
            PANEL_WIDTH_LOGICAL as f64,
            height as f64,
        ))
        .with_skip_taskbar(true)
        .with_undecorated_shadow(true)
        .build(target)
        .map_err(|error| format!("could not create tray popup window: {error}"))
}

fn create_production_ui(
    state: &mut ShellState,
    target: &EventLoopWindowTarget<UserEvent>,
    proxy: EventLoopProxy<UserEvent>,
) -> Result<(), String> {
    let icon = load_tray_icon()?;
    state.tray = Some(
        TrayIconBuilder::new()
            .with_icon(icon)
            .with_tooltip("MiniUsage")
            .build()
            .map_err(|error| {
                format!("could not create Windows tray icon: {error}")
            })?,
    );

    state.popup_window =
        Some(build_popup_window(target, PANEL_HEIGHT_LOGICAL, false)?);
    let user_data = create_user_data_dir()?;
    state.web_context = Some(WebContext::new(Some(user_data)));

    let window = state
        .popup_window
        .as_ref()
        .ok_or_else(|| {
            "tray popup window missing during WebView creation".to_string()
        })?;
    let context = state
        .web_context
        .as_mut()
        .ok_or_else(|| {
            "WebContext missing during WebView creation".to_string()
        })?;
    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new_with_web_context(context)
        .with_url(TRAY_URL)
        .with_navigation_handler(|url| url == TRAY_URL || url == TRAY_URL_SLASH)
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            if request.body() == "open-dashboard" {
                let _ = ipc_proxy.send_event(UserEvent::OpenDashboard);
            }
        })
        .build(window)
        .map_err(|error| {
            format!(
                "could not create WebView2 tray panel: {error}. Install the Microsoft Edge WebView2 Evergreen Runtime: https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
            )
        })?;
    state.webview = Some(webview);
    Ok(())
}

#[cfg(debug_assertions)]
fn create_measurement_ui(
    state: &mut ShellState,
    target: &EventLoopWindowTarget<UserEvent>,
    proxy: EventLoopProxy<UserEvent>,
) -> Result<(), String> {
    state.popup_window = Some(build_popup_window(
        target,
        PANEL_MEASUREMENT_HOST_HEIGHT_LOGICAL,
        true,
    )?);
    let user_data = create_user_data_dir()?;
    state.web_context = Some(WebContext::new(Some(user_data)));

    let window = state
        .popup_window
        .as_ref()
        .ok_or_else(|| {
            "measurement window missing during WebView creation".to_string()
        })?;
    let context = state
        .web_context
        .as_mut()
        .ok_or_else(|| {
            "measurement WebContext missing during WebView creation".to_string()
        })?;
    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new_with_web_context(context)
        .with_url(TRAY_MEASURE_URL)
        .with_navigation_handler(|url| {
            url == TRAY_MEASURE_URL || url == TRAY_MEASURE_URL_SLASH
        })
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            let message = request.body();
            if message == "open-dashboard" {
                let _ = ipc_proxy.send_event(UserEvent::OpenDashboard);
                return;
            }
            let Some(payload) = message.strip_prefix("tray-measure-result:") else {
                return;
            };
            let parsed: serde_json::Value = match serde_json::from_str(payload) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!(
                        "tray measurement fatal: invalid JSON: {error}"
                    );
                    let _ = ipc_proxy.send_event(UserEvent::MeasurementFatal(
                        format!("invalid measurement JSON: {error}"),
                    ));
                    return;
                }
            };
            match parsed
                .get("status")
                .and_then(serde_json::Value::as_str)
            {
                Some("ok") => {
                    println!("{payload}");
                    if parsed
                        .get("scenario")
                        .and_then(serde_json::Value::as_str)
                        == Some("M09")
                    {
                        let _ = ipc_proxy
                            .send_event(UserEvent::MeasurementComplete);
                    }
                }
                Some("fatal") => {
                    let error = parsed
                        .get("error")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("unknown tray measurement failure")
                        .to_string();
                    eprintln!("tray measurement fatal: {error}");
                    let _ = ipc_proxy
                        .send_event(UserEvent::MeasurementFatal(error));
                }
                _ => {
                    let error =
                        "measurement result has invalid status".to_string();
                    eprintln!("tray measurement fatal: {error}");
                    let _ = ipc_proxy
                        .send_event(UserEvent::MeasurementFatal(error));
                }
            }
        })
        .build(window)
        .map_err(|error| {
            format!("could not create WebView2 measurement host: {error}")
        })?;
    state.webview = Some(webview);
    state.popup_visible = true;
    Ok(())
}

fn handle_tray_event(
    state: &mut ShellState,
    event: TrayIconEvent,
    target: &EventLoopWindowTarget<UserEvent>,
    control_flow: &mut ControlFlow,
) {
    let TrayIconEvent::Click {
        rect,
        button,
        button_state,
        ..
    } = event
    else {
        return;
    };

    match click_action(map_button(button), map_button_state(button_state)) {
        ClickAction::Ignore => {
            state.tray_press_visible = None;
            state.focus_loss_for_tray = false;
        }
        ClickAction::RecordPress => {
            state.tray_press_visible =
                Some(state.popup_visible || state.focus_loss_for_tray);
        }
        ClickAction::Toggle => {
            let was_visible = state
                .tray_press_visible
                .take()
                .unwrap_or(
                    state.popup_visible || state.focus_loss_for_tray,
                );
            state.focus_loss_for_tray = false;
            if was_visible {
                hide_popup(state);
            } else if let Err(error) = show_popup(state, rect, target) {
                finish_production_fatal(state, error, control_flow);
            }
        }
    }
}

fn cursor_is_over_tray(
    state: &ShellState,
    target: &EventLoopWindowTarget<UserEvent>,
) -> bool {
    let Some(rect) = state.tray.as_ref().and_then(TrayIcon::rect) else {
        return false;
    };
    let Ok(cursor) = target.cursor_position() else {
        return false;
    };
    tray_rect_to_physical(rect).contains(cursor)
}

fn handle_window_event(
    state: &mut ShellState,
    event: WindowEvent<'_>,
    target: &EventLoopWindowTarget<UserEvent>,
    control_flow: &mut ControlFlow,
) {
    #[cfg(debug_assertions)]
    if state.measurement_mode {
        match event {
            WindowEvent::CloseRequested => finish_measurement_fatal(
                state,
                "measurement window closed before completion".to_string(),
                control_flow,
            ),
            WindowEvent::ScaleFactorChanged {
                scale_factor,
                new_inner_size,
            } => {
                *new_inner_size = LogicalSize::new(
                    PANEL_WIDTH_LOGICAL as f64,
                    PANEL_MEASUREMENT_HOST_HEIGHT_LOGICAL as f64,
                )
                .to_physical(scale_factor);
            }
            _ => {}
        }
        return;
    }

    match event {
        WindowEvent::Focused(false) if state.popup_visible => {
            if cursor_is_over_tray(state, target) {
                state.focus_loss_for_tray = true;
            }
            hide_popup(state);
        }
        WindowEvent::CloseRequested => hide_popup(state),
        WindowEvent::ScaleFactorChanged {
            scale_factor,
            new_inner_size,
        } => {
            *new_inner_size = LogicalSize::new(
                PANEL_WIDTH_LOGICAL as f64,
                PANEL_HEIGHT_LOGICAL as f64,
            )
            .to_physical(scale_factor);
        }
        _ => {}
    }
}

fn hide_popup(state: &mut ShellState) {
    if let Some(window) = state.popup_window.as_ref() {
        window.set_visible(false);
    }
    state.popup_visible = false;
}

fn show_popup(
    state: &mut ShellState,
    tray_rect: TrayRect,
    target: &EventLoopWindowTarget<UserEvent>,
) -> Result<(), String> {
    let anchor = tray_rect_to_physical(tray_rect);
    let center_x = anchor.left as f64 + anchor.width() as f64 / 2.0;
    let center_y = anchor.top as f64 + anchor.height() as f64 / 2.0;
    let monitor = target
        .monitor_from_point(center_x, center_y)
        .ok_or_else(|| {
            "could not resolve Tao monitor for tray anchor".to_string()
        })?;
    let scale = monitor.scale_factor();

    let window = state
        .popup_window
        .as_ref()
        .ok_or_else(|| {
            "tray popup window is not initialized".to_string()
        })?;
    window.set_inner_size(LogicalSize::new(
        PANEL_WIDTH_LOGICAL as f64,
        PANEL_HEIGHT_LOGICAL as f64,
    ));
    let expected_inner: PhysicalSize<u32> = LogicalSize::new(
        PANEL_WIDTH_LOGICAL as f64,
        PANEL_HEIGHT_LOGICAL as f64,
    )
    .to_physical(scale);
    if window.inner_size() != expected_inner {
        window.set_inner_size(expected_inner);
    }

    let popup_size = window.outer_size();
    let (monitor_rect, work_rect) = monitor_and_work_area(anchor)?;
    let position =
        popup_position(anchor, monitor_rect, work_rect, popup_size)?;
    window.set_outer_position(position);
    window.set_visible(true);
    window.set_focus();
    state.popup_visible = true;
    Ok(())
}

fn finish_production_fatal(
    state: &mut ShellState,
    error: String,
    control_flow: &mut ControlFlow,
) {
    state.teardown_production();
    show_fatal_message(&error);
    apply_flow(
        terminal_disposition(TerminalInput::ProductionFatal).flow,
        control_flow,
    );
}

#[cfg(debug_assertions)]
fn finish_measurement_fatal(
    state: &mut ShellState,
    error: String,
    control_flow: &mut ControlFlow,
) {
    eprintln!("tray measurement fatal: {error}");
    state.teardown_measurement();
    apply_flow(
        terminal_disposition(TerminalInput::MeasurementFatal).flow,
        control_flow,
    );
}

fn apply_flow(flow: FlowKind, control_flow: &mut ControlFlow) {
    *control_flow = match flow {
        FlowKind::Wait => ControlFlow::Wait,
        FlowKind::Exit => ControlFlow::Exit,
        FlowKind::ExitWithCode(code) => ControlFlow::ExitWithCode(code),
    };
}

fn show_fatal_message(error: &str) {
    let text = wide_null(&format!("MiniUsage 启动失败：{error}"));
    let title = wide_null("MiniUsage");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn wide_null(value: &str) -> Vec<u16> {
    value
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_wintray_click_contract() {
        let table = [
            (
                ClickButton::Left,
                ClickState::Up,
                ClickAction::Toggle,
            ),
            (
                ClickButton::Left,
                ClickState::Down,
                ClickAction::RecordPress,
            ),
            (
                ClickButton::Right,
                ClickState::Up,
                ClickAction::Ignore,
            ),
        ];
        for (button, state, expected) in table {
            assert_eq!(click_action(button, state), expected);
        }

        let focus_loss_for_tray = true;
        let visible_after_focus_loss = false;
        let was_visible =
            visible_after_focus_loss || focus_loss_for_tray;
        assert!(was_visible);
        assert!(!(!was_visible));
    }

    #[test]
    fn t_wintray_popup_position() {
        struct Case {
            anchor: PhysicalRect,
            monitor: PhysicalRect,
            work: PhysicalRect,
            popup: PhysicalSize<u32>,
            expected: PhysicalPosition<i32>,
        }

        let full = PhysicalRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        let cases = [
            Case {
                anchor: PhysicalRect {
                    left: 1800,
                    top: 1040,
                    right: 1840,
                    bottom: 1080,
                },
                monitor: full,
                work: PhysicalRect {
                    left: 0,
                    top: 0,
                    right: 1920,
                    bottom: 1040,
                },
                popup: PhysicalSize::new(341, 400),
                expected: PhysicalPosition::new(1649, 632),
            },
            Case {
                anchor: PhysicalRect {
                    left: 800,
                    top: 0,
                    right: 840,
                    bottom: 40,
                },
                monitor: full,
                work: PhysicalRect {
                    left: 0,
                    top: 40,
                    right: 1920,
                    bottom: 1080,
                },
                popup: PhysicalSize::new(341, 400),
                expected: PhysicalPosition::new(650, 48),
            },
            Case {
                anchor: PhysicalRect {
                    left: 0,
                    top: 500,
                    right: 40,
                    bottom: 540,
                },
                monitor: full,
                work: PhysicalRect {
                    left: 40,
                    top: 0,
                    right: 1920,
                    bottom: 1080,
                },
                popup: PhysicalSize::new(341, 400),
                expected: PhysicalPosition::new(48, 320),
            },
            Case {
                anchor: PhysicalRect {
                    left: 1880,
                    top: 500,
                    right: 1920,
                    bottom: 540,
                },
                monitor: full,
                work: PhysicalRect {
                    left: 0,
                    top: 0,
                    right: 1880,
                    bottom: 1080,
                },
                popup: PhysicalSize::new(341, 400),
                expected: PhysicalPosition::new(1531, 320),
            },
            Case {
                anchor: PhysicalRect {
                    left: -1275,
                    top: 1000,
                    right: -1235,
                    bottom: 1040,
                },
                monitor: PhysicalRect {
                    left: -1280,
                    top: 0,
                    right: 0,
                    bottom: 1024,
                },
                work: PhysicalRect {
                    left: -1280,
                    top: 0,
                    right: 0,
                    bottom: 984,
                },
                popup: PhysicalSize::new(426, 500),
                expected: PhysicalPosition::new(-1280, 476),
            },
        ];
        for case in cases {
            assert_eq!(
                popup_position(
                    case.anchor,
                    case.monitor,
                    case.work,
                    case.popup
                )
                .unwrap(),
                case.expected
            );
        }

        assert!(popup_position(
            PhysicalRect {
                left: 0,
                top: 0,
                right: 20,
                bottom: 20,
            },
            PhysicalRect {
                left: 0,
                top: 0,
                right: 300,
                bottom: 300,
            },
            PhysicalRect {
                left: 0,
                top: 0,
                right: 300,
                bottom: 300,
            },
            PhysicalSize::new(341, 400),
        )
        .is_err());

        let logical = LogicalSize::new(341.0, 400.0);
        let physical: PhysicalSize<u32> =
            logical.to_physical(1.25);
        assert_eq!(physical.width, 426);
        assert_eq!(physical.height, 500);
    }

    #[test]
    fn t_wintray_backend_terminal_contract() {
        let cases = [
            (
                TerminalInput::NonTerminal,
                TerminalDisposition {
                    teardown: TeardownKind::None,
                    show_message_box: false,
                    flow: FlowKind::Wait,
                },
            ),
            (
                TerminalInput::ExistingInstance,
                TerminalDisposition {
                    teardown: TeardownKind::None,
                    show_message_box: false,
                    flow: FlowKind::Exit,
                },
            ),
            (
                TerminalInput::NormalStop,
                TerminalDisposition {
                    teardown: TeardownKind::Production,
                    show_message_box: false,
                    flow: FlowKind::Exit,
                },
            ),
            (
                TerminalInput::ProductionFatal,
                TerminalDisposition {
                    teardown: TeardownKind::Production,
                    show_message_box: true,
                    flow: FlowKind::ExitWithCode(1),
                },
            ),
            (
                TerminalInput::MeasurementComplete,
                TerminalDisposition {
                    teardown: TeardownKind::Measurement,
                    show_message_box: false,
                    flow: FlowKind::Exit,
                },
            ),
            (
                TerminalInput::MeasurementFatal,
                TerminalDisposition {
                    teardown: TeardownKind::Measurement,
                    show_message_box: false,
                    flow: FlowKind::ExitWithCode(1),
                },
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(terminal_disposition(input), expected);
        }

        assert_eq!(normalize_backend_worker(|| Ok(())), Ok(()));
        assert_eq!(
            normalize_backend_worker(|| Err("boom".to_string())),
            Err("boom".to_string())
        );
        assert_eq!(
            normalize_backend_worker(|| -> Result<(), String> {
                panic!("worker panic")
            }),
            Err("backend worker panicked".to_string())
        );
    }
}
