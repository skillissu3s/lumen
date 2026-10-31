// Errors shared by both storage backends.

/** The file moved on since the edit was based on it. `current` is `{ text, sha } | null`. */
export class ConflictError extends Error {
  constructor(current) {
    super('The file changed since you loaded it')
    this.current = current
  }
}

/** 401/403 — the session or token is no longer accepted. */
export class AuthError extends Error {
  constructor(message) {
    super(message)
    this.status = 401
  }
}

/** No network; the edit is kept and will be retried. */
export class OfflineError extends Error {
  constructor() {
    super('You are offline')
    this.status = 0
  }
}
