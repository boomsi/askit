/**
 * 由脚本自动生成，请勿手改。
 *
 * 来源：specs/contracts/ask.contracts.v1.json
 * 生成：bun run scripts/generate-contracts.ts
 */

export const ASK_CONTRACT_NAME = "ask" as const;
export const ASK_CONTRACT_VERSION = 1 as const;

export type AskContractName = typeof ASK_CONTRACT_NAME;
export type AskContractVersion = typeof ASK_CONTRACT_VERSION;

export type HostToGuestEventPayloads = {
  "// --- 标准原生能力 ---": unknown;
  "// --- 系统内置 ---": unknown;
  "CLEAR_CHAT_HISTORY_RESULT": { "error"?: unknown; "requestId": string; "success": boolean; };
  "CLOSE_EXTENSION_RESULT": { "error"?: unknown; "requestId": string; "success": boolean; };
  "HOST_VISIBILITY": { "tabId"?: string; "visible": boolean; };
  "HTTP_RESPONSE": { "data": unknown; "requestId": string; "status": number; "success": boolean; };
  "LANGUAGE_LIST": { "current": string; "languages": unknown; "requestId": string; };
  "RECEIVER_BACKPRESSURE": { "applied": number; "batchId"?: number; "skipped": number; "total": number; };
  "SEND_APP_INFO": { "appName": string; "author": string; "favoriteCount": number; "languageContents": unknown; "logo": string; "requestId": string; "usedCount": number; };
  "SEND_EMAIL_RESULT": { "error"?: unknown; "requestId": string; "success": boolean; };
  "SET_APP_LANGUAGE_RESULT": { "error"?: unknown; "requestId": string; "success": boolean; };
  "SET_TOOLBOX_ENTRIES_RESULT": { "error"?: unknown; "requestId": string; "success": boolean; };
  "SPEECH_RESPONSE": { "error"?: unknown; "requestId": string; "success": boolean; };
};
export type HostToGuestEventName = keyof HostToGuestEventPayloads;
export const HOST_TO_GUEST_EVENT_NAMES = ["// --- 标准原生能力 ---", "// --- 系统内置 ---", "CLEAR_CHAT_HISTORY_RESULT", "CLOSE_EXTENSION_RESULT", "HOST_VISIBILITY", "HTTP_RESPONSE", "LANGUAGE_LIST", "RECEIVER_BACKPRESSURE", "SEND_APP_INFO", "SEND_EMAIL_RESULT", "SET_APP_LANGUAGE_RESULT", "SET_TOOLBOX_ENTRIES_RESULT", "SPEECH_RESPONSE"] as const;
export function isHostToGuestEventName(name: string): name is HostToGuestEventName {
  return ((HOST_TO_GUEST_EVENT_NAMES as readonly string[]).includes(name));
}

export type GuestToHostEventPayloads = {
  "// --- 标准原生能力 ---": unknown;
  "// --- 系统内置 ---": unknown;
  "ASKIT_HAPTIC_TRIGGER": { "type"?: string; };
  "ASKIT_TOAST_SHOW": { "message": string; "options"?: unknown; };
  "CLEAR_CHAT_HISTORY": { "requestId": string; };
  "CLOSE_EXTENSION": { "requestId": string; };
  "GET_APP_INFO": { "requestId": string; };
  "GET_LANGUAGE_LIST": { "requestId": string; };
  "GUEST_SLEEP_STATE": { "reason"?: string; "sleeping": boolean; "tabId"?: string; };
  "HTTP_REQUEST": { "body"?: unknown; "headers"?: unknown; "method"?: string; "requestId": string; "url": string; };
  "SEND_EMAIL": { "requestId": string; "subject": string; "to": string; };
  "SET_APP_LANGUAGE": { "language": string; "requestId": string; };
  "SET_TOOLBOX_ENTRIES": { "entries": { "camera"?: boolean; "file"?: boolean; "location"?: boolean; "photo"?: boolean; "sendKey"?: boolean; "webSearch"?: boolean; }; "requestId": string; };
  "SPEECH_REQUEST": { "action": unknown; "requestId": string; "text"?: string; };
};
export type GuestToHostEventName = keyof GuestToHostEventPayloads;
export const GUEST_TO_HOST_EVENT_NAMES = ["// --- 标准原生能力 ---", "// --- 系统内置 ---", "ASKIT_HAPTIC_TRIGGER", "ASKIT_TOAST_SHOW", "CLEAR_CHAT_HISTORY", "CLOSE_EXTENSION", "GET_APP_INFO", "GET_LANGUAGE_LIST", "GUEST_SLEEP_STATE", "HTTP_REQUEST", "SEND_EMAIL", "SET_APP_LANGUAGE", "SET_TOOLBOX_ENTRIES", "SPEECH_REQUEST"] as const;
export function isGuestToHostEventName(name: string): name is GuestToHostEventName {
  return ((GUEST_TO_HOST_EVENT_NAMES as readonly string[]).includes(name));
}

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

