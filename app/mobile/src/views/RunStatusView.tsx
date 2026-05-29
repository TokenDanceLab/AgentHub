import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  GitPullRequestArrow,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "@agenthub/shared/components";
import type { StatusVariant } from "@agenthub/shared/components";
import type { Artifact, Preview, Run, RunStatus, ThreadItem } from "@agenthub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideApproval,
  getRun,
  getRunDiff,
  getRunLogs,
  listApprovals,
  listArtifacts,
  listPreviews,
  listRunItems,
} from "@agenthub/shared";
import { useTranslation } from "react-i18next";

interface RunStatusViewProps {
  run: Run;
  onBack: () => void;
}

type RunSection = "review" | "diff" | "blocks" | "outputs" | "logs";
type Decision = "approved" | "rejected";
type RunDiffFile = {
  path?: string;
  filePath?: string;
  diff?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  hunks?: Array<{ lines?: Array<{ content?: string; text?: string }> }>;
};

function runStatusToVariant(s: RunStatus): StatusVariant {
  switch (s) {
    case "queued": return "pending";
    case "starting": return "pending";
    case "running": return "running";
    case "waiting_approval": return "review";
    case "finished": return "done";
    case "failed": return "error";
    case "cancelled": return "offline";
    default: return "pending";
  }
}

function blockIcon(kind: ThreadItem["kind"]) {
  switch (kind) {
    case "approval": return ShieldAlert;
    case "diff": return GitPullRequestArrow;
    case "code": return Code2;
    case "file": return FileText;
    default: return TerminalSquare;
  }
}

function logRows(stdout?: string, stderr?: string) {
  const rows = [
    ...(stdout ?? "").split(/\r?\n/).filter(Boolean).map((line) => ({ source: "stdout", line })),
    ...(stderr ?? "").split(/\r?\n/).filter(Boolean).map((line) => ({ source: "stderr", line })),
  ];
  return rows.length ? rows : [{ source: "stdout", line: "Waiting for output..." }];
}

function diffFilePath(file: RunDiffFile) {
  return file.path ?? file.filePath ?? "changed file";
}

function diffFileText(file: RunDiffFile) {
  if (file.diff) return file.diff;
  const hunkText = file.hunks
    ?.flatMap((hunk) => hunk.lines ?? [])
    .map((line) => line.content ?? line.text ?? "")
    .filter(Boolean)
    .join("\n");
  return hunkText || `${file.status ?? "modified"} +${file.additions ?? 0} -${file.deletions ?? 0}`;
}

