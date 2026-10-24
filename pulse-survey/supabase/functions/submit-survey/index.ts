/**
 * Pulse — Edge Function `submit-survey`
 * ============================================================================
 * API công khai nhận câu trả lời khảo sát Pulse và ghi vào bảng
 * public.survey_responses bằng service role key (chỉ tồn tại ở máy chủ).
 *
 * - Không yêu cầu đăng nhập.
 * - Bắt buộc tên người tham gia; liên kết MXH tuỳ chọn (đã chuẩn hoá).
 * - Kiểm tra hình dạng payload, kích thước và thời gian gửi.
 * - Giới hạn tần suất theo hash IP (best-effort, không phải chống spam tuyệt đối).
 * - Chỉ trả 201 khi INSERT thực sự thành công.
 * - Không log nội dung câu trả lời.
 *
 * Biến môi trường:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (Supabase tự inject khi deploy)
 *   SURVEY_ID           mặc định "pulse-v1"
 *   ALLOWED_ORIGINS     danh sách origin cách nhau bởi dấu phẩy; bỏ trống = "*"
 *   RATE_LIMIT_PEPPER   chuỗi bí mật tuỳ chọn để băm IP
 * ============================================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const SURVEY_ID = Deno.env.get("SURVEY_ID") ?? "pulse-v1";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_ANSWERS_BYTES = 24 * 1024;
const MAX_ANSWER_KEYS = 60;
const MAX_ANSWER_TEXT = 1000;
const MAX_OTHER_TEXT = 200;
const MAX_NAME = 100;
const MAX_SOCIAL = 300;
const MAX_MULTI_CHOICES = 20;
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

type NormalizedAnswer = { a: string | string[]; other?: string };
type ValidPayload = {
  survey: string;
  submittedAt: string;
  respondent: { name: string; social: string | null };
  answers: Record<string, NormalizedAnswer>;
};
type ValidationFailure = { ok: false; code: string; message: string };
type ValidationResult = { ok: true; value: ValidPayload } | ValidationFailure;
type TextResult = { ok: true; value: string } | ValidationFailure;
type SocialResult = { ok: true; value: string | null } | ValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(input: unknown): TextResult {
  if (typeof input !== "string") {
    return { ok: false, code: "invalid_name", message: "Thiếu tên người tham gia." };
  }
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length < 1 || value.length > MAX_NAME) {
    return { ok: false, code: "invalid_name", message: "Tên phải có từ 1 đến 100 ký tự." };
  }
  return { ok: true, value };
}

function normalizeSocial(input: unknown): SocialResult {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") {
    return { ok: false, code: "invalid_social", message: "Liên kết MXH không hợp lệ." };
  }

  let value = input.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > MAX_SOCIAL) {
    return { ok: false, code: "invalid_social", message: "Liên kết MXH quá dài." };
  }

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      !url.hostname.includes(".") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return { ok: false, code: "invalid_social", message: "Liên kết MXH không hợp lệ." };
    }
    if (url.href.length > MAX_SOCIAL) {
      return { ok: false, code: "invalid_social", message: "Liên kết MXH quá dài." };
    }
    return { ok: true, value: url.href };
  } catch {
    return { ok: false, code: "invalid_social", message: "Liên kết MXH không hợp lệ." };
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  let allowOrigin = "*";

  if (ALLOWED_ORIGINS.length > 0) {
    allowOrigin = origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0];
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function invalid(
  req: Request,
  code: string,
  message: string,
  status = 400,
): Response {
  return json(req, { ok: false, error: { code, message } }, status);
}

function validatePayload(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, code: "invalid_payload", message: "Dữ liệu gửi lên không phải JSON object." };
  }

  // Honeypot: trình duyệt thật không bao giờ gửi trường này.
  if (typeof input.hp === "string" && input.hp.trim() !== "") {
    return { ok: false, code: "invalid_payload", message: "Yêu cầu không hợp lệ." };
  }

  if (typeof input.survey !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.survey)) {
    return { ok: false, code: "invalid_survey", message: "Mã khảo sát không hợp lệ." };
  }
  if (input.survey !== SURVEY_ID) {
    return { ok: false, code: "unknown_survey", message: "Khảo sát này không được nhận." };
  }

  if (typeof input.submittedAt !== "string") {
    return { ok: false, code: "invalid_submitted_at", message: "Thiếu thời gian gửi." };
  }
  const submittedMs = Date.parse(input.submittedAt);
  if (!Number.isFinite(submittedMs)) {
    return { ok: false, code: "invalid_submitted_at", message: "Thời gian gửi không hợp lệ." };
  }
  if (Math.abs(Date.now() - submittedMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, code: "invalid_submitted_at", message: "Thời gian gửi lệch quá nhiều so với máy chủ." };
  }

  if (!isRecord(input.respondent)) {
    return { ok: false, code: "invalid_respondent", message: "Thiếu thông tin người tham gia." };
  }
  const nameResult = normalizeName(input.respondent.name);
  if (!nameResult.ok) return nameResult;
  const socialResult = normalizeSocial(input.respondent.social);
  if (!socialResult.ok) return socialResult;

  if (!isRecord(input.answers)) {
    return { ok: false, code: "invalid_answers", message: "Thiếu object câu trả lời." };
  }

  const entries = Object.entries(input.answers);
  if (entries.length > MAX_ANSWER_KEYS) {
    return { ok: false, code: "too_many_answers", message: "Quá nhiều câu trả lời." };
  }

  const answers: Record<string, NormalizedAnswer> = {};

  for (const [key, raw] of entries) {
    if (!/^q(?:[1-9]|[1-9][0-9])$/.test(key)) {
      return { ok: false, code: "invalid_question_key", message: `Mã câu hỏi không hợp lệ: ${key}.` };
    }
    if (!isRecord(raw)) {
      return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} không hợp lệ.` };
    }

    const value = raw.a;
    let normalized: NormalizedAnswer;

    if (typeof value === "string") {
      const text = value.trim();
      if (text.length === 0 || text.length > MAX_ANSWER_TEXT) {
        return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} rỗng hoặc quá dài.` };
      }
      normalized = { a: text };
    } else if (Array.isArray(value)) {
      if (value.length === 0 || value.length > MAX_MULTI_CHOICES) {
        return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} có số lựa chọn không hợp lệ.` };
      }
      const choices: string[] = [];
      for (const choice of value) {
        if (typeof choice !== "string") {
          return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} chứa lựa chọn không phải chuỗi.` };
        }
        const text = choice.trim();
        if (text.length === 0 || text.length > MAX_ANSWER_TEXT) {
          return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} có lựa chọn rỗng hoặc quá dài.` };
        }
        choices.push(text);
      }
      normalized = { a: choices };
    } else {
      return { ok: false, code: "invalid_answer", message: `Câu trả lời ${key} phải là chuỗi hoặc mảng.` };
    }

    if (raw.other !== undefined && raw.other !== null) {
      if (typeof raw.other !== "string") {
        return { ok: false, code: "invalid_other", message: `Nội dung "Khác" của ${key} không hợp lệ.` };
      }
      const other = raw.other.trim();
      if (other.length > MAX_OTHER_TEXT) {
        return { ok: false, code: "invalid_other", message: `Nội dung "Khác" của ${key} quá dài.` };
      }
      if (other.length > 0) normalized.other = other;
    }

    answers[key] = normalized;
  }

  const answersBytes = new TextEncoder().encode(JSON.stringify(answers)).byteLength;
  if (answersBytes > MAX_ANSWERS_BYTES) {
    return { ok: false, code: "payload_too_large", message: "Câu trả lời vượt quá giới hạn kích thước." };
  }

  return {
    ok: true,
    value: {
      survey: input.survey,
      submittedAt: new Date(submittedMs).toISOString(),
      respondent: { name: nameResult.value, social: socialResult.value },
      answers,
    },
  };
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

async function hashClient(ip: string): Promise<string> {
  const pepper = Deno.env.get("RATE_LIMIT_PEPPER") ?? "pulse-survey-public-endpoint";
  const data = new TextEncoder().encode(`${pepper}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isRateLimited(req: Request): Promise<boolean | null> {
  if (!supabase) return null;
  const ip = clientIp(req);
  if (!ip) return false;

  const clientHash = await hashClient(ip);
  const buckets = [
    { bucket: `${clientHash}:10m`, limit: 8, windowSeconds: 600 },
    { bucket: `${clientHash}:1d`, limit: 40, windowSeconds: 86400 },
  ];

  for (const item of buckets) {
    const { data, error } = await supabase.rpc("survey_check_rate_limit", {
      p_bucket: item.bucket,
      p_limit: item.limit,
      p_window_seconds: item.windowSeconds,
    });

    if (error) {
      console.error("[submit-survey] rate_limit_check_failed", error.code);
      return null;
    }
    if (data !== true) return true;
  }

  return false;
}

async function handleSubmit(req: Request): Promise<Response> {
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return invalid(req, "origin_not_allowed", "Nguồn gửi không được phép.", 403);
    }
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return invalid(req, "payload_too_large", "Dữ liệu gửi lên quá lớn.", 413);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return invalid(req, "unreadable_body", "Không đọc được dữ liệu gửi lên.");
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return invalid(req, "payload_too_large", "Dữ liệu gửi lên quá lớn.", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid(req, "invalid_json", "Dữ liệu gửi lên không phải JSON hợp lệ.");
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return json(
      req,
      { ok: false, error: { code: validation.code, message: validation.message } },
      400,
    );
  }

  if (!supabase) {
    console.error("[submit-survey] missing_server_configuration");
    return invalid(req, "server_misconfigured", "Máy chủ chưa được cấu hình.", 500);
  }

  const limited = await isRateLimited(req);
  if (limited === null) {
    return invalid(req, "temporarily_unavailable", "Máy chủ tạm thời không nhận dữ liệu. Vui lòng thử lại.", 503);
  }
  if (limited) {
    return json(
      req,
      {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau ít phút.",
        },
      },
      429,
      { "Retry-After": "600" },
    );
  }

  const { data, error } = await supabase
    .from("survey_responses")
    .insert({
      survey: validation.value.survey,
      submitted_at: validation.value.submittedAt,
      respondent_name: validation.value.respondent.name,
      social_link: validation.value.respondent.social,
      answers: validation.value.answers,
    })
    .select("id, received_at")
    .single();

  if (error || !data) {
    console.error("[submit-survey] insert_failed", error?.code ?? "no_data");
    return invalid(req, "storage_failed", "Chưa lưu được câu trả lời. Vui lòng thử lại.", 500);
  }

  return json(
    req,
    { ok: true, id: data.id, receivedAt: data.received_at },
    201,
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method === "GET") {
    return json(req, { ok: true, service: "pulse-survey", survey: SURVEY_ID });
  }

  if (req.method !== "POST") {
    return json(
      req,
      { ok: false, error: { code: "method_not_allowed", message: "Chỉ hỗ trợ POST." } },
      405,
      { Allow: "GET, POST, OPTIONS" },
    );
  }

  try {
    return await handleSubmit(req);
  } catch (error) {
    console.error(
      "[submit-survey] unhandled_error",
      error instanceof Error ? error.name : "unknown",
    );
    return invalid(req, "server_error", "Máy chủ gặp lỗi. Vui lòng thử lại.", 500);
  }
});
