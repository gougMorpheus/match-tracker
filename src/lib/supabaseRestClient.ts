import { observeServerDate } from "../utils/serverClock";

interface SupabaseError {
  message: string;
}

interface SupabaseResponse<T> {
  data: T | null;
  error: SupabaseError | null;
}

type QueryMethod = "GET" | "POST" | "PATCH" | "DELETE";
type FilterOperator = "eq" | "in";

interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value: string | number | Array<string | number>;
}

interface OrderRule {
  column: string;
  ascending: boolean;
}

interface UpsertOptions {
  onConflict?: string;
}

interface RealtimeChannel {
  on: (_event: string, _filter: Record<string, unknown>, _callback: () => void) => RealtimeChannel;
  subscribe: (callback?: (status: string) => void) => RealtimeChannel;
  close: () => void;
}

export interface SupabaseClient<Database = unknown> {
  from: <Row = unknown>(table: string) => SupabaseQueryBuilder<Row>;
  channel: (name: string) => RealtimeChannel;
  removeChannel: (_channel: RealtimeChannel) => Promise<void>;
  readonly __database?: Database;
}

const encodeFilterValue = (value: string | number): string =>
  typeof value === "number" ? String(value) : `"${String(value).replace(/"/g, '\\"')}"`;

const isDevelopment = (): boolean =>
  import.meta.env?.DEV === true;

const getRequestSource = (): string => {
  const stack = new Error().stack;
  if (!stack) {
    return "unknown";
  }

  return stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.includes("supabaseRestClient")) ?? "unknown";
};

