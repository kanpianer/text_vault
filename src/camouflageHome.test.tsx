import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import App from "./App";

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("Camouflage Home Screen (404 Stealth Mode)", () => {
  beforeEach(() => {
    window.history.pushState({}, "Home", "/");
    vi.clearAllMocks();
  });

  it("default behavior: hides real home screen and displays only 404 error prompt with correct styles and no extra text", () => {
    const { container } = render(<App />);

    // 1. Must show 404 error prompt
    const camouflagePrompt = screen.getByText("404 Not Found");
    expect(camouflagePrompt).toBeInTheDocument();

    // 2. Background matches home black background (#090a0b) and text color matches home hint color (text-zinc-500)
    const camouflageContainer = camouflagePrompt.closest(".fixed");
    expect(camouflageContainer).toBeInTheDocument();
    expect(camouflageContainer?.className).toContain("bg-[#090a0b]");
    expect(camouflageContainer?.className).toContain("text-zinc-500");

    // 3. No extra descriptions on the camouflage screen
    expect(camouflageContainer?.textContent?.trim()).toBe("404 Not Found");

    // 4. Real home content (inputs, open button, branding) is completely hidden / not rendered
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("OPEN")).toBeNull();
    expect(screen.queryByText("End To End Encrypted Text")).toBeNull();
  });

  it("does not reveal real home when clicked fewer than 5 times", () => {
    render(<App />);

    const camouflage = screen.getByText("404 Not Found");

    // Click 4 times (one less than required 5)
    for (let i = 0; i < 4; i++) {
      fireEvent.click(camouflage);
    }

    // Still in 404 camouflage
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("does not reveal real home when 5 clicks take longer than 1.5 seconds (1500ms)", () => {
    const nowSpy = vi.spyOn(Date, "now");
    let fakeTime = 10000;
    nowSpy.mockImplementation(() => fakeTime);

    render(<App />);
    const camouflage = screen.getByText("404 Not Found");

    // 5 clicks with 500ms intervals = 2000ms total (> 1500ms limit)
    for (let i = 0; i < 5; i++) {
      fakeTime += 500;
      fireEvent.click(camouflage);
    }

    // Since the first clicks expired outside the 1.5s window, real home must remain hidden
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();

    nowSpy.mockRestore();
  });

  it("reveals real home screen when 5 clicks occur within 1.5 seconds (1500ms)", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    let fakeTime = 20000;
    nowSpy.mockImplementation(() => fakeTime);

    render(<App />);
    const camouflage = screen.getByText("404 Not Found");

    // 5 rapid clicks with 200ms intervals = 800ms total (< 1500ms limit)
    for (let i = 0; i < 5; i++) {
      fakeTime += 200;
      fireEvent.click(camouflage);
    }

    // Real home should now be revealed
    await waitFor(() => {
      expect(screen.getByText("End To End Encrypted Text")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(screen.getByText("OPEN")).toBeInTheDocument();
    });

    nowSpy.mockRestore();
  });

  it("allows entering vault name and navigating once real home is revealed", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ exists: false }),
      });
    });

    render(<App />);
    const camouflage = screen.getByText("404 Not Found");

    // Click 5 times rapidly
    for (let i = 0; i < 5; i++) {
      fireEvent.click(camouflage);
    }

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "myvault" } });
    expect(input).toHaveValue("myvault");

    const openBtn = screen.getByText("OPEN");
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByText(/Create Vault Password|UNLOCK THE VAULT/i)).toBeInTheDocument();
    });
  });

  it("ignores non-primary mouse buttons (e.g. right clicks)", () => {
    render(<App />);
    const camouflage = screen.getByText("404 Not Found");

    // Simulate 5 right-clicks (button = 2)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(camouflage, { button: 2 });
    }

    // Still hidden
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
