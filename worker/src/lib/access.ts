/**
 * Xác thực danh tính do Cloudflare Access cấp.
 *
 * VÌ SAO CÓ TỆP NÀY:
 * Hướng dẫn triển khai khuyến nghị đặt Worker sau Cloudflare Access, khi đó
 * trình duyệt không giữ token nào cả — Access phát cookie/JWT và Worker tin vào
 * danh tính đó. Nhưng "tin" phải có cơ sở: header `Cf-Access-Jwt-Assertion` do
 * client gửi tới KHÔNG tự nó đáng tin (ai cũng đặt được header). Vì vậy ở đây ta
 * XÁC MINH CHỮ KÝ RS256 của JWT bằng khoá công khai lấy từ chính tổ chức Access,
 * rồi mới kiểm tra `aud` (đúng ứng dụng) và `exp` (còn hạn).
 *
 * Nhờ vậy, ngay cả khi Worker bị gọi trực tiếp (bỏ qua Access), một JWT giả mạo
 * vẫn bị từ chối: chữ ký không khớp khoá công khai.
 *
 * Chỉ hoạt động khi đã cấu hình ĐỦ hai biến:
 *   CF_ACCESS_TEAM_DOMAIN   ví dụ: myteam.cloudflareaccess.com
 *   CF_ACCESS_AUD           Application Audience (AUD) Tag của ứng dụng Access
 */

import type { Env } from "../env";

interface AccessConfig {
  teamDomain: string;
  aud: string;
}

/** Chuẩn hoá tên miền tổ chức: bỏ scheme và dấu `/` cuối. */
function normalizeTeamDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function readAccessConfig(env: Env): AccessConfig | null {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? "");
  const aud = (env.CF_ACCESS_AUD ?? "").trim();
  if (!teamDomain || !aud) return null;
  return { teamDomain, aud };
}

/** Đã cấu hình Cloudflare Access chưa (dùng để báo lỗi rõ ràng). */
export function hasAccessConfig(env: Env): boolean {
  return readAccessConfig(env) !== null;
}

interface JsonWebKey {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

interface CertCache {
  keys: JsonWebKey[];
  fetchedAt: number;
}

const CERT_TTL_MS = 60 * 60 * 1000;
let certCache: CertCache | null = null;

async function fetchAccessKeys(teamDomain: string): Promise<JsonWebKey[]> {
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Không lấy được khoá công khai của Access (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as { keys?: JsonWebKey[] };
  return Array.isArray(payload.keys) ? payload.keys : [];
}

/** Khoá công khai, có đệm — tránh gọi mạng ở mỗi request. */
async function accessKeys(teamDomain: string, force = false): Promise<JsonWebKey[]> {
  if (!force && certCache && Date.now() - certCache.fetchedAt < CERT_TTL_MS) {
    return certCache.keys;
  }
  const keys = await fetchAccessKeys(teamDomain);
  certCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

interface AccessClaims {
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iss?: string;
  email?: string;
  sub?: string;
}

async function importRsaKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n as string, e: jwk.e as string, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export interface AccessIdentity {
  /** Giá trị ổn định làm danh tính chủ kho. */
  subject: string;
  email: string | null;
}

/**
 * Trả về danh tính Access nếu request mang JWT hợp lệ; `null` trong mọi trường
 * hợp còn lại (chưa cấu hình, thiếu JWT, chữ ký sai, hết hạn, sai ứng dụng).
 */
export async function verifyAccessRequest(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const config = readAccessConfig(env);
  if (!config) return null;

  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (!jwt) return null;

  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeSegment<{ alg?: string; kid?: string }>(headerSegment);
  const claims = decodeSegment<AccessClaims>(payloadSegment);
  if (!header || !claims) return null;
  // Chỉ nhận RS256 — không nhận "none" hay thuật toán đối xứng.
  if (header.alg !== "RS256") return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) return null;

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(config.aud)) return null;

  if (typeof claims.iss === "string" && claims.iss !== `https://${config.teamDomain}`) return null;

  const pick = (keys: JsonWebKey[]): JsonWebKey | undefined =>
    keys.find((key) => key.kty === "RSA" && (header.kid ? key.kid === header.kid : true));

  // FAIL CLOSED: nếu không lấy/nhập được khoá công khai (mạng lỗi, khoá đổi
  // định dạng), coi như KHÔNG xác thực được — trả null để tầng trên từ chối,
  // chứ không để lỗi mạng biến thành 500 hay thành "cho qua".
  let valid = false;
  try {
    let jwk = pick(await accessKeys(config.teamDomain));
    if (!jwk) {
      // Khoá có thể đã được luân chuyển: làm mới một lần rồi thử lại.
      jwk = pick(await accessKeys(config.teamDomain, true));
    }
    if (!jwk) return null;

    const key = await importRsaKey(jwk);
    const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(signatureSegment),
      signed,
    );
  } catch (error) {
    console.warn("Không xác minh được JWT của Cloudflare Access:", error);
    return null;
  }
  if (!valid) return null;

  const email = typeof claims.email === "string" && claims.email ? claims.email : null;
  const raw = email ?? claims.sub ?? "";
  if (!raw) return null;
  return { subject: `access:${raw}`, email };
}