class SupabaseQueryBuilder<Row> implements PromiseLike<SupabaseResponse<Row[] | Row>> {
  private method: QueryMethod = "GET";
  private filters: QueryFilter[] = [];
  private orders: OrderRule[] = [];
  private body: unknown = null;
  private selectColumns = "*";
  private includeRepresentation = false;
  private expectSingle = false;
  private upsertOptions: UpsertOptions | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private writePermission: () => boolean = () => true;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly table: string
  ) {}

  // Recheck immediately before sending, including after repository preflight GETs.
  guardWrite(permission: () => boolean) {
    this.writePermission = permission;
    return this;
  }

  select(columns = "*") {
    this.selectColumns = columns;
    this.includeRepresentation = true;
    return this;
  }

  insert(payload: unknown) {
    this.method = "POST";
    this.body = payload;
    return this;
  }

  update(payload: unknown) {
    this.method = "PATCH";
    this.body = payload;
    return this;
  }

  upsert(payload: unknown, options?: UpsertOptions) {
    this.method = "POST";
    this.body = payload;
    this.upsertOptions = options ?? null;
    return this;
  }

  delete() {
    this.method = "DELETE";
    return this;
  }

  eq(column: string, value: string | number) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  in(column: string, values: Array<string | number>) {
    this.filters.push({ column, operator: "in", value: values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this;
  }

  then<TResult1 = SupabaseResponse<Row[] | Row>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResponse<Row[] | Row>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<SupabaseResponse<Row[] | Row>> {
    if (this.method !== "GET" && !this.writePermission()) {
      return { data: null, error: { message: "Schreibzugriff im Ansichtsmodus gesperrt." } };
    }
    const url = new URL(`${this.baseUrl}/rest/v1/${this.table}`);
    url.searchParams.set("select", this.selectColumns);

    if (this.upsertOptions?.onConflict) {
      url.searchParams.set("on_conflict", this.upsertOptions.onConflict);
    }

    this.filters.forEach((filter) => {
      if (filter.operator === "eq") {
        url.searchParams.set(filter.column, `eq.${filter.value}`);
        return;
      }

      const values = (filter.value as Array<string | number>).map(encodeFilterValue).join(",");
      url.searchParams.set(filter.column, `in.(${values})`);
    });

    this.orders.forEach((rule, index) => {
      const orderValue = `${rule.column}.${rule.ascending ? "asc" : "desc"}`;
      const existing = url.searchParams.get("order");
      if (!existing || index === 0) {
        url.searchParams.set("order", orderValue);
        return;
      }

      url.searchParams.set("order", `${existing},${orderValue}`);
    });

    if (this.rangeFrom !== null && this.rangeTo !== null) {
      url.searchParams.set("offset", String(this.rangeFrom));
      url.searchParams.set("limit", String(Math.max(this.rangeTo - this.rangeFrom + 1, 0)));
    }

    const preferValues: string[] = [];
    if (this.includeRepresentation) {
      preferValues.push("return=representation");
    }
    if (this.upsertOptions) {
      preferValues.push("resolution=merge-duplicates");
    }

    const headers = new Headers({
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`
    });

    if (this.body !== null) {
      headers.set("Content-Type", "application/json");
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      headers.set("Range-Unit", "items");
      headers.set("Range", `${this.rangeFrom}-${this.rangeTo}`);
    }
    if (preferValues.length) {
      headers.set("Prefer", preferValues.join(","));
    }
    if (this.expectSingle) {
      headers.set("Accept", "application/vnd.pgrst.object+json");
    }

    try {
      if (isDevelopment()) {
        console.debug("[supabase-request]", {
          method: this.method,
          table: this.table,
          source: getRequestSource(),
          url: url.toString()
        });
      }

      const sentAt = Date.now();
      const response = await fetch(url.toString(), {
        method: this.method,
        headers,
        body: this.body === null ? undefined : JSON.stringify(this.body)
      });

      observeServerDate(response.headers.get("Date"), sentAt, Date.now());
      const rawText = await response.text();
      const parsed = rawText ? (JSON.parse(rawText) as Row[] | Row | { message?: string }) : null;

      if (!response.ok) {
        return {
          data: null,
          error: {
            message:
              parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
                ? parsed.message
                : `${response.status} ${response.statusText}`.trim()
          }
        };
      }

      return {
        data: (parsed as Row[] | Row | null) ?? null,
        error: null
      };
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : "Supabase REST Anfrage fehlgeschlagen."
        }
      };
    }
  }
}

class SupabaseRealtimeChannel implements RealtimeChannel {
  private bindings: Array<{ filter: Record<string, unknown>; callback: () => void; id?: number }> = [];
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private joinTimeout: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private attempt = 0;
  private ref = 0;
  private joinRef = "";
  private pendingHeartbeat: string | null = null;
  private statusCallback?: (status: string) => void;
  constructor(private url: string, private apiKey: string, private name: string) {}
  on(event: string, filter: Record<string, unknown>, callback: () => void) {
    if (event === "postgres_changes") this.bindings.push({ filter, callback });
    return this;
  }
  subscribe(callback?: (status: string) => void) {
    this.statusCallback = callback;
    if (this.stopped && typeof WebSocket !== "undefined") {
      this.stopped = false;
      this.connect();
    }
    return this;
  }
  private send(event: string, payload: unknown, topic = `realtime:${this.name}`): string {
    const ref = String(++this.ref);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ topic, event, payload, ref }));
    }
    return ref;
  }
  private connect() {
    if (this.stopped) return;
    try {
      const url = new URL(this.url);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/realtime/v1/websocket";
      url.search = new URLSearchParams({ apikey: this.apiKey, vsn: "1.0.0" }).toString();
      const socket = new WebSocket(url.toString());
      this.socket = socket;
      socket.onopen = () => {
        if (this.stopped || this.socket !== socket) return;
        this.joinRef = this.send("phx_join", {
          config: { broadcast: { self: false }, presence: { key: "" },
            postgres_changes: this.bindings.map(({ filter }) => filter) },
          ...(this.apiKey.startsWith("eyJ") ? { access_token: this.apiKey } : {})
        });
        this.joinTimeout = setTimeout(() => socket.close(), 10000);
        this.heartbeat = setInterval(() => {
          if (this.pendingHeartbeat) { socket.close(); return; }
          this.pendingHeartbeat = this.send("heartbeat", {}, "phoenix");
        }, 25000);
      };
      socket.onmessage = ({ data }) => {
        if (this.socket !== socket || this.stopped) return;
        try {
          const message = JSON.parse(String(data));
          if (message.event === "phx_reply" && message.ref === this.pendingHeartbeat) this.pendingHeartbeat = null;
          if (message.event === "phx_reply" && message.ref === this.joinRef) {
            if (message.payload?.status !== "ok") { socket.close(); return; }
            if (this.joinTimeout) clearTimeout(this.joinTimeout);
            this.joinTimeout = null;
            const changes = message.payload.response?.postgres_changes ?? [];
            this.bindings.forEach((binding, index) => { binding.id = changes[index]?.id; });
            this.attempt = 0;
            this.statusCallback?.("SUBSCRIBED");
          }
          if (message.event === "postgres_changes") {
            const ids = message.payload?.ids;
            const change = message.payload?.data;
            this.bindings.forEach(({ filter, callback, id }) => {
              if (Array.isArray(ids) && id !== undefined ? ids.includes(id) :
                change?.table === filter.table && change?.schema === filter.schema &&
                  (filter.event === "*" || change?.type === filter.event)) callback();
            });
          }
          if (message.event === "phx_error" || message.event === "phx_close" ||
            (message.event === "system" && message.payload?.status === "error")) socket.close();
        } catch { /* Ignore malformed frames; polling remains available. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.clearTimers();
        this.socket = null;
        this.statusCallback?.("CLOSED");
        this.scheduleReconnect();
      };
    } catch { this.scheduleReconnect(); }
  }
  private scheduleReconnect() {
    if (this.stopped || this.reconnect) return;
    const delay = Math.min(1000 * 2 ** Math.min(this.attempt++, 5), 30000);
    this.reconnect = setTimeout(() => { this.reconnect = null; this.connect(); }, delay);
  }
  private clearTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.joinTimeout) clearTimeout(this.joinTimeout);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.heartbeat = this.joinTimeout = this.reconnect = null;
    this.pendingHeartbeat = null;
  }
  close() {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) this.send("phx_leave", {});
    this.socket = null;
    socket?.close();
  }
}

export const createClient = <Database = unknown>(
  url: string,
  apiKey: string,
  _options?: unknown
): SupabaseClient<Database> => ({
  from: <Row = unknown>(table: string) => new SupabaseQueryBuilder<Row>(url, apiKey, table),
  channel: (name) => new SupabaseRealtimeChannel(url, apiKey, name),
  removeChannel: async (channel) => channel.close()
});
