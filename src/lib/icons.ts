/**
 * Storq's icon surface — one line per glyph, each backed by its own module.
 *
 * `@hugeicons/core-free-icons` exposes ~6 000 glyphs from a single barrel. A
 * production build tree-shakes that down to what we use, but a dev server cannot:
 * Vite pre-bundles the whole barrel, so every page load pulled 7.4 MB of
 * unmangled JavaScript (20 MB with its source map). Importing each glyph from its
 * own subpath keeps the dev graph to a few kilobytes and the browser stops
 * waiting on icons before it can paint.
 *
 * Import from here, never from the barrel directly, so that stays true:
 *   import { PlusSignIcon } from "@/lib/icons";
 */

export { default as Alert02Icon } from "@hugeicons/core-free-icons/Alert02Icon";
export { default as Archive01Icon } from "@hugeicons/core-free-icons/Archive01Icon";
export { default as ArrowLeft01Icon } from "@hugeicons/core-free-icons/ArrowLeft01Icon";
export { default as ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
export { default as ArrowRight01Icon } from "@hugeicons/core-free-icons/ArrowRight01Icon";
export { default as ArrowUpRight01Icon } from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
export { default as BankIcon } from "@hugeicons/core-free-icons/BankIcon";
export { default as BanknoteIcon } from "@hugeicons/core-free-icons/BanknoteIcon";
export { default as BarChartIcon } from "@hugeicons/core-free-icons/BarChartIcon";
export { default as BoxesIcon } from "@hugeicons/core-free-icons/BoxesIcon";
export { default as CalculatorIcon } from "@hugeicons/core-free-icons/CalculatorIcon";
export { default as Camera01Icon } from "@hugeicons/core-free-icons/Camera01Icon";
export { default as Cancel01Icon } from "@hugeicons/core-free-icons/Cancel01Icon";
export { default as ChartLineData01Icon } from "@hugeicons/core-free-icons/ChartLineData01Icon";
export { default as CookieIcon } from "@hugeicons/core-free-icons/CookieIcon";
export { default as Copy01Icon } from "@hugeicons/core-free-icons/Copy01Icon";
export { default as CreditCardIcon } from "@hugeicons/core-free-icons/CreditCardIcon";
export { default as DashboardSquare01Icon } from "@hugeicons/core-free-icons/DashboardSquare01Icon";
export { default as Delete02Icon } from "@hugeicons/core-free-icons/Delete02Icon";
export { default as Download01Icon } from "@hugeicons/core-free-icons/Download01Icon";
export { default as File01Icon } from "@hugeicons/core-free-icons/File01Icon";
export { default as FilterIcon } from "@hugeicons/core-free-icons/FilterIcon";
export { default as FlashIcon } from "@hugeicons/core-free-icons/FlashIcon";
export { default as GridViewIcon } from "@hugeicons/core-free-icons/GridViewIcon";
export { default as Logout02Icon } from "@hugeicons/core-free-icons/Logout02Icon";
export { default as LanguagesIcon } from "@hugeicons/core-free-icons/LanguagesIcon";
export { default as MinusSignIcon } from "@hugeicons/core-free-icons/MinusSignIcon";
export { default as MoneyBag02Icon } from "@hugeicons/core-free-icons/MoneyBag02Icon";
export { default as MoreHorizontalIcon } from "@hugeicons/core-free-icons/MoreHorizontalIcon";
export { default as Note01Icon } from "@hugeicons/core-free-icons/Note01Icon";
export { default as NoteEditIcon } from "@hugeicons/core-free-icons/NoteEditIcon";
export { default as Notification01Icon } from "@hugeicons/core-free-icons/Notification01Icon";
export { default as PackageIcon } from "@hugeicons/core-free-icons/PackageIcon";
export { default as PauseIcon } from "@hugeicons/core-free-icons/PauseIcon";
export { default as PercentIcon } from "@hugeicons/core-free-icons/PercentIcon";
export { default as PlusSignIcon } from "@hugeicons/core-free-icons/PlusSignIcon";
export { default as PrinterIcon } from "@hugeicons/core-free-icons/PrinterIcon";
export { default as QrCode01Icon } from "@hugeicons/core-free-icons/QrCode01Icon";
export { default as ReceiptIcon } from "@hugeicons/core-free-icons/ReceiptIcon";
export { default as Refresh01Icon } from "@hugeicons/core-free-icons/Refresh01Icon";
export { default as Search01Icon } from "@hugeicons/core-free-icons/Search01Icon";
export { default as Settings01Icon } from "@hugeicons/core-free-icons/Settings01Icon";
export { default as Share01Icon } from "@hugeicons/core-free-icons/Share01Icon";
export { default as ShieldCheckIcon } from "@hugeicons/core-free-icons/ShieldCheckIcon";
export { default as ShoppingBag01Icon } from "@hugeicons/core-free-icons/ShoppingBag01Icon";
export { default as ShoppingCart01Icon } from "@hugeicons/core-free-icons/ShoppingCart01Icon";
export { default as Simcard01Icon } from "@hugeicons/core-free-icons/Simcard01Icon";
export { default as SmartPhone01Icon } from "@hugeicons/core-free-icons/SmartPhone01Icon";
export { default as Tick01Icon } from "@hugeicons/core-free-icons/Tick01Icon";
export { default as Tick02Icon } from "@hugeicons/core-free-icons/Tick02Icon";
export { default as UserIcon } from "@hugeicons/core-free-icons/UserIcon";
export { default as UserMultipleIcon } from "@hugeicons/core-free-icons/UserMultipleIcon";
export { default as UserPlusIcon } from "@hugeicons/core-free-icons/UserPlusIcon";
export { default as ViewIcon } from "@hugeicons/core-free-icons/ViewIcon";
export { default as ViewOffIcon } from "@hugeicons/core-free-icons/ViewOffIcon";
export { default as Wallet01Icon } from "@hugeicons/core-free-icons/Wallet01Icon";

// Three names we use only exist as aliases inside the barrel, so they have no
// module of that exact spelling; each points at the glyph file it resolved to.
export { default as SquareLockIcon } from "@hugeicons/core-free-icons/SquareLock01Icon";
export { default as StoreIcon } from "@hugeicons/core-free-icons/Store01Icon";
export { default as WifiOffIcon } from "@hugeicons/core-free-icons/WifiOff01Icon";
