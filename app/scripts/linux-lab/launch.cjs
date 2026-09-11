const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  net = require("net"),
  cp = require("child_process");
const workspace = fs.realpathSync(path.resolve(__dirname, "../../..")),
  ssh2 = require(path.join(workspace, "app/node_modules/ssh2"));
fs.mkdirSync(path.join(workspace, ".cache/linux-lab"), { recursive: true });
const cache = fs.realpathSync(path.join(workspace, ".cache/linux-lab")),
  tools = fs.realpathSync(
    process.env.TANDEM_QEMU_DIR || path.join(workspace, ".tools/qemu-11.1.0"),
  ),
  id = crypto.randomUUID(),
  name = "tandem-linux-" + id,
  dir = path.join(cache, "runs", id);
fs.mkdirSync(dir, { recursive: true });
function key() {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }),
    pem = pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    parsed = ssh2.utils.parseKey(pem);
  if (parsed instanceof Error) throw parsed;
  return {
    pem,
    public:
      "ssh-rsa " + parsed.getPublicSSH().toString("base64") + " tandem-fixture",
    fingerprint:
      "SHA256:" +
      crypto
        .createHash("sha256")
        .update(parsed.getPublicSSH())
        .digest("base64")
        .replace(/=+$/, ""),
  };
}
function run(exe, args, options = {}) {
  const r = cp.spawnSync(exe, args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: 60000,
    ...options,
  });
  if (r.status !== 0)
    throw Error(path.basename(exe) + " failed: " + (r.stderr || r.stdout));
  return r.stdout;
}
async function freePort() {
  const s = net.createServer();
  await new Promise((r, j) => {
    s.once("error", j);
    s.listen(0, "127.0.0.1", r);
  });
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
(async () => {
  const expectedImage =
    "6e2e6fe0572b6632527f268d3659e8fccebda4e1ee470fafe2c4d7b85b6a4df6";
  if (
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(cache, "alpine-base.qcow2")))
      .digest("hex") !== expectedImage
  )
    throw Error("Pinned Alpine image checksum mismatch");
  const clientKey = key(),
    hostKey = key(),
    password = crypto.randomUUID(),
    port = await freePort(),
    qmpPort = await freePort(),
    mac = "52:54:00:65:21:09",
    remoteRoot = "/home/alpine/tandem-test";
  fs.writeFileSync(path.join(dir, "client.pem"), clientKey.pem);
  fs.writeFileSync(path.join(dir, "client.pub"), clientKey.public + "\n");
  const sshd =
    "Port 22\nListenAddress 0.0.0.0\nHostKey /etc/ssh/ssh_host_rsa_key\nPasswordAuthentication yes\nPubkeyAuthentication yes\nPermitRootLogin no\nPermitEmptyPasswords no\nAllowUsers alpine\nAllowTcpForwarding yes\nGatewayPorts clientspecified\nSubsystem sftp internal-sftp\nLogLevel VERBOSE\n";
  const userData = {
    hostname: "tandem-linux",
    manage_etc_hosts: true,
    users: ["default"],
    ssh_authorized_keys: [clientKey.public],
    ssh_pwauth: true,
    ssh_deletekeys: true,
    ssh_genkeytypes: [],
    ssh_keys: { rsa_private: hostKey.pem, rsa_public: hostKey.public },
    chpasswd: {
      expire: false,
      users: [{ name: "alpine", password, type: "text" }],
    },
    growpart: { mode: "auto", devices: ["/"] },
    resize_rootfs: true,
    write_files: [
      { path: "/etc/ssh/sshd_config", permissions: "0600", content: sshd },
    ],
    runcmd: [
      [
        "sh",
        "-c",
        "addgroup -g 1600 tandem-files; addgroup alpine tandem-files; mkdir -p /home/alpine/tandem-test /mnt/tandem-full /srv/tandem-denied; chown alpine:alpine /home/alpine/tandem-test; chmod 700 /srv/tandem-denied; mount -t tmpfs -o size=1048576 tmpfs /mnt/tandem-full; chmod 777 /mnt/tandem-full; rc-service sshd restart; printf '\\nTANDEM_LINUX_READY\\n' > /dev/ttyS0",
      ],
    ],
  };
  const seed = {
    output: path.join(dir, "seed.iso"),
    pythonDependencies: path.join(cache, "pydeps"),
    files: {
      "user-data": "#cloud-config\n" + JSON.stringify(userData, null, 2) + "\n",
      "meta-data":
        JSON.stringify({
          "instance-id": id,
          "local-hostname": "tandem-linux",
        }) + "\n",
      "network-config":
        JSON.stringify({
          version: 1,
          config: [
            {
              type: "physical",
              name: "eth0",
              mac_address: mac,
              subnets: [{ type: "dhcp4" }],
            },
          ],
        }) + "\n",
    },
  };
  fs.writeFileSync(path.join(dir, "seed.json"), JSON.stringify(seed));
  run(process.env.TANDEM_LINUX_PYTHON || "python", [
    path.join(__dirname, "make-seed.py"),
    path.join(dir, "seed.json"),
  ]);
  const disk = path.join(dir, "disk.qcow2");
  run(path.join(tools, "qemu-img.exe"), [
    "create",
    "-f",
    "qcow2",
    "-F",
    "qcow2",
    "-b",
    path.join(cache, "alpine-base.qcow2"),
    disk,
  ]);
  run(path.join(tools, "qemu-img.exe"), ["resize", disk, "4G"]);
  const args = [
    "-name",
    name,
    "-machine",
    "pc",
    "-accel",
    process.env.TANDEM_LINUX_ICOUNT === "1"
      ? "tcg,thread=single"
      : "tcg,thread=multi",
    ...(process.env.TANDEM_LINUX_ICOUNT === "1"
      ? ["-icount", "shift=auto"]
      : []),
    "-cpu",
    "max",
    "-smp",
    "2",
    "-m",
    "1024",
    "-display",
    "none",
    "-monitor",
    "none",
    "-serial",
    "file:" + path.join(dir, "serial.log").replaceAll("\\", "/"),
    "-qmp",
    "tcp:127.0.0.1:" + qmpPort + ",server=on,wait=off",
    "-drive",
    "file=" + disk.replaceAll("\\", "/") + ",format=qcow2,if=virtio",
    "-drive",
    "file=" +
      seed.output.replaceAll("\\", "/") +
      ",format=raw,media=cdrom,readonly=on",
    "-netdev",
    "user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:" + port + "-:22",
    "-device",
    "virtio-net-pci,netdev=net0,mac=" + mac,
    "-boot",
    "order=c",
    "-no-reboot",
  ];
  const qemu = cp.spawn(path.join(tools, "qemu-system-x86_64.exe"), args, {
    cwd: tools,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  const log = fs.createWriteStream(path.join(dir, "qemu.log"));
  qemu.stdout.pipe(log, { end: false });
  qemu.stderr.pipe(log, { end: false });
  qemu.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  qemu.on("exit", (code, signal) => {
    exited = true;
    log.end();
    console.log(JSON.stringify({ vmExited: true, id, code, signal }));
  });
  const manifest = {
    id,
    name,
    dir,
    host: "127.0.0.1",
    port,
    qmpPort,
    pid: qemu.pid,
    user: "alpine",
    password,
    privateKey: path.join(dir, "client.pem"),
    hostFingerprint: hostKey.fingerprint,
    root: remoteRoot,
    timing:
      process.env.TANDEM_LINUX_ICOUNT === "1" ? "icount-auto" : "tcg-multi",
    qemuVersion: "11.1.0",
    alpineVersion: "3.24.1",
  };
  fs.writeFileSync(
    path.join(dir, "connection.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(cache, "current.json"),
    JSON.stringify({
      id,
      dir,
      manifest: path.join(dir, "connection.json"),
      pid: qemu.pid,
      port,
      qmpPort,
    }),
  );
  console.log(
    JSON.stringify({
      vmStarted: true,
      id,
      dir,
      pid: qemu.pid,
      port,
      qmpPort,
      hostFingerprint: hostKey.fingerprint,
    }),
  );
  const deadline = Date.now() + 240000;
  let lastError = "not attempted";
  while (Date.now() < deadline && !exited) {
    try {
      const output = await new Promise((resolve, reject) => {
        const client = new ssh2.Client();
        client.on("error", reject);
        client.on("ready", () =>
          client.exec(
            "uname -s; id -u; cat /etc/alpine-release; df -B1 / | tail -1",
            (error, stream) => {
              if (error) {
                client.end();
                reject(error);
                return;
              }
              let out = "";
              stream.on("data", (data) => (out += data));
              stream.stderr.on("data", (data) => (out += data));
              stream.on("close", (code) => {
                client.end();
                code === 0 ? resolve(out) : reject(Error("Probe exit " + code));
              });
            },
          ),
        );
        client.connect({
          host: "127.0.0.1",
          port,
          username: "alpine",
          privateKey: clientKey.pem,
          readyTimeout: 5000,
          algorithms: { serverHostKey: ["rsa-sha2-512", "rsa-sha2-256"] },
          hostVerifier: (key) =>
            "SHA256:" +
              crypto
                .createHash("sha256")
                .update(key)
                .digest("base64")
                .replace(/=+$/, "") ===
            hostKey.fingerprint,
        });
      });
      if (!output.startsWith("Linux\n") || !output.includes("3.24.1"))
        throw Error("Linux probe mismatch");
      fs.writeFileSync(
        path.join(dir, "ready.json"),
        JSON.stringify({ linux: true, output, at: new Date().toISOString() }),
      );
      console.log(JSON.stringify({ vmReady: true, id, output }));
      return;
    } catch (error) {
      lastError = error.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  fs.writeFileSync(
    path.join(dir, "boot-failure.json"),
    JSON.stringify({ exited, lastError }),
  );
  console.error("Linux VM not ready: " + lastError);
  process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
