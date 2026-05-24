use crate::edge_manager::SharedEdgeManager;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned().unwrap();

    let show_item = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
    let hide_item = MenuItemBuilder::with_id("hide", "Hide Window").build(app)?;
    let start_item = MenuItemBuilder::with_id("start_edge", "Start Edge").build(app)?;
    let stop_item = MenuItemBuilder::with_id("stop_edge", "Stop Edge").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&hide_item)
        .separator()
        .item(&start_item)
        .item(&stop_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("AgentHub Desktop")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
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
                    tauri::async_runtime::spawn(async move {
                        let mut mgr = edge.lock().await;
                        let _ = mgr.start().await;
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
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
