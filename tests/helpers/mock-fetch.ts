/** Utilities to mock `fetch` in tests. No real network. */

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type MockResult = Response | Error;
export type Responder = (call: RecordedCall, index: number) => MockResult | Promise<MockResult>;

export interface MockFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
}

/** JSON response (or empty if `body` is `undefined`). */
export function json(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Response {
  const noBody = status === 204 || status === 205 || body === undefined;
  return new Response(noBody ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** API error body: `{"Error":{"Code":n,"Message":"..."}}`. */
export function apiError(status: number, code: number, message: string): Response {
  return json(status, {
    Error: {
      Code: code,
      Message: message,
      Details: '',
      Timestamp: '2026-11-16T10:00:00.000Z',
      StackTrace: '',
    },
  });
}

export function token(accessToken = 'jwt-token-1', expiresIn: string | number = '3600'): Response {
  return json(200, {
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: String(expiresIn),
  });
}

/** Creates a fake `fetch` that records calls and delegates the response to `responder`. */
export function mockFetch(responder: Responder): MockFetch {
  const calls: RecordedCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && !Array.isArray(h) && !(h instanceof Headers)) {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    const result = await responder(call, calls.length - 1);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Shortcut: a fixed queue of responses, in order. */
export function sequence(...results: MockResult[]): MockFetch {
  let i = 0;
  return mockFetch(() => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    if (!r) throw new Error('sequence() without responses');
    // A Response can only be read once: it is cloned so the last one can be reused.
    return r instanceof Response ? r.clone() : r;
  });
}

export const noSleep = async (): Promise<void> => undefined;

export function networkError(msg = 'fetch failed'): Error {
  return new TypeError(msg);
}

/** Controllable clock. */
export function fakeClock(start = 1_000_000) {
  const clock = {
    t: start,
    now: () => clock.t,
    advance(ms: number) {
      clock.t += ms;
    },
  };
  return clock;
}
