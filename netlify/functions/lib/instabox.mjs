const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSITIONAL_STATES = new Set(["creating", "starting", "stopping", "suspending", "resuming"]);

export class InstaBoxError extends Error {
  constructor(message, { code = "instabox_error", status = 502, retryable = false, retryAfterSeconds, operationId } = {}) {
    super(message);
    this.name = "InstaBoxError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    this.operationId = operationId;
  }
}

function errorFromResponse(response, body) {
  const detail = body?.error || {};
  const headerDelay = Number.parseInt(response.headers.get("retry-after") || "", 10);
  return new InstaBoxError(detail.message || `InstaBox request failed (${response.status}).`, {
    code: detail.code || "instabox_error",
    status: response.status,
    retryable: detail.retryable === true || RETRYABLE_HTTP_STATUSES.has(response.status),
    retryAfterSeconds: Number.isFinite(detail.retryAfterSeconds) ? detail.retryAfterSeconds : Number.isFinite(headerDelay) ? headerDelay : undefined,
    operationId: detail.operationId || undefined,
  });
}

export function createInstaBoxClient({
  apiKey,
  baseUrl = "https://api.instabox.sh",
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  requestTimeoutMs = 12_000,
  maxRetries = 2,
  operationPolls = 1,
} = {}) {
  if (!apiKey) throw new Error("Missing InstaBox API key.");

  async function request(path, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "X-API-Key": apiKey,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
        });
        const text = await response.text();
        const body = text ? JSON.parse(text) : null;
        if (response.ok) return body;
        lastError = errorFromResponse(response, body);
      } catch (error) {
        lastError = error instanceof InstaBoxError
          ? error
          : new InstaBoxError("InstaBox could not be reached.", { code: "network_error", status: 503, retryable: true });
      } finally {
        clearTimeout(timeout);
      }

      if (!lastError.retryable || attempt === maxRetries) throw lastError;
      const delay = Math.min(5_000, Math.max(250 * 2 ** attempt, (lastError.retryAfterSeconds || 0) * 1_000));
      await sleep(delay);
    }
    throw lastError;
  }

  async function waitForOperation(operation) {
    let current = operation;
    for (let poll = 0; current && !["succeeded", "failed"].includes(current.state) && poll < operationPolls; poll += 1) {
      current = await request(`/v1/operations/${encodeURIComponent(current.id)}?wait=8s`);
    }
    if (current?.state === "failed") {
      const detail = current.error || {};
      throw new InstaBoxError(detail.message || "InstaBox wake operation failed.", {
        code: detail.code || "operation_failed",
        status: detail.code === "machine_cooldown" ? 429 : 503,
        retryable: detail.retryable === true,
        retryAfterSeconds: detail.retryAfterSeconds,
        operationId: current.id,
      });
    }
    return current;
  }

  async function wakeMachine({ machineId, requestId }) {
    if (!machineId || !requestId) throw new Error("Machine and sync request IDs are required.");
    let machine = await request(`/v1/machines/${encodeURIComponent(machineId)}`);

    const cooldownUntil = machine.cooldownUntil ? Date.parse(machine.cooldownUntil) : Number.NaN;
    if (Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
      throw new InstaBoxError("InstaBox is temporarily cooling down.", {
        code: "machine_cooldown",
        status: 429,
        retryable: true,
        retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1_000)),
      });
    }

    if (machine.state === "running") {
      return { status: machine.runtime?.ready ? "ready" : "waking", machineState: machine.state, operationState: null };
    }

    if (TRANSITIONAL_STATES.has(machine.state)) {
      if (!machine.operationId) return { status: "waking", machineState: machine.state, operationState: "running" };
      const operation = await waitForOperation({ id: machine.operationId, state: "running" });
      if (!operation || !["succeeded", "failed"].includes(operation.state)) {
        return { status: "waking", machineState: machine.state, operationState: operation?.state || "running" };
      }
      machine = operation.machine || await request(`/v1/machines/${encodeURIComponent(machineId)}`);
      if (machine.state === "running") {
        return { status: machine.runtime?.ready ? "ready" : "waking", machineState: machine.state, operationState: operation.state };
      }
    }

    const action = machine.state === "suspended" ? "resume" : machine.state === "stopped" ? "start" : null;
    if (!action) {
      throw new InstaBoxError("InstaBox is not in a wakeable state.", { code: "invalid_machine_state", status: 409, retryable: false });
    }

    // One key per request/action/minute deduplicates simultaneous clicks and
    // in-function retries, while allowing a later retry after a failed operation.
    const idempotencyKey = `billforus-sync-${requestId}-${action}-${Math.floor(Date.now() / 60_000).toString(36)}`;
    let operation;
    try {
      operation = await request(`/v1/machines/${encodeURIComponent(machineId)}/${action}`, {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": idempotencyKey },
      });
    } catch (error) {
      if (!(error instanceof InstaBoxError) || error.code !== "operation_conflict" || !error.operationId) throw error;
      operation = { id: error.operationId, state: "running" };
    }
    operation = await waitForOperation(operation);
    return {
      status: operation?.state === "succeeded" && operation.machine?.runtime?.ready ? "ready" : "waking",
      machineState: operation?.machine?.state || (action === "resume" ? "resuming" : "starting"),
      operationState: operation?.state || "running",
    };
  }

  return { wakeMachine };
}
