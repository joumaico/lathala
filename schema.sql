-- Lathala optimized Supabase schema
-- Single merged rebuild script for the static public site and local Flask control app.
-- Back up existing data before running this in an existing project.

begin;

-- ---------------------------------------------------------------------------
-- Drop old/new objects so this single file can replace the previous split SQL.
-- ---------------------------------------------------------------------------
drop table if exists public.publisher_sources cascade;
drop table if exists public.sources cascade;
drop table if exists public.publishers cascade;
drop table if exists public.articles cascade;
drop table if exists public.app_settings cascade;
drop table if exists public.variables cascade;

drop function if exists public.get_articles_by_tag(text, integer) cascade;
drop function if exists public.get_articles_by_tag(text) cascade;
drop function if exists public.get_domain_name(text) cascade;
drop function if exists public.root_domain(text) cascade;
drop function if exists public.get_app_config() cascade;
drop function if exists public.set_app_setting(text, jsonb) cascade;
drop function if exists public.assign_article_publishers() cascade;
drop function if exists public.normalize_article_authors() cascade;
drop function if exists public.clean_article_author() cascade;
drop function if exists public.touch_updated_at() cascade;

-- ---------------------------------------------------------------------------
-- URL/domain helpers
-- ---------------------------------------------------------------------------
create or replace function public.root_domain(raw_url text)
returns text
language sql
immutable
strict
as $$
  with normalized as (
    select regexp_replace(
      regexp_replace(lower(btrim(raw_url)), '^[a-z][a-z0-9+.-]*://', ''),
      '^www\.',
      ''
    ) as value
  ),
  host_only as (
    select regexp_replace(
      split_part(split_part(split_part(split_part(value, '@', array_length(string_to_array(value, '@'), 1)), '/', 1), '?', 1), '#', 1),
      ':[0-9]+$',
      ''
    ) as host
    from normalized
  ),
  labels as (
    select
      host,
      string_to_array(host, '.') as parts,
      array_length(string_to_array(host, '.'), 1) as part_count
    from host_only
    where host is not null and host <> ''
  )
  select case
    when part_count is null then null
    when part_count <= 2 then host
    when parts[part_count - 1] || '.' || parts[part_count] in (
      'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
      'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
      'com.au', 'net.au', 'org.au',
      'co.nz',
      'com.sg', 'com.my',
      'co.jp'
    ) then parts[part_count - 2] || '.' || parts[part_count - 1] || '.' || parts[part_count]
    else parts[part_count - 1] || '.' || parts[part_count]
  end
  from labels;
$$;

-- Backward-compatible name used by the previous SQL.
create or replace function public.get_domain_name(raw_url text)
returns text
language sql
immutable
strict
as $$
  select public.root_domain(raw_url);
$$;

-- ---------------------------------------------------------------------------
-- Runtime variables: editable in the local control app, never used for secrets.
-- ---------------------------------------------------------------------------
create table public.variables (
  key text primary key,
  value jsonb not null,
  value_type text not null check (value_type in ('string', 'integer', 'number', 'boolean')),
  label text not null,
  description text not null default ''
);

