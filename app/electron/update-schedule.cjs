const CHECK_INTERVAL_MS = 20 * 60 * 1000;
class UpdateCheckSchedule {
  constructor(check) {
    this.check = check;
    this.enabled = false;
    this.timer = undefined;
    this.generation = 0;
  }
  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextCheckAt = undefined;
    if (enabled) this.schedule(5000, this.generation);
  }
  schedule(delay, generation) {
    this.nextCheckAt = Date.now() + delay;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      this.nextCheckAt = undefined;
      try {
        await this.check();
      } catch {
        /* the service owns user-visible errors */
      }
      if (this.enabled && this.generation === generation)
        this.schedule(CHECK_INTERVAL_MS, generation);
    }, delay);
    this.timer.unref?.();
  }
  dispose() {
    this.setEnabled(false);
  }
  snapshot() {
    return {
      automaticChecks: this.enabled,
      checkIntervalMinutes: 20,
      nextCheckAt: this.nextCheckAt,
    };
  }
}
module.exports = { UpdateCheckSchedule, CHECK_INTERVAL_MS };
