import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/button";
import type {
  WorkflowDefinition,
  WorkflowArgument,
  WorkflowParameter,
  WorkflowValue,
} from "@/types/workflow";
export function WorkflowValueEditor({
  value,
  onChange,
  parameters,
  label,
  directory = false,
}: {
  value: WorkflowArgument | undefined;
  onChange: (value: WorkflowArgument) => void;
  parameters: WorkflowDefinition["parameters"];
  label: string;
  directory?: boolean;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.workflow." + key);
  const selected = typeof value === "object" ? value.param : "";
  return (
    <div className="tandem-workflow-value">
      <label>
        {label}
        <select
          aria-label={label + " · " + w("valueType")}
          value={selected}
          onChange={(e) => {
            const key = e.target.value;
            if (!key) onChange("");
            else if (parameters[key]?.type === "boolean")
              onChange({ param: key, whenTrue: [], whenFalse: [] });
            else onChange({ param: key });
          }}
        >
          <option value="">{w("literal")}</option>
          {Object.entries(parameters)
            .filter(([, p]) => !directory || p.type === "remote-directory")
            .map(([key]) => (
              <option key={key} value={key}>
                {w("parameter")} · {key}
              </option>
            ))}
          {selected && !Object.hasOwn(parameters, selected) && (
            <option value={selected}>
              {w("missingParameter")} · {selected}
            </option>
          )}
        </select>
      </label>
      {typeof value !== "object" ? (
        <label>
          <span className="sr-only">{label}</span>
          <textarea
            rows={1}
            value={value ?? ""}
            placeholder={directory ? w("inheritDirectory") : undefined}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : "whenTrue" in value ? (
        <div className="tandem-settings-row">
          <label>
            {w("whenTrue")}
            <textarea
              rows={2}
              value={value.whenTrue.join("\n")}
              onChange={(e) =>
                onChange({
                  ...value,
                  whenTrue:
                    e.target.value === "" ? [] : e.target.value.split("\n"),
                })
              }
            />
          </label>
          <label>
            {w("whenFalse")}
            <textarea
              rows={2}
              value={value.whenFalse.join("\n")}
              onChange={(e) =>
                onChange({
                  ...value,
                  whenFalse:
                    e.target.value === "" ? [] : e.target.value.split("\n"),
                })
              }
            />
          </label>
        </div>
      ) : (
        <span className="tandem-workflow-ref">{selected}</span>
      )}
    </div>
  );
}
export function WorkflowDefinitionEditor({
  definition,
  onChange,
}: {
  definition: WorkflowDefinition;
  onChange: (next: WorkflowDefinition) => void;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.workflow." + key);
  const [parameterName, setParameterName] = useState(""),
    [parameterType, setParameterType] =
      useState<WorkflowParameter["type"]>("string"),
    [newEnv, setNewEnv] = useState("");
  const set = (patch: Partial<WorkflowDefinition>) =>
    onChange({ ...definition, ...patch });
  function param(name: string, next: WorkflowParameter) {
    set({ parameters: { ...definition.parameters, [name]: next } });
  }
  function makeParam(type: WorkflowParameter["type"]): WorkflowParameter {
    return type === "enum" ? { type, values: [""] } : { type };
  }
  function updateStep(
    index: number,
    patch: Partial<WorkflowDefinition["steps"][number]>,
  ) {
    set({
      steps: definition.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      ),
    });
  }
  function move(index: number, direction: number) {
    const steps = [...definition.steps];
    [steps[index], steps[index + direction]] = [
      steps[index + direction],
      steps[index],
    ];
    set({ steps });
  }
  function argument(index: number, n: number, value: WorkflowArgument) {
    const step = definition.steps[index];
    updateStep(index, {
      action: {
        ...step.action,
        args: (step.action.args ?? []).map((arg, i) => (i === n ? value : arg)),
      },
    });
  }
  return (
    <div className="tandem-workflow-definition">
      <div className="tandem-settings-row">
        <label>
          {w("name")}
          <input
            required
            maxLength={120}
            value={definition.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label>
          {w("version")}
          <input
            required
            value={definition.version}
            onChange={(e) => set({ version: e.target.value })}
          />
        </label>
        <label>
          {w("category")}
          <input
            value={definition.category ?? ""}
            maxLength={120}
            onChange={(e) => set({ category: e.target.value })}
          />
        </label>
      </div>
      <label>
        {w("description")}
        <textarea
          rows={2}
          maxLength={8000}
          value={definition.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <details>
        <summary>{w("definitionDetails")}</summary>
        <label>
          {w("identifier")}
          <input
            value={definition.id}
            onChange={(e) => set({ id: e.target.value })}
          />
        </label>
      </details>
      <section>
        <h3>{w("parameters")}</h3>
        <p className="tandem-settings-help">{w("parameterHint")}</p>
        {Object.entries(definition.parameters).map(([key, spec]) => (
          <article className="tandem-workflow-parameter" key={key}>
            <div className="tandem-settings-row">
              <strong>{key}</strong>
              <label>
                <span className="sr-only">{w("parameterType")}</span>
                <select
                  value={spec.type}
                  onChange={(e) =>
                    param(key, {
                      ...makeParam(e.target.value as WorkflowParameter["type"]),
                      description: spec.description,
                      required: spec.required,
                    })
                  }
                >
                  {[
                    "string",
                    "integer",
                    "boolean",
                    "enum",
                    "remote-directory",
                    "secret-ref",
                  ].map((type) => (
                    <option key={type} value={type}>
                      {w("types." + type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tandem-settings-check">
                <input
                  type="checkbox"
                  checked={!!spec.required}
                  onChange={(e) =>
                    param(key, { ...spec, required: e.target.checked })
                  }
                />
                {w("required")}
              </label>
              <Button
                variant="ghost"
                aria-label={w("removeParameter") + " " + key}
                onClick={() => {
                  const parameters = { ...definition.parameters };
                  delete parameters[key];
                  set({ parameters });
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <label>
              {w("parameterDescription")}
              <input
                value={spec.description ?? ""}
                onChange={(e) =>
                  param(key, { ...spec, description: e.target.value })
                }
              />
            </label>
            {spec.type === "secret-ref" ? (
              <p className="tandem-settings-help">{w("secretUnsupported")}</p>
            ) : spec.type === "boolean" ? (
              <label>
                {w("default")}
                <select
                  value={spec.default === undefined ? "" : String(spec.default)}
                  onChange={(e) =>
                    param(key, {
                      ...spec,
                      default:
                        e.target.value === ""
                          ? undefined
                          : e.target.value === "true",
                    })
                  }
                >
                  <option value="">{w("noDefault")}</option>
                  <option value="true">{w("true")}</option>
                  <option value="false">{w("false")}</option>
                </select>
              </label>
            ) : (
              <label>
                {w("default")}
                <input
                  type={spec.type === "integer" ? "number" : "text"}
                  value={spec.default ?? ""}
                  onChange={(e) =>
                    param(
                      key,
                      spec.type === "integer"
                        ? {
                            ...spec,
                            default:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          }
                        : {
                            ...spec,
                            default:
                              e.target.value === ""
                                ? undefined
                                : e.target.value,
                          },
                    )
                  }
                />
              </label>
            )}
            {spec.type === "integer" ? (
              <div className="tandem-settings-row">
                {(["min", "max"] as const).map((bound) => (
                  <label key={bound}>
                    {w(bound)}
                    <input
                      type="number"
                      value={spec[bound] ?? ""}
                      onChange={(e) =>
                        param(key, {
                          ...spec,
                          [bound]:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ) : spec.type === "enum" ? (
              <label>
                {w("enumValues")}
                <textarea
                  value={spec.values.join("\n")}
                  onChange={(e) =>
                    param(key, { ...spec, values: e.target.value.split("\n") })
                  }
                />
              </label>
            ) : spec.type === "string" ? (
              <div className="tandem-settings-row">
                {(["minLength", "maxLength"] as const).map((bound) => (
                  <label key={bound}>
                    {w(bound)}
                    <input
                      type="number"
                      min={bound === "minLength" ? 0 : 1}
                      max={32768}
                      value={spec[bound] ?? ""}
                      onChange={(e) =>
                        param(key, {
                          ...spec,
                          [bound]:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        <div className="tandem-settings-row">
          <label>
            {w("newParameter")}
            <input
              value={parameterName}
              maxLength={80}
              onChange={(e) => setParameterName(e.target.value)}
            />
          </label>
          <label>
            {w("parameterType")}
            <select
              value={parameterType}
              onChange={(e) =>
                setParameterType(e.target.value as WorkflowParameter["type"])
              }
            >
              {[
                "string",
                "integer",
                "boolean",
                "enum",
                "remote-directory",
                "secret-ref",
              ].map((type) => (
                <option key={type} value={type}>
                  {w("types." + type)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={
              !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(parameterName) ||
              Object.hasOwn(definition.parameters, parameterName) ||
              Object.keys(definition.parameters).length >= 64
            }
            onClick={() => {
              param(parameterName, makeParam(parameterType));
              setParameterName("");
            }}
          >
            <Plus size={14} />
            {w("addParameter")}
          </Button>
        </div>
      </section>
      <section>
        <h3>{w("defaults")}</h3>
        <div className="tandem-settings-row">
          <WorkflowValueEditor
            label={w("defaultDirectory")}
            directory
            parameters={definition.parameters}
            value={definition.defaults.cwd}
            onChange={(value) =>
              set({
                defaults: {
                  ...definition.defaults,
                  cwd: value === "" ? undefined : (value as WorkflowValue),
                },
              })
            }
          />
          <label>
            {w("directoryMode")}
            <select
              value={definition.shellState ?? "explicit-cwd"}
              onChange={(e) =>
                set({
                  shellState: e.target
                    .value as WorkflowDefinition["shellState"],
                })
              }
            >
              <option value="explicit-cwd">{w("explicitDirectory")}</option>
              <option value="stateful-shell">{w("statefulDirectory")}</option>
            </select>
          </label>
          <label>
            {w("timeout")}
            <input
              type="number"
              min={1}
              max={600}
              value={(definition.defaults.timeoutMs ?? 120000) / 1000}
              onChange={(e) =>
                set({
                  defaults: {
                    ...definition.defaults,
                    timeoutMs: Number(e.target.value) * 1000,
                  },
                })
              }
            />
          </label>
        </div>
        <p className="tandem-settings-help">{w("directoryHint")}</p>
        <details>
          <summary>{w("environment")}</summary>
          <p className="tandem-settings-help">{w("environmentHint")}</p>
          {Object.entries(definition.defaults.env ?? {}).map(
            ([name, value]) => (
              <div key={name} className="tandem-settings-row">
                <WorkflowValueEditor
                  label={name}
                  parameters={Object.fromEntries(
                    Object.entries(definition.parameters).filter(
                      ([, p]) => p.type !== "boolean",
                    ),
                  )}
                  value={value}
                  onChange={(value) =>
                    set({
                      defaults: {
                        ...definition.defaults,
                        env: {
                          ...definition.defaults.env,
                          [name]: value as WorkflowValue,
                        },
                      },
                    })
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={w("removeEnvironment") + " " + name}
                  onClick={() => {
                    const env = { ...definition.defaults.env };
                    delete env[name];
                    set({ defaults: { ...definition.defaults, env } });
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          )}
          <div className="tandem-settings-row">
            <label>
              {w("environmentName")}
              <input
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={
                !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(newEnv) ||
                Object.hasOwn(definition.defaults.env ?? {}, newEnv)
              }
              onClick={() => {
                set({
                  defaults: {
                    ...definition.defaults,
                    env: { ...definition.defaults.env, [newEnv]: "" },
                  },
                });
                setNewEnv("");
              }}
            >
              {w("addEnvironment")}
            </Button>
          </div>
        </details>
      </section>
      <section>
        <h3>{w("steps")}</h3>
        {definition.steps.map((step, index) => (
          <article key={step.id} className="tandem-workflow-step">
            <header>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <label>
                {w("stepName")}
                <input
                  value={step.name}
                  maxLength={120}
                  onChange={(e) => updateStep(index, { name: e.target.value })}
                />
              </label>
              <Button
                variant="ghost"
                disabled={index === 0}
                aria-label={w("moveUp")}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                variant="ghost"
                disabled={index === definition.steps.length - 1}
                aria-label={w("moveDown")}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                variant="ghost"
                disabled={definition.steps.length === 1}
                aria-label={w("removeStep")}
                onClick={() =>
                  set({ steps: definition.steps.filter((_, i) => i !== index) })
                }
              >
                <Trash2 size={14} />
              </Button>
            </header>
            <div className="tandem-settings-row">
              <label>
                {w("actionType")}
                <select
                  value={step.action.type}
                  onChange={(e) =>
                    updateStep(index, {
                      action:
                        e.target.value === "command"
                          ? { type: "command", program: "", args: [] }
                          : {
                              type: "script",
                              shell: "bash",
                              source: "",
                              args: [],
                            },
                    })
                  }
                >
                  <option value="command">{w("command")}</option>
                  <option value="script">{w("script")}</option>
                </select>
              </label>
              {step.action.type === "command" ? (
                <label>
                  {w("program")}
                  <input
                    value={step.action.program}
                    onChange={(e) =>
                      updateStep(index, {
                        action: {
                          ...step.action,
                          type: "command",
                          program: e.target.value,
                          args: step.action.args ?? [],
                        },
                      })
                    }
                  />
                </label>
              ) : (
                <label>
                  {w("shell")}
                  <select
                    value={step.action.shell}
                    onChange={(e) => {
                      if (step.action.type === "script")
                        updateStep(index, {
                          action: {
                            ...step.action,
                            shell: e.target.value as "sh" | "bash",
                          },
                        });
                    }}
                  >
                    <option value="bash">Bash</option>
                    <option value="sh">POSIX sh</option>
                  </select>
                </label>
              )}
            </div>
            {step.action.type === "script" && (
              <>
                <p className="tandem-settings-help">{w("scriptHint")}</p>
                <label>
                  {w("scriptSource")}
                  <textarea
                    className="tandem-settings-code"
                    rows={5}
                    value={step.action.source}
                    onChange={(e) => {
                      if (step.action.type === "script")
                        updateStep(index, {
                          action: { ...step.action, source: e.target.value },
                        });
                    }}
                  />
                </label>
              </>
            )}
            {(step.action.args ?? []).map((arg, n) => (
              <div className="tandem-settings-row" key={n}>
                <WorkflowValueEditor
                  label={w("argument") + " " + (n + 1)}
                  parameters={definition.parameters}
                  value={arg}
                  onChange={(value) => argument(index, n, value)}
                />
                <Button
                  variant="ghost"
                  aria-label={w("removeArgument")}
                  onClick={() =>
                    updateStep(index, {
                      action: {
                        ...step.action,
                        args: (step.action.args ?? []).filter(
                          (_, i) => i !== n,
                        ),
                      },
                    })
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={(step.action.args?.length ?? 0) >= 256}
              onClick={() =>
                updateStep(index, {
                  action: {
                    ...step.action,
                    args: [...(step.action.args ?? []), ""],
                  },
                })
              }
            >
              {w("addArgument")}
            </Button>
            <details>
              <summary>{w("stepOptions")}</summary>
              <WorkflowValueEditor
                directory
                label={w("stepDirectory")}
                parameters={definition.parameters}
                value={step.cwd}
                onChange={(value) =>
                  updateStep(index, {
                    cwd: value === "" ? undefined : (value as WorkflowValue),
                  })
                }
              />
              <div className="tandem-settings-row">
                <label>
                  {w("timeout")}
                  <input
                    type="number"
                    min={1}
                    max={600}
                    placeholder={String(
                      (definition.defaults.timeoutMs ?? 120000) / 1000,
                    )}
                    value={
                      step.timeoutMs === undefined ? "" : step.timeoutMs / 1000
                    }
                    onChange={(e) =>
                      updateStep(index, {
                        timeoutMs:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value) * 1000,
                      })
                    }
                  />
                </label>
                <label>
                  {w("onFailure")}
                  <select
                    value={
                      step.onFailure ?? definition.defaults.onFailure ?? "stop"
                    }
                    onChange={(e) =>
                      updateStep(index, {
                        onFailure: e.target.value as "stop" | "continue",
                      })
                    }
                  >
                    <option value="stop">{w("stop")}</option>
                    <option value="continue">{w("continue")}</option>
                  </select>
                </label>
              </div>
              {(step.onFailure ?? definition.defaults.onFailure) ===
                "continue" && (
                <p className="tandem-settings-help">{w("continueHint")}</p>
              )}
            </details>
          </article>
        ))}
        <Button
          variant="outline"
          disabled={definition.steps.length >= 100}
          onClick={() =>
            set({
              steps: [
                ...definition.steps,
                {
                  id: "step-" + crypto.randomUUID(),
                  name: "",
                  action: { type: "command", program: "", args: [] },
                },
              ],
            })
          }
        >
          <Plus size={14} />
          {w("addStep")}
        </Button>
      </section>
    </div>
  );
}
