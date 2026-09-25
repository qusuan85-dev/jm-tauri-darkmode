/**
 * Search source adapter.
 *
 * The search screen owns the parts that are awkward to get right — restoring the
 * previous session (query, sort, buffered results, scroll offset), the infinite
 * scroll sentinel, duplicate suppression across shifting result sets, and the
 * list/card presentations. The adapter supplies only what actually differs: the
 * sort choices, the paged request, and how to read an id / title / author /
 * cover / route out of one result row.
 */
import { getImgBase } from "../config/endpoints";

export type SearchSortOption = { key: string; label: string };

export type SearchPageResult = { list: unknown[]; total: number | null };

export type SearchAdapter = {
  id: "jm";
  /** Placeholder shown in the query box. */
  placeholder: string;
  /** Prefix for the raw id shown on each row. */
  idLabel: string;
  sorts: SearchSortOption[];
  defaultSort: string;
  /** Whether a bare number should open that id directly. */
  numericShortcut: boolean;

  fetchPage(params: {
    query: string;
    sort: string;
    page: number;
    cookies: Record<string, string>;
  }): Promise<SearchPageResult>;

  itemId(item: unknown): string;
  itemTitle(item: unknown): string;
  itemAuthor(item: unknown): string;
  itemCover(item: unknown): string;
  /** In-app route that opens one result. */
  detailPath(item: unknown): string;
};

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  return "";
}

// --------------------------------------------------------------- JM adapter

const JM_SORTS: SearchSortOption[] = [
  { key: "mr", label: "最新" },
  { key: "mv", label: "最多点击" },
  { key: "mp", label: "最多图片" },
  { key: "tf", label: "最多爱心" },
];

export function createJmSearchAdapter(): SearchAdapter {
  return {
    id: "jm",
    placeholder: "输入关键词 / JM12345",
    idLabel: "AID",
    sorts: JM_SORTS,
    defaultSort: "mr",
    numericShortcut: true,

    async fetchPage({ query, sort, page, cookies }) {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<any>("api_search", {
        searchQuery: query,
        sort,
        page: String(page),
        cookies,
      });
      return {
        list: Array.isArray(data?.content) ? data.content : [],
        total: typeof data?.total === "number" ? data.total : null,
      };
    },

    itemId(item) {
      const raw = (item as any)?.id;
      return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    },
    itemTitle(item) {
      return text((item as any)?.name) || text((item as any)?.title);
    },
    itemAuthor(item) {
      return text((item as any)?.author);
    },
    itemCover(item) {
      const id = this.itemId(item);
      return id ? `${getImgBase()}/media/albums/${id}_3x4.jpg` : "";
    },
    detailPath(item) {
      const id = this.itemId(item);
      return id ? `/detail/${id}` : "";
    },
  };
}

export function createSearchAdapter(): SearchAdapter {
  return createJmSearchAdapter();
}
