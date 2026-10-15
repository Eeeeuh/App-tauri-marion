mod storage;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Serialises disk access so concurrent saves can never interleave.
#[derive(Default)]
struct DiskLock(Mutex<()>);

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_library(app: AppHandle, lock: State<'_, DiskLock>) -> Result<Option<String>, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    storage::load(&data_dir(&app)?)
}

#[tauri::command]
fn save_library(app: AppHandle, lock: State<'_, DiskLock>, data: String) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    storage::save(&data_dir(&app)?, &data)
}

/// Asks where to save a backup, then writes it. Returns the path, or `None` if cancelled.
#[tauri::command]
async fn export_library(app: AppHandle, data: String) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Exporter la liste")
        .set_file_name("bobine.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Lets the user pick a backup file and returns its content, or `None` if cancelled.
#[tauri::command]
async fn import_library(app: AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Importer une liste")
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > storage::MAX_BYTES {
        return Err("fichier trop volumineux".into());
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch focuses the existing window instead of opening a
    // concurrent instance writing to the same file.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DiskLock::default())
        .invoke_handler(tauri::generate_handler![
            load_library,
            save_library,
            export_library,
            import_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bobine");
}
