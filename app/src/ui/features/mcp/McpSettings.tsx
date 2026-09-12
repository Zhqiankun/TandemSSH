import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cable, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog";
import { copyToClipboard } from "@/lib/clipboard";
import { mcpApi, codexMcpConfiguration, type McpHost } from "@/api/mcp-api";
import type { McpPairing, McpClientConfiguration } from "@/types/mcp-pairing";
export function McpSettings({ hostId }: { hostId?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Cable size={14} />
          {t("tandem.mcp.settings")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tandem.mcp.title")}</DialogTitle>
          <DialogDescription>{t("tandem.mcp.description")}</DialogDescription>
        </DialogHeader>
        {open && <PairingForm hostId={hostId} />}
      </DialogContent>
    </Dialog>
  );
}
function PairingForm({ hostId }: { hostId?: number }) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<McpHost[]>([]),
    [clients, setClients] = useState<McpPairing[]>([]),
    [selected, setSelected] = useState<number[]>(hostId ? [hostId] : []);
  const [name, setName] = useState("Codex"),
    [readTerminal, setReadTerminal] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [configuration, setConfiguration] = useState<McpClientConfiguration>(),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void Promise.all([mcpApi.status(), mcpApi.hosts()])
      .then(([status, hosts]) => {
        if (alive) {
          setClients(status.clients);
          setHosts(hosts);
        }
      })
      .catch(() => {
        if (alive) setError(t("tandem.mcp.unavailable"));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [t]);
  async function run(
    action: () => Promise<void>,
    failureKey = "tandem.mcp.failed",
  ) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch {
      setError(t(failureKey));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 text-xs">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await mcpApi.create({
              name: name.trim(),
              allowedHostIds: selected,
              readTerminal,
            });
            setClients((previous) => [...previous, result.client]);
            setConfiguration(result.configuration);
            setCopied(false);
          });
        }}
      >
        <label className="block space-y-1">
          <span>{t("tandem.mcp.clientName")}</span>
          <input
            className="w-full rounded border bg-background p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">
            {t("tandem.mcp.hostScope")}
          </legend>
          <div className="max-h-40 overflow-y-auto space-y-2 border p-3">
            {hosts.length ? (
              hosts.map((host) => (
                <label key={host.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(host.id)}
                    onChange={(e) =>
                      setSelected((previous) =>
                        e.target.checked
                          ? [...previous, host.id]
                          : previous.filter((id) => id !== host.id),
                      )
                    }
                  />
                  <span>
                    {host.name}
                    <small className="block text-muted-foreground">
                      {host.address}:{host.port}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="text-muted-foreground">{t("tandem.mcp.noHosts")}</p>
            )}
          </div>
        </fieldset>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={readTerminal}
            onChange={(e) => setReadTerminal(e.target.checked)}
          />
          <span>
            {t("tandem.mcp.readTerminal")}
            <small className="block leading-relaxed text-muted-foreground">
              {t("tandem.mcp.readHint")}
            </small>
          </span>
        </label>
        <p className="text-muted-foreground leading-relaxed">
          {t("tandem.mcp.authorityHint")}
        </p>
        <Button
          type="submit"
          disabled={busy || !name.trim() || !selected.length}
        >
          {t("tandem.mcp.create")}
        </Button>
      </form>
      {configuration && (
        <section className="space-y-2">
          <div className="flex justify-between items-center">
            <strong>{t("tandem.mcp.configuration")}</strong>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setCopied(false);
                  const ok = await copyToClipboard(
                    codexMcpConfiguration(configuration),
                  );
                  if (!ok) {
                    setError(t("common.copyFailed"));
                    return;
                  }
                  setCopied(true);
                }, "common.copyFailed")
              }
            >
              <Copy size={13} />
              {copied ? t("tandem.mcp.copied") : t("tandem.mcp.copy")}
            </Button>
          </div>
          <p className="text-muted-foreground">{t("tandem.mcp.configHint")}</p>
          <textarea
            aria-label={t("tandem.mcp.configuration")}
            className="w-full min-h-36 rounded border bg-muted p-3 font-mono text-[10px]"
            readOnly
            value={codexMcpConfiguration(configuration)}
          />
        </section>
      )}
      {clients.length > 0 && (
        <section className="space-y-2 border-t pt-3">
          <h3 className="font-medium">{t("tandem.mcp.clients")}</h3>
          {clients.map((client) => (
            <div key={client.id} className="flex items-center gap-2 border p-2">
              <div className="flex-1 min-w-0">
                <strong>{client.name}</strong>
                <p className="text-muted-foreground text-[10px]">
                  {client.enabled
                    ? t("tandem.mcp.allowedCount", {
                        count: client.allowedHostIds.length,
                      })
                    : t("tandem.mcp.revoked")}
                </p>
              </div>
              {client.enabled && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setConfiguration(await mcpApi.configuration(client.id));
                        setCopied(false);
                      })
                    }
                  >
                    {t("tandem.mcp.configuration")}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t("tandem.mcp.revoke", { name: client.name })}
                    onClick={() =>
                      void run(async () => {
                        await mcpApi.revoke(client.id);
                        setClients((previous) =>
                          previous.map((item) =>
                            item.id === client.id
                              ? { ...item, enabled: false }
                              : item,
                          ),
                        );
                        setConfiguration(undefined);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
