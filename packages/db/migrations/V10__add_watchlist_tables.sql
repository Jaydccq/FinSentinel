CREATE TABLE IF NOT EXISTS watchlist_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    name varchar(80) NOT NULL,
    category_key varchar(100) NOT NULL,
    description varchar(255),
    summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_watchlist_categories_user_key
ON watchlist_categories (user_id, category_key);

CREATE INDEX IF NOT EXISTS idx_watchlist_categories_user_id
ON watchlist_categories (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    category_id uuid NOT NULL REFERENCES watchlist_categories(id) ON DELETE CASCADE,
    symbol varchar(20) NOT NULL,
    company_name varchar(200),
    thesis text,
    notes text,
    priority integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_watchlist_items_category_symbol
ON watchlist_items (category_id, symbol);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_id
ON watchlist_items (user_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_category_id
ON watchlist_items (category_id);
