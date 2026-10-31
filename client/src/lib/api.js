// HTTP calls to the Lumen server (server/desktop mode). Relative paths so the
// same code works under any base.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** `api(method, path, body)` — JSON in/out. Throws `ApiError` on non-2xx. */
export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  if (method !== 'GET' && method !== 'HEAD') opts.headers['X-Lumen'] = '1'
  let res
  try {
    res = await fetch('api' + path, opts)
  } catch {
    throw new ApiError(0, 'Could not reach the server', null)
  }
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const message = data && typeof data === 'object' && data.error ? data.error : `Request failed (${res.status})`
    throw new ApiError(res.status, message, data)
  }
  return data
}
