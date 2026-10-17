import type { Env } from "./env";
import type { RuntimeConfig } from "./config";
import type { StorageBundle } from "./storage";

/** Bối cảnh chung cho mọi route đã xác thực. */
export interface Ctx {
  request: Request;
  env: Env;
  config: RuntimeConfig;
  storage: StorageBundle;
  ownerId: string;
  url: URL;
}
