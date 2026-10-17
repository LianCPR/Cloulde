/**
 * Khai báo tối thiểu cho `node:crypto` khi bật `nodejs_compat`.
 *
 * Chỉ khai báo đúng phần được dùng — băm theo luồng. Không kéo `@types/node`
 * vào vì nó xung đột với các kiểu toàn cục của Cloudflare Workers
 * (`Request`, `Response`, `crypto`…).
 */
declare module "node:crypto" {
  export interface Hash {
    update(data: Uint8Array): void;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
}
