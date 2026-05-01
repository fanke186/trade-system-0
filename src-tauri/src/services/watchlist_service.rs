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

pub fn reorder_watchlist_item(
    conn: &Connection,
    item_id: &str,
    position: &str,
) -> AppResult<OkResult> {
    let now = now_iso();
    let sort_order = match position {
        "top" => -1_i64,
        "bottom" => {
            conn.query_row(
                "select coalesce(max(sort_order), 0) + 1 from watchlist_items",
                [],
                |row| row.get::<_, i64>(0),
            )?
        }
        _ => return Err(AppError::new("invalid_position", "position 只允许 top、bottom", true)),
    };
    conn.execute(
        "update watchlist_items set sort_order = ?1, updated_at = ?2 where id = ?3",
        params![sort_order, now, item_id],
    )?;
    Ok(OkResult { ok: true })
}

pub fn move_watchlist_item(
    conn: &Connection,
    item_id: &str,
    target_watchlist_id: &str,
) -> AppResult<OkResult> {
    let now = now_iso();
    conn.execute(
        "update watchlist_items set watchlist_id = ?1, updated_at = ?2 where id = ?3",
        params![target_watchlist_id, now, item_id],
    )?;
    Ok(OkResult { ok: true })
}

pub fn create_watchlist_group(conn: &Connection, name: &str) -> AppResult<Watchlist> {
    let now = now_iso();
    let id = new_id("wl");
    conn.execute(
        "insert into watchlists (id, name, created_at, updated_at) values (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(Watchlist {
        id,
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        items: Vec::new(),
    })
}

pub fn delete_watchlist_group(conn: &Connection, watchlist_id: &str) -> AppResult<OkResult> {
    // Prevent deleting the default watchlist
    let name: String = conn.query_row(
        "select name from watchlists where id = ?1",
        params![watchlist_id],
        |row| row.get(0),
    )?;
    if name == "我的自选" {
        return Err(AppError::new(
            "protected",
            "不能删除默认自选股分组",
            true,
        ));
    }
    conn.execute(
        "delete from watchlist_items where watchlist_id = ?1",
        params![watchlist_id],
    )?;
    conn.execute(
        "delete from watchlists where id = ?1",
        params![watchlist_id],
    )?;
    Ok(OkResult { ok: true })
}

pub fn rename_watchlist_group(
    conn: &Connection,
    watchlist_id: &str,
    new_name: &str,
) -> AppResult<OkResult> {
    let now = now_iso();
    conn.execute(
        "update watchlists set name = ?1, updated_at = ?2 where id = ?3",
        params![new_name, now, watchlist_id],
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
