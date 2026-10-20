import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { invalidArguments } from "./errors.ts";
import type { JsonObject } from "./json.ts";

const jsonObject = Compile(Type.Cyclic({
  JsonValue: Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(Type.Ref("JsonValue")),
    Type.Ref("JsonObject"),
  ]),
  JsonObject: Type.Record(Type.String(), Type.Ref("JsonValue")),
}, "JsonObject"));

export function requestAcceptsJson(request: Request): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return jsonObject.Check(value);
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidArguments("valid JSON object body is required");
  }
  if (!isJsonObject(value)) throw invalidArguments("JSON object body is required");
  return value;
}
