import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapView } from "@/components/MapView";

const fake = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {};
  const map = {
    setView: vi.fn().mockReturnThis(),
    on: vi.fn((events: string, handler: () => void) => {
      for (const event of events.split(" ")) handlers[event] = handler;
    }),
    remove: vi.fn(),
  };
  return { map, handlers };
});
vi.mock("leaflet", () => ({
  map: () => fake.map,
  tileLayer: () => ({ addTo: vi.fn() }),
  layerGroup: () => ({ addTo() { return this; }, clearLayers: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(fake.handlers)) delete fake.handlers[key];
});
afterEach(cleanup);

describe("地图定位不打断浏览", () => {
  it("初次定位后，持续 GPS 更新不会拉回当前位置", async () => {
    const view = render(<MapView center={[24, 118]} />);
    await waitFor(() => expect(fake.map.setView).toHaveBeenCalledWith([24, 118], 13));
    fake.handlers.dragstart?.();
    view.rerender(<MapView center={[24.01, 118.01]} />);
    expect(fake.map.setView).toHaveBeenCalledTimes(1);
  });

  it("尚未操作地图时允许迟到的首次定位，但只定位一次", async () => {
    const view = render(<MapView center={null} />);
    await waitFor(() => expect(fake.map.setView).toHaveBeenCalledTimes(1));
    view.rerender(<MapView center={[25, 119]} />);
    expect(fake.map.setView).toHaveBeenLastCalledWith([25, 119]);
    view.rerender(<MapView center={[26, 120]} />);
    expect(fake.map.setView).toHaveBeenCalledTimes(2);
  });

  it.each(["dragstart", "zoomstart"])("%s 后首次定位也不会移动地图", async (event) => {
    const view = render(<MapView center={null} />);
    await waitFor(() => expect(fake.map.on).toHaveBeenCalled());
    fake.handlers[event]?.();
    view.rerender(<MapView center={[25, 119]} />);
    expect(fake.map.setView).toHaveBeenCalledTimes(1);
  });
});