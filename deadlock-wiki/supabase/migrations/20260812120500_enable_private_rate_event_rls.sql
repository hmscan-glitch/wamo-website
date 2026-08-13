-- Keine Client-Policy ist beabsichtigt: nur die geprüfte SECURITY-DEFINER-RPC
-- schreibt als Tabellenbesitzer in diese interne Rate-Limit-Tabelle.
alter table private.community_post_rate_events enable row level security;
revoke all on table private.community_post_rate_events from public, anon, authenticated, service_role;
