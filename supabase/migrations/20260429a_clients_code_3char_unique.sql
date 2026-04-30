-- Enforce that clients.code is either NULL or exactly 3 characters,
-- and that non-NULL codes are unique (case-insensitive).

-- 1. Normalize: collapse empty/whitespace codes to NULL so the CHECK passes.
update clients
   set code = null
 where code is not null
   and (length(trim(code)) = 0 or length(code) <> 3);

-- Note: any non-NULL row with length<>3 is also nulled by the WHERE above.
-- If you want to preserve a non-3-char code instead, abort and assign a real code first.

-- 2. CHECK constraint: must be NULL or exactly 3 chars.
alter table clients
  drop constraint if exists clients_code_3chars;
alter table clients
  add constraint clients_code_3chars
  check (code is null or length(code) = 3);

-- 3. Unique index on uppercased code (when not null) — prevents duplicates and case-only variants.
drop index if exists clients_code_unique_ci;
create unique index clients_code_unique_ci
  on clients (upper(code))
  where code is not null;
