import { seat } from "../app/lib/api.mjs";
export function POST(request) {
  return seat(request);
}
