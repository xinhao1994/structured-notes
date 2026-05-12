// Minimal stub of next/server's NextRequest / NextResponse so route tests
// can run in a plain Node environment without installing the next package.

export class NextRequest {
  constructor(url) { this._url = url instanceof URL ? url : new URL(url); }
  get nextUrl() { return this._url; }
}

export class NextResponse extends Response {
  constructor(body, init) { super(body, init); }
  static json(body, init = {}) {
    return new NextResponse(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers || {}) },
    });
  }
}
