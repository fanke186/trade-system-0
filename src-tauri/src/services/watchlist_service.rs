use crate::error::{AppError, AppResult};
use crate::models::{OkResult, Watchlist, WatchlistItem};
use crate::services::common::{new_id, now_iso};
use rusqlite::{params, Connection};

pub fn list_watchlists(conn: &Connection) -> AppResult<Vec<Watchlist>> {
    let mut stmt = conn.prepare(
        "select id, name, created_at, updated_at from watchlists order by updated_at desc",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Watchlist {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            items: Vec::new(),
        })
    })?;
    let mut watchlists = Vec::new();
    for row in rows {
        let mut watchlist = row?;
        watchlist.items = list_items(conn, &watchlist.id)?;
        watchlists.push(watchlist);
    }
    Ok(watchlists)
}

pub fn save_watchlist(conn: &Connection, id: Option<String>, name: String) -> AppResult<Watchlist> {
    let now = now_iso();
    let id = id.unwrap_or_else(|| new_id("wl"));
    conn.execute(
        r#"
        insert into watchlists (id, name, created_at, updated_at)
        values (?1, ?2, ?3, ?3)
        on conflict(id) do update set name = excluded.name, updated_at = excluded.updated_at
        "#,
        params![id, name, now],
    )?;
    let mut result = list_watchlists(conn)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::new("not_found", "股票池不存在", true))?;
    result.items = list_items(conn, &id)?;
    Ok(result)
}

pub fn add_watchlist_item(
    conn: &Connection,
    watchlist_id: String,
    stock_code: String,
) -> AppResult<WatchlistItem> {
    let now = now_iso();
    let id = new_id("wli");
    let sort_order: i64 = conn.query_row(
        "select coalesce(max(sort_order), 0) + 1 from watchlist_items where watchlist_id = ?1",
        params![watchlist_id],
        |row| row.get(0),
    )?;
    conn.execute(
        r#"
        insert into watchlist_items
          (id, watchlist_id, stock_code, local_status, note, sort_order, created_at, updated_at)
        values (?1, ?2, ?3, 'watch', null, ?4, ?5, ?5)
        on conflict(watchlist_id, stock_code) do update set updated_at = excluded.updated_at
        "#,
        params![id, watchlist_id, stock_code, sort_order, now],
    )?;
    list_items(conn, &watchlist_id)?
        .into_iter()
        .find(|item| item.stock_code == stock_code)
        .ok_or_else(|| AppError::new("not_found", "股票池条目不存在", true))
}

pub fn remove_watchlist_item(
    conn: &Connection,
    watchlist_id: String,
    stock_code: String,
) -> AppResult<OkResult> {
    conn.execute(
        "delete from watchlist_items where watchlist_id = ?1 and stock_code = ?2",
        params![watchlist_id, stock_code],
    )?;
    Ok(OkResult { ok: true })
}

pub fn list_items(conn: &Connection, watchlist_id: &str) -> AppResult<Vec<WatchlistItem>> {
    let mut stmt = conn.prepare(
        r#"
        select id, watchlist_id, stock_code, local_status, note, sort_order, created_at, updated_at
          from watchlist_items
         where watchlist_id = ?1
         order by sort_order asc, created_at asc
        "#,
    )?;
    let rows = stmt.query_map(params![watchlist_id], |row| {
        Ok(WatchlistItem {
            id: row.get(0)?,
            watchlist_id: row.get(1)?,
            stock_code: row.get(2)?,
            local_status: row.get(3)?,
            note: row.get(4)?,
            sort_order: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}
