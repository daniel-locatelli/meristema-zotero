/**
 * Debug lines that time startup from the Zotero process's start (B113), so a
 * reader's debug output shows where the graph tabs wait after a restart.
 */
export function markStartup(step: string): void {
  let since = "";
  try {
    const started = (Services.startup.getStartupInfo() as { process?: Date })
      .process;
    if (started) since = ` at +${Date.now() - started.getTime()} ms`;
  } catch {
    // Startup info is not available in every host.
  }
  Zotero.debug(`Meristema: startup ${step}${since}`);
}
