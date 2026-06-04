use crate::edge_manager::SharedEdgeManager;
use crate::QuittingState;
use serde::Deserialize;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const TRAY_ID: &str = "main-tray";

/// Labels for tray menu items, supplied by the frontend i18n system.
#[derive(Debug, Clone, Deserialize)]
pub struct TrayLabels {
    #[serde(default = "default_show")]
    pub show: String,
    #[serde(default = "default_hide")]
    pub hide: String,
    #[serde(default = "default_start_edge")]
    pub start_edge: String,
    #[serde(default = "default_stop_edge")]
    pub stop_edge: String,
    #[serde(default = "default_quit")]
    pub quit: String,
    #[serde(default = "default_tooltip")]
    pub tooltip: String,
}

fn default_show() -> String {
    "Show Window".into()
}
fn default_hide() -> String {
    "Hide Window".into()
}
fn default_start_edge() -> String {
    "Start Edge".into()
}
fn default_stop_edge() -> String {
    "Stop Edge".into()
}
fn default_quit() -> String {
    "Quit".into()
}
fn default_tooltip() -> String {
    "AgentHub Desktop".into()
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            show: default_show(),
            hide: default_hide(),
            start_edge: default_start_edge(),
            stop_edge: default_stop_edge(),
            quit: default_quit(),
            tooltip: default_tooltip(),
        }
    }
}

/// Build the tray menu from label strings (so it can be rebuilt when the language changes).
fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: &TrayLabels,
) -> tauri::Result<tauri::menu::Menu<R>> {
    let show_item = MenuItemBuilder::with_id("show", &labels.show).build(app)?;
    let hide_item = MenuItemBuilder::with_id("hide", &labels.hide).build(app)?;
    let start_item = MenuItemBuilder::with_id("start_edge", &labels.start_edge).build(app)?;
    let stop_item = MenuItemBuilder::with_id("stop_edge", &labels.stop_edge).build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", &labels.quit).build(app)?;

    MenuBuilder::new(app)
        .item(&show_item)
        .item(&hide_item)
        .separator()
        .item(&start_item)
        .item(&stop_item)
        .separator()
        .item(&quit_item)
        .build()
}

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned().unwrap();
    let labels = TrayLabels::default();
    let menu = build_menu(app, &labels)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(&labels.tooltip)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        // On macOS, restore the Dock icon when showing the window.
                        #[cfg(target_os = "macos")]
                        {
                            use tauri::ActivationPolicy;
                            let _ = app.set_activation_policy(ActivationPolicy::Regular);
                        }
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "start_edge" => {
                    let edge = app.state::<SharedEdgeManager>().inner().clone();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut mgr = edge.lock().await;
                        let _ = mgr.start(&handle).await;
                    });
                }
                "stop_edge" => {
                    let edge = app.state::<SharedEdgeManager>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let mut mgr = edge.lock().await;
                        let _ = mgr.stop().await;
                    });
                }
                "quit" => {
                    let quitting = app.state::<QuittingState>();
                    quitting.0.store(true, Ordering::Relaxed);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    // On macOS, restore the Dock icon when showing the window.
                    #[cfg(target_os = "macos")]
                    {
                        use tauri::ActivationPolicy;
                        let _ = app.set_activation_policy(ActivationPolicy::Regular);
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Tauri command — called by the frontend after i18n initialisation to
/// localise the tray menu.  Rebuilds the menu with the supplied labels
/// and replaces it on the existing tray icon.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray icon not found".to_string())?;
    let menu = build_menu(&app, &labels).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&labels.tooltip))
        .map_err(|e| e.to_string())?;
    Ok(())
}
