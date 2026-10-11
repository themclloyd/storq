import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Component tests mount into document.body; drop them between files so a
// leftover dialog cannot satisfy another test's query.
afterEach(() => cleanup());