insert into public.variables (key, value, value_type, label, description) values
  ('GEMINI_MODEL_ID', '"gemini-3.1-flash-lite-preview"'::jsonb, 'string', 'Gemini model ID', 'Model used for link extraction and article summaries.'),
  ('GEMINI_LINK_BATCH_SIZE', '4'::jsonb, 'integer', 'Gemini link batch size', 'Number of scraped source pages sent to Gemini in one link-extraction prompt.'),
  ('GEMINI_ARTICLE_BATCH_SIZE', '3'::jsonb, 'integer', 'Gemini article batch size', 'Number of scraped article pages sent to Gemini in one summary prompt.'),
  ('PUBLISHER_LOGO_BASE_URL', '"https://ruludjzcqacclehqkppk.supabase.co/storage/v1/object/public/lathala/images/sources"'::jsonb, 'string', 'Publisher logo base URL', 'Static folder URL used to build publisher logo paths from domain filenames.'),
  ('PUBLISHER_LOGO_BASE_EXT', '"webp"'::jsonb, 'string', 'Publisher logo file extension', 'File extension used for publisher logo filenames, such as webp or png.'),
  ('SCRAPE_CONCURRENCY', '3'::jsonb, 'integer', 'Scrape concurrency', 'Number of browser pages loaded at the same time.'),
  ('HTTP_CONCURRENCY', '30'::jsonb, 'integer', 'HTTP validation concurrency', 'Number of URLs validated at the same time before browser scraping.'),
  ('SCRAPE_TIMEOUT_SEC', '15'::jsonb, 'integer', 'Scrape timeout seconds', 'Page navigation timeout.'),
  ('HTTP_TIMEOUT_SEC', '8'::jsonb, 'integer', 'HTTP validation timeout seconds', 'Timeout for fast HTTP redirect/status validation.'),
  ('RENDER_WAIT_MS', '500'::jsonb, 'integer', 'Render wait milliseconds', 'Small capped wait after DOMContentLoaded for JavaScript-rendered pages.'),
  ('BATCH_SIZE', '15'::jsonb, 'integer', 'Batch size', 'Unsummarized article rows processed per run.'),
  ('REQUEST_DELAY_SEC', '15'::jsonb, 'number', 'Request delay seconds', 'Minimum delay between Gemini requests.'),
  ('MAX_AI_RETRIES', '3'::jsonb, 'integer', 'Max AI retries', 'Retry attempts for Gemini calls.'),
  ('RETRY_BACKOFF_SEC', '2'::jsonb, 'number', 'Retry backoff seconds', 'Initial retry backoff after Gemini failures.');

-- ---------------------------------------------------------------------------
-- Publisher/source model: one publisher owns many source links.
-- Example: abs-cbn.com can own /lifestyle, /entertainment, etc.
-- ---------------------------------------------------------------------------
create table public.publishers (
  id bigint generated by default as identity primary key,
  name text not null,
  domain text not null,
  constraint publishers_domain_unique unique (domain),
  constraint publishers_domain_clean check (domain = public.root_domain(domain))
);

create table public.sources (
  id bigint generated by default as identity primary key,
  publisher_id bigint not null references public.publishers(id) on delete cascade,
  url text not null,
  constraint sources_url_unique unique (url)
);

-- ---------------------------------------------------------------------------
-- Articles: optimized typed columns instead of one duplicated JSONB blob.
-- Rows with an empty bullets array are considered pending/unsummarized.
-- ---------------------------------------------------------------------------
create table public.articles (
  url text primary key,
  publisher_id bigint references public.publishers(id) on delete set null,
  title text,
  author text,
  published_at timestamptz,
  image_url text,
  tag text check (
    tag is null or tag in (
      'World', 'National', 'Politics', 'Business', 'Technology', 'Health', 'Sports', 'Entertainment'
    )
  ),
  bullets text[] not null default '{}'
);

create or replace function public.clean_article_author()
returns trigger
language plpgsql
as $$
begin
  if new.author is not null then
    new.author = btrim(new.author);
    if new.author !~ '[A-Za-z]' then
      new.author = null;
    end if;
  end if;

  return new;
end;
$$;

create trigger articles_clean_author_before_write
before insert or update of author on public.articles
for each row execute function public.clean_article_author();

-- ---------------------------------------------------------------------------
-- Indexes for lower API bandwidth and faster filtering/joining.
-- ---------------------------------------------------------------------------
create index articles_published_at_desc_idx on public.articles (published_at desc);
create index articles_tag_published_at_idx on public.articles (tag, published_at desc);
create index articles_publisher_id_idx on public.articles (publisher_id);
create index sources_publisher_id_idx on public.sources (publisher_id);
create index sources_root_domain_idx on public.sources ((public.root_domain(url)));

-- ---------------------------------------------------------------------------
-- Functions used by the local Flask control app and the static public site.
-- ---------------------------------------------------------------------------
create or replace function public.assign_article_publishers()
returns void
language sql
as $$
  with matched as (
    select
      a.url,
      coalesce(
        (
          select s.publisher_id
          from public.sources as s
          where public.root_domain(s.url) = public.root_domain(a.url)
          order by s.id asc
          limit 1
        ),
        (
          select p.id
          from public.publishers as p
          where p.domain = public.root_domain(a.url)
          order by p.id asc
          limit 1
        )
      ) as publisher_id
    from public.articles as a
  )
  update public.articles as a
  set publisher_id = matched.publisher_id
  from matched
  where a.url = matched.url
    and a.publisher_id is distinct from matched.publisher_id;
$$;

