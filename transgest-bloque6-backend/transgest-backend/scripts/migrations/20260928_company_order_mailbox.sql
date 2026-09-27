-- Opt-in: never connect existing companies automatically or backfill old mail.
CREATE TABLE IF NOT EXISTS empresa_order_mailbox (
 empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
 email text NOT NULL DEFAULT '', provider text NOT NULL DEFAULT 'otro',
 host text NOT NULL DEFAULT '', port integer NOT NULL DEFAULT 993 CHECK(port=993),
 username text NOT NULL DEFAULT '', secret_encrypted text, folder text NOT NULL DEFAULT 'INBOX',
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 verified_at timestamptz, uid_validity text, last_uid bigint,
 last_sync_at timestamptz, last_received integer NOT NULL DEFAULT 0, last_error text,
 lease_token uuid, lease_until timestamptz, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
