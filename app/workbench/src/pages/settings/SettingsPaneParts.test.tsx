// SettingsPaneParts behavior (#shadow coverage): the data-mode status card
// was removed in the data-mode surface shrink, which also deleted the only
// test that mounted this file. These live leaves (CLI discovery, state
// preview, agent deep-link) are still rendered by the settings UI, so their
// direct behavior stays asserted here. No DataMode UI is re-added.
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LocalCliDiscoveryManifest } from "@shared/platform";
import {
  AgentConfigLink,
  LocalCliDiscoveryStatus,
  StatePreviewSection,
} from "./SettingsPaneParts";

const cliManifest: LocalCliDiscoveryManifest = {
  mode: "no-spend-discovery",
  readinessManifest: "/tmp/agenthub/readiness.md",
  readinessScript: "/usr/local/bin/agenthub read",
  items: [
    { id: "codex", name: "Codex CLI", installed: true, version: "1.2.3", path: "/usr/bin/codex", noSpend: true },
    { id: "claude-code", name: "Claude Code", installed: false, version: null, path: "/usr/bin/claude", noSpend: false },
  ],
};

describe("SettingsPaneParts live leaves", () => {
  it("LocalCliDiscoveryStatus renders manifest meta and per-item rows", () => {
    render(<LocalCliDiscoveryStatus discovery={cliManifest} />);

    expect(screen.getByText("CLI 诊断")).toBeInTheDocument();
    expect(screen.getByText("发现模式")).toBeInTheDocument();
    expect(screen.getByText("no-spend-discovery")).toBeInTheDocument();
    expect(screen.getByText("就绪 manifest")).toBeInTheDocument();
    expect(screen.getByText("/tmp/agenthub/readiness.md")).toBeInTheDocument();
    expect(screen.getByText("就绪脚本")).toBeInTheDocument();
    expect(screen.getByText("/usr/local/bin/agenthub read")).toBeInTheDocument();

    expect(screen.getByText("Codex CLI")).toBeInTheDocument();
    expect(screen.getByText("version 1.2.3 · /usr/bin/codex")).toBeInTheDocument();
    expect(screen.getByText("installed · no-spend")).toBeInTheDocument();

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("version unknown · /usr/bin/claude")).toBeInTheDocument();
    expect(screen.getByText("missing · requires approval")).toBeInTheDocument();
  });

  it("AgentConfigLink renders its surface and invokes onOpen on click", () => {
    const onOpen = vi.fn();
    render(
      <AgentConfigLink
        title="打开配置"
        description="前往 Agent 配置文件夹"
        actionLabel="打开"
        ariaLabel="打开 Agent 配置"
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("region", { name: "打开 Agent 配置" })).toBeInTheDocument();
    expect(screen.getByText("打开配置")).toBeInTheDocument();
    expect(screen.getByText("前往 Agent 配置文件夹")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("StatePreviewSection renders the design-system state grid with disabled panels", () => {
    render(<StatePreviewSection />);

    expect(screen.getByText("Design System")).toBeInTheDocument();
    expect(screen.getByText("新建文档")).toBeInTheDocument();
    expect(screen.getByText("请求权限")).toBeInTheDocument();
    expect(screen.getByText("返回项目")).toBeInTheDocument();

    const previewButtons = screen.getAllByText(/新建文档|请求权限|返回项目/);
    previewButtons.forEach((node) => {
      expect(node).toBeDisabled();
    });
  });
});
