/**
 * Public contract of the Pricing context (M0-026, ADR-026). Ordering never reads Catalog price
 * columns; it asks Pricing for an effective price and stores the returned snapshot immutably on the
 * line. Price-list precedence and effective-dating rules are decision G04 and live inside Pricing.
 */

export type SaleChannel = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

/** Price captured at sale time; historical lines keep it even when price lists change (§9.1). */
export interface PriceSnapshot {
  readonly productId: string;
  /** Exact decimal string in the currency's minor units, e.g. "12.50". */
  readonly unitAmount: string;
  readonly currency: string;
  /** Price list that produced the price, for traceability. */
  readonly priceListId: string | null;
  readonly channel: SaleChannel;
  readonly resolvedAt: string;
}

export interface PriceRequest {
  readonly organizationId: string;
  readonly branchId: string;
  readonly productId: string;
  readonly channel: SaleChannel;
  readonly at: string;
}

/** Effective-price resolution. On the Edge it is served from the Branch Operational Projection (ADR-038). */
export interface PricingPort {
  resolve(request: PriceRequest): Promise<PriceSnapshot | undefined>;
}
