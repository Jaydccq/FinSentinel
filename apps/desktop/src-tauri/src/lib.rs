pub mod commands;
pub mod db;
pub mod embeddings;
pub mod indexer;

use commands::{index_pdf, list_documents, search_private_docs, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)
                .expect("failed to create app data dir");

            let db_path = data_dir.join("finsentinel.db");
            let state = AppState::new(&db_path)
                .expect("failed to initialise AppState");

            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            index_pdf,
            search_private_docs,
            list_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
