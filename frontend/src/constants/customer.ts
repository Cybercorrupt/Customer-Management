// Status is a fixed business enum (not master data), so it stays in code.
// Segment / Purchasing Size / Area / Payment Terms are Master Data and come
// live from the database (single source of truth) — never hard-coded here.
export const STATUSES = ["Active", "Inactive", "Bad Debt"];
