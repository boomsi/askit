import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PrimitiveTypeName = 'string' | 'number' | 'boolean' | 'unknown';

// 嵌套 payload：键可带 ? 后缀表示可选，值为字段类型或嵌套对象
interface NestedPayload {
  [key: string]: FieldType;
}

// 字段类型支持：基础类型、可选、nullable、嵌套对象
type FieldType =
  | PrimitiveTypeName
  | `${PrimitiveTypeName}?`
  | `${PrimitiveTypeName} | null`
  | NestedPayload;

type ContractsEventSpec = {
  summary?: string;
  /** 请求-响应配对：声明本请求事件对应的 hostToGuest 响应事件名 */
  response?: string;
  payload?: NestedPayload;
};

type AskContractsSpecV1 = {
  name: string;
  version: number;
  hostToGuest: Record<string, ContractsEventSpec>;
  guestToHost: Record<string, ContractsEventSpec>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const askitRoot = path.resolve(__dirname, '..');

interface ParsedField {
  ts: string;
  optional: boolean;
  isNested: boolean;
  schema?: NestedPayload;
}

/**
 * 解析字段类型。支持:
 * 1. 基础类型: "string", "number", "boolean", "unknown"
 * 2. 可选标记: "string?"
 * 3. Nullable 标记: "string | null"
 * 4. 嵌套对象
 */
function parseFieldType(raw: unknown): ParsedField {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return { ts: 'object', optional: false, isNested: true, schema: raw as NestedPayload };
  }

  if (typeof raw !== 'string') return { ts: 'unknown', optional: false, isNested: false };

  const optional = raw.endsWith('?');
  let base = (optional ? raw.slice(0, -1) : raw).trim();

  const nullable = base.endsWith('| null');
  if (nullable) {
    base = base.replace('| null', '').trim();
  }

  const ts: PrimitiveTypeName =
    base === 'string' || base === 'number' || base === 'boolean' || base === 'unknown'
      ? (base as PrimitiveTypeName)
      : 'unknown';

  return {
    ts: nullable ? `${ts} | null` : ts,
    optional,
    isNested: false,
  };
}

/** 规范化字段名（去掉 key 上的 ? 后缀）并返回是否可选 */
function normalizeKey(key: string): { name: string; optional: boolean } {
  if (key.endsWith('?')) {
    return { name: key.slice(0, -1), optional: true };
  }
  return { name: key, optional: false };
}

/**
 * 渲染 TypeScript 类型
 */
function renderPayloadType(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'unknown';
  const keys = Object.keys(payload).sort();
  const fields = keys.map((k) => {
    const { name, optional: optionalKey } = normalizeKey(k);
    const raw = (payload as Record<string, unknown>)[k];
    const { ts, optional, isNested, schema } = parseFieldType(raw);
    const typeStr = isNested ? renderPayloadType(schema) : ts;
    return `${JSON.stringify(name)}${optionalKey || optional ? '?:' : ':'} ${typeStr};`;
  });
  return `{ ${fields.join(' ')} }`;
}

/**
 * 渲染运行时 Schema
 */
function renderPayloadSchema(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '{}';
  const keys = Object.keys(payload).sort();
  const fields = keys.map((k) => {
    const { name, optional: optionalKey } = normalizeKey(k);
    const raw = (payload as Record<string, unknown>)[k];
    const { ts, optional, isNested, schema } = parseFieldType(raw);
    const value = isNested ? renderPayloadSchema(schema) : JSON.stringify(ts);
    return `${JSON.stringify(name)}: [${value}, ${optionalKey || optional}] as const`;
  });
  return `{ ${fields.join(', ')} }`;
}

function renderPayloadMap(
  events: Record<string, ContractsEventSpec>,
  render: (payload: unknown) => string
): string {
  const names = Object.keys(events).sort();
  const lines = names.map((name) => `  ${JSON.stringify(name)}: ${render(events[name]?.payload)};`);
  return `{\n${lines.join('\n')}\n}`;
}

function renderPayloadSchemaMap(events: Record<string, ContractsEventSpec>): string {
  const names = Object.keys(events).sort();
  const lines = names.map(
    (name) => `  ${JSON.stringify(name)}: ${renderPayloadSchema(events[name]?.payload)},`
  );
  return `{\n${lines.join('\n')}\n} as const`;
}

/**
 * 过滤分组注释 key（"// --- xxx ---"）：分组信息只服务于 JSON 阅读，
 * 不应进入生成的事件名类型与运行时校验列表。
 */
function filterCommentEntries(
  events: Record<string, ContractsEventSpec>
): Record<string, ContractsEventSpec> {
  return Object.fromEntries(Object.entries(events).filter(([key]) => !key.startsWith('//')));
}

/**
 * 提取请求-响应配对表，并校验 response 指向的事件确实存在于 hostToGuest。
 * 配对错误在生成期直接失败，而不是留到运行时。
 */
function extractEventPairs(
  guestToHost: Record<string, ContractsEventSpec>,
  hostToGuest: Record<string, ContractsEventSpec>
): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const [name, spec] of Object.entries(guestToHost)) {
    if (!spec?.response) continue;
    if (!(spec.response in hostToGuest)) {
      throw new Error(
        `[generate-contracts] 事件 ${name} 声明的 response "${spec.response}" 不存在于 hostToGuest`
      );
    }
    pairs[name] = spec.response;
  }
  return pairs;
}

