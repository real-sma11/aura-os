import type { RouteObject } from "react-router-dom";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

export const bugReportsRoutes: RouteObject[] = [
  { path: "bug-reports", element: <ShellRoutePlaceholder title="Bug Reports" /> },
];
