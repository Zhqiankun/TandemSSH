import "./workflow-settings.css";
import { useTranslation } from "react-i18next";
import type { FileScope, FileRule } from "@/types/file-operations";
export function FileScopeFields({
  value,
  onChange,
}: {
  value: FileScope;
  onChange: (value: FileScope) => void;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.fileScope." + key);
  return (
    <div className="tandem-file-scope-fields">
      <label>
        {w("path")}
        <input
          required
          maxLength={4096}
          pattern="/.*"
          value={value.path}
          onChange={(e) => onChange({ ...value, path: e.target.value })}
          placeholder="/srv/app"
        />
      </label>
      <label>
        {w("kind")}
        <select
          value={value.kind}
          onChange={(e) =>
            onChange({ ...value, kind: e.target.value as FileScope["kind"] })
          }
        >
          <option value="path">{w("exact")}</option>
          <option value="directory">{w("directory")}</option>
        </select>
      </label>
      <label>
        {w("access")}
        <select
          value={value.access.length === 2 ? "both" : value.access[0]}
          onChange={(e) =>
            onChange({
              ...value,
              access:
                e.target.value === "both"
                  ? ["read", "write"]
                  : [e.target.value as "read" | "write"],
            })
          }
        >
          <option value="read">{w("read")}</option>
          <option value="write">{w("write")}</option>
          <option value="both">{w("both")}</option>
        </select>
      </label>
    </div>
  );
}
export function FileScopeEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: FileScope[];
  onChange: (value: FileScope[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.fileScope." + key);
  return (
    <fieldset disabled={disabled} className="tandem-file-scopes">
      <legend>{w("title")}</legend>
      <p>{w("hint")}</p>
      {value.map((scope, i) => (
        <section key={i} aria-label={w("scope") + " " + (i + 1)}>
          <FileScopeFields
            value={scope}
            onChange={(next) =>
              onChange(value.map((v, n) => (n === i ? next : v)))
            }
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            {w("remove")}
          </button>
        </section>
      ))}
      <button
        type="button"
        disabled={value.length >= 128}
        onClick={() =>
          onChange([...value, { kind: "path", path: "", access: ["read"] }])
        }
      >
        {w("add")}
      </button>
    </fieldset>
  );
}
export function FilePolicyEditor({
  rules,
  strict,
  onChange,
}: {
  rules: FileRule[];
  strict: boolean;
  onChange: (patch: {
    fileRules?: FileRule[];
    strictFileAllowlist?: boolean;
  }) => void;
}) {
  const { t } = useTranslation(),
    w = (key: string) => t("tandem.fileScope." + key);
  const update = (index: number, patch: Partial<FileRule>) =>
    onChange({
      fileRules: rules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    });
  return (
    <section className="tandem-file-scopes" aria-label={w("rules")}>
      <h3>{w("rules")}</h3>
      <p>{w("rulesHint")}</p>
      <label>
        <input
          type="checkbox"
          checked={strict}
          onChange={(e) => onChange({ strictFileAllowlist: e.target.checked })}
        />
        {w("strict")}
      </label>
      {rules.map((rule, i) => (
        <section className={"tandem-policy-rule " + rule.effect} key={rule.id}>
          <label>
            {t("tandem.policy.effectLabel")}
            <select
              value={rule.effect}
              onChange={(e) =>
                update(i, { effect: e.target.value as FileRule["effect"] })
              }
            >
              {["deny", "confirm", "allow"].map((effect) => (
                <option key={effect} value={effect}>
                  {t("tandem.policy.effect." + effect)}
                </option>
              ))}
            </select>
          </label>
          <FileScopeFields
            value={rule.match}
            onChange={(match) => update(i, { match })}
          />
          <label>
            {t("tandem.policy.reason")}
            <input
              maxLength={2000}
              value={rule.reason}
              onChange={(e) => update(i, { reason: e.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              onChange({ fileRules: rules.filter((_, n) => n !== i) })
            }
          >
            {w("removeRule")}
          </button>
        </section>
      ))}
      <button
        type="button"
        disabled={rules.length >= 256}
        onClick={() =>
          onChange({
            fileRules: [
              ...rules,
              {
                id: crypto.randomUUID(),
                effect: "deny",
                match: { kind: "path", path: "", access: ["read", "write"] },
                reason: "",
              },
            ],
          })
        }
      >
        {w("addRule")}
      </button>
    </section>
  );
}