function renderEventPairs(pairs: Record<string, string>): string {
  const names = Object.keys(pairs).sort();
  const lines = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(pairs[name])},`);
  return `{\n${lines.join('\n')}\n} as const`;
}

function renderConstNames(names: string[], constName: string): string {
  const items = names.map((n) => JSON.stringify(n)).join(', ');
  return `export const ${constName} = [${items}] as const;`;
}

function renderTypeGuard(constName: string, typeName: string, fnName: string): string {
  return `export function ${fnName}(name: string): name is ${typeName} {\n  return ((${constName} as readonly string[]).includes(name));\n}`;
}

async function main(): Promise<void> {
  const defaultSpecPath = path.resolve(askitRoot, 'specs', 'contracts', 'ask.contracts.v1.json');
  const defaultOutPath = path.resolve(askitRoot, 'src', 'contracts', 'generated.ts');

  const specPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSpecPath;
  const outPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutPath;

  const raw = await readFile(specPath, 'utf8');
  const spec = JSON.parse(raw) as AskContractsSpecV1;

  // 注释 key（分组标题）在源头过滤，全程使用净化后的事件表
  const hostToGuest = filterCommentEntries(spec.hostToGuest ?? {});
  const guestToHost = filterCommentEntries(spec.guestToHost ?? {});

  const hostToGuestNames = Object.keys(hostToGuest).sort();
  const guestToHostNames = Object.keys(guestToHost).sort();

  const eventPairs = extractEventPairs(guestToHost, hostToGuest);

  const hostToGuestPayloads = renderPayloadMap(hostToGuest, renderPayloadType);
  const guestToHostPayloads = renderPayloadMap(guestToHost, renderPayloadType);

  const content = `/**
 * 由脚本自动生成，请勿手改。
 *
 * 来源：${path.relative(askitRoot, specPath)}
 * 生成：bun run scripts/generate-contracts.ts
 */

export const ASK_CONTRACT_NAME = ${JSON.stringify(spec.name)} as const;
export const ASK_CONTRACT_VERSION = ${JSON.stringify(spec.version)} as const;

export type AskContractName = typeof ASK_CONTRACT_NAME;
export type AskContractVersion = typeof ASK_CONTRACT_VERSION;

export type HostToGuestEventPayloads = ${hostToGuestPayloads};
export type HostToGuestEventName = keyof HostToGuestEventPayloads;
${renderConstNames(hostToGuestNames, 'HOST_TO_GUEST_EVENT_NAMES')}
${renderTypeGuard('HOST_TO_GUEST_EVENT_NAMES', 'HostToGuestEventName', 'isHostToGuestEventName')}

export type GuestToHostEventPayloads = ${guestToHostPayloads};
export type GuestToHostEventName = keyof GuestToHostEventPayloads;
${renderConstNames(guestToHostNames, 'GUEST_TO_HOST_EVENT_NAMES')}
${renderTypeGuard('GUEST_TO_HOST_EVENT_NAMES', 'GuestToHostEventName', 'isGuestToHostEventName')}

/**
 * 请求-响应配对表：guestToHost 事件上声明了 "response" 的子集。
 * ask.call 据此查表响应事件，EventHandler/HandlerRegistry 据此推导 handler 类型，
 * 配对只存在于契约一处，两端零重复声明。
 */
export const EVENT_PAIRS = ${renderEventPairs(eventPairs)};
export type EventPairs = typeof EVENT_PAIRS;
export type RequestEventName = keyof EventPairs;

export type HostToGuestEvent<E extends HostToGuestEventName = HostToGuestEventName> = {
  name: E;
  payload: HostToGuestEventPayloads[E];
};

export type GuestToHostEvent<E extends GuestToHostEventName = GuestToHostEventName> = {
  name: E;
  payload: GuestToHostEventPayloads[E];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface PayloadSchema {
  [key: string]: readonly [type: string | PayloadSchema, optional: boolean];
}

function validatePayloadAgainstSchema(payload: unknown, schema: PayloadSchema): boolean {
  if (!isPlainObject(payload)) return false;
  const obj = payload as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    const field = schema[key];
    if (!field) continue;

    const [typeOrSchema, optional] = field;

    if (!(key in obj)) {
      if (!optional) return false;
      continue;
    }

    const value = obj[key];
    if (value === undefined) {
      if (!optional) return false;
      continue;
    }

    // 递归处理嵌套对象
    if (typeof typeOrSchema === 'object' && typeOrSchema !== null) {
      if (!validatePayloadAgainstSchema(value, typeOrSchema)) return false;
      continue;
    }

    const isNullable = typeOrSchema.includes('| null');
    const baseType = typeOrSchema.replace('| null', '').trim();

    if (value === null) {
      if (!isNullable) return false;
      continue;
    }

    if (baseType === 'unknown') continue;
    if (typeof value !== baseType) return false;
  }
  return true;
}

export const HOST_TO_GUEST_PAYLOAD_SCHEMA = ${renderPayloadSchemaMap(hostToGuest)};
export function validateHostToGuestPayload<E extends HostToGuestEventName>(
  name: E,
  payload: unknown
): payload is HostToGuestEventPayloads[E] {
  const schema = (HOST_TO_GUEST_PAYLOAD_SCHEMA as Record<string, PayloadSchema>)[name];
  if (!schema) return false;
  return validatePayloadAgainstSchema(payload, schema);
}

export const GUEST_TO_HOST_PAYLOAD_SCHEMA = ${renderPayloadSchemaMap(guestToHost)};
export function validateGuestToHostPayload<E extends GuestToHostEventName>(
  name: E,
  payload: unknown
): payload is GuestToHostEventPayloads[E] {
  const schema = (GUEST_TO_HOST_PAYLOAD_SCHEMA as Record<string, PayloadSchema>)[name];
  if (!schema) return false;
  return validatePayloadAgainstSchema(payload, schema);
}
`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, 'utf8');
  console.log(`[askit] contracts generated: ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
