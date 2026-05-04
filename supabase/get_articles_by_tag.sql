-- Normalizes a URL/host into the root domain used for joining.
-- Examples:
--   https://www.gmanetwork.com/news/...       -> gmanetwork.com
--   https://data.gmanetwork.com/gno/rss/...   -> gmanetwork.com
--   https://www.example.com.ph/path           -> example.com.ph
create or replace function public.get_domain_name(raw_url text)
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
      split_part(split_part(split_part(value, '/', 1), '?', 1), '#', 1),
      ':\d+$',
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

    -- Common compound public suffixes. PostgreSQL does not include the full
    -- public suffix list, so add more here if your sources need them.
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

-- If tag is omitted, null, empty, or "All", this returns all articles.
create or replace function public.get_articles_by_tag(
  tag text default null,
  p_limit integer default 1000
)
returns setof jsonb
language sql
stable
as $$
  with source_domains as (
    select
      s.id,
      s.name,
      s.url,
      public.get_domain_name(s.url) as domain_name,
      row_number() over (
        partition by public.get_domain_name(s.url)
        order by s.id asc
      ) as source_rank
    from public.sources as s
    where public.get_domain_name(s.url) is not null
  )
  select
    coalesce(a.data, '{}'::jsonb)
    || jsonb_build_object('url', a.url)
    || case
      when s.id is null then '{}'::jsonb
      else jsonb_build_object(
        'publisher',
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'url', s.url
        )
      )
    end
  from public.articles as a
  left join source_domains as s
    on s.domain_name = public.get_domain_name(a.url)
   and s.source_rank = 1
  where
    $1 is null
    or btrim($1) = ''
    or lower($1) = 'all'
    or a.data ->> 'tag' = $1
  order by
    case
      when a.data ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
      then (a.data ->> 'date')::date
      else null
    end desc nulls last,
    a.url asc
  limit least(greatest(coalesce($2, 1000), 0), 1000);
$$;

grant execute on function public.get_domain_name(text)
to anon, authenticated;

grant execute on function public.get_articles_by_tag(text, integer)
to anon, authenticated;

create index if not exists articles_tag_idx
on public.articles ((data ->> 'tag'));

create index if not exists articles_date_idx
on public.articles ((data ->> 'date'));

create index if not exists articles_domain_name_idx
on public.articles (public.get_domain_name(url));

create index if not exists sources_domain_name_idx
on public.sources (public.get_domain_name(url));
