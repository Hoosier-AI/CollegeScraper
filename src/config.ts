import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  COLLEGE_TRIGGER_SECRET: z.string().min(1).optional(),
  CONTACT_EMAIL: z.string().default('hoosieraisolutions@gmail.com'),
  NCAA_API_BASE: z.string().url().optional(),
  COLLEGE_ALLOW_PROD: z.string().default('0'),
  CRAWL_PER_HOST_RPS: z.coerce.number().positive().default(1),
  CRAWL_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(8),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().default(8080),
  SCHEDULER_ENABLED: z.string().default('0'),
});

export type Config = z.infer<typeof schema> & { userAgent: string; contactEmail: string };

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached && env === process.env) return cached;
  const parsed = schema.parse({
    SUPABASE_URL: env.SUPABASE_URL || undefined,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || undefined,
    COLLEGE_TRIGGER_SECRET: env.COLLEGE_TRIGGER_SECRET || undefined,
    CONTACT_EMAIL: env.CONTACT_EMAIL,
    NCAA_API_BASE: env.NCAA_API_BASE || undefined,
    COLLEGE_ALLOW_PROD: env.COLLEGE_ALLOW_PROD,
    CRAWL_PER_HOST_RPS: env.CRAWL_PER_HOST_RPS,
    CRAWL_GLOBAL_CONCURRENCY: env.CRAWL_GLOBAL_CONCURRENCY,
    LOG_LEVEL: env.LOG_LEVEL,
    PORT: env.PORT,
    SCHEDULER_ENABLED: env.SCHEDULER_ENABLED,
  });
  const cfg: Config = {
    ...parsed,
    // Browser-compatible prefix + our identifier. PrestoSports hosts return 403 to any UA containing "bot";
    // the contact email is still sent on every request in the From: header (see http/client.ts).
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 PlaibookCollege/1.0 (+https://plaibook.soccer)`,
    contactEmail: parsed.CONTACT_EMAIL,
  };
  if (env === process.env) cached = cfg;
  return cfg;
}

/** Local Supabase (supabase start) is always writable; anything else needs COLLEGE_ALLOW_PROD=1. */
export function assertWritable(cfg: Config): void {
  if (!cfg.SUPABASE_URL) throw new Error('SUPABASE_URL is not set');
  const local = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/.test(cfg.SUPABASE_URL);
  if (!local && cfg.COLLEGE_ALLOW_PROD !== '1') {
    throw new Error(`Refusing to write to ${cfg.SUPABASE_URL}: set COLLEGE_ALLOW_PROD=1 to allow non-local writes.`);
  }
}
