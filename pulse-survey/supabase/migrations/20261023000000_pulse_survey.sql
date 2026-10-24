-- ============================================================================
-- Pulse — Khảo sát ứng dụng sức khỏe
-- Migration: bảng lưu câu trả lời + RLS + bộ đếm giới hạn tần suất.
--
-- Chạy trong Supabase SQL Editor hoặc: supabase db push
-- Không chứa credential. Không đụng tới các bảng khác của project.
-- ============================================================================

-- Câu trả lời của người tham gia. Mỗi lần gửi = một dòng riêng.
create table if not exists public.survey_responses (
  id            uuid primary key default gen_random_uuid(),
  survey        text not null
                  check (survey ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  submitted_at  timestamptz not null,
  received_at   timestamptz not null default now(),
  answers       jsonb not null
                  check (jsonb_typeof(answers) = 'object')
                  check (octet_length(answers::text) <= 65536),
  created_at    timestamptz not null default now()
);

comment on table public.survey_responses is
  'Câu trả lời khảo sát Pulse. Chỉ service_role (Edge Function) được ghi/đọc; anon và authenticated bị chặn hoàn toàn.';
comment on column public.survey_responses.survey is
  'Mã khảo sát, ví dụ pulse-v1.';
comment on column public.survey_responses.submitted_at is
  'Thời điểm trình duyệt gửi (ISO 8601), đã được Edge Function kiểm tra.';
comment on column public.survey_responses.received_at is
  'Thời điểm database nhận bản ghi (đồng hồ máy chủ, không tin trình duyệt).';
comment on column public.survey_responses.answers is
  'Toàn bộ câu trả lời dạng JSONB: {"q1":{"a":[...],"other":"..."}}. Giữ nguyên mảng nhiều lựa chọn và mục Khác.';

-- Truy vấn/xuất dữ liệu theo khảo sát và thời gian.
create index if not exists survey_responses_survey_received_at_idx
  on public.survey_responses (survey, received_at desc);

-- Bật RLS và không tạo policy nào cho anon/authenticated:
-- mọi truy cập qua PostgREST từ trình duyệt đều bị từ chối.
alter table public.survey_responses enable row level security;

revoke all on table public.survey_responses from anon, authenticated;
grant select, insert on table public.survey_responses to service_role;

-- ----------------------------------------------------------------------------
-- Giới hạn tần suất gửi (best-effort, theo IP đã băm).
-- Chỉ lưu hash SHA-256, không lưu IP thô; bản ghi tự hết hiệu lực theo cửa sổ.
-- ----------------------------------------------------------------------------
create table if not exists public.survey_rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

comment on table public.survey_rate_limits is
  'Bộ đếm giới hạn tần suất gửi khảo sát theo hash IP + cửa sổ thời gian. Chỉ Edge Function truy cập.';

create index if not exists survey_rate_limits_window_start_idx
  on public.survey_rate_limits (window_start);

alter table public.survey_rate_limits enable row level security;
revoke all on table public.survey_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.survey_rate_limits to service_role;

-- Trả về true nếu còn trong hạn mức, false nếu vượt.
-- Khoá advisory theo bucket để hai request đồng thời không cùng lọt qua.
create or replace function public.survey_check_rate_limit(
  p_bucket          text,
  p_limit           integer default 8,
  p_window_seconds  integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  if p_bucket is null or length(p_bucket) < 8 then
    return true;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_bucket));

  select request_count, window_start
    into v_count, v_start
    from public.survey_rate_limits
   where bucket = p_bucket
     for update;

  if not found then
    insert into public.survey_rate_limits (bucket, window_start, request_count)
    values (p_bucket, now(), 1);
    return true;
  end if;

  if v_start < now() - make_interval(secs => p_window_seconds) then
    update public.survey_rate_limits
       set window_start = now(), request_count = 1
     where bucket = p_bucket;
    return true;
  end if;

  if v_count >= p_limit then
    return false;
  end if;

  update public.survey_rate_limits
     set request_count = request_count + 1
   where bucket = p_bucket;

  return true;
end;
$$;

revoke all on function public.survey_check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.survey_check_rate_limit(text, integer, integer)
  to service_role;
