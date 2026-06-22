export interface Product {
  id: string;
  name: string;
  category: string;
  price: string;
  created_at: Date;
  updated_at: Date;
}

export interface PaginationCursor {
  updated_at: string;
  id: string;
}

export interface PageInfo {
  snapshot: string;
  next_cursor: string | null;
  has_next: boolean;
}

export interface ProductListResponse {
  data: Product[];
  page_info: PageInfo;
}

export interface ProductQueryOptions {
  limit: number;
  category?: string;
  snapshot?: string;
  cursor?: PaginationCursor;
}
