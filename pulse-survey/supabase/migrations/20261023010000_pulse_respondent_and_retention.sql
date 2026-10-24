-- ============================================================================
-- Pulse — bổ sung thông tin người tham gia + chính sách lưu trữ 6 tháng.
--
-- Bảng survey_responses đã tồn tại từ migration trước. File này chỉ thêm cột,
-- ràng buộc và hàm dọn dữ liệu; không xoá bảng hay dữ liệu đang có.
-- ============================================================================

alter table public.survey_responses
  add column if not exists respondent_name text;
alter table public.survey_responses
  add column if not exists social_link text;

-- Bản ghi cũ (nếu có) không thể thiếu tên; đánh dấu rõ thay vì để null.
update public.survey_responses
   set respondent_name = 'Không rõ'
 where respondent_name is null;

alter table public.survey_responses
  alter column respondent_name set not null;

alter table public.survey_responses
  drop constraint if exists survey_responses_respondent_name_check;
alter table public.survey_responses
  add constraint survey_responses_respondent_name_check
  check (char_length(btrim(respondent_name)) between 1 and 100);

alter table public.survey_responses
  drop constraint if exists survey_responses_social_link_check;
alter table public.survey_responses
  add constraint survey_responses_social_link_check
  check (
    social_link is null
    or (
      char_length(social_link) between 1 and 300
      and social_link ~ '^https?://'
    )
  );

comment on column public.survey_responses.respondent_name is
  'Tên người tham gia, bắt buộc. Edge Function chuẩn hoá khoảng trắng và giới hạn 100 ký tự.';
comment on column public.survey_responses.social_link is
  'Liên kết mạng xã hội tuỳ chọn (http/https), tối đa 300 ký tự. Không hiển thị công khai.';

-- Danh sách bài làm và hàm dọn dữ liệu lọc theo received_at.
create index if not exists survey_responses_received_at_idx
  on public.survey_responses (received_at desc);

-- Hàm dọn dữ liệu quá hạn. Không tự chạy theo lịch: gọi thủ công hoặc gắn
-- pg_cron nếu project có extension này. Chỉ service_role được gọi.
create or replace function public.survey_purge_expired(
  p_retention interval default interval '6 months'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_retention is null or p_retention < interval '1 day' then
    raise exception 'retention must be at least 1 day';
  end if;

  delete from public.survey_responses
   where received_at < now() - p_retention;
  get diagnostics v_deleted = row_count;

  -- Dọn luôn bộ đếm rate limit cũ để bảng không phình ra.
  delete from public.survey_rate_limits
   where window_start < now() - interval '2 days';

  return v_deleted;
end;
$$;

revoke all on function public.survey_purge_expired(interval)
  from public, anon, authenticated;
grant execute on function public.survey_purge_expired(interval)
  to service_role;
