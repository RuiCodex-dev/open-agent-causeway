import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const emptyToUndefined = (v: unknown) =>
  v === "" || v === undefined || v === null ? undefined : v;

const configSchema = z.object({
  MODEL_PROVIDER: z
    .enum(["meterless", "nvidia", "nebius", "offline"])
    .default("meterless"),

  METERLESS_BASE_URL: z.string().default("http://127.0.0.1:8088/v1"),
  METERLESS_RUNTIME_TOKEN: z.string().optional(),
  METERLESS_MODEL: z.string().default("meterless/deep"),
  METERLESS_APP_ID: z.string().default("causeway"),

  MODEL_BASE_URL: z.string().default("https://integrate.api.nvidia.com/v1"),
  MODEL_API_KEY: z.string().optional(),
  MODEL_REASONER: z.string().default("nvidia/nemotron-3-super-120b-a12b"),
  MODEL_FAST: z.string().default("nvidia/nemotron-3.5-lightning-30b-a3b"),
  MODEL_EMBED: z.string().default("nvidia/nemotron-3-embed-1b"),
  MODEL_GUARD: z.string().default("nvidia/nemotron-3.5-content-safety"),
  NVIDIA_RPM_BUDGET: z.coerce.number().int().positive().default(32),

  FALLBACK_BASE_URL: z
    .string()
    .default("https://api.tokenfactory.nebius.com/v1/"),
  FALLBACK_API_KEY: z.string().optional(),

  ZETARIS_REST_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  ZETARIS_ORG_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  ZETARIS_API_KEY: z.string().optional(),
  /** true = snapshot + DuckDB; false = live; undefined = auto */
  SAMPLE_MODE: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PORT: z.coerce.number().int().positive().default(8000),
  UI_PORT: z.coerce.number().int().positive().default(8080),
});

export type Config = z.infer<typeof configSchema>;

/** Mask a secret for logging; never echo real values. */
export function redact(value: string | undefined | null): string {
  return value ? "***" : "";
}

/** Load and validate config from process.env. Does not log values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse({
    MODEL_PROVIDER: env.MODEL_PROVIDER,
    METERLESS_BASE_URL: env.METERLESS_BASE_URL,
    METERLESS_RUNTIME_TOKEN: env.METERLESS_RUNTIME_TOKEN,
    METERLESS_MODEL: env.METERLESS_MODEL,
    METERLESS_APP_ID: env.METERLESS_APP_ID,
    MODEL_BASE_URL: env.MODEL_BASE_URL,
    MODEL_API_KEY: env.MODEL_API_KEY,
    MODEL_REASONER: env.MODEL_REASONER,
    MODEL_FAST: env.MODEL_FAST,
    MODEL_EMBED: env.MODEL_EMBED,
    MODEL_GUARD: env.MODEL_GUARD,
    NVIDIA_RPM_BUDGET: env.NVIDIA_RPM_BUDGET,
    FALLBACK_BASE_URL: env.FALLBACK_BASE_URL,
    FALLBACK_API_KEY: env.FALLBACK_API_KEY,
    ZETARIS_REST_URL: env.ZETARIS_REST_URL,
    ZETARIS_ORG_ID: env.ZETARIS_ORG_ID,
    ZETARIS_API_KEY: env.ZETARIS_API_KEY,
    SAMPLE_MODE: env.SAMPLE_MODE,
    LOG_LEVEL: env.LOG_LEVEL,
    PORT: env.PORT,
    UI_PORT: env.UI_PORT,
  });
}
