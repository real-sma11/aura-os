import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { FeedbackFilters } from "./FeedbackFilters";
import { normalizeSort } from "../../../api/marketing/feedback";

function FiltersHarness(): React.ReactNode {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const sort = normalizeSort(searchParams.get("sort"));
  return (
    <>
      <FeedbackFilters sort={sort} category={null} status={null} />
      <div data-testid="location-search">{location.search}</div>
    </>
  );
}

function renderFilters() {
  return render(
    <MemoryRouter initialEntries={["/feedback"]}>
      <Routes>
        <Route path="/feedback" element={<FiltersHarness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FeedbackFilters", () => {
  it("updates the URL search when a sort row is clicked", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.click(screen.getByRole("button", { name: /Most Popular/i }));

    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "?sort=popular",
    );
  });
});