create or replace function public.normalize_article_authors()
returns integer
language sql
set search_path = public
as $$
  with updated as (
    update public.articles
    set author = null
    where author is not null
      and btrim(author) !~ '[A-Za-z]'
    returning 1
  )
  select count(*)::integer
  from updated;
$$;

create or replace function public.get_app_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value order by key), '{}'::jsonb)
  from public.variables;
$$;

create or replace function public.set_app_setting(setting_key text, setting_value jsonb)
returns jsonb
language plpgsql
as $$
begin
  if not exists (select 1 from public.variables where key = setting_key) then
    raise exception 'Unknown setting key: %', setting_key;
  end if;

  update public.variables
  set value = setting_value
  where key = setting_key;

  return public.get_app_config();
end;
$$;

-- Returns the same JSON shape expected by the existing static mobile UI.
-- SECURITY DEFINER allows the GitHub static site to call this RPC with only the
-- public Supabase anon key, without exposing direct table reads.
create or replace function public.get_articles_by_tag(tag text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      now() - interval '24 hours' as start_at,
      now() as end_at
  ),
  logo_config as (
    select
      rtrim(btrim(coalesce(
        max(value #>> '{}') filter (where key = 'PUBLISHER_LOGO_BASE_URL'),
        ''
      )), '/') as publisher_logo_base_url,
      coalesce(nullif(regexp_replace(btrim(coalesce(
        max(value #>> '{}') filter (where key = 'PUBLISHER_LOGO_BASE_EXT'),
        'webp'
      )), '^\.+', ''), ''), 'webp') as publisher_logo_base_ext
    from public.variables
    where key in ('PUBLISHER_LOGO_BASE_URL', 'PUBLISHER_LOGO_BASE_EXT')
  )
  select jsonb_build_object(
    'url', a.url,
    'title', a.title,
    'author', coalesce(a.author, ''),
    'date', to_char(a.published_at at time zone 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
    'image', coalesce(a.image_url, ''),
    'tag', coalesce(a.tag, ''),
    'bullets', coalesce(to_jsonb(a.bullets), '[]'::jsonb),
    'publisher', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'domain', p.domain,
      'url', coalesce(first_source.url, ''),
      'logo', case
        when logo_config.publisher_logo_base_url <> '' and public.root_domain(p.domain) <> ''
          then logo_config.publisher_logo_base_url || '/' || public.root_domain(p.domain) || '.' || logo_config.publisher_logo_base_ext
        else ''
      end
    )
  )
  from public.articles as a
  cross join bounds as b
  cross join logo_config
  join public.publishers as p
    on p.id = a.publisher_id
  left join lateral (
    select s.url
    from public.sources as s
    where s.publisher_id = p.id
    order by s.id asc
    limit 1
  ) as first_source on true
  where cardinality(a.bullets) > 0
    and a.published_at is not null
    and a.published_at >= b.start_at
    and a.published_at <= b.end_at
    and coalesce(a.image_url, '') <> ''
    and btrim(coalesce(a.title, '')) <> ''
    and (
      $1 is null
      or btrim($1) = ''
      or lower(btrim($1)) = 'all'
      or a.tag = $1
    )
  order by a.published_at desc;
$$;

-- Optional starter publisher/source example. Edit or delete in the local control app.
-- insert into public.publishers (name, domain) values ('ABS-CBN News', 'abs-cbn.com');
-- insert into public.sources (publisher_id, url)
-- select id, 'https://www.abs-cbn.com/lifestyle' from public.publishers where domain = 'abs-cbn.com';
-- insert into public.sources (publisher_id, url)
-- select id, 'https://www.abs-cbn.com/entertainment' from public.publishers where domain = 'abs-cbn.com';

-- Public static site may execute only the read-only article/config RPCs.
revoke all on table public.articles from anon, authenticated;
revoke all on table public.publishers from anon, authenticated;
revoke all on table public.sources from anon, authenticated;
revoke all on table public.variables from anon, authenticated;

grant execute on function public.get_articles_by_tag(text) to anon, authenticated;
grant execute on function public.get_app_config() to anon, authenticated;

-- These write helpers are intentionally not granted to anon. The local control app uses the
-- Supabase service role key from environment variables.
grant execute on function public.root_domain(text) to authenticated;
grant execute on function public.get_domain_name(text) to authenticated;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;

commit;