export function RunStatusView({ run, onBack }: RunStatusViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<RunSection>("review");
  const [logFilter, setLogFilter] = useState("All");
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [sheetError, setSheetError] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<Decision | null>(null);
  const [localDecisionStatus, setLocalDecisionStatus] = useState<Decision | null>(null);
  const [selectedResource, setSelectedResource] = useState<Artifact | Preview | null>(null);
  const [copiedResourceId, setCopiedResourceId] = useState<string | null>(null);
  const [copiedDetail, setCopiedDetail] = useState(false);

  const reviewRef = useRef<HTMLElement | null>(null);
  const diffRef = useRef<HTMLElement | null>(null);
  const blocksRef = useRef<HTMLElement | null>(null);
  const outputsRef = useRef<HTMLElement | null>(null);
  const logsRef = useRef<HTMLElement | null>(null);

  const runDetail = useQuery({
    queryKey: ["run", run.runId],
    queryFn: () => getRun(run.runId),
    refetchInterval: 5000,
  });
  const runItems = useQuery({ queryKey: ["run-items", run.runId], queryFn: () => listRunItems(run.runId) });
  const diff = useQuery({ queryKey: ["run-diff", run.runId], queryFn: () => getRunDiff(run.runId) });
  const logs = useQuery({ queryKey: ["run-logs", run.runId], queryFn: () => getRunLogs(run.runId) });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: listApprovals });
  const artifacts = useQuery({ queryKey: ["artifacts"], queryFn: listArtifacts });
  const previews = useQuery({ queryKey: ["previews"], queryFn: listPreviews });

  const approval = approvals.data?.items.find((item) => item.runId === run.runId);
  const decisionStatus = localDecisionStatus ?? approval?.status;
  const status = decisionStatus === "approved"
    ? "running"
    : decisionStatus === "rejected"
      ? "failed"
      : (runDetail.data?.status ?? run.status);
  const blocks = runItems.data?.items ?? [];
  const diffFiles = (diff.data?.files ?? []) as RunDiffFile[];
  const runArtifacts = artifacts.data?.items.filter((item) => item.runId === run.runId) ?? [];
  const runPreviews = previews.data?.items.filter((item) => item.runId === run.runId) ?? [];
  const resources = [...runArtifacts, ...runPreviews];
  const allLogRows = logRows(logs.data?.stdout, logs.data?.stderr);
  const filteredLogRows = useMemo(() => {
    if (logFilter === "All") return allLogRows;
    const needle = logFilter.toLowerCase();
    return allLogRows.filter((row) => row.source.toLowerCase().includes(needle) || row.line.toLowerCase().includes(needle));
  }, [allLogRows, logFilter]);

  const decision = useMutation({
    mutationFn: (nextDecision: Decision) => {
      if (!approval) throw new Error("Missing approval");
      return decideApproval(approval.id, { decision: nextDecision });
    },
    onSuccess: (_result, nextDecision) => {
      setSheetError(false);
      setDecisionNotice(nextDecision);
      setLocalDecisionStatus(nextDecision);
      setPendingDecision(null);
      queryClient.setQueryData<{ items: Run[] }>(["runs"], (current) => current
        ? {
            ...current,
            items: current.items.map((item) => item.runId === run.runId
              ? { ...item, status: nextDecision === "approved" ? "running" : "failed" }
              : item),
          }
        : current);
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", run.runId] });
    },
    onError: () => setSheetError(true),
  });

  function sectionRef(section: RunSection) {
    return { review: reviewRef, diff: diffRef, blocks: blocksRef, outputs: outputsRef, logs: logsRef }[section];
  }

  function jumpTo(section: RunSection) {
    setActiveSection(section);
    sectionRef(section).current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function copyResource(resource: Artifact | Preview) {
    const value = "path" in resource ? resource.path : resource.url ?? resource.id;
    await navigator.clipboard.writeText(value);
    setCopiedResourceId(resource.id);
    window.setTimeout(() => setCopiedResourceId(null), 1400);
  }

  async function copySelectedResource() {
    if (!selectedResource) return;
    const value = "path" in selectedResource ? selectedResource.path : selectedResource.url ?? selectedResource.id;
    await navigator.clipboard.writeText(value);
    setCopiedDetail(true);
  }

  return (
    <div className="mobileView">
      <header className="mobileHeader mobileChatHeader">
        <button onClick={onBack} className="mobileIconButton" type="button" aria-label={t("runDetail.actions.back")}>
          <ArrowLeft size={20} />
        </button>
        <div className="mobileHeaderTitle">
          <p className="mobileEyebrow">{t("runDetail.header.eyebrow")}</p>
          <h1>{t("runDetail.header.title", { runId: run.runId.slice(0, 8) })}</h1>
        </div>
        <div className="mobileStatusBadge">
          <StatusBadge status={runStatusToVariant(status)} />
        </div>
        {runDetail.isFetching && <RefreshCw size={14} className="mobileSpin" />}
      </header>

      <div className="mobileScroll mobileRunDetailScroll">
        <section className="mobileOverviewPanel">
          <p className="mobileEyebrow">{t("runDetail.context.eyebrow")}</p>
          <h2>{run.projectId}</h2>
          <div className="mobileMetricGrid">
            <button className="mobileMetricTile mobileSummaryShortcut" type="button" onClick={() => jumpTo("review")}>
              <strong>{decisionStatus === "approved" ? "Approved" : decisionStatus === "rejected" ? "Rejected" : "Review"}</strong>
              <span>{t("runDetail.summary.review")}</span>
            </button>
            <button className="mobileMetricTile mobileSummaryShortcut" type="button" onClick={() => jumpTo("blocks")} aria-label={`Blocks summary: ${blocks.length} items`}>
              <strong>{blocks.length}</strong>
              <span>{t("runDetail.summary.blocks")}</span>
            </button>
            <button className="mobileMetricTile mobileSummaryShortcut" type="button" onClick={() => jumpTo("outputs")}>
              <strong>{resources.length}</strong>
              <span>{t("runDetail.summary.outputs")}</span>
            </button>
          </div>
        </section>

        <nav className="mobileRunSectionNav" aria-label={t("runDetail.sections.aria")}>
          {(["review", "diff", "blocks", "outputs", "logs"] as RunSection[]).map((section) => (
            <button
              key={section}
              className={`mobileSegmentButton${activeSection === section ? " mobileSegmentButtonActive" : ""}`}
              type="button"
              onClick={() => jumpTo(section)}
            >
              {t(`runDetail.sections.${section}`)}
            </button>
          ))}
        </nav>

        <section className="mobileApprovalPanel" ref={reviewRef}>
          <p className="mobileEyebrow">{t("runDetail.sections.review")}</p>
          <h2>{approval?.summary ?? t("runDetail.review.pending")}</h2>
          <p>{decisionStatus === "approved" ? t("runDetail.review.approved") : decisionStatus === "rejected" ? t("runDetail.review.rejected") : t("runDetail.review.description")}</p>
          {decisionNotice && (
            <div className="mobileDecisionNotice" role="status">
              {decisionNotice === "approved"
                ? "Decision submitted. Hub marked this checkpoint approved."
                : "Decision submitted. Hub marked this checkpoint rejected."}
            </div>
          )}
          {decisionStatus && decisionStatus !== "pending" && (
            <div className="mobileDecisionLock">
              {decisionStatus === "approved" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span>{decisionStatus === "approved" ? "Checkpoint approved" : "Checkpoint rejected"}</span>
            </div>
          )}
          {decisionStatus && decisionStatus !== "pending" && (
            <button className="mobileActionButton" type="button" onClick={onBack}>Back to queue</button>
          )}
        </section>

        <section className="mobileDiffPanel" ref={diffRef}>
          <p className="mobileEyebrow">{t("runDetail.sections.diff")}</p>
          <h2>{t("runDetail.diff.title", { count: diffFiles.length })}</h2>
          {diffFiles.map((file) => (
            <article className="mobileDiffFile" key={diffFilePath(file)}>
              <strong>{diffFilePath(file)}</strong>
              <pre className="mobileDiffCode">{diffFileText(file)}</pre>
            </article>
          ))}
        </section>

        <section className="mobileRunBlocksPanel" ref={blocksRef}>
          <p className="mobileEyebrow">{t("runDetail.sections.blocks")}</p>
          <h2>{t("runDetail.blocks.title", { count: blocks.length })}</h2>
          <div className="mobileRunBlockList">
            {blocks.map((block, index) => {
              const Icon = blockIcon(block.kind);
              return (
                <article className="mobileRunBlock" key={block.id}>
                  <span className="mobileRunBlockIndex">{index + 1}</span>
                  <span className="mobileRunBlockIcon"><Icon size={16} /></span>
                  <span className="mobileRunBlockBody">
                    <strong>{block.kind}</strong>
                    <span>{block.content}</span>
                  </span>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mobileRunResourcesPanel" ref={outputsRef}>
          <p className="mobileEyebrow">{t("runDetail.sections.outputs")}</p>
          <h2>{t("runDetail.outputs.title", { count: resources.length })}</h2>
          {resources.map((resource) => {
            const isArtifact = "path" in resource;
            const label = isArtifact ? resource.path : resource.url ?? resource.id;
            return (
              <article className="mobileResourceRow" key={resource.id}>
                <span className="mobileRunBlockIcon">{isArtifact ? <FileText size={16} /> : <ExternalLink size={16} />}</span>
                <span className="mobileRunBlockBody">
                  <strong>{isArtifact ? "Artifact" : "Preview"}</strong>
                  <span>{label}</span>
                </span>
                <button className="mobileActionButton" type="button" onClick={() => void copyResource(resource)}>
                  <Copy size={15} />
                  <span>{copiedResourceId === resource.id ? "Copied" : "Copy"}</span>
                </button>
                <button className="mobileActionButton" type="button" aria-label={`Inspect ${label}`} onClick={() => { setCopiedDetail(false); setSelectedResource(resource); }}>
                  <Clipboard size={15} />
                  <span>Inspect</span>
                </button>
              </article>
            );
          })}
        </section>

        <section className="mobileLogPanel" ref={logsRef}>
          <p className="mobileEyebrow">{t("runDetail.sections.logs")}</p>
          <h2>{t("runDetail.logs.title")}</h2>
          <div className="mobileLogFilterBar">
            {["All", "Review", "Diff", "Mobile", "Error"].map((filter) => (
              <button
                className={`mobileLogFilterChip${logFilter === filter ? " mobileLogFilterChipActive" : ""}`}
                key={filter}
                type="button"
                onClick={() => setLogFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="mobileLogFrame">
            {filteredLogRows.map((row, index) => (
              <div className="mobileLogLine" key={`${row.source}-${index}`}>
                <span>{index + 1}</span>
                <strong>{row.source}</strong>
                <code>{row.line}</code>
              </div>
            ))}
          </div>
        </section>
      </div>

      {(!decisionStatus || decisionStatus === "pending") && (
        <div className="mobileReviewDock">
          <button className="mobileActionButton" type="button" onClick={() => { setSheetError(false); setPendingDecision("approved"); }}>
            <CheckCircle2 size={16} />
            <span>Approve</span>
          </button>
          <button className="mobileActionButton mobileDangerAction" type="button" onClick={() => { setSheetError(false); setPendingDecision("rejected"); }}>
            <XCircle size={16} />
            <span>Reject</span>
          </button>
        </div>
      )}

      {pendingDecision && (
        <div className="mobileSheetLayer" role="presentation">
          <button className="mobileSheetScrim" type="button" aria-label="Close approval decision" disabled={decision.isPending} onClick={() => setPendingDecision(null)} />
          <section className="mobileBottomSheet" role="dialog" aria-modal="true" aria-label="Confirm approval decision">
            <div className="mobileSheetHandle" aria-hidden="true" />
            <div className="mobileSheetHeader">
              <div>
                <p className="mobileEyebrow">{pendingDecision === "approved" ? "Approve" : "Reject"}</p>
                <h2>Confirm approval decision</h2>
              </div>
              <button className="mobileIconButton" type="button" disabled={decision.isPending} aria-label="Close approval decision" onClick={() => setPendingDecision(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="mobileSheetDescription">
              {pendingDecision === "approved" ? "Confirm approve for this checkpoint." : "Confirm reject for this checkpoint."}
            </p>
            <div className="mobileSignalRow" role="status" aria-live="polite">
              {decision.isPending ? <RefreshCw size={14} className="mobileSpin" /> : sheetError ? <XCircle size={14} /> : <ShieldAlert size={14} />}
              <span>
                {decision.isPending
                  ? "Submitting approval decision to Hub..."
                  : sheetError
                    ? "Decision was not submitted. Check Hub session and retry."
                    : "Ready to submit decision."}
              </span>
            </div>
            <div className="mobileSheetActions">
              <button className="mobileActionButton" type="button" disabled={decision.isPending} onClick={() => setPendingDecision(null)}>Cancel</button>
              <button
                className="mobileActionButton"
                type="button"
                disabled={decision.isPending}
                onClick={() => decision.mutate(pendingDecision)}
              >
                {decision.isPending && <RefreshCw size={16} className="mobileSpin" />}
                <span>{pendingDecision === "approved" ? "Confirm approve" : "Confirm reject"}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedResource && (
        <div className="mobileSheetLayer" role="presentation">
          <button className="mobileSheetScrim" type="button" aria-label="Close resource details" onClick={() => setSelectedResource(null)} />
          <section className="mobileBottomSheet" role="dialog" aria-modal="true" aria-label="Output resource details">
            <div className="mobileSheetHandle" aria-hidden="true" />
            <div className="mobileSheetHeader">
              <div>
                <p className="mobileEyebrow">Output</p>
                <h2>Output resource details</h2>
              </div>
              <button className="mobileIconButton" type="button" aria-label="Close resource details" onClick={() => setSelectedResource(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="mobileSheetDescription">{"path" in selectedResource ? selectedResource.path : selectedResource.url ?? selectedResource.id}</p>
            <div className="mobileSheetActions">
              <button className="mobileActionButton" type="button" onClick={() => void copySelectedResource()}>
                <Copy size={16} />
                <span>{copiedDetail ? "Copied" : "Copy path"}</span>
              </button>
              <button className="mobileActionButton" type="button" onClick={() => setSelectedResource(null)}>Close resource details</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
