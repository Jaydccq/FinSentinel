use super::schema::open_in_memory;

#[test]
fn creates_expected_tables() {
    let conn = open_in_memory().expect("open db");
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert!(tables.contains(&"documents".to_string()));
    assert!(tables.contains(&"chunks".to_string()));
}

#[test]
fn vec_virtual_table_exists() {
    let conn = open_in_memory().expect("open db");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='chunk_vectors'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "chunk_vectors virtual table must exist");
}
