# Inventory Management

<cite>
**Referenced Files in This Document**
- [app.inventory.tsx](file://src/routes/_authenticated/app.inventory.tsx)
- [products.ts](file://src/lib/products.ts)
- [collections.ts](file://src/lib/collections.ts)
- [item-codes.ts](file://src/lib/item-codes.ts)
- [transfers.ts](file://src/lib/transfers.ts)
- [pdf.ts](file://src/lib/pdf.ts)
- [validate.ts](file://src/lib/validate.ts)
- [paging.ts](file://src/lib/paging.ts)
</cite>

## Update Summary
**Changes Made**
- Updated advanced filtering system documentation with low stock, collection, and sorting filters
- Added comprehensive pagination controls documentation with responsive design
- Enhanced export functionality section covering CSV and PDF exports with templates
- Expanded search integration details with debounced search implementation
- Updated responsive design improvements across all inventory screens

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Advanced Filtering System](#advanced-filtering-system)
7. [Pagination Controls](#pagination-controls)
8. [Export Functionality](#export-functionality)
9. [Search Integration](#search-integration)
10. [Responsive Design Improvements](#responsive-design-improvements)
11. [Dependency Analysis](#dependency-analysis)
12. [Performance Considerations](#performance-considerations)
13. [Troubleshooting Guide](#troubleshooting-guide)
14. [Conclusion](#conclusion)

## Introduction
This document explains the inventory management system for a multi-store point-of-sale application. It covers how products are organized into categories and collections, how stock is tracked per store with near real-time updates, how barcode integration works for both manual entry and scanner input, how item codes are generated and managed, and how bulk import/export supports product data management. The system now features an enhanced interface with advanced filtering, pagination controls, comprehensive export capabilities, integrated search functionality, and responsive design improvements across collections, inventory, transfers, and stock take screens.

## Project Structure
The inventory feature spans an authenticated route that renders the inventory UI and several library modules that provide data access, code handling, collection membership, transfer operations, and pagination utilities:

- `src/routes/_authenticated/app.inventory.tsx` — Inventory page UI with advanced filtering, pagination, dialogs, CSV import/export, label printing, and stock adjustments.
- `src/lib/products.ts` — Product catalog query hook, barcode lookup helper, and per-store stock query hook.
- `src/lib/collections.ts` — Collection definitions, product-to-collection mapping, discount calculation helpers.
- `src/lib/item-codes.ts` — Code normalization, auto-code generation, clash detection, and QR payload formatting.
- `src/lib/transfers.ts` — Transfer listing, low-stock queries, and mutations for dispatching/receiving/canceling transfers.
- `src/lib/pdf.ts` — CSV/PDF utilities used by export and label sheet generation.
- `src/lib/validate.ts` — Validation helpers used by forms (SKU validation, amount limits).
- `src/lib/paging.ts` — Pagination utility for consistent list paging across screens.

```mermaid
graph TB
INV["Inventory Page<br/>app.inventory.tsx"] --> PROD["Products Hook<br/>products.ts"]
INV --> COL["Collections Hook<br/>collections.ts"]
INV --> CODE["Item Codes Utils<br/>item-codes.ts"]
INV --> PDF["PDF/CSV Utilities<br/>pdf.ts"]
INV --> TRANS["Transfers & Low Stock<br/>transfers.ts"]
INV --> VAL["Validation Helpers<br/>validate.ts"]
INV --> PAGING["Pagination Utility<br/>paging.ts"]
PROD --> DB["Database Tables<br/>products / store_stock"]
COL --> DB
TRANS --> DB
```

**Diagram sources**
- [app.inventory.tsx:1-100](file://src/routes/_authenticated/app.inventory.tsx#L1-L100)
- [products.ts:1-107](file://src/lib/products.ts#L1-L107)
- [collections.ts:1-56](file://src/lib/collections.ts#L1-L56)
- [item-codes.ts:1-84](file://src/lib/item-codes.ts#L1-L84)
- [transfers.ts:1-140](file://src/lib/transfers.ts#L1-L140)
- [pdf.ts:1-412](file://src/lib/pdf.ts#L1-L412)
- [validate.ts:1-147](file://src/lib/validate.ts#L1-L147)
- [paging.ts:1-17](file://src/lib/paging.ts#L1-L17)

**Section sources**
- [app.inventory.tsx:1-100](file://src/routes/_authenticated/app.inventory.tsx#L1-L100)
- [products.ts:1-107](file://src/lib/products.ts#L1-L107)
- [collections.ts:1-56](file://src/lib/collections.ts#L1-L56)
- [item-codes.ts:1-84](file://src/lib/item-codes.ts#L1-L84)
- [transfers.ts:1-140](file://src/lib/transfers.ts#L1-L140)
- [paging.ts:1-17](file://src/lib/paging.ts#L1-L17)

## Core Components
- Product Catalog
  - Products are fetched via a long-lived cached query. Buying costs are loaded only when needed by admin/manager roles.
  - SKU is the single identifier used for search, scanning, and QR payloads.
- Collections
  - Products can belong to multiple collections; the best discount among them applies at sale time.
  - The UI shows collection membership and allows grouping inventory value by collection.
- Stock Tracking
  - Per-store stock is read from a store-scoped table and exposed as a map of product ID to quantity.
  - Live mode refreshes periodically on the till to reflect changes made elsewhere.
- Item Codes
  - Auto-generated codes use a safe alphabet and prefix. Normalization ensures consistent matching.
  - Clash detection prevents duplicate SKUs across the catalog.
- Transfers and Low Stock
  - Low-stock items are surfaced per store using a server-side query.
  - Transfers move stock between stores with status tracking and audit fields.

**Section sources**
- [products.ts:1-107](file://src/lib/products.ts#L1-L107)
- [collections.ts:1-56](file://src/lib/collections.ts#L1-L56)
- [item-codes.ts:1-84](file://src/lib/item-codes.ts#L1-L84)
- [transfers.ts:1-140](file://src/lib/transfers.ts#L1-L140)

## Architecture Overview
The inventory system combines a React-based UI with TanStack Query-backed hooks and Supabase database tables. Data flows from the UI through hooks to the database, with explicit cache invalidation after writes.

```mermaid
sequenceDiagram
participant User as "User"
participant UI as "Inventory Page"
participant Hooks as "React Query Hooks"
participant RPC as "Supabase RPCs"
participant DB as "Database"
User->>UI : Open Inventory
UI->>Hooks : useProducts()
Hooks->>DB : SELECT products
DB-->>Hooks : Product list
UI->>Hooks : useStock(storeId)
Hooks->>DB : SELECT store_stock WHERE store_id
DB-->>Hooks : Stock map
User->>UI : Add/Edit Product
UI->>RPC : save_product(...)
RPC->>DB : INSERT/UPDATE products
UI->>RPC : set_product_collections(...)
RPC->>DB : INSERT product_collections
UI->>RPC : set_stock_qty(...)
RPC->>DB : UPDATE store_stock
UI->>Hooks : invalidate(["products","stock",...])
Hooks->>DB : Re-fetch changed data
```

**Diagram sources**
- [app.inventory.tsx:698-769](file://src/routes/_authenticated/app.inventory.tsx#L698-L769)
- [products.ts:22-53](file://src/lib/products.ts#L22-L53)
- [products.ts:82-106](file://src/lib/products.ts#L82-L106)

## Detailed Component Analysis

### Product Catalog Organization with Categories and Collections
- Products include optional category and SKU fields. The UI displays name, SKU, cost, price, active state, reorder point, and current stock.
- Collections group products and can apply discounts. The inventory view computes inventory value split by collection, distributing value evenly when an item belongs to multiple collections.
- The collections hook loads both collection metadata and product-to-collection mappings, enabling fast lookups in the UI.

Key behaviors:
- Filtering by collection and searching by name/SKU/collection names.
- Displaying collection badges next to each product row.
- Computing total retail and cost values for inventory reporting.

**Section sources**
- [app.inventory.tsx:110-213](file://src/routes/_authenticated/app.inventory.tsx#L110-L213)
- [collections.ts:15-39](file://src/lib/collections.ts#L15-L39)
- [collections.ts:42-53](file://src/lib/collections.ts#L42-L53)

### Barcode Integration: Manual Entry and Scanner Input
- SKU is the canonical item code. It is normalized (trimmed, space-collapsed, case-insensitive) everywhere it is compared.
- The inventory page integrates a hardware scanner wedge: when idle, scanned codes jump to the matching product or pre-fill a new item dialog if unknown.
- The till uses an exact match against the cached product catalog for fast resolution.

```mermaid
flowchart TD
Start(["Barcode Input"]) --> Normalize["Normalize Code"]
Normalize --> Search{"Match Found?"}
Search --> |Yes| Jump["Jump to Product Row"]
Search --> |No| NewItem["Open New Item Dialog<br/>Pre-filled with Scanned Code"]
Jump --> End(["Done"])
NewItem --> End
```

**Diagram sources**
- [app.inventory.tsx:140-157](file://src/routes/_authenticated/app.inventory.tsx#L140-L157)
- [products.ts:54-64](file://src/lib/products.ts#L54-L64)
- [item-codes.ts:21-24](file://src/lib/item-codes.ts#L21-L24)

**Section sources**
- [app.inventory.tsx:140-157](file://src/routes/_authenticated/app.inventory.tsx#L140-L157)
- [products.ts:54-64](file://src/lib/products.ts#L54-L64)
- [item-codes.ts:21-24](file://src/lib/item-codes.ts#L21-L24)

### Item Code Generation and Management
- Auto-generated codes use a safe base-32 alphabet with a fixed prefix to avoid ambiguity.
- The UI suggests non-clashing codes and validates SKUs before saving.
- QR payloads contain the normalized code so scanners and cameras resolve consistently.

```mermaid
classDiagram
class ItemCodes {
+AUTO_PREFIX
+normalizeCode(raw) string
+isAutoCode(code) bool
+suggestCode(taken) string
+takenCodes(list) string[]
+findCodeClash(list, code, exceptId) any
+qrPayload(code) string
}
```

**Diagram sources**
- [item-codes.ts:15-83](file://src/lib/item-codes.ts#L15-L83)

**Section sources**
- [item-codes.ts:15-83](file://src/lib/item-codes.ts#L15-L83)
- [app.inventory.tsx:698-769](file://src/routes/_authenticated/app.inventory.tsx#L698-L769)

### Bulk Import/Export Capabilities
- CSV Import
  - Users can upload a CSV file; the UI parses it and presents rows for review before applying changes.
- CSV Export
  - Exports include name, SKU, cost, price, quantity, collections, and active state.
- PDF Inventory Report
  - Generates a landscape report with KPIs (items, units, cost value, retail value) and a detailed table including collections and stock value.

```mermaid
flowchart TD
A["User Action"] --> B{"Import or Export?"}
B --> |Import| C["Upload CSV"]
C --> D["Parse CSV Rows"]
D --> E["Review & Apply Changes"]
B --> |Export CSV| F["Download CSV File"]
B --> |Export PDF| G["Generate Inventory Report PDF"]
```

**Diagram sources**
- [app.inventory.tsx:273-368](file://src/routes/_authenticated/app.inventory.tsx#L273-L368)
- [pdf.ts:1-412](file://src/lib/pdf.ts#L1-L412)

**Section sources**
- [app.inventory.tsx:273-368](file://src/routes/_authenticated/app.inventory.tsx#L273-L368)
- [pdf.ts:1-412](file://src/lib/pdf.ts#L1-L412)

### Adding Products and Updating Stock Levels
- Adding a Product
  - The product dialog collects name, SKU, selling price, buying cost, initial quantity, reorder point, and active flag.
  - On save, it calls an RPC to create/update the product, assigns collections, and optionally sets absolute stock for the current store.
- Updating Stock
  - The stock adjustment dialog sends an absolute quantity update with a reason and note.
  - After successful mutation, the UI invalidates relevant caches to refresh stock, movements, and alerts.

```mermaid
sequenceDiagram
participant User as "User"
participant Dialog as "Product/Stock Dialog"
participant RPC as "Supabase RPCs"
participant Cache as "React Query Cache"
User->>Dialog : Save Product
Dialog->>RPC : save_product(...)
RPC-->>Dialog : product id
Dialog->>RPC : set_product_collections(...)
alt Initial Quantity Provided
Dialog->>RPC : set_stock_qty(...)
end
Dialog->>Cache : invalidate(["products","stock","movements","collections","dash-alerts"])
```

**Diagram sources**
- [app.inventory.tsx:698-769](file://src/routes/_authenticated/app.inventory.tsx#L698-L769)

**Section sources**
- [app.inventory.tsx:698-769](file://src/routes/_authenticated/app.inventory.tsx#L698-L769)
- [validate.ts:1-147](file://src/lib/validate.ts#L1-L147)

### Multi-Store Inventory Allocation and Transfer Processes
- Low Stock Alerts
  - The inventory page highlights items at or below their reorder point per store.
- Transfers
  - Transfers are listed per store and support statuses: in transit, received, cancelled.
  - Mutations dispatch, receive, or cancel transfers and invalidate related caches (transfers, stock, low-stock, dash-alerts, movements).

```mermaid
stateDiagram-v2
[*] --> InTransit : "create_transfer"
InTransit --> Received : "receive_transfer"
InTransit --> Cancelled : "cancel_transfer"
Received --> [*]
Cancelled --> [*]
```

**Diagram sources**
- [transfers.ts:51-89](file://src/lib/transfers.ts#L51-L89)
- [transfers.ts:117-139](file://src/lib/transfers.ts#L117-L139)

**Section sources**
- [transfers.ts:51-89](file://src/lib/transfers.ts#L51-L89)
- [transfers.ts:92-115](file://src/lib/transfers.ts#L92-L115)
- [transfers.ts:117-139](file://src/lib/transfers.ts#L117-L139)

### Relationship Between Products, Collections, and Stock Levels Across Stores
- Products are independent of stores; they define identity, pricing, and catalog metadata.
- Collections group products and influence pricing/discounts but do not change stock counts.
- Stock is per store: the same product can have different quantities at different locations.
- The inventory UI aggregates stock per store and shows collection membership alongside stock and valuation.

```mermaid
erDiagram
PRODUCTS {
uuid id PK
string name
string sku UK
string category
decimal price
decimal cost
boolean active
int reorder_point
}
COLLECTIONS {
uuid id PK
string name
decimal discount_pct
boolean is_shared
string share_slug
}
PRODUCT_COLLECTIONS {
uuid product_id FK
uuid collection_id FK
}
STORE_STOCK {
uuid store_id FK
uuid product_id FK
int qty
}
PRODUCTS ||--o{ PRODUCT_COLLECTIONS : "belongs to"
COLLECTIONS ||--o{ PRODUCT_COLLECTIONS : "contains"
PRODUCTS ||--o{ STORE_STOCK : "has stock per store"
```

**Diagram sources**
- [products.ts:8-17](file://src/lib/products.ts#L8-L17)
- [collections.ts:6-13](file://src/lib/collections.ts#L6-L13)
- [collections.ts:22-38](file://src/lib/collections.ts#L22-L38)
- [products.ts:94-104](file://src/lib/products.ts#L94-L104)

**Section sources**
- [products.ts:8-17](file://src/lib/products.ts#L8-L17)
- [collections.ts:6-13](file://src/lib/collections.ts#L6-L13)
- [collections.ts:22-38](file://src/lib/collections.ts#L22-L38)
- [products.ts:94-104](file://src/lib/products.ts#L94-L104)

## Advanced Filtering System

The inventory interface now provides a comprehensive filtering system that allows users to narrow down product lists efficiently:

### Filter Types
- **Low Stock Filter**: Toggle to show only products at or below their reorder point
- **Collection Filter**: Filter products by specific collections with a radio button interface
- **Sort Options**: Sort by name, price, or stock levels

### Implementation Details
- Filters are implemented using React state management with debounced search
- Active filter count is displayed in a badge on the filter button
- Filter combinations are supported (e.g., low stock + specific collection)
- All filters reset pagination to page 0 for consistent user experience

```mermaid
flowchart TD
FilterButton["Filter Button"] --> Dropdown["Filter Dropdown Menu"]
Dropdown --> LowStock["Low Stock Checkbox"]
Dropdown --> CollectionFilter["Collection Radio Group"]
Dropdown --> SortOptions["Sort Radio Group"]
LowStock --> ApplyFilters["Apply Filters"]
CollectionFilter --> ApplyFilters
SortOptions --> ApplyFilters
ApplyFilters --> UpdateRows["Update Filtered Rows"]
UpdateRows --> ResetPage["Reset to Page 1"]
```

**Diagram sources**
- [app.inventory.tsx:368-435](file://src/routes/_authenticated/app.inventory.tsx#L368-L435)

**Section sources**
- [app.inventory.tsx:154-158](file://src/routes/_authenticated/app.inventory.tsx#L154-L158)
- [app.inventory.tsx:187-209](file://src/routes/_authenticated/app.inventory.tsx#L187-L209)
- [app.inventory.tsx:368-435](file://src/routes/_authenticated/app.inventory.tsx#L368-L435)

## Pagination Controls

The inventory system implements robust pagination controls to handle large product catalogs efficiently:

### Pagination Features
- **Fixed Page Size**: 10 items per page for optimal mobile and desktop viewing
- **Smart Page Clamping**: Automatically adjusts page numbers when filters reduce result count
- **Visual Indicators**: Shows total items, current page, and navigation controls
- **Responsive Layout**: Adapts to different screen sizes while maintaining usability

### Technical Implementation
- Uses the `pageSlice` utility function for consistent pagination logic
- Integrates with the `Pager` component for visual navigation
- Maintains pagination state independently from filter state
- Provides smooth transitions when filters change result counts

```mermaid
flowchart TD
Rows["Filtered Rows"] --> PageSlice["pageSlice Utility"]
PageSlice --> CalculatePages["Calculate Total Pages"]
CalculatePages --> ClampPage["Clamp Current Page"]
ClampPage --> SliceData["Slice Data for Current Page"]
SliceData --> RenderTable["Render Paginated Table"]
RenderTable --> PagerComponent["Pager Navigation"]
```

**Diagram sources**
- [app.inventory.tsx:315-316](file://src/routes/_authenticated/app.inventory.tsx#L315-L316)
- [paging.ts:1-17](file://src/lib/paging.ts#L1-L17)

**Section sources**
- [app.inventory.tsx:315-316](file://src/routes/_authenticated/app.inventory.tsx#L315-L316)
- [app.inventory.tsx:655](file://src/routes/_authenticated/app.inventory.tsx#L655)
- [paging.ts:1-17](file://src/lib/paging.ts#L1-L17)

## Export Functionality

The inventory system provides comprehensive export capabilities for both CSV and PDF formats:

### CSV Export Features
- **Complete Data Export**: Exports all product information including name, SKU, cost, price, quantity, collections, and active status
- **Template Download**: Provides a downloadable CSV template for bulk imports
- **Flexible Import**: Supports various column name variations for compatibility

### PDF Report Generation
- **Professional Layout**: Generates branded PDF reports with business headers and footers
- **KPI Dashboard**: Includes key performance indicators (items count, units, cost value, retail value)
- **Detailed Tables**: Comprehensive product listings with collection memberships and stock valuations
- **Multi-page Support**: Automatically handles large datasets across multiple pages

### Label Printing
- **QR Code Labels**: Generates printable labels with QR codes for each product
- **Batch Processing**: Supports printing multiple copies of labels for different products
- **Responsive Layout**: Optimized label layout for standard label printers

```mermaid
flowchart TD
ExportAction["Export Action"] --> FormatChoice{"Format Type?"}
FormatChoice --> |CSV| CSVExport["CSV Export"]
FormatChoice --> |PDF| PDFExport["PDF Export"]
CSVExport --> TemplateCheck{"Has Template?"}
TemplateCheck --> |Yes| TemplateDownload["Download Template"]
TemplateCheck --> |No| CSVDownload["Download CSV"]
PDFExport --> ReportGen["Generate Report"]
ReportGen --> KPICalculation["Calculate KPIs"]
KPICalculation --> TableGeneration["Generate Tables"]
TableGeneration --> PDFDownload["Download PDF"]
```

**Diagram sources**
- [app.inventory.tsx:252-314](file://src/routes/_authenticated/app.inventory.tsx#L252-L314)
- [pdf.ts:51-266](file://src/lib/pdf.ts#L51-L266)

**Section sources**
- [app.inventory.tsx:252-314](file://src/routes/_authenticated/app.inventory.tsx#L252-L314)
- [app.inventory.tsx:443-462](file://src/routes/_authenticated/app.inventory.tsx#L443-L462)
- [pdf.ts:51-266](file://src/lib/pdf.ts#L51-L266)
- [pdf.ts:332-411](file://src/lib/pdf.ts#L332-L411)

## Search Integration

The inventory system features advanced search capabilities with debounced input handling:

### Search Features
- **Debounced Input**: Prevents excessive filtering during rapid typing
- **Multi-field Search**: Searches across product names, SKUs, and collection names
- **Case-Insensitive**: Handles mixed-case searches seamlessly
- **Real-time Results**: Updates results as users type with minimal performance impact

### Implementation Details
- Uses `useDebouncedValue` hook for efficient search performance
- Integrates with existing filter system for combined search and filtering
- Maintains search state independently from other filters
- Provides visual feedback during search operations

```mermaid
flowchart TD
SearchInput["Search Input"] --> DebounceHook["useDebouncedValue Hook"]
DebounceHook --> SearchLogic["Search Logic"]
SearchLogic --> NameMatch["Name Match"]
SearchLogic --> SkuMatch["SKU Match"]
SearchLogic --> CollectionMatch["Collection Match"]
NameMatch --> CombineResults["Combine Results"]
SkuMatch --> CombineResults
CollectionMatch --> CombineResults
CombineResults --> FilteredResults["Filtered Results"]
```

**Diagram sources**
- [app.inventory.tsx:154-187](file://src/routes/_authenticated/app.inventory.tsx#L154-L187)
- [app.inventory.tsx:187-209](file://src/routes/_authenticated/app.inventory.tsx#L187-L209)

**Section sources**
- [app.inventory.tsx:154-187](file://src/routes/_authenticated/app.inventory.tsx#L154-L187)
- [app.inventory.tsx:353-367](file://src/routes/_authenticated/app.inventory.tsx#L353-L367)
- [app.inventory.tsx:187-209](file://src/routes/_authenticated/app.inventory.tsx#L187-L209)

## Responsive Design Improvements

The inventory interface has been enhanced with responsive design principles for optimal user experience across devices:

### Responsive Features
- **Mobile-First Layout**: Optimized for touch interactions on smaller screens
- **Adaptive Grid Systems**: Uses CSS grid with responsive breakpoints
- **Touch-Friendly Controls**: Larger tap targets and improved spacing for mobile devices
- **Collapsible Interfaces**: Hidden elements on small screens to maximize content visibility

### Key Responsive Elements
- **Flexible Header**: Adapts search bar and action buttons based on screen width
- **Responsive Tables**: Horizontal scrolling for wide tables on mobile devices
- **Adaptive Cards**: Grid layout adjusts from single column on mobile to multi-column on desktop
- **Scalable Typography**: Font sizes and spacing adjust for readability across devices

```mermaid
flowchart TD
ScreenSize["Screen Size Detection"] --> MobileLayout["Mobile Layout (< 640px)"]
ScreenSize --> TabletLayout["Tablet Layout (640px - 1024px)"]
ScreenSize --> DesktopLayout["Desktop Layout (> 1024px)"]
MobileLayout --> SingleColumn["Single Column Layout"]
TabletLayout --> TwoColumn["Two Column Layout"]
DesktopLayout --> MultiColumn["Multi Column Layout"]
SingleColumn --> TouchOptimized["Touch-Optimized Controls"]
TwoColumn --> BalancedView["Balanced View"]
MultiColumn --> FullFeatures["Full Feature Set"]
```

**Diagram sources**
- [app.inventory.tsx:324-476](file://src/routes/_authenticated/app.inventory.tsx#L324-L476)
- [app.inventory.tsx:492-520](file://src/routes/_authenticated/app.inventory.tsx#L492-L520)

**Section sources**
- [app.inventory.tsx:324-476](file://src/routes/_authenticated/app.inventory.tsx#L324-L476)
- [app.inventory.tsx:492-520](file://src/routes/_authenticated/app.inventory.tsx#L492-L520)

## Dependency Analysis
The inventory page depends on several libraries:

```mermaid
graph LR
INV["app.inventory.tsx"] --> P["products.ts"]
INV --> C["collections.ts"]
INV --> I["item-codes.ts"]
INV --> T["transfers.ts"]
INV --> V["validate.ts"]
INV --> PDF["pdf.ts"]
INV --> PG["paging.ts"]
```

**Diagram sources**
- [app.inventory.tsx:1-89](file://src/routes/_authenticated/app.inventory.tsx#L1-L89)
- [products.ts:1-107](file://src/lib/products.ts#L1-L107)
- [collections.ts:1-56](file://src/lib/collections.ts#L1-L56)
- [item-codes.ts:1-84](file://src/lib/item-codes.ts#L1-L84)
- [transfers.ts:1-140](file://src/lib/transfers.ts#L1-L140)
- [pdf.ts:1-412](file://src/lib/pdf.ts#L1-L412)
- [validate.ts:1-147](file://src/lib/validate.ts#L1-L147)
- [paging.ts:1-17](file://src/lib/paging.ts#L1-L17)

**Section sources**
- [app.inventory.tsx:1-89](file://src/routes/_authenticated/app.inventory.tsx#L1-L89)

## Performance Considerations
- Cached Catalog
  - The product catalog is cached for 30 minutes to keep scanning and search responsive without constant network calls.
- Selective Cost Loading
  - Buying costs are only fetched when screens explicitly request them and the user has permission, reducing payload size.
- Stock Polling
  - Stock queries can poll every 30 seconds in live mode (e.g., on the till) to reflect changes made elsewhere.
- Efficient Filtering and Sorting
  - Filtering, sorting, and totals are memoized and computed over cached data to avoid re-scanning on unrelated updates.
- Pagination
  - Large catalogs paginate rows to keep the UI responsive.
- Debounced Search
  - Search input is debounced to prevent excessive filtering operations during rapid typing.

## Troubleshooting Guide
- Duplicate SKU Errors
  - If a saved SKU clashes with an existing product, the UI detects the conflict client-side and shows an error message. Ensure the SKU is unique across the catalog.
- Invalid Amounts
  - Selling price, buying cost, quantity, and reorder point are validated with minimum/maximum bounds. Correct inputs to pass validation.
- Missing Barcode Match
  - If scanning does not resolve a product, verify that the SKU is present and normalized correctly. Check that the product is active.
- Stock Not Updating
  - After edits, ensure cache invalidation occurs for products, stock, movements, collections, and dash-alerts. Verify that the correct store context is active.
- CSV Import Issues
  - Validate CSV headers and data types. Use the provided template to ensure compatibility. Review parsed rows before applying changes.
- Filter Performance
  - If filters seem slow, check that the debounced search is working properly and that filters are being applied efficiently.
- Pagination Issues
  - If pagination appears broken, verify that the pageSlice utility is correctly clamping page numbers and that filter changes reset pagination appropriately.

**Section sources**
- [app.inventory.tsx:698-769](file://src/routes/_authenticated/app.inventory.tsx#L698-L769)
- [validate.ts:1-147](file://src/lib/validate.ts#L1-L147)

## Conclusion
The inventory management system provides a robust foundation for managing products, organizing them into collections, tracking stock per store, integrating barcodes, generating and validating item codes, and performing bulk import/export. The enhanced interface now includes advanced filtering capabilities, responsive pagination controls, comprehensive export functionality, integrated search with debounced input, and responsive design improvements across all screens. By leveraging cached queries, precise validation, explicit cache invalidation, and modern UI patterns, the system remains performant and reliable across devices and roles while providing an intuitive user experience for inventory management tasks.