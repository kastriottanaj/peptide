/**
 * The sidebar icon and its unread badge.
 *
 * This component renders inside the admin's own navigation, on every page of
 * the application. That makes its failure behaviour more important than its
 * happy path: **a broken inbox must never break navigation.** So the tests here
 * are mostly about what it does when the request fails, and about it not
 * needing a react-query provider to exist at all.
 */

import { act, render, screen, waitFor } from "@testing-library/react";

import { InboxNavIcon } from "../nav-icon";

const realFetch = global.fetch;

function mockCounts(payload: unknown, ok = true) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });

  global.fetch = fetchMock as never;
  return fetchMock;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

describe("the badge", () => {
  it("shows the unread count once it loads", async () => {
    mockCounts({ unread_messages: 4 });

    render(<InboxNavIcon />);

    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(await screen.findByText("4 unread messages")).toBeInTheDocument();
  });

  it("shows nothing when there is nothing unread", async () => {
    const fetchMock = mockCounts({ unread_messages: 0 });

    render(<InboxNavIcon />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("caps a very large count", async () => {
    mockCounts({ unread_messages: 4_211 });

    render(<InboxNavIcon />);

    expect(await screen.findByText("99+")).toBeInTheDocument();
  });

  it("reads the count from the admin endpoint with the session cookie", async () => {
    const fetchMock = mockCounts({ unread_messages: 1 });

    render(<InboxNavIcon />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/inbox/counts",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("failure never breaks the sidebar", () => {
  it("renders the icon when the request fails", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("network"));
    global.fetch = fetchMock as never;

    const { container } = render(<InboxNavIcon />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText(/unread messages/)).not.toBeInTheDocument();
  });

  it("renders the icon on a non-200 answer", async () => {
    const fetchMock = mockCounts({}, false);

    const { container } = render(<InboxNavIcon />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("ignores a nonsense payload rather than rendering NaN", async () => {
    mockCounts({ unread_messages: "many" });

    const { container } = render(<InboxNavIcon />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.textContent).not.toContain("NaN");
  });

  /**
   * An admin tab left open overnight against a broken deploy must not spend the
   * night retrying.
   */
  it("stops polling after three consecutive failures", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockRejectedValue(new Error("network"));
    global.fetch = fetchMock as never;

    render(<InboxNavIcon />);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
    }

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("stops requesting once unmounted", async () => {
    const fetchMock = mockCounts({ unread_messages: 2 });
    const { unmount } = render(<InboxNavIcon />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    jest.useFakeTimers();
    await act(async () => {
      jest.advanceTimersByTime(300_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