export const HOST_TO_GUEST_PAYLOAD_SCHEMA = {
  "// --- 标准原生能力 ---": {},
  "// --- 系统内置 ---": {},
  "CLEAR_CHAT_HISTORY_RESULT": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
  "CLOSE_EXTENSION_RESULT": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
  "HOST_VISIBILITY": { "tabId": ["string", true] as const, "visible": ["boolean", false] as const },
  "HTTP_RESPONSE": { "data": ["unknown", false] as const, "requestId": ["string", false] as const, "status": ["number", false] as const, "success": ["boolean", false] as const },
  "LANGUAGE_LIST": { "current": ["string", false] as const, "languages": ["unknown", false] as const, "requestId": ["string", false] as const },
  "RECEIVER_BACKPRESSURE": { "applied": ["number", false] as const, "batchId": ["number", true] as const, "skipped": ["number", false] as const, "total": ["number", false] as const },
  "SEND_APP_INFO": { "appName": ["string", false] as const, "author": ["string", false] as const, "favoriteCount": ["number", false] as const, "languageContents": ["unknown", false] as const, "logo": ["string", false] as const, "requestId": ["string", false] as const, "usedCount": ["number", false] as const },
  "SEND_EMAIL_RESULT": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
  "SET_APP_LANGUAGE_RESULT": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
  "SET_TOOLBOX_ENTRIES_RESULT": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
  "SPEECH_RESPONSE": { "error": ["unknown", true] as const, "requestId": ["string", false] as const, "success": ["boolean", false] as const },
} as const;
export function validateHostToGuestPayload<E extends HostToGuestEventName>(
  name: E,
  payload: unknown
): payload is HostToGuestEventPayloads[E] {
  const schema = (HOST_TO_GUEST_PAYLOAD_SCHEMA as Record<string, PayloadSchema>)[name];
  if (!schema) return false;
  return validatePayloadAgainstSchema(payload, schema);
}

export const GUEST_TO_HOST_PAYLOAD_SCHEMA = {
  "// --- 标准原生能力 ---": {},
  "// --- 系统内置 ---": {},
  "ASKIT_HAPTIC_TRIGGER": { "type": ["string", true] as const },
  "ASKIT_TOAST_SHOW": { "message": ["string", false] as const, "options": ["unknown", true] as const },
  "CLEAR_CHAT_HISTORY": { "requestId": ["string", false] as const },
  "CLOSE_EXTENSION": { "requestId": ["string", false] as const },
  "GET_APP_INFO": { "requestId": ["string", false] as const },
  "GET_LANGUAGE_LIST": { "requestId": ["string", false] as const },
  "GUEST_SLEEP_STATE": { "reason": ["string", true] as const, "sleeping": ["boolean", false] as const, "tabId": ["string", true] as const },
  "HTTP_REQUEST": { "body": ["unknown", true] as const, "headers": ["unknown", true] as const, "method": ["string", true] as const, "requestId": ["string", false] as const, "url": ["string", false] as const },
  "SEND_EMAIL": { "requestId": ["string", false] as const, "subject": ["string", false] as const, "to": ["string", false] as const },
  "SET_APP_LANGUAGE": { "language": ["string", false] as const, "requestId": ["string", false] as const },
  "SET_TOOLBOX_ENTRIES": { "entries": [{ "camera": ["boolean", true] as const, "file": ["boolean", true] as const, "location": ["boolean", true] as const, "photo": ["boolean", true] as const, "sendKey": ["boolean", true] as const, "webSearch": ["boolean", true] as const }, false] as const, "requestId": ["string", false] as const },
  "SPEECH_REQUEST": { "action": ["unknown", false] as const, "requestId": ["string", false] as const, "text": ["string", true] as const },
} as const;
export function validateGuestToHostPayload<E extends GuestToHostEventName>(
  name: E,
  payload: unknown
): payload is GuestToHostEventPayloads[E] {
  const schema = (GUEST_TO_HOST_PAYLOAD_SCHEMA as Record<string, PayloadSchema>)[name];
  if (!schema) return false;
  return validatePayloadAgainstSchema(payload, schema);
}
