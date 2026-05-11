import type { CSSProperties, ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";

export type ExplorerNodeWithSuffix = Omit<ExplorerNode, "children"> & {
  suffix?: ReactNode;
  /** Inline style applied to the rendered label text. Consumed by the
   *  `features/left-menu` renderer so per-project text customizations
   *  (e.g. name color from appearance settings) can flow through
   *  without LeftMenu having to know about the source. */
  labelStyle?: CSSProperties;
  children?: ExplorerNodeWithSuffix[];
};
