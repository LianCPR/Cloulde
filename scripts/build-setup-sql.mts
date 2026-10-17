/**
 * Sinh `supabase/setup.sql` — bản gộp "dán một lần" của toàn bộ migration.
 *
 * Vì sao cần: `supabase db push` là cách chuẩn, nhưng nó đòi cài CLI, đăng nhập
 * và link project. Với người chỉ muốn dựng lược đồ nhanh bằng Dashboard, việc
 * dán 4 tệp migration theo đúng thứ tự rất dễ sai (sai thứ tự → lỗi khoá ngoại).
 * Tệp gộp này giữ nguyên thứ tự và bao trong một transaction all-or-nothing.
 *
 * Quan trọng: đây là tệp SINH RA TỰ ĐỘNG, không sửa tay. Sửa migration rồi chạy
 * lại `npm run supabase:setup-sql`. Chế độ `--check` so nội dung trên đĩa với
 * nội dung sinh lại để phát hiện tệp bị lệch (drift) — dùng trong `npm run verify`.
 *
 * Chạy:
 *   npm run supabase:setup-sql          # sinh lại tệp
 *   npm run supabase:setup-sql -- --check   # chỉ kiểm tra, lệch thì exit 1
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const outputPath = join(root, "supabase", "setup.sql");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const checkOnly = process.argv.includes("--check");

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`✗ Không tìm thấy migration nào trong ${migrationsDir}`);
  process.exit(1);
}

const entries = files.map((name) => {
  const sql = readFileSync(join(migrationsDir, name), "utf8").trimEnd();
  return { name, sql, hash: sha256(sql) };
});

/**
 * Bao trong transaction chỉ an toàn khi không có câu lệnh cấm transaction
 * (CREATE INDEX CONCURRENTLY, VACUUM…) và migration chưa tự quản transaction.
 */
const TRANSACTION_UNSAFE = /\bconcurrently\b|\bvacuum\b/i;
const SELF_MANAGED_TX = /^\s*(begin|commit|rollback)\s*;/im;

const blocked = entries.filter(
  (entry) => TRANSACTION_UNSAFE.test(entry.sql) || SELF_MANAGED_TX.test(entry.sql),
);

if (blocked.length > 0) {
  console.error(
    `✗ Không thể bọc transaction vì các migration sau dùng câu lệnh không tương thích:\n` +
      blocked.map((entry) => `    - ${entry.name}`).join("\n") +
      `\n  Hãy tách chúng ra khỏi phần bọc transaction rồi chạy lại.`,
  );
  process.exit(1);
}

const manifest = entries
  .map((entry) => `--   ${entry.name.padEnd(18)} sha256:${entry.hash}`)
  .join("\n");

const body = entries
  .map(
    (entry) => `-- ═══════════════════════════════════════════════════════════════════════
--  ▶ ${entry.name}
-- ═══════════════════════════════════════════════════════════════════════

${entry.sql}`,
  )
  .join("\n\n");

const output = `-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — TỆP SINH TỰ ĐỘNG, KHÔNG SỬA TAY
--  Bản gộp của toàn bộ migration, dùng để dựng lược đồ chỉ bằng SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════
--
--  Cách dùng (Dashboard, không cần cài CLI):
--    1. Tạo project Supabase mới.
--    2. Mở SQL Editor → New query.
--    3. Dán TOÀN BỘ tệp này rồi bấm Run.
--
--  Cách dùng (CLI, khuyến nghị cho công việc lặp lại):
--    npm run supabase:link -- --project-ref <project-ref>
--    npm run supabase:push
--
--  Đặc điểm:
--    • Bao trong MỘT transaction: sai ở đâu thì huỷ hết, không để lại trạng
--      thái dở dang.
--    • MỌI câu lệnh đều idempotent (if not exists / or replace / drop policy
--      if exists), nên chạy lại nhiều lần vẫn an toàn.
--    • KHÔNG nạp dữ liệu mẫu — supabase/seed.sql là tệp mẫu đã chú thích sẵn,
--      chỉ dành cho môi trường phát triển.
--
--  Sinh lại tệp này:  npm run supabase:setup-sql
--  Kiểm tra lệch:     npm run supabase:setup-sql -- --check
--
--  Nguồn (theo đúng thứ tự đã gộp):
${manifest}
-- ═══════════════════════════════════════════════════════════════════════

begin;

${body}

commit;
`;

const existing = (() => {
  try {
    return readFileSync(outputPath, "utf8");
  } catch {
    return null;
  }
})();

if (checkOnly) {
  if (existing === output) {
    console.log(
      `✓ supabase/setup.sql khớp với ${entries.length} migration (sha256:${sha256(output).slice(0, 12)}…)`,
    );
    process.exit(0);
  }
  console.error(
    "✗ supabase/setup.sql đã LỆCH so với supabase/migrations/.\n" +
      "  Chạy `npm run supabase:setup-sql` để sinh lại rồi kiểm tra diff.",
  );
  process.exit(1);
}

if (existing === output) {
  console.log("✓ supabase/setup.sql đã là bản mới nhất, không cần ghi lại.");
  process.exit(0);
}

writeFileSync(outputPath, output, "utf8");
console.log(
  `✓ Đã ghi supabase/setup.sql từ ${entries.length} migration ` +
    `(${output.split("\n").length - 1} dòng, sha256:${sha256(output).slice(0, 12)}…)`,
);
