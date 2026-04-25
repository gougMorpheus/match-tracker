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
  subscribe: () => RealtimeChannel;
}

export interface SupabaseClient<Database = unknown> {
  from: <Row = unknown>(table: string) => SupabaseQueryBuilder<Row>;
  channel: (name: string) => RealtimeChannel;
  removeChannel: (_channel: RealtimeChannel) => Promise<void>;
  readonly __database?: Database;
}

const encodeFilterValue = (value: string | number): string =>
  typeof value === "number" ? String(value) : `"${String(value).replace(/"/g, '\\"')}"`;

class SupabaseQueryBuilder<Row> implements PromiseLike<SupabaseResponse<Row[] | Row>> {
  private method: QueryMethod = "GET";
  private filters: QueryFilter[] = [];
  private orders: OrderRule[] = [];
  private body: unknown = null;
  private selectColumns = "*";
  private includeRepresentation = false;
  private expectSingle = false;
  private upsertOptions: UpsertOptions | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly table: string
  ) {}

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
    if (preferValues.length) {
      headers.set("Prefer", preferValues.join(","));
    }
    if (this.expectSingle) {
      headers.set("Accept", "application/vnd.pgrst.object+json");
    }

    try {
      const response = await fetch(url.toString(), {
        method: this.method,
        headers,
        body: this.body === null ? undefined : JSON.stringify(this.body)
      });

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
  on() {
    return this;
  }

  subscribe() {
    return this;
  }
}

export const createClient = <Database = unknown>(
  url: string,
  apiKey: string,
  _options?: unknown
): SupabaseClient<Database> => ({
  from: <Row = unknown>(table: string) => new SupabaseQueryBuilder<Row>(url, apiKey, table),
  channel: () => new SupabaseRealtimeChannel(),
  removeChannel: async () => undefined
});
