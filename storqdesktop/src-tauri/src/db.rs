// Device-local database for the packaged till.
//
// The web app already keeps a small reference snapshot and an offline sales
// queue in localStorage. WebView2's profile is durable, but it disappears with
// "clear site data", a profile reset or a repair install, and it cannot be
// inspected. SQLite is the copy that survives that: the webview still runs from
// its hot localStorage store, and every write is mirrored here, then restored
// into the webview at startup.
//
// Nothing role-gated is stored: the frontend only mirrors the same reference
// queries it is allowed to persist for every staff member.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheRow {
    pub user_id: String,
    pub cache_key: String,
    pub data: String,
    pub fetched_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub cache_key: String,
    pub data: String,
    pub fetched_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRow {
    pub user_id: String,
    /// One queued sale, exactly as the web app serialises it.
    pub entry: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub path: String,
    pub bytes: u64,
    pub cache_rows: i64,
    pub queued_sales: i64,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS query_cache (
  user_id    TEXT NOT NULL,
  cache_key  TEXT NOT NULL,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, cache_key)
);

CREATE TABLE IF NOT EXISTS sale_outbox (
  ref        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  entry      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ref)
);

CREATE INDEX IF NOT EXISTS sale_outbox_user ON sale_outbox (user_id);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    Ok(dir.join("storq.db"))
}

/// Open (or create) the till database and publish it as managed state.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("could not open {path:?}: {e}"))?;
    // WAL keeps a write from blocking the reads the register does while it rings
    // up a sale; `synchronous=NORMAL` is the right durability trade for a cache
    // that is rebuilt from the network whenever it is lost.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('schema', '1')
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| e.to_string())?;
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|_| "database lock poisoned".to_string())
}

/// Every cached reference query, for every account this device has signed in
/// with. The frontend keys them back into the webview's own storage at startup.
#[tauri::command]
pub fn cache_all(db: State<'_, Db>) -> Result<Vec<CacheRow>, String> {
    let conn = lock(&db)?;
    let mut stmt = conn
        .prepare("SELECT user_id, cache_key, data, fetched_at FROM query_cache")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CacheRow {
                user_id: row.get(0)?,
                cache_key: row.get(1)?,
                data: row.get(2)?,
                fetched_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replace this account's cache snapshot. The web app persists a snapshot per
/// account, so a replace (inside one transaction) keeps the file bounded instead
/// of growing a row for every query the register ever ran.
#[tauri::command]
pub fn cache_replace(
    db: State<'_, Db>,
    user_id: String,
    entries: Vec<CacheEntry>,
) -> Result<(), String> {
    let mut conn = lock(&db)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM query_cache WHERE user_id = ?1", params![user_id])
        .map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO query_cache (user_id, cache_key, data, fetched_at)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| e.to_string())?;
        for e in entries {
            stmt.execute(params![user_id, e.cache_key, e.data, e.fetched_at])
                .map_err(|err| err.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Drop every cached reference query. Signing out must not leave one tenant's
/// catalogue readable to the next person who signs in on this till.
#[tauri::command]
pub fn cache_clear(db: State<'_, Db>) -> Result<(), String> {
    let conn = lock(&db)?;
    conn.execute("DELETE FROM query_cache", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Queued sales, per account. These survive sign-out on purpose: money already
/// taken at the counter must still file itself when the shop reconnects.
#[tauri::command]
pub fn outbox_all(db: State<'_, Db>) -> Result<Vec<OutboxRow>, String> {
    let conn = lock(&db)?;
    let mut stmt = conn
        .prepare("SELECT user_id, entry FROM sale_outbox ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(OutboxRow {
                user_id: row.get(0)?,
                entry: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replace this account's queued sales. The ref is the primary key, so a sale
/// can never be written twice.
#[tauri::command]
pub fn outbox_replace(
    db: State<'_, Db>,
    user_id: String,
    entries: Vec<String>,
) -> Result<(), String> {
    let mut conn = lock(&db)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sale_outbox WHERE user_id = ?1", params![user_id])
        .map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO sale_outbox (ref, user_id, entry, created_at) VALUES (?1, ?2, ?3, ?4)")
            .map_err(|e| e.to_string())?;
        for (i, entry) in entries.into_iter().enumerate() {
            let reference = serde_json::from_str::<serde_json::Value>(&entry)
                .ok()
                .and_then(|v| v.get("ref").and_then(|r| r.as_str()).map(str::to_owned))
                .unwrap_or_else(|| format!("{user_id}-{i}"));
            stmt.execute(params![reference, user_id, entry, now + i as i64])
                .map_err(|err| err.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_stats(app: AppHandle, db: State<'_, Db>) -> Result<DbStats, String> {
    let conn = lock(&db)?;
    let cache_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM query_cache", [], |r| r.get(0))
        .unwrap_or(0);
    let queued_sales: i64 = conn
        .query_row("SELECT COUNT(*) FROM sale_outbox", [], |r| r.get(0))
        .unwrap_or(0);
    let path = db_path(&app)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(DbStats {
        path: path.to_string_lossy().into_owned(),
        bytes,
        cache_rows,
        queued_sales,
    })
}
