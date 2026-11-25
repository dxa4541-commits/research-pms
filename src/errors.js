// Shared helpers: HTTP errors and input validation.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (s, m) => { throw new HttpError(s, m); };

export const str = (v, max = 200) => (typeof v === 'string' && v.trim() && v.trim().length <= max) ? v.trim() : null;
export const need = (v, label, max) => str(v, max) ?? fail(400, `${label} is required (max ${max ?? 200} chars)`);
export const intParam = (v, def, min, max) => {
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fail(400, 'Invalid paging parameter');
};
