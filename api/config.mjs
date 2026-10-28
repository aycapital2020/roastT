import { config } from "../app/lib/api.mjs";
export function GET(request) {
  return config(request);
}
