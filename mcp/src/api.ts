/**
 * Cliente de la API del backend. El MCP no tiene logica propia: todo lo que
 * decide (que se puede cambiar, que es un criterio valido...) lo decide la API,
 * y aqui solo se traducen sus errores a un mensaje que el modelo entienda.
 */

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

const describeError = (status: number, body: ErrorBody | null): string => {
  const base = body?.error ?? `La API respondió ${status}`;
  const details = body?.details?.map((detail) => `${detail.field}: ${detail.message}`).join('; ');
  return details ? `${base} (${details})` : base;
};

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  public post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  public patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** Para las capturas: devuelve los bytes en base64, que es como viajan en MCP. */
  public async getBase64(path: string): Promise<{ data: string; mimeType: string }> {
    const res = await this.fetch('GET', path);
    if (!res.ok) throw new ApiError(describeError(res.status, await this.errorBody(res)), res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { data: buffer.toString('base64'), mimeType: res.headers.get('content-type') ?? 'image/jpeg' };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const res = await this.fetch(method, path, body, query);
    if (!res.ok) throw new ApiError(describeError(res.status, await this.errorBody(res)), res.status);
    return (await res.json()) as T;
  }

  private async fetch(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      return await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApiError(`No se pudo conectar con la API en ${this.baseUrl} (${reason}). ¿Está arrancado el backend?`, 0);
    }
  }

  private async errorBody(res: Response): Promise<ErrorBody | null> {
    try {
      return (await res.json()) as ErrorBody;
    } catch {
      return null;
    }
  }
}
