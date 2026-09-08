import { TaskPlanLine } from "@/features/collaboration/TaskPlanLine";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Plus,
  Upload,
  Download,
  Play,
  Trash2,
  Hand,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog";
import type { SavedWorkflow, WorkflowDefinition } from "@/types/workflow";
import type {
  TaskMode,
  TaskView,
  CollaborationTarget,
} from "@/types/collaboration-task";
import {
  workflowApi,
  workflowError,
  type WorkflowReview,
} from "@/api/workflow-api";
import { collaborationApi } from "@/api/collaboration-api";
import { isTaskFileStep } from "@/types/task-plan";
import { WorkflowDefinitionEditor } from "./WorkflowDefinitionEditor";
import { createWorkflow } from "./initial-definition";
import { policyReason } from "@/features/collaboration/policy-presentation";
import "@/features/collaboration/workflow-settings.css";
export function WorkflowLibrary({
  sessionId,
  hostId,
  connected,
  onCreated,
}: {
  sessionId: string;
  hostId?: number;
  connected: boolean;
  onCreated: (task: TaskView) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [dirty, setDirty] = useState(false),
    [closing, setClosing] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && dirty) setClosing(true);
        else setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <BookOpen size={14} />
          {t("tandem.workflow.library")}
        </Button>
      </DialogTrigger>
      <DialogContent className="tandem-settings-dialog tandem-workflow-dialog">
        <DialogHeader>
          <DialogTitle>{t("tandem.workflow.library")}</DialogTitle>
          <DialogDescription>
            {t("tandem.workflow.libraryHint")}
          </DialogDescription>
        </DialogHeader>
        {closing && (
          <div className="tandem-settings-confirm">
            <p>{t("tandem.workflow.discardHint")}</p>
            <Button
              variant="destructive"
              onClick={() => {
                setDirty(false);
                setClosing(false);
                setOpen(false);
              }}
            >
              {t("tandem.workflow.discard")}
            </Button>
            <Button variant="outline" onClick={() => setClosing(false)}>
              {t("tandem.workflow.keepEditing")}
            </Button>
          </div>
        )}
        {open && (
          <WorkflowLibraryBody
            sessionId={sessionId}
            hostId={hostId}
            connected={connected}
            onDirty={setDirty}
            onCreated={(task) => {
              setDirty(false);
              setOpen(false);
              onCreated(task);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
export function WorkflowLibraryBody({
  sessionId,
  hostId,
  connected,
  onCreated,
  onDirty,
}: {
  sessionId: string;
  hostId?: number;
  connected: boolean;
  onCreated: (task: TaskView) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.workflow." + key);
  const [items, setItems] = useState<SavedWorkflow[]>([]),
    [targets, setTargets] = useState<CollaborationTarget[]>([]),
    [selected, setSelected] = useState<SavedWorkflow>(),
    [definition, setDefinition] = useState<WorkflowDefinition>(createWorkflow),
    [bindings, setBindings] = useState<number[]>(hostId ? [hostId] : []),
    [dirty, setDirty] = useState(false),
    [mode, setMode] = useState<TaskMode>("collaborative"),
    [view, setView] = useState<"edit" | "run" | "export">("edit"),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [preview, setPreview] = useState<WorkflowReview>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<{ code: string; field?: string }>(),
    [exported, setExported] =
      useState<Awaited<ReturnType<typeof workflowApi.export>>>(),
    [ack, setAck] = useState(false),
    [imported, setImported] = useState(false),
    [remove, setRemove] = useState(false),
    [pending, setPending] = useState<() => void>(),
    [notice, setNotice] = useState<string>();
  const file = useRef<HTMLInputElement>(null),
    request = useRef<string>("");
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    const stop = new AbortController();
    Promise.all([
      workflowApi.list(stop.signal),
      collaborationApi.targets(stop.signal),
    ])
      .then(([rows, hosts]) => {
        if (!stop.signal.aborted) {
          setItems(rows);
          setTargets(hosts);
        }
      })
      .catch((e) => {
        if (!stop.signal.aborted) setError(workflowError(e));
      })
      .finally(() => {
        if (!stop.signal.aborted) setBusy(false);
      });
    return () => stop.abort();
  }, []);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        setPreview(undefined);
        setNotice(t("tandem.workflow.previewExpired"));
      },
      Math.max(0, preview.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview, t]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setError(workflowError(e));
    } finally {
      setBusy(false);
    }
  }
  function load(item?: SavedWorkflow) {
    setSelected(item);
    setDefinition(item ? structuredClone(item.definition) : createWorkflow());
    setBindings(item ? [...item.allowedHostIds] : hostId ? [hostId] : []);
    setDirty(false);
    setValues({});
    setPreview(undefined);
    setExported(undefined);
    setView("edit");
    setAck(false);
    setImported(false);
    setRemove(false);
    setError(undefined);
    setNotice(undefined);
  }
  function switchTo(action: () => void) {
    if (dirty) setPending(() => action);
    else action();
  }
  function changed(next: WorkflowDefinition) {
    setDefinition(next);
    setDirty(true);
    setPreview(undefined);
    setAck(false);
  }
  async function readImport(input: File) {
    if (input.size > 256000) throw Error("WORKFLOW_TOO_LARGE");
    const data = await workflowApi.inspect(JSON.parse(await input.text()));
    load();
    setDefinition(data.definition);
    setBindings(hostId ? [hostId] : []);
    setImported(true);
    setDirty(true);
    setNotice(w("importHint"));
  }
  const available =
    selected &&
    (!selected.allowedHostIds.length ||
      (!!hostId && selected.allowedHostIds.includes(hostId)));
  return (
    <div className="tandem-settings-body">
      <div className="tandem-settings-toolbar">
        <span className="tandem-settings-kicker">
          {w("savedCount")} {items.length}
        </span>
        <div className="tandem-settings-actions">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => switchTo(() => load())}
          >
            <Plus size={14} />
            {w("new")}
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => switchTo(() => file.current?.click())}
          >
            <Upload size={14} />
            {w("import")}
          </Button>
          <input
            ref={file}
            type="file"
            hidden
            accept=".json,application/json"
            aria-label={w("importFile")}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              if (chosen) void run(() => readImport(chosen));
            }}
          />
          <Button
            variant="outline"
            disabled={!connected}
            onClick={() => {
              void collaborationApi
                .takeover(sessionId)
                .then(() => {
                  setPreview(undefined);
                  setNotice(w("takenOver"));
                })
                .catch((e) => setError(workflowError(e)));
            }}
          >
            <Hand size={14} />
            {w("takeover")}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="tandem-settings-error">
          {t("tandem.workflow.errors." + error.code, {
            defaultValue: w("failed"),
          })}
          {error.field ? " · " + error.field : ""}
        </p>
      )}
      {notice && (
        <p role="status" className="tandem-settings-help">
          {notice}
        </p>
      )}
      {pending && (
        <div className="tandem-settings-confirm">
          <span>{w("discardHint")}</span>
          <Button
            variant="destructive"
            onClick={() => {
              const action = pending;
              setPending(undefined);
              action();
            }}
          >
            {w("discard")}
          </Button>
          <Button variant="outline" onClick={() => setPending(undefined)}>
            {w("keepEditing")}
          </Button>
        </div>
      )}
      <div className="tandem-settings-columns">
        <nav aria-label={w("list")} className="tandem-settings-list">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={selected?.id === item.id ? "selected" : ""}
                onClick={() => switchTo(() => load(item))}
              >
                <span>{item.definition.name}</span>
                <small>
                  {item.definition.category || w("uncategorized")} ·{" "}
                  {item.definition.version}
                </small>
                <small>
                  {item.definition.steps.length} {w("stepsCount")}
                </small>
              </button>
            ))
          ) : (
            <p className="tandem-settings-help">{w("empty")}</p>
          )}
        </nav>
        <div className="tandem-settings-editor">
          <div className="tandem-settings-tabs">
            {(["edit", "run", "export"] as const).map((tab) => (
              <Button
                key={tab}
                variant={view === tab ? "default" : "outline"}
                disabled={busy || (tab !== "edit" && (!selected || dirty))}
                onClick={() => {
                  setView(tab);
                  setError(undefined);
                  setAck(false);
                  setRemove(false);
                  if (tab === "export" && selected)
                    void run(async () =>
                      setExported(await workflowApi.export(selected.id)),
                    );
                }}
              >
                {w("tabs." + tab)}
              </Button>
            ))}
            {dirty && <span>{w("unsaved")}</span>}
          </div>
          {view === "edit" ? (
            <fieldset disabled={busy}>
              <WorkflowDefinitionEditor
                definition={definition}
                onChange={changed}
              />
              <section className="tandem-workflow-bindings">
                <h3>{w("bindings")}</h3>
                <p className="tandem-settings-help">{w("bindingsHint")}</p>
                <label className="tandem-settings-check">
                  <input
                    type="checkbox"
                    checked={!bindings.length}
                    onChange={(e) => {
                      setBindings(
                        e.target.checked
                          ? []
                          : hostId
                            ? [hostId]
                            : targets[0]
                              ? [targets[0].id]
                              : [],
                      );
                      setDirty(true);
                      setAck(false);
                    }}
                  />
                  {w("allOwnedHosts")}
                </label>
                {targets.map((target) => (
                  <label key={target.id} className="tandem-settings-check">
                    <input
                      type="checkbox"
                      checked={bindings.includes(target.id)}
                      onChange={(e) => {
                        if (!e.target.checked && bindings.length === 1) {
                          setError({ code: "SELECT_HOST_OR_ALL" });
                          return;
                        }
                        setBindings(
                          e.target.checked
                            ? [...bindings, target.id]
                            : bindings.filter((id) => id !== target.id),
                        );
                        setDirty(true);
                        setAck(false);
                      }}
                    />
                    {target.name}{" "}
                    <small>
                      {target.address}:{target.port}
                    </small>
                  </label>
                ))}
              </section>
              {imported && (
                <label className="tandem-settings-check">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {w("importAck")}
                </label>
              )}
              <div className="tandem-settings-save">
                <Button
                  disabled={!definition.name.trim() || (imported && !ack)}
                  onClick={() =>
                    void run(async () => {
                      const saved = await workflowApi.save({
                        id: selected?.id,
                        expectedRevision: selected?.revision,
                        definition,
                        allowedHostIds: bindings,
                      });
                      setItems((rows) => [
                        ...rows.filter((r) => r.id !== saved.id),
                        saved,
                      ]);
                      load(saved);
                      setNotice(w("saved"));
                    })
                  }
                >
                  {imported ? w("saveImport") : w("save")}
                </Button>
                {selected && (
                  <Button variant="ghost" onClick={() => setRemove(true)}>
                    <Trash2 size={14} />
                    {w("delete")}
                  </Button>
                )}
              </div>
              {remove && selected && (
                <div className="tandem-settings-confirm">
                  <span>{w("deleteHint")}</span>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      void run(async () => {
                        await workflowApi.remove(selected);
                        setItems((rows) =>
                          rows.filter((r) => r.id !== selected.id),
                        );
                        load();
                        setNotice(w("deleted"));
                      })
                    }
                  >
                    {w("confirmDelete")}
                  </Button>
                  <Button variant="outline" onClick={() => setRemove(false)}>
                    {w("cancel")}
                  </Button>
                </div>
              )}
            </fieldset>
          ) : view === "run" && selected ? (
            <fieldset disabled={busy}>
              <h3>{selected.definition.name}</h3>
              <p className="tandem-settings-help">
                {w("target")}:{" "}
                {targets.find((target) => target.id === hostId)?.name ??
                  w("disconnected")}
              </p>
              {Object.entries(selected.definition.parameters).map(
                ([name, spec]) => (
                  <label key={name}>
                    {name}
                    {spec.required ? " *" : ""}
                    <small>{spec.description}</small>
                    {spec.type === "secret-ref" ? (
                      <span className="tandem-settings-error">
                        {w("secretUnsupported")}
                      </span>
                    ) : spec.type === "boolean" || spec.type === "enum" ? (
                      <select
                        value={(() => {
                          const current = Object.hasOwn(values, name)
                            ? values[name]
                            : spec.default;
                          return current === undefined
                            ? ""
                            : spec.type === "boolean"
                              ? String(current)
                              : "value:" + String(current);
                        })()}
                        onChange={(e) => {
                          setValues({
                            ...values,
                            [name]:
                              e.target.value === ""
                                ? undefined
                                : spec.type === "boolean"
                                  ? e.target.value === "true"
                                  : e.target.value.slice(6),
                          });
                          setPreview(undefined);
                        }}
                      >
                        <option value="">{w("notProvided")}</option>
                        {spec.type === "boolean" ? (
                          <>
                            <option value="true">{w("true")}</option>
                            <option value="false">{w("false")}</option>
                          </>
                        ) : (
                          spec.values.map((v) => (
                            <option key={v} value={"value:" + v}>
                              {v || w("emptyValue")}
                            </option>
                          ))
                        )}
                      </select>
                    ) : (
                      <input
                        type={spec.type === "integer" ? "number" : "text"}
                        value={String(
                          Object.hasOwn(values, name)
                            ? (values[name] ?? "")
                            : "default" in spec
                              ? (spec.default ?? "")
                              : "",
                        )}
                        onChange={(e) => {
                          setValues({
                            ...values,
                            [name]:
                              spec.type === "integer"
                                ? e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value)
                                : e.target.value,
                          });
                          setPreview(undefined);
                        }}
                      />
                    )}
                  </label>
                ),
              )}
              <label>
                {w("mode")}
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as TaskMode);
                    setPreview(undefined);
                  }}
                >
                  <option value="collaborative">{w("collaborative")}</option>
                  <option value="automatic">{w("automatic")}</option>
                </select>
              </label>
              <p className="tandem-settings-help">{w("runHint")}</p>
              {!available && <p role="alert">{w("hostNotAllowed")}</p>}
              <Button
                disabled={!connected || !available}
                variant="outline"
                onClick={() =>
                  void run(async () => {
                    const result = await workflowApi.preview(
                      selected.id,
                      sessionId,
                      values,
                    );
                    request.current = crypto.randomUUID();
                    setPreview(result);
                  })
                }
              >
                {w("preview")}
              </Button>
              {preview && (
                <section className="tandem-workflow-preview">
                  <h3>{w("reviewTitle")}</h3>
                  <p>
                    {w("previewRevision")} {preview.revision} ·{" "}
                    {w("policyRevision")} {preview.policyRevision}
                  </p>
                  <ol>
                    {(preview.plan ?? preview.commands).map((command, i) => (
                      <li key={i}>
                        <div className="tandem-settings-toolbar">
                          <strong>
                            {i + 1}. {command.name}
                          </strong>
                          <span
                            className={
                              "tandem-policy-badge " +
                              preview.decisions[i]?.outcome
                            }
                          >
                            {t(
                              "tandem.policy.outcome." +
                                preview.decisions[i]?.outcome,
                            )}
                          </span>
                        </div>
                        <TaskPlanLine step={command} />
                        <small>
                          {!isTaskFileStep(command) && (
                            <>
                              {command.cwd ?? w("resolvedAtAuthorization")}{" "}
                              ·{" "}
                            </>
                          )}
                          {(command.timeoutMs ?? 120000) / 1000}s ·{" "}
                          {command.onFailure === "continue"
                            ? w("continue")
                            : w("stop")}
                        </small>
                        {preview.decisions[i]?.reasons.length > 0 && (
                          <p>
                            {preview.decisions[i].reasons
                              .map((reason) => policyReason(reason, t))
                              .join(" · ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                  {preview.warnings.map((warning, i) => (
                    <p className="tandem-settings-help" key={i}>
                      {t("tandem.workflow.warnings." + warning.split(":")[0], {
                        defaultValue: warning,
                      })}
                      {warning.includes(":")
                        ? " · " + warning.split(":").slice(1).join(":")
                        : ""}
                    </p>
                  ))}
                  <Button
                    disabled={
                      preview.decisions.some(
                        (decision) => decision.outcome === "deny",
                      ) || Date.now() >= preview.expiresAt
                    }
                    onClick={() =>
                      void run(async () => {
                        const task = await workflowApi.start(
                          preview.id,
                          request.current,
                          mode,
                        );
                        onCreated(task);
                      })
                    }
                  >
                    <Play size={14} />
                    {w("createTask")}
                  </Button>
                  <p className="tandem-settings-help">
                    {w("authorizationNext")}
                  </p>
                </section>
              )}
            </fieldset>
          ) : view === "export" && exported ? (
            <fieldset disabled={busy}>
              <p>{w("exportHint")}</p>
              {exported.warnings.map((warning) => (
                <p key={warning} className="tandem-settings-help">
                  {t("tandem.workflow.warnings." + warning, {
                    defaultValue: warning,
                  })}
                </p>
              ))}
              <pre className="tandem-workflow-export">
                {JSON.stringify(exported.definition, null, 2)}
              </pre>
              <label className="tandem-settings-check">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {w("exportAck")}
              </label>
              <Button
                disabled={!ack}
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [JSON.stringify(exported.definition, null, 2) + "\n"],
                      { type: "application/json" },
                    ),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download =
                    exported.definition.id +
                    "-" +
                    exported.definition.version +
                    ".json";
                  a.style.display = "none";
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    a.remove();
                    URL.revokeObjectURL(url);
                  }, 1000);
                  setNotice(w("exportStarted"));
                }}
              >
                <Download size={14} />
                {w("download")}
              </Button>
            </fieldset>
          ) : null}
        </div>
      </div>
    </div>
  );
}
