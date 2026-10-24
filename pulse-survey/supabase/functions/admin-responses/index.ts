/**
 * Pulse — Edge Function `admin-responses`
 * ============================================================================
 * API riêng cho trang quản trị. Không dùng Supabase Auth để tránh phụ thuộc
 * email/SMTP; thay vào đó dùng mật khẩu dài lưu trong secret ADMIN_PASSWORD.
 *
 * - Bắt buộc header `x-admin-key` khớp ADMIN_PASSWORD (so sánh constant-time).
 * - Sai mật khẩu bị giới hạn 10 lần / 15 phút theo hash IP.
 * - Chỉ trả về dữ liệu qua service role; RLS của bảng vẫn đóng với client.
 * - Không log tên, liên kết MXH hay nội dung câu trả lời.
 *
 * Biến môi trường:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (Supabase tự inject)
 *   ADMIN_PASSWORD        bắt buộc, đặt trong Edge Functions → Secrets
 *   ADMIN_ALLOWED_ORIGINS tuỳ chọn, cách nhau dấu phẩy; bỏ trống = "*"
 *   RATE_LIMIT_PEPPER     tuỳ chọn, dùng để băm IP
 * ============================================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_BODY_BYTES = 8 * 1024;
const PAGE_MAX = 200;
const OFFSET_MAX = 100_000;
const QUERY_MAX = 100;

const ALLOWED_ORIGINS = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-key",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
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
      ...extraHeaders,
    },
  });
}

function fail(
  req: Request,
  code: string,
  message: string,
  status = 400,
): Response {
  return json(req, { ok: false, error: { code, message } }, status);
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

// So sánh sau khi băm để độ dài hai chuỗi không lộ qua thời gian.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

async function hashClient(ip: string): Promise<string> {
  const pepper = Deno.env.get("RATE_LIMIT_PEPPER") ?? "pulse-survey-admin-endpoint";
  const digest = await sha256(`${pepper}:admin:${ip}`);
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function consumeFailedAttempt(req: Request): Promise<boolean | null> {
  if (!supabase) return null;
  const ip = clientIp(req);
  if (!ip) return false;

  const clientHash = await hashClient(ip);
  const { data, error } = await supabase.rpc("survey_check_rate_limit", {
    p_bucket: `${clientHash}:admin15m`,
    p_limit: 10,
    p_window_seconds: 900,
  });

  if (error) {
    console.error("[admin-responses] rate_limit_check_failed", error.code);
    return null;
  }
  return data !== true;
}

async function authorize(req: Request): Promise<Response | null> {
  if (!ADMIN_PASSWORD) {
    console.error("[admin-responses] missing_admin_password");
    return fail(
      req,
      "admin_not_configured",
      "Chưa cấu hình mật khẩu quản trị trên máy chủ.",
      503,
    );
  }

  const provided = req.headers.get("x-admin-key") ?? "";
  if (await safeEqual(provided, ADMIN_PASSWORD)) return null;

  const limited = await consumeFailedAttempt(req);
  if (limited === null) {
    return fail(
      req,
      "temporarily_unavailable",
      "Máy chủ tạm thời không kiểm tra được đăng nhập. Vui lòng thử lại.",
      503,
    );
  }
  if (limited) {
    return json(
      req,
      {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        },
      },
      429,
      { "Retry-After": "900" },
    );
  }

  return fail(req, "unauthorized", "Mật khẩu quản trị không đúng.", 401);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseDate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

async function handleList(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!supabase) {
    console.error("[admin-responses] missing_server_configuration");
    return fail(
      req,
      "server_misconfigured",
      "Máy chủ chưa được cấu hình.",
      500,
    );
  }

  const rawLimit = Number(body.limit);
  const rawOffset = Number(body.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_MAX, Math.max(1, Math.floor(rawLimit)))
    : 50;
  const offset = Number.isFinite(rawOffset)
    ? Math.min(OFFSET_MAX, Math.max(0, Math.floor(rawOffset)))
    : 0;

  let q = "";
  if (body.q !== undefined && body.q !== null) {
    if (typeof body.q !== "string") {
      return fail(req, "invalid_query", "Từ khoá tìm kiếm không hợp lệ.");
    }
    q = body.q.trim();
    if (q.length > QUERY_MAX) {
      return fail(req, "invalid_query", "Từ khoá tìm kiếm quá dài.");
    }
  }

  const from = parseDate(body.from);
  if (!from.ok) return fail(req, "invalid_date", "Ngày bắt đầu không hợp lệ.");
  const to = parseDate(body.to);
  if (!to.ok) return fail(req, "invalid_date", "Ngày kết thúc không hợp lệ.");
  if (from.value && to.value && from.value > to.value) {
    return fail(req, "invalid_range", "Khoảng ngày không hợp lệ.");
  }

  let query = supabase
    .from("survey_responses")
    .select(
      "id,survey,respondent_name,social_link,submitted_at,received_at,answers",
      { count: "exact" },
    );

  if (q) query = query.ilike("respondent_name", `%${escapeLike(q)}%`);
  if (from.value) query = query.gte("received_at", from.value);
  if (to.value) query = query.lte("received_at", to.value);

  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[admin-responses] list_failed", error.code);
    return fail(req, "storage_failed", "Chưa đọc được dữ liệu.", 500);
  }

  return json(req, {
    ok: true,
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method === "GET") {
    return json(req, { ok: true, service: "pulse-admin" });
  }

  if (req.method !== "POST") {
    return json(
      req,
      { ok: false, error: { code: "method_not_allowed", message: "Chỉ hỗ trợ POST." } },
      405,
      { Allow: "GET, POST, OPTIONS" },
    );
  }

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return fail(req, "origin_not_allowed", "Nguồn gửi không được phép.", 403);
    }
  }

  const authFailure = await authorize(req);
  if (authFailure) return authFailure;

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(req, "payload_too_large", "Yêu cầu quá lớn.", 413);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return fail(req, "unreadable_body", "Không đọc được yêu cầu.");
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail(req, "payload_too_large", "Yêu cầu quá lớn.", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return fail(req, "invalid_json", "Yêu cầu không phải JSON hợp lệ.");
  }
  if (!isRecord(parsed)) {
    return fail(req, "invalid_payload", "Yêu cầu không phải JSON object.");
  }

  try {
    if (parsed.action === "list") return await handleList(req, parsed);
    return fail(req, "unknown_action", "Hành động không được hỗ trợ.");
  } catch (error) {
    console.error(
      "[admin-responses] unhandled_error",
      error instanceof Error ? error.name : "unknown",
    );
    return fail(req, "server_error", "Máy chủ gặp lỗi.", 500);
  }
});
