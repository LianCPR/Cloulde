-- ============================================================================
-- Pulse — tự động áp dụng thời hạn lưu trữ 6 tháng.
--
-- Tạo job pg_cron chạy mỗi ngày lúc 03:00 UTC, gọi public.survey_purge_expired().
-- Hàm này xoá các bài có received_at cũ hơn 6 tháng và dọn bộ đếm rate limit.
--
-- Nếu project không bật được pg_cron, bỏ qua phần cron và gọi hàm thủ công:
--   select public.survey_purge_expired();
-- ============================================================================

create extension if not exists pg_cron with schema extensions;

-- Chạy lại migration nhiều lần vẫn an toàn: bỏ job cũ trước khi tạo lại.
do $$
begin
  perform cron.unschedule('pulse-survey-purge');
exception
  when others then null; -- job chưa tồn tại
end;
$$;

select cron.schedule(
  'pulse-survey-purge',
  '0 3 * * *',
  $$select public.survey_purge_expired();$$
);

comment on extension pg_cron is
  'Dùng cho job pulse-survey-purge: xoá câu trả lời khảo sát Pulse cũ hơn 6 tháng.';
