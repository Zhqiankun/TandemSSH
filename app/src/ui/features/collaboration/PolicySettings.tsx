import { FilePolicyEditor } from "./FileScopes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Plus, Trash2, Hand } from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog";
import type {
  CommandPolicySet,
  CommandPolicySnapshot,
  CommandRule,
} from "@/types/collaboration-operations";
import { policyApi } from "@/api/policy-api";
import { workflowError } from "@/api/workflow-api";
import type { CollaborationTarget } from "@/types/collaboration-task";
import { collaborationApi } from "@/api/collaboration-api";
import { policyReason } from "./policy-presentation";
import { parseCommandPlan, displayCommand } from "./command-plan";
import "./workflow-settings.css";
export function PolicySettings({
  sessionId,
  taskId,
  hostId,
}: {
  sessionId: string;
  taskId?: string;
  hostId?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Shield size={14} />
          {t("tandem.policy.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="tandem-settings-dialog">
        <DialogHeader>
          <DialogTitle>{t("tandem.policy.title")}</DialogTitle>
          <DialogDescription>
            {t("tandem.policy.description")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PolicyEditor sessionId={sessionId} taskId={taskId} hostId={hostId} />
        )}
      </DialogContent>
    </Dialog>
  );
}
export function PolicyEditor({
  sessionId,
  taskId,
  hostId,
}: {
  sessionId: string;
  taskId?: string;
  hostId?: number;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.policy." + key);
  const [snapshot, setSnapshot] = useState<CommandPolicySnapshot>(),
    [sets, setSets] = useState<CommandPolicySet[]>([]),
    [targets, setTargets] = useState<CollaborationTarget[]>([]),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false),
    [trial, setTrial] = useState<Awaited<ReturnType<typeof policyApi.trial>>>(),
    [line, setLine] = useState("pwd"),
    [cwd, setCwd] = useState("/");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const stop = new AbortController();
    Promise.all([
      policyApi.read(stop.signal),
      collaborationApi.targets(stop.signal),
    ])
      .then(([value, hosts]) => {
        if (!stop.signal.aborted) {
          setSnapshot(value);
          setSets(value.sets);
          setTargets(hosts);
        }
      })
      .catch((e) => {
        if (!stop.signal.aborted) setError(workflowError(e).code);
      })
      .finally(() => {
        if (!stop.signal.aborted) setBusy(false);
      });
    return () => stop.abort();
  }, []);
  function change(next: CommandPolicySet[]) {
    setSets(next);
    setTrial(undefined);
    setSaved(false);
    setAck(false);
  }
  const current = sets[selected];
  function update(patch: Partial<CommandPolicySet>) {
    change(sets.map((set, i) => (i === selected ? { ...set, ...patch } : set)));
  }
  function rule(index: number, patch: Partial<CommandRule>) {
    if (current)
      update({
        rules: current.rules.map((r, i) =>
          i === index ? { ...r, ...patch } : r,
        ),
      });
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(workflowError(e).code);
    } finally {
      setBusy(false);
    }
  }
  const groups = [...new Set(targets.flatMap((target) => target.groups))];
  return (
    <div className="tandem-settings-body">
      <div className="tandem-settings-toolbar">
        <span>
          {snapshot ? w("revision") + " " + snapshot.revision : w("loading")}
        </span>
        <Button
          disabled={busy || !snapshot || sets.length >= 64}
          variant="outline"
          onClick={() => {
            change([
              ...sets,
              {
                id: crypto.randomUUID(),
                scope: { type: "global" },
                strictAllowlist: false,
                rules: [],
              },
            ]);
            setSelected(sets.length);
          }}
        >
          <Plus size={14} />
          {w("addSet")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void collaborationApi
              .takeover(sessionId)
              .then(() => setTrial(undefined))
              .catch((e) => setError(workflowError(e).code));
          }}
        >
          <Hand size={14} />
          {t("tandem.workflow.takeover")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="tandem-settings-error">
          {t("tandem.workflow.errors." + error, { defaultValue: w("failed") })}
        </p>
      )}
      <div className="tandem-settings-columns">
        <nav aria-label={w("sets")} className="tandem-settings-list">
          {sets.map((set, i) => (
            <button
              key={set.id}
              className={i === selected ? "selected" : ""}
              disabled={busy}
              onClick={() => setSelected(i)}
            >
              <span>{w("scope." + set.scope.type)}</span>
              <small>
                {set.scope.type === "host"
                  ? (targets.find(
                      (h) =>
                        String(h.id) ===
                        ("id" in set.scope ? set.scope.id : ""),
                    )?.name ?? set.scope.id)
                  : set.scope.type === "global"
                    ? w("allHosts")
                    : set.scope.id}
              </small>
              <small>
                {set.rules.length} {w("rulesCount")}
              </small>
            </button>
          ))}
        </nav>
        <fieldset disabled={busy} className="tandem-settings-editor">
          {current ? (
            <>
              <div className="tandem-settings-row">
                <label>
                  {w("scopeLabel")}
                  <select
                    value={current.scope.type}
                    onChange={(e) => {
                      const type = e.target
                        .value as CommandPolicySet["scope"]["type"];
                      update({
                        scope:
                          type === "global"
                            ? { type }
                            : {
                                type,
                                id:
                                  type === "host"
                                    ? String(hostId ?? targets[0]?.id ?? "")
                                    : type === "task"
                                      ? (taskId ?? "")
                                      : (groups[0] ?? ""),
                              },
                      });
                    }}
                  >
                    {["global", "group", "host", "task"].map((type) => (
                      <option key={type} value={type}>
                        {w("scope." + type)}
                      </option>
                    ))}
                  </select>
                </label>
                {current.scope.type === "host" ? (
                  <label>
                    {w("target")}
                    <select
                      value={current.scope.id}
                      onChange={(e) =>
                        update({ scope: { type: "host", id: e.target.value } })
                      }
                    >
                      <option value="">{w("chooseHost")}</option>
                      {targets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name} · {target.address}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : current.scope.type !== "global" ? (
                  <label>
                    {current.scope.type === "group" ? w("group") : w("task")}
                    <input
                      list={
                        current.scope.type === "group"
                          ? "tandem-policy-groups"
                          : undefined
                      }
                      value={current.scope.id}
                      onChange={(e) =>
                        update({
                          scope: {
                            type: current.scope.type as "group" | "task",
                            id: e.target.value,
                          },
                        })
                      }
                    />
                    <datalist id="tandem-policy-groups">
                      {groups.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </label>
                ) : null}
              </div>
              <label className="tandem-settings-check">
                <input
                  type="checkbox"
                  checked={current.strictAllowlist}
                  onChange={(e) =>
                    update({ strictAllowlist: e.target.checked })
                  }
                />
                {w("strict")}
              </label>
              <p className="tandem-settings-help">{w("strictHint")}</p>
              <FilePolicyEditor
                rules={current.fileRules ?? []}
                strict={!!current.strictFileAllowlist}
                onChange={update}
              />
              {current.rules.map((item, i) => (
                <section
                  className={"tandem-policy-rule " + item.effect}
                  key={item.id}
                >
                  <div className="tandem-settings-row">
                    <label>
                      {w("effectLabel")}
                      <select
                        value={item.effect}
                        onChange={(e) =>
                          rule(i, {
                            effect: e.target.value as CommandRule["effect"],
                          })
                        }
                      >
                        {["deny", "confirm", "allow"].map((effect) => (
                          <option key={effect} value={effect}>
                            {w("effect." + effect)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {w("matching")}
                      <select
                        value={item.match.kind}
                        onChange={(e) =>
                          rule(i, {
                            match:
                              e.target.value === "program"
                                ? {
                                    kind: "program",
                                    program: item.match.program,
                                  }
                                : {
                                    kind: "program-args",
                                    program: item.match.program,
                                    args: [],
                                  },
                          })
                        }
                      >
                        <option value="program">{w("programOnly")}</option>
                        <option value="program-args">
                          {w("exactArguments")}
                        </option>
                      </select>
                    </label>
                    <Button
                      variant="ghost"
                      aria-label={w("removeRule")}
                      onClick={() =>
                        update({
                          rules: current.rules.filter((_, n) => n !== i),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  <label>
                    {w("program")}
                    <input
                      value={item.match.program}
                      onChange={(e) =>
                        rule(i, {
                          match: { ...item.match, program: e.target.value },
                        })
                      }
                      maxLength={1024}
                    />
                  </label>
                  {item.match.kind === "program-args" && (
                    <div>
                      <p className="tandem-settings-help">
                        {w("argumentHint")}
                      </p>
                      {item.match.args.map((arg, j) => (
                        <div className="tandem-settings-row" key={j}>
                          <label>
                            {w("argument")} {j + 1}
                            <textarea
                              rows={1}
                              value={arg}
                              onChange={(e) => {
                                if (item.match.kind === "program-args")
                                  rule(i, {
                                    match: {
                                      ...item.match,
                                      args: item.match.args.map((a, k) =>
                                        k === j ? e.target.value : a,
                                      ),
                                    },
                                  });
                              }}
                            />
                          </label>
                          <Button
                            variant="ghost"
                            aria-label={w("removeArgument")}
                            onClick={() => {
                              if (item.match.kind === "program-args")
                                rule(i, {
                                  match: {
                                    ...item.match,
                                    args: item.match.args.filter(
                                      (_, k) => k !== j,
                                    ),
                                  },
                                });
                            }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (item.match.kind === "program-args")
                            rule(i, {
                              match: {
                                ...item.match,
                                args: [...item.match.args, ""],
                              },
                            });
                        }}
                      >
                        {w("addArgument")}
                      </Button>
                    </div>
                  )}
                  <label>
                    {w("reason")}
                    <input
                      value={item.reason}
                      onChange={(e) => rule(i, { reason: e.target.value })}
                      maxLength={2000}
                    />
                  </label>
                </section>
              ))}
              <div className="tandem-settings-toolbar">
                <Button
                  variant="outline"
                  disabled={current.rules.length >= 256}
                  onClick={() =>
                    update({
                      rules: [
                        ...current.rules,
                        {
                          id: crypto.randomUUID(),
                          effect: "deny",
                          match: { kind: "program", program: "" },
                          reason: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {w("addRule")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    change(sets.filter((_, i) => i !== selected));
                    setSelected(Math.max(0, selected - 1));
                  }}
                >
                  {w("removeSet")}
                </Button>
              </div>
            </>
          ) : (
            <p>{w("empty")}</p>
          )}
        </fieldset>
      </div>
      <fieldset disabled={busy} className="tandem-settings-trial">
        <h3>{w("trialTitle")}</h3>
        <p className="tandem-settings-help">{w("trialHint")}</p>
        <div className="tandem-settings-row">
          <label>
            {w("trialCommand")}
            <input
              value={line}
              onChange={(e) => {
                setLine(e.target.value);
                setTrial(undefined);
              }}
            />
          </label>
          <label>
            {w("directory")}
            <input
              value={cwd}
              onChange={(e) => {
                setCwd(e.target.value);
                setTrial(undefined);
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={!snapshot}
            onClick={() =>
              void run(async () => {
                const parsed = parseCommandPlan(line);
                if (parsed.length !== 1) throw Error("ONE_COMMAND_REQUIRED");
                setTrial(
                  await policyApi.trial({
                    sessionId,
                    taskId,
                    sets,
                    command: { ...parsed[0], cwd },
                  }),
                );
              })
            }
          >
            {w("trial")}
          </Button>
        </div>
        {trial && (
          <div
            role="status"
            className={"tandem-policy-result " + trial.decision.outcome}
          >
            <strong>{w("outcome." + trial.decision.outcome)}</strong>
            <code>{displayCommand(trial.action)}</code>
            <p>
              {trial.decision.reasons
                .map((reason) =>
                  policyReason(reason, t, (id) => {
                    const set = sets.find((set) => set.id === id);
                    if (!set) return id;
                    const scope = set.scope;
                    const label = w("scope." + scope.type);
                    if (scope.type === "global") return label;
                    const name =
                      scope.type === "host"
                        ? (targets.find(
                            (target) => String(target.id) === scope.id,
                          )?.name ?? scope.id)
                        : scope.id;
                    return label + " · " + name;
                  }),
                )
                .join(" · ")}
            </p>
            <small>
              {w("matched")}{" "}
              {trial.decision.matchedRules.length
                ? trial.decision.matchedRules
                    .map((id) => {
                      for (const set of sets) {
                        const rule = set.rules.find(
                          (rule) => set.id + "/" + rule.id === id,
                        );
                        if (rule)
                          return (
                            w("scope." + set.scope.type) +
                            " · " +
                            rule.match.program +
                            " · " +
                            w("effect." + rule.effect)
                          );
                      }
                      return w("none");
                    })
                    .join("；")
                : w("none")}
            </small>
          </div>
        )}
      </fieldset>
      <div className="tandem-settings-save">
        <label className="tandem-settings-check">
          <input
            type="checkbox"
            checked={ack}
            disabled={busy}
            onChange={(e) => setAck(e.target.checked)}
          />
          {w("saveHint")}
        </label>
        <Button
          disabled={busy || !snapshot || !ack}
          onClick={() =>
            void run(async () => {
              const result = await policyApi.save(snapshot!.revision, sets);
              setSnapshot(result);
              setSets(result.sets);
              setSaved(true);
              setAck(false);
              setTrial(undefined);
            })
          }
        >
          {w("save")}
        </Button>
        {saved && <span role="status">{w("saved")}</span>}
      </div>
    </div>
  );
}
